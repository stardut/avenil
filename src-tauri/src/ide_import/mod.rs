mod jetbrains;
mod vscode;

use crate::{
    config,
    models::{
        AppConfig, EnvVar, Group, IdeImportCandidate, IdeImportInput, IdeImportPreview,
        IdeImportSource, Service, ShellSpec,
    },
    state::AppState,
};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone)]
pub struct StoredPreview {
    pub public: IdeImportPreview,
    pub services: HashMap<String, Service>,
}

struct DiscoveredSource {
    path: PathBuf,
    kind: &'static str,
}

pub fn preview(input: IdeImportInput) -> Result<StoredPreview, String> {
    let workspace = absolute_directory(&input.project_root)?;
    let sources = discover_sources(&workspace)?;
    let mut parsed = ParsedResult {
        candidates: vec![],
        warnings: vec![],
    };
    for source in &sources {
        let bytes = fs::metadata(&source.path)
            .map_err(|e| format!("读取 IDE 配置信息失败（{}）：{e}", source.path.display()))?
            .len();
        if bytes > MAX_SOURCE_BYTES {
            return Err(format!(
                "IDE 配置文件超过 2 MiB 限制：{}",
                source.path.display()
            ));
        }
        let text = fs::read_to_string(&source.path)
            .map_err(|e| format!("读取 IDE 配置失败（{}）：{e}", source.path.display()))?;
        let source_result = match source.kind {
            "vscode" => vscode::parse(&text, &workspace),
            "jetbrains" => jetbrains::parse(&text, &workspace),
            _ => unreachable!(),
        }
        .map_err(|error| format!("解析 IDE 配置失败（{}）：{error}", source.path.display()))?;
        parsed.candidates.extend(source_result.candidates);
        parsed.warnings.extend(source_result.warnings);
    }
    parsed.warnings.insert(
        0,
        format!("已从项目根目录自动发现 {} 个 IDE 配置文件", sources.len()),
    );
    if sources.iter().any(|source| source.kind == "vscode")
        && sources.iter().any(|source| source.kind == "jetbrains")
    {
        parsed
            .warnings
            .push("同时发现 VS Code 与 JetBrains 配置，已合并到同一份预览中".into());
    }
    let snapshot_id = Uuid::new_v4().to_string();
    let mut services = HashMap::new();
    let mut candidates = Vec::with_capacity(parsed.candidates.len());
    for mut candidate in parsed.candidates {
        let id = Uuid::new_v4().to_string();
        if let Some(mut service) = candidate.service.take() {
            service.id = id.clone();
            services.insert(id.clone(), service);
        }
        candidates.push(IdeImportCandidate {
            id,
            name: candidate.name,
            status: candidate.status,
            service: candidate.service,
            warnings: candidate.warnings,
            missing: candidate.missing,
        });
    }
    Ok(StoredPreview {
        public: IdeImportPreview {
            snapshot_id,
            project_root: workspace.display().to_string(),
            sources: sources
                .iter()
                .map(|source| IdeImportSource {
                    path: source.path.display().to_string(),
                    kind: source.kind.to_string(),
                })
                .collect(),
            suggested_group_name: suggested_group_name(&workspace),
            candidates,
            warnings: parsed.warnings,
        },
        services,
    })
}

pub fn store_preview(state: &AppState, stored: StoredPreview) -> Result<IdeImportPreview, String> {
    let public = stored.public.clone();
    let mut previews = state
        .ide_previews
        .lock()
        .map_err(|_| "导入快照锁不可用".to_string())?;
    if previews.len() >= 8 {
        if let Some(oldest) = previews.keys().next().cloned() {
            previews.remove(&oldest);
        }
    }
    previews.insert(public.snapshot_id.clone(), stored);
    Ok(public)
}

pub fn apply(
    state: &std::sync::Arc<AppState>,
    public: &IdeImportPreview,
    selected_ids: Vec<String>,
    group_name: String,
) -> Result<AppConfig, String> {
    if selected_ids.is_empty() {
        return Err("至少选择一个可导入配置".into());
    }
    if group_name.trim().is_empty() {
        return Err("分组名称不能为空".into());
    }
    let _mutation = state
        .mutation
        .lock()
        .map_err(|_| "状态变更锁不可用".to_string())?;
    let stored = state
        .ide_previews
        .lock()
        .map_err(|_| "导入快照锁不可用".to_string())?
        .get(&public.snapshot_id)
        .cloned()
        .ok_or_else(|| "导入预览已失效，请重新预览".to_string())?;
    if selected_ids
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len()
        != selected_ids.len()
    {
        return Err("导入配置选择不能重复".into());
    }
    let mut selected = Vec::with_capacity(selected_ids.len());
    for id in &selected_ids {
        let candidate = stored
            .public
            .candidates
            .iter()
            .find(|item| &item.id == id)
            .ok_or_else(|| format!("未知的导入配置: {id}"))?;
        if candidate.status != "ready" || !candidate.missing.is_empty() {
            return Err(format!("配置 {} 尚未达到可导入状态", candidate.name));
        }
        let service = stored
            .services
            .get(id)
            .ok_or_else(|| format!("配置 {} 没有可导入服务", candidate.name))?
            .clone();
        selected.push(service);
    }
    let mut current = state
        .config
        .lock()
        .map_err(|_| "配置锁不可用".to_string())?
        .clone();
    let group_id = Uuid::new_v4().to_string();
    let group = Group {
        id: group_id.clone(),
        name: group_name.trim().to_string(),
        sort_order: current.groups.len() as i32,
    };
    current.groups.push(group);
    for mut service in selected {
        service.id = Uuid::new_v4().to_string();
        service.group_id = Some(group_id.clone());
        current.services.push(service);
    }
    config::save_locked(state, current.clone())?;
    state
        .ide_previews
        .lock()
        .map_err(|_| "导入快照锁不可用".to_string())?
        .remove(&public.snapshot_id);
    Ok(current)
}

pub fn choose_project_directory() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        const SCRIPT: &str = r#"try
    set selectedFolder to choose folder with prompt "选择 Avenil 项目根目录"
    return POSIX path of selectedFolder
on error number -128
    return ""
end try"#;
        let output = std::process::Command::new("/usr/bin/osascript")
            .args(["-e", SCRIPT])
            .output()
            .map_err(|error| format!("打开目录选择器失败：{error}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                "目录选择器执行失败".into()
            } else {
                format!("目录选择器执行失败：{detail}")
            });
        }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            return Ok(None);
        }
        Ok(Some(absolute_directory(&selected)?.display().to_string()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("项目根目录选择器仅支持 macOS".into())
    }
}

fn absolute_directory(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if !path.is_absolute() {
        return Err("projectRoot 必须是绝对路径".into());
    }
    let path = path
        .canonicalize()
        .map_err(|e| format!("项目根目录无效: {e}"))?;
    if !path.is_dir() {
        return Err("项目根目录必须是目录".into());
    }
    Ok(path)
}

fn discover_sources(workspace: &Path) -> Result<Vec<DiscoveredSource>, String> {
    let mut sources = vec![];
    let vscode = workspace.join(".vscode").join("launch.json");
    if vscode.is_file() {
        let path = source_path_within_workspace(workspace, &vscode, "VS Code")?;
        sources.push(DiscoveredSource {
            path,
            kind: "vscode",
        });
    }
    collect_xml_sources(
        workspace,
        &workspace.join(".idea").join("runConfigurations"),
        &mut sources,
    )?;
    collect_xml_sources(workspace, &workspace.join(".run"), &mut sources)?;
    if sources.is_empty() {
        return Err("项目根目录下未找到 IDE 配置；请确认存在 .vscode/launch.json、.idea/runConfigurations/*.xml 或 .run/*.xml".into());
    }
    Ok(sources)
}

fn collect_xml_sources(
    workspace: &Path,
    directory: &Path,
    sources: &mut Vec<DiscoveredSource>,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    if !directory.is_dir() {
        return Err(format!("IDE 配置目录无效：{}", directory.display()));
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|e| format!("读取 IDE 配置目录失败（{}）：{e}", directory.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取 IDE 配置目录失败（{}）：{e}", directory.display()))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        if !path.is_file()
            || path
                .extension()
                .and_then(|extension| extension.to_str())
                .map_or(true, |extension| !extension.eq_ignore_ascii_case("xml"))
        {
            continue;
        }
        let path = source_path_within_workspace(workspace, &path, "JetBrains")?;
        if !sources.iter().any(|source| source.path == path) {
            sources.push(DiscoveredSource {
                path,
                kind: "jetbrains",
            });
        }
    }
    Ok(())
}

fn source_path_within_workspace(
    workspace: &Path,
    source: &Path,
    kind: &str,
) -> Result<PathBuf, String> {
    let path = source
        .canonicalize()
        .map_err(|e| format!("{kind} 配置路径无效：{e}"))?;
    if !path.starts_with(workspace) {
        return Err(format!(
            "{kind} 配置不能指向项目根目录之外的路径：{}",
            path.display()
        ));
    }
    Ok(path)
}

fn suggested_group_name(workspace: &Path) -> String {
    workspace
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("导入配置")
        .to_string()
}

pub(crate) fn env_from_object(
    value: Option<&serde_json::Value>,
    workspace: &Path,
) -> Result<Vec<EnvVar>, String> {
    let Some(value) = value else {
        return Ok(vec![]);
    };
    let Some(map) = value.as_object() else {
        return Err("env 必须是字符串对象".into());
    };
    let mut env = Vec::with_capacity(map.len());
    for (key, value) in map {
        let Some(value) = value.as_str() else {
            return Err(format!("环境变量 {key} 不是字面量字符串"));
        };
        let value = resolve_value(value, workspace)?;
        env.push(EnvVar {
            key: key.clone(),
            value,
        });
    }
    Ok(env)
}

pub(crate) fn service_defaults(
    name: String,
    workdir: &Path,
    command: String,
    env: Vec<EnvVar>,
) -> Service {
    Service {
        id: String::new(),
        name,
        group_id: None,
        workdir: workdir.display().to_string(),
        command,
        shell: ShellSpec::default(),
        env,
        port: None,
        url: None,
        log: crate::models::LogPolicy::default(),
    }
}

pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(crate) fn resolve_value(value: &str, workspace: &Path) -> Result<String, String> {
    let mut result = value.to_string();
    if result.contains("${workspaceFolder}") {
        result = result.replace("${workspaceFolder}", &workspace.display().to_string());
    }
    if result.contains("$PROJECT_DIR$") {
        result = result.replace("$PROJECT_DIR$", &workspace.display().to_string());
    }
    if result.contains("${")
        || result.contains("$MODULE_DIR$")
        || result.contains("$USER_HOME$")
        || result.contains("$VAR$")
    {
        return Err(format!("包含无法在 Avenil 中解析的动态变量: {value}"));
    }
    Ok(result)
}

pub(crate) fn candidate(
    name: String,
    service: Option<Service>,
    status: &str,
    warnings: Vec<String>,
    missing: Vec<String>,
) -> ParsedCandidate {
    ParsedCandidate {
        name,
        service,
        status: status.to_string(),
        warnings,
        missing,
    }
}

pub(crate) struct ParsedCandidate {
    pub name: String,
    pub service: Option<Service>,
    pub status: String,
    pub warnings: Vec<String>,
    pub missing: Vec<String>,
}
pub(crate) struct ParsedResult {
    pub candidates: Vec<ParsedCandidate>,
    pub warnings: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::LogPolicy;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_workspace() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("avenil-ide-test-{suffix}"));
        fs::create_dir_all(root.join(".vscode")).unwrap();
        root
    }

    #[test]
    fn resolves_supported_workspace_variables_and_rejects_dynamic_ones() {
        let workspace = Path::new("/tmp/project");

        assert_eq!(
            resolve_value("${workspaceFolder}/src", workspace).unwrap(),
            "/tmp/project/src"
        );
        assert_eq!(
            resolve_value("$PROJECT_DIR$/target", workspace).unwrap(),
            "/tmp/project/target"
        );
        assert!(resolve_value("${env:PORT}", workspace)
            .unwrap_err()
            .contains("动态变量"));
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn preview_discovers_vscode_sources_and_apply_persists_selected_candidates() {
        let root = temp_workspace();
        fs::write(
            root.join(".vscode/launch.json"),
            r#"{ "configurations": [{ "name": "web", "type": "node-terminal", "request": "launch", "command": "pnpm dev" }] }"#,
        )
        .unwrap();

        let stored = preview(IdeImportInput {
            project_root: root.display().to_string(),
        })
        .unwrap();
        assert_eq!(stored.public.sources.len(), 1);
        assert_eq!(stored.public.sources[0].kind, "vscode");
        assert_eq!(stored.public.candidates[0].status, "ready");

        let state = AppState::new();
        *state.config_path.lock().unwrap() = Some(root.join("avenil.json"));
        let public = store_preview(&state, stored).unwrap();
        let candidate_id = public.candidates[0].id.clone();
        let result = apply(&state, &public, vec![candidate_id], "Imported".into()).unwrap();

        assert_eq!(result.groups[0].name, "Imported");
        assert_eq!(result.services.len(), 1);
        assert_eq!(result.services[0].command, "pnpm dev");
        assert!(state.ide_previews.lock().unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn apply_allows_new_services_while_an_unrelated_service_is_active() {
        let root = temp_workspace();
        fs::write(
            root.join(".vscode/launch.json"),
            r#"{ "configurations": [{ "name": "web", "type": "node-terminal", "request": "launch", "command": "pnpm dev" }] }"#,
        )
        .unwrap();

        let stored = preview(IdeImportInput {
            project_root: root.display().to_string(),
        })
        .unwrap();
        let state = AppState::new();
        *state.config_path.lock().unwrap() = Some(root.join("avenil.json"));
        *state.config.lock().unwrap() = AppConfig {
            schema_version: 1,
            groups: vec![],
            services: vec![Service {
                id: "00000000-0000-0000-0000-000000000010".into(),
                name: "existing".into(),
                group_id: None,
                workdir: "/tmp".into(),
                command: "printf ready".into(),
                shell: ShellSpec::default(),
                env: vec![],
                port: None,
                url: None,
                log: LogPolicy::default(),
            }],
        };
        state
            .mark_operation("00000000-0000-0000-0000-000000000010")
            .unwrap();

        let public = store_preview(&state, stored).unwrap();
        let candidate_id = public.candidates[0].id.clone();
        let result = apply(&state, &public, vec![candidate_id], "Imported".into()).unwrap();

        assert_eq!(result.services.len(), 2);
        assert_eq!(result.services[0].name, "existing");
        assert_eq!(result.services[1].command, "pnpm dev");
        assert!(state.active("00000000-0000-0000-0000-000000000010"));
        state.unmark_operation("00000000-0000-0000-0000-000000000010");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn apply_rejects_empty_duplicate_and_stale_selections() {
        let state = AppState::new();
        let preview = IdeImportPreview {
            snapshot_id: "missing".into(),
            project_root: "/tmp".into(),
            sources: vec![],
            suggested_group_name: "tmp".into(),
            candidates: vec![],
            warnings: vec![],
        };

        assert_eq!(
            apply(&state, &preview, vec![], "group".into()).unwrap_err(),
            "至少选择一个可导入配置"
        );
        assert_eq!(
            apply(&state, &preview, vec!["a".into()], " ".into()).unwrap_err(),
            "分组名称不能为空"
        );
        assert!(apply(&state, &preview, vec!["a".into()], "group".into())
            .unwrap_err()
            .contains("导入预览已失效"));
    }
}
