use super::{
    candidate, env_from_object, resolve_value, service_defaults, shell_quote, ParsedResult,
};
use quick_xml::{events::Event, Reader};
use serde_json::Value;
use std::{fs, path::Path};

pub fn parse(text: &str, workspace: &Path) -> Result<ParsedResult, String> {
    let root: Value =
        json5::from_str(text).map_err(|e| format!("launch.json JSONC 解析失败: {e}"))?;
    let object = root
        .as_object()
        .ok_or_else(|| "launch.json 顶层必须是对象".to_string())?;
    let configurations = object
        .get("configurations")
        .and_then(Value::as_array)
        .ok_or_else(|| "launch.json 缺少 configurations 数组".to_string())?;
    let mut result = ParsedResult {
        candidates: vec![],
        warnings: vec![],
    };
    for item in configurations {
        let Some(config) = item.as_object() else {
            result.candidates.push(candidate(
                "无名配置".into(),
                None,
                "unsupported",
                vec![],
                vec!["配置项不是对象".into()],
            ));
            continue;
        };
        let name = config
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("无名配置")
            .to_string();
        let kind = config.get("type").and_then(Value::as_str).unwrap_or("");
        let request = config.get("request").and_then(Value::as_str).unwrap_or("");
        if request == "attach" {
            result.candidates.push(candidate(
                name,
                None,
                "unsupported",
                vec!["Avenil 不提供调试器 attach，未生成服务".into()],
                vec![],
            ));
            continue;
        }
        if request != "launch" {
            result.candidates.push(candidate(
                name,
                None,
                "unsupported",
                vec!["只支持 request=launch".into()],
                vec!["request".into()],
            ));
            continue;
        }
        let parsed = match kind {
            "node-terminal" => parse_node_terminal(config, &name, workspace),
            "node" | "pwa-node" => parse_node(config, &name, workspace),
            "java" => parse_java(config, &name, workspace),
            "python" | "debugpy" => parse_python(config, &name, workspace),
            "" => Ok(candidate(
                name,
                None,
                "unsupported",
                vec!["缺少调试扩展 type".into()],
                vec!["type".into()],
            )),
            _ => Ok(candidate(
                name,
                None,
                "unsupported",
                vec![format!("未知或扩展专属的 VS Code type: {kind}")],
                vec![],
            )),
        }?;
        result.candidates.push(parsed);
    }
    if let Some(compounds) = object.get("compounds").and_then(Value::as_array) {
        for compound in compounds {
            let name = compound
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("无名 compound")
                .to_string();
            result.candidates.push(candidate(
                name,
                None,
                "unsupported",
                vec!["compound 只表示 IDE 调试编排，Avenil 不导入依赖关系".into()],
                vec![],
            ));
        }
    }
    Ok(result)
}

fn parse_node_terminal(
    config: &serde_json::Map<String, Value>,
    name: &str,
    workspace: &Path,
) -> Result<super::ParsedCandidate, String> {
    let Some(command) = config.get("command").and_then(Value::as_str) else {
        return Ok(candidate(
            name.into(),
            None,
            "needsInput",
            vec![],
            vec!["command".into()],
        ));
    };
    let mut warnings = vec!["按普通前台 shell 命令导入，不保留 IDE 调试能力".into()];
    let command = match resolve_value(command, workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["动态变量".into()],
            ))
        }
    };
    let cwd = match resolve_cwd(config, workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["cwd".into()],
            ))
        }
    };
    let env = match env_from_object(config.get("env"), workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["env".into()],
            ))
        }
    };
    let mut missing = special_fields(config);
    if config.contains_key("envFile") {
        missing.push("envFile".into());
    }
    if !missing.is_empty() {
        warnings.push("存在 IDE 任务或外部环境语义，需在 Avenil 中重新确认".into());
    }
    let service = service_defaults(name.into(), &cwd, command, env);
    Ok(candidate(
        service.name.clone(),
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

fn parse_node(
    config: &serde_json::Map<String, Value>,
    name: &str,
    workspace: &Path,
) -> Result<super::ParsedCandidate, String> {
    let executable = match optional_string(config, "runtimeExecutable") {
        Ok(Some(value)) => value,
        Ok(None) => "node",
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["runtimeExecutable".into()],
            ))
        }
    };
    let program = match optional_string(config, "program") {
        Ok(Some(value)) => value,
        Ok(None) => return parse_node_script(config, name, workspace, executable),
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["program".into()],
            ))
        }
    };
    let values = match resolve_values(
        executable,
        config.get("runtimeArgs"),
        program,
        config.get("args"),
        workspace,
    ) {
        Ok(values) => values,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["动态变量或参数".into()],
            ))
        }
    };
    let cwd = match resolve_cwd(config, workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["cwd".into()],
            ))
        }
    };
    let env = match env_from_object(config.get("env"), workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["env".into()],
            ))
        }
    };
    let mut warnings = vec!["按普通前台运行导入，不保留 IDE 调试能力".into()];
    let mut missing = special_fields(config);
    if config.contains_key("envFile") {
        missing.push("envFile".into());
    }
    if !missing.is_empty() {
        warnings.push("存在 IDE 任务或外部环境语义，需在 Avenil 中重新确认".into());
    }
    let service = service_defaults(name.into(), &cwd, values, env);
    Ok(candidate(
        service.name.clone(),
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

fn parse_node_script(
    config: &serde_json::Map<String, Value>,
    name: &str,
    workspace: &Path,
    executable: &str,
) -> Result<super::ParsedCandidate, String> {
    if !is_npm_executable(executable) {
        return Ok(candidate(
            name.into(),
            None,
            "needsInput",
            vec![],
            vec!["program".into()],
        ));
    }
    let runtime_args = match string_array(config.get("runtimeArgs")) {
        Ok(values) => values,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["runtimeArgs".into()],
            ))
        }
    };
    if runtime_args.len() < 2
        || !matches!(
            runtime_args.first().map(String::as_str),
            Some("run" | "run-script")
        )
    {
        return Ok(candidate(
            name.into(),
            None,
            "needsInput",
            vec!["npm 启动配置需要 runtimeArgs=run <script>".into()],
            vec!["runtimeArgs".into()],
        ));
    }
    let args = match string_array(config.get("args")) {
        Ok(values) => values,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["args".into()],
            ))
        }
    };
    let mut values = vec![executable.to_string()];
    values.extend(runtime_args);
    if !args.is_empty() {
        values.push("--".into());
        values.extend(args);
    }
    let command = match resolve_command_values(&values, workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["动态变量或参数".into()],
            ))
        }
    };
    let cwd = match resolve_cwd(config, workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["cwd".into()],
            ))
        }
    };
    let env = match env_from_object(config.get("env"), workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["env".into()],
            ))
        }
    };
    let mut warnings = vec!["按普通前台运行导入，不保留 IDE 调试能力".into()];
    let mut missing = special_fields(config);
    if config.contains_key("envFile") {
        missing.push("envFile".into());
    }
    if !missing.is_empty() {
        warnings.push("存在 IDE 任务或外部环境语义，需在 Avenil 中重新确认".into());
    }
    let service = service_defaults(name.into(), &cwd, command, env);
    Ok(candidate(
        service.name.clone(),
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

fn parse_java(
    config: &serde_json::Map<String, Value>,
    name: &str,
    workspace: &Path,
) -> Result<super::ParsedCandidate, String> {
    let main_class = match optional_string(config, "mainClass") {
        Ok(Some(value)) => value,
        Ok(None) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![],
                vec!["mainClass".into()],
            ))
        }
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["mainClass".into()],
            ))
        }
    };
    let cwd = match resolve_cwd(config, workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["cwd".into()],
            ))
        }
    };
    let pom = match fs::read_to_string(cwd.join("pom.xml")) {
        Ok(value) => value,
        Err(_) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec!["Java 配置需要可识别的 Maven Spring Boot 项目".into()],
                vec!["Java 构建命令".into()],
            ))
        }
    };
    let has_plugin = match has_spring_boot_maven_plugin(&pom) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["Java 构建命令".into()],
            ))
        }
    };
    if !has_plugin {
        return Ok(candidate(name.into(), None, "needsInput", vec!["当前 Java 项目未声明 spring-boot-maven-plugin，Avenil 不猜测 Java classpath 或启动命令".into()], vec!["Java 构建命令".into()]));
    }
    let main_class = match resolve_value(main_class, workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["mainClass".into()],
            ))
        }
    };
    let vm_args = match config.get("vmArgs") {
        None => String::new(),
        Some(Value::String(value)) => match resolve_value(value, workspace) {
            Ok(value) => value,
            Err(error) => {
                return Ok(candidate(
                    name.into(),
                    None,
                    "needsInput",
                    vec![error],
                    vec!["vmArgs".into()],
                ))
            }
        },
        Some(_) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec!["vmArgs 必须是字符串".into()],
                vec!["vmArgs".into()],
            ))
        }
    };
    let application_args = match java_application_args(config.get("args")) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["args".into()],
            ))
        }
    };
    let maven = if cwd.join("mvnw").is_file() {
        "./mvnw"
    } else {
        "mvn"
    };
    let mut values = vec![
        maven.to_string(),
        "spring-boot:run".into(),
        format!("-Dspring-boot.run.main-class={main_class}"),
    ];
    if !vm_args.trim().is_empty() {
        values.push(format!("-Dspring-boot.run.jvmArguments={vm_args}"));
    }
    if !application_args.is_empty() {
        values.push(format!(
            "-Dspring-boot.run.arguments={}",
            application_args.join(",")
        ));
    }
    let command = match resolve_command_values(&values, workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["动态变量或参数".into()],
            ))
        }
    };
    let env = match env_from_object(config.get("env"), workspace) {
        Ok(value) => value,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["env".into()],
            ))
        }
    };
    let mut warnings = vec!["按 Maven Spring Boot 普通前台运行导入，不保留 Java 调试能力".into()];
    if config.contains_key("preLaunchTask") {
        warnings.push("未单独执行 preLaunchTask；spring-boot:run 已负责项目编译和启动".into());
    }
    let mut missing: Vec<String> = special_fields(config)
        .into_iter()
        .filter(|field| field != "preLaunchTask")
        .collect();
    if config.contains_key("envFile") {
        missing.push("envFile".into());
    }
    if !missing.is_empty() {
        warnings.push("存在 IDE 任务或外部环境语义，需在 Avenil 中重新确认".into());
    }
    let service = service_defaults(name.into(), &cwd, command, env);
    Ok(candidate(
        service.name.clone(),
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

fn java_application_args(value: Option<&Value>) -> Result<Vec<String>, String> {
    let Some(value) = value else {
        return Ok(vec![]);
    };
    match value {
        Value::String(value) if value.trim().is_empty() => Ok(vec![]),
        Value::Array(values) if values.is_empty() => Ok(vec![]),
        Value::Array(_) | Value::String(_) => {
            Err("Java args 非空时暂不自动转换，请在 Avenil 中确认启动参数".into())
        }
        _ => Err("Java args 必须是字符串或字符串数组".into()),
    }
}

fn is_npm_executable(executable: &str) -> bool {
    Path::new(executable)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "npm" || name == "npm.cmd")
}

fn optional_string<'a>(
    config: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<&'a str>, String> {
    match config.get(key) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(format!("{key} 必须是字符串")),
    }
}

fn has_spring_boot_maven_plugin(text: &str) -> Result<bool, String> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut depth = 0usize;
    let mut plugin_depth = None;
    let mut artifact_depth = None;
    let mut artifact_text = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                depth += 1;
                if event.name().as_ref() == b"plugin" {
                    plugin_depth = Some(depth);
                } else if event.name().as_ref() == b"artifactId"
                    && plugin_depth == Some(depth.saturating_sub(1))
                {
                    artifact_depth = Some(depth);
                    artifact_text.clear();
                }
            }
            Ok(Event::Text(event)) if artifact_depth == Some(depth) => {
                artifact_text.push_str(
                    &event
                        .unescape()
                        .map_err(|error| format!("Maven POM XML 解析失败: {error}"))?,
                );
            }
            Ok(Event::CData(event)) if artifact_depth == Some(depth) => {
                artifact_text.push_str(&String::from_utf8_lossy(event.as_ref()));
            }
            Ok(Event::End(event)) => {
                if artifact_depth == Some(depth) && event.name().as_ref() == b"artifactId" {
                    if artifact_text.trim() == "spring-boot-maven-plugin" {
                        return Ok(true);
                    }
                    artifact_depth = None;
                }
                if plugin_depth == Some(depth) && event.name().as_ref() == b"plugin" {
                    plugin_depth = None;
                }
                depth = depth.saturating_sub(1);
            }
            Ok(Event::Eof) => return Ok(false),
            Err(error) => return Err(format!("Maven POM XML 解析失败: {error}")),
            _ => {}
        }
    }
}

fn parse_python(
    config: &serde_json::Map<String, Value>,
    name: &str,
    workspace: &Path,
) -> Result<super::ParsedCandidate, String> {
    let interpreter = config
        .get("python")
        .or_else(|| config.get("pythonPath"))
        .and_then(Value::as_str);
    let Some(interpreter) = interpreter else {
        return Ok(candidate(
            name.into(),
            None,
            "needsInput",
            vec![],
            vec!["python interpreter".into()],
        ));
    };
    let program = config.get("program").and_then(Value::as_str);
    let module = config.get("module").and_then(Value::as_str);
    if program.is_none() == module.is_none() {
        return Ok(candidate(
            name.into(),
            None,
            "needsInput",
            vec![],
            vec!["program 或 module（二选一）".into()],
        ));
    }
    let parsed =
        (|| -> Result<(std::path::PathBuf, String, Vec<crate::models::EnvVar>), String> {
            let mut command = vec![resolve_value(interpreter, workspace)?];
            let python_args = string_array(config.get("pythonArgs"))?;
            for arg in python_args {
                command.push(resolve_value(&arg, workspace)?);
            }
            if let Some(module) = module {
                command.push("-m".into());
                command.push(resolve_value(module, workspace)?);
            }
            if let Some(program) = program {
                command.push(resolve_value(program, workspace)?);
            }
            for arg in string_array(config.get("args"))? {
                command.push(resolve_value(&arg, workspace)?);
            }
            let cwd = resolve_cwd(config, workspace)?;
            let env = env_from_object(config.get("env"), workspace)?;
            Ok((
                cwd,
                command
                    .iter()
                    .map(|item| shell_quote(item))
                    .collect::<Vec<_>>()
                    .join(" "),
                env,
            ))
        })();
    let (cwd, command, env) = match parsed {
        Ok(parsed) => parsed,
        Err(error) => {
            return Ok(candidate(
                name.into(),
                None,
                "needsInput",
                vec![error],
                vec!["解释器、路径或参数".into()],
            ))
        }
    };
    let mut missing = special_fields(config);
    if config.contains_key("envFile") {
        missing.push("envFile".into());
    }
    let service = service_defaults(name.into(), &cwd, command, env);
    Ok(candidate(
        service.name.clone(),
        Some(service),
        if missing.is_empty() {
            "ready"
        } else {
            "needsInput"
        },
        vec!["按普通前台运行导入，不保留 Python 调试能力".into()],
        missing,
    ))
}

fn resolve_cwd(
    config: &serde_json::Map<String, Value>,
    workspace: &Path,
) -> Result<std::path::PathBuf, String> {
    let raw = config
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or("${workspaceFolder}");
    let value = resolve_value(raw, workspace)?;
    let path = std::path::PathBuf::from(value);
    if !path.is_absolute() {
        return Err("cwd 解析后必须是绝对路径".into());
    }
    if !path.is_dir() {
        return Err("cwd 目录不存在".into());
    }
    Ok(path)
}

fn resolve_values(
    executable: &str,
    runtime_args: Option<&Value>,
    program: &str,
    args: Option<&Value>,
    workspace: &Path,
) -> Result<String, String> {
    let mut values = vec![executable.to_string()];
    values.extend(string_array(runtime_args)?);
    values.push(program.to_string());
    values.extend(string_array(args)?);
    resolve_command_values(&values, workspace)
}

fn resolve_command_values(values: &[String], workspace: &Path) -> Result<String, String> {
    values
        .iter()
        .map(|value| resolve_value(value, workspace))
        .map(|value| value.map(|item| shell_quote(&item)))
        .collect::<Result<Vec<_>, _>>()
        .map(|values| values.join(" "))
}

fn string_array(value: Option<&Value>) -> Result<Vec<String>, String> {
    let Some(value) = value else {
        return Ok(vec![]);
    };
    let Some(array) = value.as_array() else {
        return Err("参数必须是字符串数组".into());
    };
    array
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_string)
                .ok_or_else(|| "参数数组包含非字符串".to_string())
        })
        .collect()
}

fn special_fields(config: &serde_json::Map<String, Value>) -> Vec<String> {
    ["preLaunchTask", "postDebugTask", "dependsOn"]
        .iter()
        .filter(|key| config.contains_key(**key))
        .map(|key| (*key).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn parses_node_launch_configs_and_keeps_unsupported_debug_entries_visible() {
        let result = parse(
            r#"
            {
              // JSONC comments are valid in launch.json.
              configurations: [
                { name: "web", type: "node", request: "launch", program: "${workspaceFolder}/server.js", args: ["--port", "3000"], env: { MODE: "test" } },
                { name: "attach", type: "node", request: "attach" },
                { name: "ruby", type: "ruby", request: "launch" }
              ],
              compounds: [{ name: "all" }]
            }
            "#,
            Path::new("/tmp"),
        )
        .unwrap();

        assert_eq!(result.candidates.len(), 4);
        assert_eq!(result.candidates[0].status, "ready");
        assert!(result.candidates[0]
            .service
            .as_ref()
            .unwrap()
            .command
            .contains("server.js"));
        assert_eq!(
            result.candidates[0].service.as_ref().unwrap().env[0].value,
            "test"
        );
        assert_eq!(result.candidates[1].status, "unsupported");
        assert_eq!(result.candidates[2].status, "unsupported");
        assert!(result.candidates[3].warnings[0].contains("compound"));
    }

    #[test]
    fn reports_unresolvable_variables_as_needing_user_input() {
        let result = parse(
            r#"{ configurations: [{ name: "dynamic", type: "python", request: "launch", python: "${env:PYTHON}", module: "app" }] }"#,
            Path::new("/tmp"),
        )
        .unwrap();

        assert_eq!(result.candidates[0].status, "needsInput");
        assert_eq!(result.candidates[0].missing, vec!["解释器、路径或参数"]);
        assert!(result.candidates[0].warnings[0].contains("动态变量"));
    }

    #[test]
    fn rejects_invalid_launch_json_shapes() {
        assert!(parse("[]", Path::new("/tmp"))
            .err()
            .unwrap()
            .contains("顶层必须是对象"));
        assert!(parse("{}", Path::new("/tmp"))
            .err()
            .unwrap()
            .contains("缺少 configurations 数组"));
    }
}
