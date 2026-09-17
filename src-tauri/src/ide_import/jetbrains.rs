use super::{candidate, resolve_value, service_defaults, shell_quote, ParsedResult};
use crate::models::EnvVar;
use quick_xml::{events::Event, Reader};
use std::path::Path;

#[derive(Default)]
struct XmlConfig {
    kind: String,
    name: String,
    options: std::collections::HashMap<String, Vec<String>>,
    env: Vec<EnvVar>,
    has_before_run: bool,
}

pub fn parse(text: &str, workspace: &Path) -> Result<ParsedResult, String> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut config = XmlConfig::default();
    let mut in_envs = false;
    let mut in_list: Option<String> = None;
    let mut current_option: Option<String> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => match event.name().as_ref() {
                b"configuration" => {
                    config.kind = attr(&event, b"type").unwrap_or_default();
                    config.name = attr(&event, b"name").unwrap_or_else(|| "IDEA 配置".into());
                }
                b"envs" => in_envs = true,
                b"option" => {
                    current_option = attr(&event, b"name");
                }
                b"list" => {
                    in_list = current_option.clone();
                }
                b"method" => config.has_before_run = true,
                _ => {}
            },
            Ok(Event::Empty(event)) => match event.name().as_ref() {
                b"option" => {
                    let name = attr(&event, b"name").unwrap_or_default();
                    if let Some(value) = attr(&event, b"value") {
                        if in_list.is_some() {
                            config
                                .options
                                .entry(in_list.clone().unwrap())
                                .or_default()
                                .push(value);
                        } else {
                            config.options.entry(name).or_default().push(value);
                        }
                    }
                }
                b"env" if in_envs => {
                    if let (Some(key), Some(value)) =
                        (attr(&event, b"name"), attr(&event, b"value"))
                    {
                        config.env.push(EnvVar { key, value });
                    }
                }
                b"method" => config.has_before_run = true,
                _ => {}
            },
            Ok(Event::End(event)) => match event.name().as_ref() {
                b"envs" => in_envs = false,
                b"list" => in_list = None,
                b"option" => current_option = None,
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("IDEA XML 解析失败: {error}")),
            _ => {}
        }
    }
    if config.kind.is_empty() {
        return Err("IDEA 配置缺少 type".into());
    }
    let candidate = match config.kind.as_str() {
        "MavenRunConfiguration" => maven(config, workspace),
        "GradleRunConfiguration" => gradle(config, workspace),
        "Application" => Ok(candidate(config.name, None, "needsInput", vec!["Java Application 只有入口类，Avenil 不猜 classpath、module path、JRE 或构建命令".into()], vec!["classpath/modulePath/JRE/构建命令".into()])),
        kind if kind.to_ascii_lowercase().contains("springboot") => Ok(candidate(config.name, None, "needsInput", vec!["Spring Boot 启动配置依赖 IDE 的 classpath、JRE 和构建模型，Avenil 不自动生成 Java 命令".into()], vec!["classpath/modulePath/JRE/构建命令".into()])),
        _ => Ok(candidate(config.name, None, "unsupported", vec![format!("暂不支持 IDEA 配置类型: {}", config.kind)], vec![])),
    }?;
    Ok(ParsedResult {
        candidates: vec![candidate],
        warnings: vec![],
    })
}

fn maven(config: XmlConfig, workspace: &Path) -> Result<super::ParsedCandidate, String> {
    build_build_tool(config, workspace, "mvn", "GOALS", "Maven", "POM_FILE_NAME")
}

fn gradle(config: XmlConfig, workspace: &Path) -> Result<super::ParsedCandidate, String> {
    build_build_tool(
        config,
        workspace,
        "gradle",
        "TASK_NAMES",
        "Gradle",
        "EXTERNAL_PROJECT_PATH",
    )
}

fn build_build_tool(
    config: XmlConfig,
    workspace: &Path,
    executable: &str,
    task_key: &str,
    label: &str,
    project_key: &str,
) -> Result<super::ParsedCandidate, String> {
    let name = config.name.clone();
    let tasks = option_values(&config.options, task_key).unwrap_or_default();
    let tasks = tasks
        .iter()
        .flat_map(|value| value.split_whitespace().map(str::to_string))
        .collect::<Vec<_>>();
    if tasks.is_empty() {
        return Ok(candidate(
            name,
            None,
            "needsInput",
            vec![format!("{label} 配置没有明确任务或目标")],
            vec![task_key.into()],
        ));
    }
    let workdir_raw = option_values(&config.options, "WORKING_DIRECTORY")
        .and_then(|values| values.first().cloned())
        .unwrap_or_else(|| "$PROJECT_DIR$".into());
    let workdir = match resolve_value(&workdir_raw, workspace) {
        Ok(value) => std::path::PathBuf::from(value),
        Err(error) => {
            return Ok(candidate(
                name,
                None,
                "needsInput",
                vec![error],
                vec!["WORKING_DIRECTORY".into()],
            ))
        }
    };
    if !workdir.is_dir() {
        return Ok(candidate(
            name,
            None,
            "needsInput",
            vec!["工作目录不存在".into()],
            vec!["WORKING_DIRECTORY".into()],
        ));
    }
    let mut command_parts = vec![executable.to_string()];
    command_parts.extend(tasks);
    if label == "Maven" {
        if let Some(values) = option_values(&config.options, "PROFILES") {
            for value in values {
                if !value.trim().is_empty() {
                    command_parts.push(format!("-P{}", value.trim()));
                }
            }
        }
    }
    let mut raw_suffix = Vec::new();
    if let Some(values) = option_values(&config.options, "PROGRAM_PARAMETERS") {
        raw_suffix.extend(values);
    }
    if label == "Gradle" {
        if let Some(values) = option_values(&config.options, "SCRIPT_PARAMETERS") {
            raw_suffix.extend(values);
        }
    }
    let mut missing = vec![];
    if config.has_before_run {
        missing.push("beforeRun".into());
    }
    for key in config.options.keys() {
        let normalized = normalize(key);
        if normalized.contains("jre")
            || normalized.contains("alternativejre")
            || normalized.contains("target")
            || normalized.contains("runon")
            || normalized == "vmparameters"
            || normalized == "vmoptions"
            || normalized == "mavenopts"
            || normalized == "gradleopts"
        {
            missing.push(key.clone());
        }
    }
    if let Some(project) =
        option_values(&config.options, project_key).and_then(|values| values.first().cloned())
    {
        if resolve_value(&project, workspace).is_err() {
            missing.push(project_key.into());
        }
    }
    let mut env = config.env;
    for item in &mut env {
        item.value = match resolve_value(&item.value, workspace) {
            Ok(value) => value,
            Err(error) => {
                return Ok(candidate(
                    name,
                    None,
                    "needsInput",
                    vec![error],
                    vec!["env".into()],
                ))
            }
        };
    }
    let mut command = command_parts
        .iter()
        .map(|item| shell_quote(item))
        .collect::<Vec<_>>()
        .join(" ");
    for suffix in raw_suffix {
        if !suffix.trim().is_empty() {
            command.push(' ');
            command.push_str(&suffix);
        }
    }
    let service = service_defaults(name.clone(), &workdir, command, env);
    let warnings = vec![format!(
        "按本机 {label} 前台任务导入，不保留 IDEA 调试/构建编排"
    )];
    Ok(candidate(
        name,
        Some(service),
        if missing.is_empty() {
            "ready"
        } else {
            "needsInput"
        },
        warnings,
        missing,
    ))
}

fn attr(event: &quick_xml::events::BytesStart<'_>, wanted: &[u8]) -> Option<String> {
    event
        .attributes()
        .flatten()
        .find(|attribute| attribute.key.as_ref() == wanted)
        .and_then(|attribute| String::from_utf8(attribute.value.into_owned()).ok())
}

fn option_values(
    options: &std::collections::HashMap<String, Vec<String>>,
    wanted: &str,
) -> Option<Vec<String>> {
    let wanted = normalize(wanted);
    options
        .iter()
        .find(|(key, _)| normalize(key) == wanted)
        .map(|(_, value)| value.clone())
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn parses_maven_run_configuration_into_a_ready_service() {
        let result = parse(
            r#"
            <component name="ProjectRunConfigurationManager">
              <configuration name="api" type="MavenRunConfiguration">
                <option name="WORKING_DIRECTORY" value="$PROJECT_DIR$" />
                <option name="POM_FILE_NAME" value="$PROJECT_DIR$/pom.xml" />
                <option name="GOALS"><list><option value="spring-boot:run" /></list></option>
                <envs><env name="PROFILE" value="local" /></envs>
              </configuration>
            </component>
            "#,
            Path::new("/tmp"),
        )
        .unwrap();

        let candidate = &result.candidates[0];
        assert_eq!(candidate.status, "ready");
        assert_eq!(candidate.name, "api");
        assert!(candidate
            .service
            .as_ref()
            .unwrap()
            .command
            .contains("spring-boot:run"));
        assert_eq!(candidate.service.as_ref().unwrap().env[0].key, "PROFILE");
    }

    #[test]
    fn marks_unsupported_idea_types_without_guessing_commands() {
        let result = parse(
            r#"<configuration name="app" type="Application"><option name="MAIN_CLASS_NAME" value="com.example.App" /></configuration>"#,
            Path::new("/tmp"),
        )
        .unwrap();

        assert_eq!(result.candidates[0].status, "needsInput");
        assert!(result.candidates[0].service.is_none());
        assert!(result.candidates[0].missing[0].contains("classpath"));
    }

    #[test]
    fn rejects_configurations_without_a_type() {
        assert!(
            parse(r#"<configuration name="missing" />"#, Path::new("/tmp"))
                .err()
                .unwrap()
                .contains("缺少 type")
        );
    }
}
