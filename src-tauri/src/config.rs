use crate::{
    models::{AppConfig, ExportResult, Group, ImportChanges, ImportPreview, Service},
    state::{is_active_status, AppState},
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
    if state
        .runtimes
        .lock()
        .unwrap()
        .values()
        .any(|r| is_active_status(&r.snapshot.lock().unwrap().status))
        || !state.operations.lock().unwrap().is_empty()
    {
        return Err("有运行中的服务或活跃操作，不能修改配置".into());
    }
    persist_validated(state, config)
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
    if state
        .runtimes
        .lock()
        .unwrap()
        .values()
        .any(|r| is_active_status(&r.snapshot.lock().unwrap().status))
        || !state.operations.lock().unwrap().is_empty()
    {
        return Err("有活跃服务操作，不能导入配置".into());
    }
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
