use crate::{
    models::{AppConfig, ExportResult, Group, ImportChanges, ImportPreview, Service},
    state::AppState,
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const SCHEMA_VERSION: u32 = 1;

// Preserve the original filename so existing installations keep their service definitions.
pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("rundock.json"))
        .map_err(|e| e.to_string())
}

pub fn load(app: &AppHandle, state: &Arc<AppState>) -> Result<AppConfig, String> {
    let path = config_path(app)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let config = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| format!("配置解析失败: {e}"))?
    } else {
        let config = AppConfig::default();
        atomic_save(&path, &config)?;
        config
    };
    validate(&config)?;
    *state
        .config
        .lock()
        .map_err(|_| "配置锁不可用".to_string())? = config.clone();
    *state.config_path.lock().unwrap() = Some(path);
    Ok(config)
}

fn atomic_save(path: &Path, config: &AppConfig) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "配置路径无父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    let temp = parent.join(format!(".rundock.{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let bytes = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub fn validate(config: &AppConfig) -> Result<(), String> {
    if config.schema_version != SCHEMA_VERSION {
        return Err(format!("不支持的配置版本: {}", config.schema_version));
    }
    let mut ids = std::collections::HashSet::new();
    for group in &config.groups {
        if uuid::Uuid::parse_str(&group.id).is_err() || group.name.trim().is_empty() {
            return Err("分组必须有 UUID ID 和名称".into());
        }
        if !ids.insert(&group.id) {
            return Err("分组 ID 重复".into());
        }
    }
    let group_ids: std::collections::HashSet<&String> =
        config.groups.iter().map(|g| &g.id).collect();
    let mut service_ids = std::collections::HashSet::new();
    for service in &config.services {
        if uuid::Uuid::parse_str(&service.id).is_err() || service.name.trim().is_empty() {
            return Err("服务必须有 UUID ID 和名称".into());
        }
        if !service_ids.insert(&service.id) {
            return Err("服务 ID 重复".into());
        }
        if let Some(group_id) = &service.group_id {
            if !group_ids.contains(group_id) {
                return Err(format!("服务 {} 引用了不存在的分组", service.name));
            }
        }
        validate_log(&service.log)?;
        if service.shell.program.trim().is_empty() || service.shell.args.is_empty() {
            return Err(format!("服务 {} 的 shell 配置无效", service.name));
        }
        let mut env_keys = std::collections::HashSet::new();
        for env in &service.env {
            if env.key.trim().is_empty() || !env_keys.insert(&env.key) {
                return Err(format!("服务 {} 的环境变量键无效或重复", service.name));
            }
        }
    }
    Ok(())
}

fn validate_log(log: &crate::models::LogPolicy) -> Result<(), String> {
    if !(64 * 1024..=16 * 1024 * 1024).contains(&log.max_bytes)
        || !(1..=10).contains(&log.rotate_count)
        || !(64 * 1024..=4 * 1024 * 1024).contains(&log.max_memory_bytes)
    {
        return Err("日志策略超出允许范围".into());
    }
    Ok(())
}

pub fn save(state: &Arc<AppState>, config: AppConfig) -> Result<(), String> {
    let _mutation = state
        .mutation
        .lock()
        .map_err(|_| "状态变更锁不可用".to_string())?;
    save_locked(state, config)
}

fn ensure_not_shutting_down(state: &Arc<AppState>) -> Result<(), String> {
    if state
        .shutting_down
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("应用正在退出，不能修改配置".into());
    }
    Ok(())
}

fn persist_validated(state: &Arc<AppState>, config: AppConfig) -> Result<(), String> {
    let path = state
        .config_path
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "配置路径尚未初始化".to_string())?;
    atomic_save(&path, &config)?;
    *state.config.lock().unwrap() = config.clone();
    if let Some(sink) = state.sink() {
        sink.config(&config);
    }
    Ok(())
}

pub(crate) fn save_locked(state: &Arc<AppState>, config: AppConfig) -> Result<(), String> {
    validate(&config)?;
    ensure_not_shutting_down(state)?;
    let current = state
        .config
        .lock()
        .map_err(|_| "配置锁不可用".to_string())?
        .clone();
    ensure_affected_services_inactive(state, &current, &config)?;
    persist_validated(state, config)
}

fn ensure_affected_services_inactive(
    state: &Arc<AppState>,
    current: &AppConfig,
    next: &AppConfig,
) -> Result<(), String> {
    for service in &current.services {
        if !state.active(&service.id) {
            continue;
        }
        let unchanged = next
            .services
            .iter()
            .find(|candidate| candidate.id == service.id)
            .map(|candidate| candidate == service)
            .unwrap_or(false);
        if !unchanged {
            return Err("该服务正在运行或操作中，不能修改配置".into());
        }
    }
    Ok(())
}

pub(crate) fn save_service_locked(
    state: &Arc<AppState>,
    service_id: &str,
    config: AppConfig,
) -> Result<(), String> {
    validate(&config)?;
    ensure_not_shutting_down(state)?;
    if state.active(service_id) {
        return Err("该服务正在运行或操作中，不能修改配置".into());
    }
    persist_validated(state, config)
}

pub fn import_preview(json: &str, current: &AppConfig) -> Result<ImportPreview, String> {
    let candidate: AppConfig =
        serde_json::from_str(json).map_err(|e| format!("导入 JSON 无效: {e}"))?;
    let mut errors = vec![];
    if let Err(error) = validate(&candidate) {
        errors.push(error);
    }
    let old_groups: std::collections::HashSet<&String> =
        current.groups.iter().map(|g| &g.id).collect();
    let new_groups: std::collections::HashSet<&String> =
        candidate.groups.iter().map(|g| &g.id).collect();
    let old_services: std::collections::HashSet<&String> =
        current.services.iter().map(|s| &s.id).collect();
    let new_services: std::collections::HashSet<&String> =
        candidate.services.iter().map(|s| &s.id).collect();
    let changes = ImportChanges {
        added_groups: new_groups.difference(&old_groups).count(),
        removed_groups: old_groups.difference(&new_groups).count(),
        added_services: new_services.difference(&old_services).count(),
        removed_services: old_services.difference(&new_services).count(),
    };
    Ok(ImportPreview {
        schema_version: candidate.schema_version,
        group_count: candidate.groups.len(),
        service_count: candidate.services.len(),
        errors: errors.clone(),
        warnings: vec![],
        changes,
        can_apply: errors.is_empty(),
    })
}

pub fn import_apply(state: &Arc<AppState>, json: &str) -> Result<AppConfig, String> {
    let _mutation = state
        .mutation
        .lock()
        .map_err(|_| "状态变更锁不可用".to_string())?;
    let config: AppConfig =
        serde_json::from_str(json).map_err(|e| format!("导入 JSON 无效: {e}"))?;
    save_locked(state, config.clone())?;
    Ok(config)
}

pub fn export(config: &AppConfig) -> Result<ExportResult, String> {
    Ok(ExportResult {
        json: serde_json::to_string_pretty(config).map_err(|e| e.to_string())?,
        notice: "配置已导出，环境变量值按当前配置保留。".into(),
    })
}

pub fn upsert_group(state: &Arc<AppState>, group: Group) -> Result<Group, String> {
    let _mutation = state
        .mutation
        .lock()
        .map_err(|_| "状态变更锁不可用".to_string())?;
    upsert_group_locked(state, group)
}
pub(crate) fn upsert_group_locked(
    state: &Arc<AppState>,
    mut group: Group,
) -> Result<Group, String> {
    if group.id.is_empty() {
        group.id = Uuid::new_v4().to_string();
    }
    let mut config = state.config.lock().unwrap().clone();
    if let Some(existing) = config.groups.iter_mut().find(|item| item.id == group.id) {
        *existing = group.clone();
    } else {
        config.groups.push(group.clone());
    }
    save_locked(state, config)?;
    Ok(group)
}
pub fn delete_group(state: &Arc<AppState>, id: &str) -> Result<(), String> {
    let _mutation = state
        .mutation
        .lock()
        .map_err(|_| "状态变更锁不可用".to_string())?;
    let mut config = state.config.lock().unwrap().clone();
    if config
        .services
        .iter()
        .any(|s| s.group_id.as_deref() == Some(id))
    {
        return Err("分组仍被服务引用，不能删除".into());
    }
    let before = config.groups.len();
    config.groups.retain(|g| g.id != id);
    if before == config.groups.len() {
        return Err("分组不存在".into());
    }
    save_locked(state, config)
}
pub fn upsert_service(state: &Arc<AppState>, service: Service) -> Result<Service, String> {
    let _mutation = state
        .mutation
        .lock()
        .map_err(|_| "状态变更锁不可用".to_string())?;
    upsert_service_locked(state, service)
}
pub(crate) fn upsert_service_locked(
    state: &Arc<AppState>,
    mut service: Service,
) -> Result<Service, String> {
    if service.id.is_empty() {
        service.id = Uuid::new_v4().to_string();
    }
    let service_id = service.id.clone();
    let mut config = state.config.lock().unwrap().clone();
    if let Some(existing) = config
        .services
        .iter_mut()
        .find(|item| item.id == service_id)
    {
        *existing = service.clone();
    } else {
        config.services.push(service.clone());
    }
    save_service_locked(state, &service_id, config)?;
    Ok(service)
}
pub fn delete_service(state: &Arc<AppState>, id: &str) -> Result<(), String> {
    let _mutation = state
        .mutation
        .lock()
        .map_err(|_| "状态变更锁不可用".to_string())?;
    if state.active(id) {
        return Err("服务正在运行或操作中，不能删除".into());
    }
    let mut config = state.config.lock().unwrap().clone();
    let before = config.services.len();
    config.services.retain(|s| s.id != id);
    if before == config.services.len() {
        return Err("服务不存在".into());
    }
    save_service_locked(state, id, config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EnvVar, LogPolicy, ShellSpec};

    const GROUP_ID: &str = "00000000-0000-0000-0000-000000000001";
    const SERVICE_ID: &str = "00000000-0000-0000-0000-000000000002";

    fn service(id: &str, group_id: Option<&str>) -> Service {
        Service {
            id: id.to_string(),
            name: "local-api".into(),
            group_id: group_id.map(str::to_string),
            workdir: "/tmp".into(),
            command: "printf ready".into(),
            shell: ShellSpec::default(),
            env: vec![EnvVar {
                key: "MODE".into(),
                value: "test".into(),
            }],
            port: None,
            url: None,
            log: LogPolicy::default(),
        }
    }

    fn group() -> Group {
        Group {
            id: GROUP_ID.into(),
            name: "local".into(),
            sort_order: 0,
        }
    }

    fn valid_config() -> AppConfig {
        AppConfig {
            schema_version: 1,
            groups: vec![group()],
            services: vec![service(SERVICE_ID, Some(GROUP_ID))],
        }
    }

    fn initialized_state() -> (Arc<AppState>, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("avenil-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let state = AppState::new();
        *state.config_path.lock().unwrap() = Some(root.join("avenil.json"));
        (state, root)
    }

    #[test]
    fn validate_accepts_a_complete_configuration() {
        assert!(validate(&valid_config()).is_ok());
    }

    #[test]
    fn validate_rejects_duplicate_ids_and_dangling_group_references() {
        let mut duplicate = valid_config();
        duplicate.groups.push(group());
        assert_eq!(validate(&duplicate).unwrap_err(), "分组 ID 重复");

        let mut dangling = valid_config();
        dangling.services[0].group_id = Some("00000000-0000-0000-0000-000000000099".into());
        assert!(validate(&dangling)
            .unwrap_err()
            .contains("引用了不存在的分组"));
    }

    #[test]
    fn validate_rejects_invalid_log_shell_and_environment_values() {
        let mut invalid_log = valid_config();
        invalid_log.services[0].log.max_bytes = 1;
        assert_eq!(validate(&invalid_log).unwrap_err(), "日志策略超出允许范围");

        let mut invalid_shell = valid_config();
        invalid_shell.services[0].shell.program.clear();
        assert!(validate(&invalid_shell)
            .unwrap_err()
            .contains("shell 配置无效"));

        let mut duplicate_env = valid_config();
        duplicate_env.services[0].env.push(EnvVar {
            key: "MODE".into(),
            value: "other".into(),
        });
        assert!(validate(&duplicate_env)
            .unwrap_err()
            .contains("环境变量键无效或重复"));
    }

    #[test]
    fn import_preview_reports_changes_without_writing_them() {
        let current = valid_config();
        let mut candidate = current.clone();
        candidate.groups.push(Group {
            id: "00000000-0000-0000-0000-000000000003".into(),
            name: "worker".into(),
            sort_order: 1,
        });
        candidate
            .services
            .push(service("00000000-0000-0000-0000-000000000004", None));
        let json = serde_json::to_string(&candidate).unwrap();

        let preview = import_preview(&json, &current).unwrap();

        assert!(preview.can_apply);
        assert_eq!(preview.changes.added_groups, 1);
        assert_eq!(preview.changes.added_services, 1);
        assert_eq!(current.groups.len(), 1);
        assert_eq!(current.services.len(), 1);
    }

    #[test]
    fn import_preview_keeps_invalid_documents_out_of_apply() {
        let mut invalid = valid_config();
        invalid.schema_version = 2;

        let preview = import_preview(
            &serde_json::to_string(&invalid).unwrap(),
            &AppConfig::default(),
        )
        .unwrap();

        assert!(!preview.can_apply);
        assert_eq!(preview.errors, vec!["不支持的配置版本: 2"]);
    }

    #[test]
    fn export_contains_the_config_and_user_facing_notice() {
        let exported = export(&valid_config()).unwrap();
        let value: serde_json::Value = serde_json::from_str(&exported.json).unwrap();

        assert_eq!(value["services"][0]["env"][0]["value"], "test");
        assert!(exported.notice.contains("环境变量值"));
    }

    #[test]
    fn save_persists_valid_config_and_blocks_changes_during_shutdown() {
        let (state, root) = initialized_state();
        save(&state, valid_config()).unwrap();
        assert!(root.join("avenil.json").is_file());

        assert!(state.begin_shutdown());
        let error = save(&state, AppConfig::default()).unwrap_err();

        assert!(error.contains("正在退出"));
        let persisted = fs::read_to_string(root.join("avenil.json")).unwrap();
        assert!(persisted.contains("local-api"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unrelated_config_changes_are_allowed_while_another_service_is_active() {
        let (state, root) = initialized_state();
        let current = valid_config();
        save(&state, current.clone()).unwrap();
        state.mark_operation(SERVICE_ID).unwrap();

        let mut next = current;
        next.groups.push(Group {
            id: "00000000-0000-0000-0000-000000000003".into(),
            name: "worker".into(),
            sort_order: 1,
        });
        next.services
            .push(service("00000000-0000-0000-0000-000000000004", None));

        save(&state, next.clone()).unwrap();

        assert_eq!(*state.config.lock().unwrap(), next);
        state.unmark_operation(SERVICE_ID);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn changes_to_an_active_service_are_still_rejected() {
        let (state, root) = initialized_state();
        let current = valid_config();
        save(&state, current.clone()).unwrap();
        state.mark_operation(SERVICE_ID).unwrap();

        let mut next = current;
        next.services[0].command = "pnpm dev".into();

        assert_eq!(
            save(&state, next).unwrap_err(),
            "该服务正在运行或操作中，不能修改配置"
        );
        state.unmark_operation(SERVICE_ID);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn importing_changes_to_an_active_service_is_rejected() {
        let (state, root) = initialized_state();
        let current = valid_config();
        save(&state, current.clone()).unwrap();
        state.mark_operation(SERVICE_ID).unwrap();

        let mut next = current;
        next.services[0].command = "pnpm dev".into();
        let json = serde_json::to_string(&next).unwrap();

        assert_eq!(
            import_apply(&state, &json).unwrap_err(),
            "该服务正在运行或操作中，不能修改配置"
        );
        state.unmark_operation(SERVICE_ID);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn upsert_assigns_missing_ids_and_delete_rejects_referenced_groups() {
        let (state, root) = initialized_state();
        let created = upsert_group(
            &state,
            Group {
                id: String::new(),
                name: "local".into(),
                sort_order: 0,
            },
        )
        .unwrap();
        let mut new_service = service("", Some(&created.id));
        new_service.name = "worker".into();
        let created_service = upsert_service(&state, new_service).unwrap();

        assert!(!created.id.is_empty());
        assert!(!created_service.id.is_empty());
        assert!(delete_group(&state, &created.id).is_err());
        delete_service(&state, &created_service.id).unwrap();
        delete_group(&state, &created.id).unwrap();
        let _ = fs::remove_dir_all(root);
    }
}
