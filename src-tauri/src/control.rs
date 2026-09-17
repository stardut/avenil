use std::{
    collections::HashSet,
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::{
    config, ide_import,
    models::{BatchActionResult, Group, IdeImportInput, IdeImportPreview, Service, ShellSpec},
    process, resources,
    state::AppState,
};

const PROTOCOL_VERSION: u32 = 1;
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_ACTIVE_CONNECTIONS: usize = 32;
const REQUEST_READ_TIMEOUT_SECS: u64 = 30;
const REQUEST_WRITE_TIMEOUT_SECS: u64 = 10;
const SOCKET_ENV: &str = "AVENIL_SOCKET";
const SOCKET_FILE_NAME: &str = "avenil.sock";

#[cfg(unix)]
struct ActiveConnection(Arc<AtomicUsize>);

#[cfg(unix)]
impl Drop for ActiveConnection {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlRequest {
    #[serde(default = "default_protocol_version")]
    version: u32,
    command: String,
    #[serde(default)]
    args: Value,
    #[serde(default)]
    confirm: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlResponse {
    version: u32,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn default_protocol_version() -> u32 {
    PROTOCOL_VERSION
}

/// Resolve the socket path used by the desktop process.
///
/// `AVENIL_SOCKET` is intentionally supported for development and isolated
/// test runs. Normal installations use the same app-data directory as the
/// persisted `rundock.json` configuration.
pub fn app_socket_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os(SOCKET_ENV) {
        let path = PathBuf::from(path);
        if path.as_os_str().is_empty() {
            return Err(format!("{SOCKET_ENV} 不能为空"));
        }
        return Ok(path);
    }
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(SOCKET_FILE_NAME))
        .map_err(|e| format!("解析控制服务路径失败: {e}"))
}

/// Resolve the socket path used by the standalone CLI.
pub fn cli_socket_path() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os(SOCKET_ENV) {
        let path = PathBuf::from(path);
        if path.as_os_str().is_empty() {
            return Err(format!("{SOCKET_ENV} 不能为空"));
        }
        return Ok(path);
    }

    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "无法确定用户主目录，请设置 AVENIL_SOCKET".to_string())?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join("com.rundock.desktop")
        .join(SOCKET_FILE_NAME))
}

#[cfg(unix)]
pub fn start(app: AppHandle, state: Arc<AppState>) -> Result<(), String> {
    use std::os::unix::net::UnixStream;

    let path = app_socket_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 CLI 控制目录失败: {e}"))?;
    }

    if path.exists() {
        match UnixStream::connect(&path) {
            Ok(_) => return Err("Avenil 控制服务已在运行".into()),
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {
                use std::os::unix::fs::FileTypeExt;

                let metadata = fs::symlink_metadata(&path)
                    .map_err(|error| format!("检查旧的 CLI 控制 socket 失败: {error}"))?;
                if !metadata.file_type().is_socket() {
                    return Err(format!(
                        "CLI 控制路径已被非 socket 文件占用: {}",
                        path.display()
                    ));
                }
                fs::remove_file(&path)
                    .map_err(|e| format!("清理旧的 CLI 控制 socket 失败: {e}"))?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("检查 CLI 控制 socket 失败: {error}")),
        }
    }

    let listener = bind_restricted(&path)?;
    restrict_socket_permissions(&path)?;
    let server_path = path.clone();
    let active_connections = Arc::new(AtomicUsize::new(0));
    let dispatch_lock = Arc::new(Mutex::new(()));
    thread::Builder::new()
        .name("avenil-control".into())
        .spawn(move || {
            loop {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let previous = active_connections.fetch_add(1, Ordering::AcqRel);
                        if previous >= MAX_ACTIVE_CONNECTIONS {
                            active_connections.fetch_sub(1, Ordering::AcqRel);
                            continue;
                        }
                        let app = app.clone();
                        let state = state.clone();
                        let active_for_thread = active_connections.clone();
                        let dispatch_lock = dispatch_lock.clone();
                        if thread::Builder::new()
                            .name("avenil-control-client".into())
                            .spawn(move || {
                                let _active = ActiveConnection(active_for_thread);
                                handle_connection(stream, app, state, dispatch_lock);
                            })
                            .is_err()
                        {
                            active_connections.fetch_sub(1, Ordering::AcqRel);
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error)
                        if matches!(
                            error.raw_os_error(),
                            Some(libc::EMFILE) | Some(libc::ENFILE)
                        ) =>
                    {
                        thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(_) => break,
                }
            }
            let _ = fs::remove_file(server_path);
        })
        .map_err(|e| format!("启动 CLI 控制服务失败: {e}"))?;
    Ok(())
}

#[cfg(unix)]
fn bind_restricted(path: &Path) -> Result<std::os::unix::net::UnixListener, String> {
    use std::os::unix::net::UnixListener;

    let previous_umask = unsafe { libc::umask(0o077) };
    let result = UnixListener::bind(path);
    unsafe { libc::umask(previous_umask) };
    result.map_err(|e| format!("创建 CLI 控制 socket 失败: {e}"))
}

#[cfg(not(unix))]
pub fn start(_app: AppHandle, _state: Arc<AppState>) -> Result<(), String> {
    Err("CLI 控制目前只支持 macOS 本机 Unix socket".into())
}

#[cfg(unix)]
fn restrict_socket_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|e| format!("读取 CLI 控制 socket 权限失败: {e}"))?
        .permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(path, permissions)
        .map_err(|e| format!("设置 CLI 控制 socket 权限失败: {e}"))
}

#[cfg(unix)]
fn handle_connection(
    mut stream: std::os::unix::net::UnixStream,
    app: AppHandle,
    state: Arc<AppState>,
    dispatch_lock: Arc<Mutex<()>>,
) {
    use std::time::Duration;

    let result = (|| {
        stream
            .set_read_timeout(Some(Duration::from_secs(REQUEST_READ_TIMEOUT_SECS)))
            .map_err(|e| format!("设置 CLI 读取超时失败: {e}"))?;
        stream
            .set_write_timeout(Some(Duration::from_secs(REQUEST_WRITE_TIMEOUT_SECS)))
            .map_err(|e| format!("设置 CLI 写入超时失败: {e}"))?;
        let request = read_request(&mut stream)?;
        let _dispatch = dispatch_lock
            .lock()
            .map_err(|_| "CLI 控制服务锁不可用".to_string())?;
        let should_exit = request.command == "quit";
        dispatch(request, &app, &state).map(|data| (data, should_exit))
    })();
    let (response, should_exit) = match result {
        Ok((data, should_exit)) => (
            ControlResponse {
                version: PROTOCOL_VERSION,
                ok: true,
                data: Some(data),
                error: None,
            },
            should_exit,
        ),
        Err(error) => (
            ControlResponse {
                version: PROTOCOL_VERSION,
                ok: false,
                data: None,
                error: Some(error),
            },
            false,
        ),
    };
    let response_written = serde_json::to_vec(&response)
        .map(|bytes| {
            stream.write_all(&bytes).is_ok()
                && stream.write_all(b"\n").is_ok()
                && stream.flush().is_ok()
        })
        .unwrap_or(false);
    if should_exit && response.ok && response_written {
        app.exit(0);
    }
}

#[cfg(unix)]
fn read_request(stream: &mut std::os::unix::net::UnixStream) -> Result<ControlRequest, String> {
    let mut line = Vec::new();
    let reader = BufReader::new(stream);
    reader
        .take((MAX_REQUEST_BYTES + 1) as u64)
        .read_until(b'\n', &mut line)
        .map_err(|e| format!("读取 CLI 请求失败: {e}"))?;
    if line.is_empty() {
        return Err("CLI 请求为空".into());
    }
    if line.len() > MAX_REQUEST_BYTES {
        return Err("CLI 请求超过 16 MiB 限制".into());
    }
    let request: ControlRequest =
        serde_json::from_slice(&line).map_err(|e| format!("CLI 请求格式无效: {e}"))?;
    if request.version != PROTOCOL_VERSION {
        return Err(format!("不支持的 CLI 协议版本: {}", request.version));
    }
    if request.command.trim().is_empty() {
        return Err("CLI 请求缺少 command".into());
    }
    Ok(request)
}

/// Send one request to the running desktop process and return its data field.
pub fn call(
    command: &str,
    args: Value,
    socket: Option<&Path>,
    confirm: bool,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        use std::{net::Shutdown, os::unix::net::UnixStream, time::Duration};

        let path = match socket {
            Some(path) => path.to_path_buf(),
            None => cli_socket_path()?,
        };
        let mut stream = UnixStream::connect(&path).map_err(|error| {
            format!(
                "无法连接 Avenil，请先启动桌面应用（{}）: {error}",
                path.display()
            )
        })?;
        stream
            .set_read_timeout(Some(Duration::from_secs(300)))
            .map_err(|e| format!("设置 CLI 读取超时失败: {e}"))?;
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(|e| format!("设置 CLI 写入超时失败: {e}"))?;
        let request = serde_json::to_vec(&json!({
            "version": PROTOCOL_VERSION,
            "command": command,
            "args": args,
            "confirm": confirm,
        }))
        .map_err(|e| format!("编码 CLI 请求失败: {e}"))?;
        stream
            .write_all(&request)
            .map_err(|e| format!("发送 CLI 请求失败: {e}"))?;
        stream
            .write_all(b"\n")
            .map_err(|e| format!("结束 CLI 请求失败: {e}"))?;
        stream
            .shutdown(Shutdown::Write)
            .map_err(|e| format!("关闭 CLI 请求写端失败: {e}"))?;

        let mut line = String::new();
        BufReader::new(stream)
            .read_line(&mut line)
            .map_err(|e| format!("读取 CLI 响应失败: {e}"))?;
        if line.is_empty() {
            return Err("Avenil 未返回 CLI 响应".into());
        }
        let response: ControlResponse =
            serde_json::from_str(&line).map_err(|e| format!("CLI 响应格式无效: {e}"))?;
        if response.version != PROTOCOL_VERSION {
            return Err(format!(
                "Avenil 返回了不支持的 CLI 协议版本: {}",
                response.version
            ));
        }
        if response.ok {
            Ok(response.data.unwrap_or(Value::Null))
        } else {
            Err(response
                .error
                .unwrap_or_else(|| "Avenil CLI 操作失败".into()))
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (command, args, socket, confirm);
        Err("CLI 控制目前只支持 macOS 本机 Unix socket".into())
    }
}

fn dispatch(
    request: ControlRequest,
    app: &AppHandle,
    state: &Arc<AppState>,
) -> Result<Value, String> {
    match request.command.as_str() {
        "status" | "list" => status(state, &request.args),
        "service_action" => service_action(state, &request.args),
        "group_action" => group_action(state, &request.args),
        "service_get" => service_get(state, &request.args),
        "service_create" => service_create(state, &request.args),
        "service_update" => service_update(state, &request.args),
        "service_delete" => {
            require_confirmation(request.confirm, "删除服务")?;
            service_delete(state, &request.args)
        }
        "group_list" => group_list(state),
        "group_create" => group_create(state, &request.args),
        "group_update" => group_update(state, &request.args),
        "group_delete" => {
            require_confirmation(request.confirm, "删除分组")?;
            group_delete(state, &request.args)
        }
        "config_show" => config_show(state, &request.args),
        "config_export" => config_export(state),
        "config_import_preview" => config_import_preview(state, &request.args),
        "config_import_apply" => {
            require_confirmation(request.confirm, "替换配置")?;
            config_import_apply(state, &request.args)
        }
        "resources" => resources(state, &request.args),
        "logs" => logs(state, &request.args),
        "open_url" => open_url(state, &request.args),
        "ide_preview" => ide_preview(state, &request.args),
        "ide_apply" => ide_apply(state, &request.args),
        "quit" => {
            require_confirmation(request.confirm, "退出 Avenil")?;
            crate::prepare_shutdown(app, state)?;
            Ok(json!({ "status": "stopped" }))
        }
        "quit_request_pending" => Ok(json!(state.has_quit_request())),
        "quit_request_cancel" => {
            state.clear_quit_request();
            Ok(Value::Null)
        }
        _ => Err(format!("不支持的 CLI 命令: {}", request.command)),
    }
}

fn require_confirmation(confirm: bool, operation: &str) -> Result<(), String> {
    if confirm {
        Ok(())
    } else {
        Err(format!("{operation}需要协议确认字段 confirm: true"))
    }
}

fn object(args: &Value) -> Result<&serde_json::Map<String, Value>, String> {
    args.as_object()
        .ok_or_else(|| "CLI 参数必须是 JSON 对象".into())
}

fn required<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    let value = object(args)?
        .get(key)
        .ok_or_else(|| format!("CLI 参数缺少 {key}"))?;
    serde_json::from_value(value.clone()).map_err(|e| format!("CLI 参数 {key} 无效: {e}"))
}

fn optional<T: DeserializeOwned>(args: &Value, key: &str) -> Result<Option<T>, String> {
    let Some(value) = object(args)?.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    serde_json::from_value(value.clone())
        .map(Some)
        .map_err(|e| format!("CLI 参数 {key} 无效: {e}"))
}

fn selectors(args: &Value, required_non_empty: bool) -> Result<Vec<String>, String> {
    let values: Vec<String> = optional(args, "selectors")?.unwrap_or_default();
    let values = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if required_non_empty && values.is_empty() {
        return Err("至少需要一个服务选择器（ID 或名称）".into());
    }
    let mut unique = HashSet::new();
    if values.iter().any(|value| !unique.insert(value)) {
        return Err("服务选择器不能重复".into());
    }
    Ok(values)
}

fn resolve_service_ids(
    state: &Arc<AppState>,
    values: &[String],
    allow_all: bool,
) -> Result<Vec<String>, String> {
    let services = state.config.lock().unwrap().services.clone();
    if values.is_empty() {
        if allow_all {
            return Ok(services.into_iter().map(|service| service.id).collect());
        }
        return Err("至少需要一个服务选择器（ID 或名称）".into());
    }

    values
        .iter()
        .map(|selector| resolve_service_selector(&services, selector))
        .collect()
}

fn resolve_service_selector(services: &[Service], selector: &str) -> Result<String, String> {
    let by_id = services.iter().find(|service| service.id == selector);
    let matches = services
        .iter()
        .filter(|service| service.name == selector)
        .collect::<Vec<_>>();
    match (by_id, matches.as_slice()) {
        (Some(service), _) => Ok(service.id.clone()),
        (None, [service]) => Ok(service.id.clone()),
        (None, []) => Err(format!("找不到服务: {selector}")),
        (None, _) => Err(format!("服务名称不唯一，请改用 ID: {selector}")),
    }
}

fn resolve_service_id(state: &Arc<AppState>, args: &Value) -> Result<String, String> {
    let values = selectors(args, true)?;
    if values.len() != 1 {
        return Err("该 CLI 操作只接受一个服务选择器".into());
    }
    resolve_service_ids(state, &values, false)?
        .into_iter()
        .next()
        .ok_or_else(|| "服务不存在".into())
}

fn resolve_group_id(state: &Arc<AppState>, selector: &str) -> Result<String, String> {
    let groups = state.config.lock().unwrap().groups.clone();
    if let Some(group) = groups.iter().find(|group| group.id == selector) {
        return Ok(group.id.clone());
    }
    let matches = groups
        .iter()
        .filter(|group| group.name == selector)
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [group] => Ok(group.id.clone()),
        [] => Err(format!("找不到分组: {selector}")),
        _ => Err(format!("分组名称不唯一，请改用 ID: {selector}")),
    }
}

fn status(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let ids = resolve_service_ids(state, &selectors(args, false)?, true)?;
    let config = state.config.lock().unwrap().clone();
    let runtimes = process::snapshots(state, Some(ids.clone()));
    let groups = config
        .groups
        .iter()
        .map(|group| (group.id.clone(), group.clone()))
        .collect::<std::collections::HashMap<_, _>>();
    let items = ids.iter().filter_map(|id| {
        let service = config.services.iter().find(|service| service.id == *id)?.clone();
        let runtime = runtimes.iter().find(|snapshot| snapshot.service_id == *id)?.clone();
        Some(json!({ "service": { "id": service.id, "name": service.name, "groupId": service.group_id, "workdir": service.workdir, "command": service.command, "port": service.port, "url": service.url }, "group": service.group_id.as_ref().and_then(|group_id| groups.get(group_id)), "runtime": runtime }))
    }).collect::<Vec<_>>();
    Ok(json!({ "services": items }))
}

fn service_action(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let action: String = required(args, "action")?;
    if !matches!(action.as_str(), "start" | "stop" | "restart") {
        return Err("服务动作必须是 start、stop 或 restart".into());
    }
    let selectors = selectors(args, true)?;
    let services = state.config.lock().unwrap().services.clone();
    let mut ids = Vec::new();
    let mut resolved_indexes = Vec::new();
    let mut results = (0..selectors.len())
        .map(|_| None)
        .collect::<Vec<Option<BatchActionResult>>>();
    let mut seen_ids = HashSet::new();
    for (index, selector) in selectors.iter().enumerate() {
        match resolve_service_selector(&services, selector) {
            Ok(id) if seen_ids.insert(id.clone()) => {
                ids.push(id);
                resolved_indexes.push(index);
            }
            Ok(_) => {
                results[index] = Some(failed_action(
                    selector,
                    &action,
                    "多个选择器指向同一个服务".into(),
                ));
            }
            Err(error) => {
                results[index] = Some(failed_action(selector, &action, error));
            }
        }
    }
    let grace_ms: Option<u64> = optional(args, "graceMs")?;
    for (index, result) in
        resolved_indexes
            .into_iter()
            .zip(process::batch(state.clone(), ids, action, grace_ms))
    {
        results[index] = Some(result);
    }
    serde_json::to_value(results.into_iter().flatten().collect::<Vec<_>>())
        .map_err(|e| format!("编码服务动作结果失败: {e}"))
}

fn failed_action(selector: &str, action: &str, error: String) -> BatchActionResult {
    BatchActionResult {
        service_id: selector.to_string(),
        action: action.to_string(),
        accepted: false,
        snapshot: None,
        error: Some(error),
    }
}

fn group_action(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let action: String = required(args, "action")?;
    if !matches!(action.as_str(), "start" | "stop" | "restart") {
        return Err("分组动作必须是 start、stop 或 restart".into());
    }
    let selector: String = required(args, "selector")?;
    let group_id = resolve_group_id(state, selector.trim())?;
    let ids = state
        .config
        .lock()
        .unwrap()
        .services
        .iter()
        .filter(|service| service.group_id.as_deref() == Some(group_id.as_str()))
        .map(|service| service.id.clone())
        .collect::<Vec<_>>();
    let grace_ms: Option<u64> = optional(args, "graceMs")?;
    serde_json::to_value(process::batch(state.clone(), ids, action, grace_ms))
        .map_err(|e| format!("编码分组动作结果失败: {e}"))
}

fn service_get(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let id = resolve_service_id(state, args)?;
    let service = state
        .config
        .lock()
        .unwrap()
        .services
        .iter()
        .find(|service| service.id == id)
        .cloned()
        .ok_or_else(|| "服务不存在".to_string())?;
    serde_json::to_value(service).map_err(|e| format!("编码服务失败: {e}"))
}

fn service_create(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let name: String = required(args, "name")?;
    let workdir: String = required(args, "workdir")?;
    let command: String = required(args, "command")?;
    let group_id = optional::<String>(args, "groupSelector")?
        .map(|selector| resolve_group_id(state, selector.trim()))
        .transpose()?;
    let service = Service {
        id: String::new(),
        name,
        group_id,
        workdir,
        command,
        shell: ShellSpec {
            program: optional(args, "shellProgram")?.unwrap_or_else(|| "/bin/zsh".into()),
            args: optional(args, "shellArgs")?.unwrap_or_else(|| vec!["-lc".into()]),
        },
        env: optional(args, "env")?.unwrap_or_default(),
        port: optional(args, "port")?,
        url: optional(args, "url")?,
        log: optional(args, "log")?.unwrap_or_default(),
    };
    serde_json::to_value(config::upsert_service(state, service)?)
        .map_err(|e| format!("编码服务失败: {e}"))
}

fn service_update(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let _mutation = state
        .mutation
        .lock()
        .map_err(|_| "状态变更锁不可用".to_string())?;
    let selector: String = required(args, "selector")?;
    let id = resolve_service_ids(state, &[selector], false)?
        .into_iter()
        .next()
        .ok_or_else(|| "服务不存在".to_string())?;
    let patch = args
        .get("patch")
        .and_then(Value::as_object)
        .ok_or_else(|| "CLI 参数缺少 patch 对象".to_string())?;
    let mut service = state
        .config
        .lock()
        .unwrap()
        .services
        .iter()
        .find(|service| service.id == id)
        .cloned()
        .ok_or_else(|| "服务不存在".to_string())?;
    if let Some(value) = patch.get("name") {
        service.name = serde_json::from_value(value.clone())
            .map_err(|e| format!("CLI 参数 name 无效: {e}"))?;
    }
    if let Some(value) = patch.get("workdir") {
        service.workdir = serde_json::from_value(value.clone())
            .map_err(|e| format!("CLI 参数 workdir 无效: {e}"))?;
    }
    if let Some(value) = patch.get("command") {
        service.command = serde_json::from_value(value.clone())
            .map_err(|e| format!("CLI 参数 command 无效: {e}"))?;
    }
    if let Some(value) = patch.get("groupSelector") {
        service.group_id = if value.is_null() {
            None
        } else {
            Some(resolve_group_id(
                state,
                serde_json::from_value::<String>(value.clone())
                    .map_err(|e| format!("CLI 参数 groupSelector 无效: {e}"))?
                    .trim(),
            )?)
        };
    }
    if let Some(value) = patch.get("port") {
        service.port = if value.is_null() {
            None
        } else {
            Some(
                serde_json::from_value(value.clone())
                    .map_err(|e| format!("CLI 参数 port 无效: {e}"))?,
            )
        };
    }
    if let Some(value) = patch.get("url") {
        service.url = if value.is_null() {
            None
        } else {
            Some(
                serde_json::from_value(value.clone())
                    .map_err(|e| format!("CLI 参数 url 无效: {e}"))?,
            )
        };
    }
    if let Some(value) = patch.get("shellProgram") {
        service.shell.program = serde_json::from_value(value.clone())
            .map_err(|e| format!("CLI 参数 shellProgram 无效: {e}"))?;
    }
    if let Some(value) = patch.get("shellArgs") {
        service.shell.args = serde_json::from_value(value.clone())
            .map_err(|e| format!("CLI 参数 shellArgs 无效: {e}"))?;
    }
    if let Some(value) = patch.get("env") {
        service.env =
            serde_json::from_value(value.clone()).map_err(|e| format!("CLI 参数 env 无效: {e}"))?;
    }
    if let Some(value) = patch.get("log") {
        let log_patch = value
            .as_object()
            .ok_or_else(|| "CLI 参数 log 必须是对象".to_string())?;
        if let Some(value) = log_patch.get("maxBytes") {
            service.log.max_bytes = serde_json::from_value(value.clone())
                .map_err(|e| format!("CLI 参数 log.maxBytes 无效: {e}"))?;
        }
        if let Some(value) = log_patch.get("rotateCount") {
            service.log.rotate_count = serde_json::from_value(value.clone())
                .map_err(|e| format!("CLI 参数 log.rotateCount 无效: {e}"))?;
        }
        if let Some(value) = log_patch.get("maxMemoryBytes") {
            service.log.max_memory_bytes = serde_json::from_value(value.clone())
                .map_err(|e| format!("CLI 参数 log.maxMemoryBytes 无效: {e}"))?;
        }
    }
    serde_json::to_value(config::upsert_service_locked(state, service)?)
        .map_err(|e| format!("编码服务失败: {e}"))
}

fn service_delete(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let id = resolve_service_id(state, args)?;
    config::delete_service(state, &id)?;
    Ok(Value::Null)
}

fn group_list(state: &Arc<AppState>) -> Result<Value, String> {
    let config = state.config.lock().unwrap().clone();
    let groups = config
        .groups
        .iter()
        .cloned()
        .map(|group| {
            let service_count = config
                .services
                .iter()
                .filter(|service| service.group_id.as_deref() == Some(group.id.as_str()))
                .count();
            json!({ "group": group, "serviceCount": service_count })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "groups": groups }))
}

fn group_create(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let name: String = required(args, "name")?;
    let sort_order: i32 = optional(args, "sortOrder")?
        .unwrap_or_else(|| state.config.lock().unwrap().groups.len() as i32);
    serde_json::to_value(config::upsert_group(
        state,
        Group {
            id: String::new(),
            name,
            sort_order,
        },
    )?)
    .map_err(|e| format!("编码分组失败: {e}"))
}

fn group_update(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let _mutation = state
        .mutation
        .lock()
        .map_err(|_| "状态变更锁不可用".to_string())?;
    let selector: String = required(args, "selector")?;
    let id = resolve_group_id(state, selector.trim())?;
    let name: String = required(args, "name")?;
    let group = state
        .config
        .lock()
        .unwrap()
        .groups
        .iter()
        .find(|group| group.id == id)
        .cloned()
        .ok_or_else(|| "分组不存在".to_string())?;
    serde_json::to_value(config::upsert_group_locked(state, Group { name, ..group })?)
        .map_err(|e| format!("编码分组失败: {e}"))
}

fn group_delete(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let selector: String = required(args, "selector")?;
    let id = resolve_group_id(state, selector.trim())?;
    config::delete_group(state, &id)?;
    Ok(Value::Null)
}

fn config_show(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let _ = args;
    serde_json::to_value(&*state.config.lock().unwrap()).map_err(|e| format!("编码配置失败: {e}"))
}

fn config_export(state: &Arc<AppState>) -> Result<Value, String> {
    serde_json::to_value(config::export(&state.config.lock().unwrap())?)
        .map_err(|e| format!("编码导出结果失败: {e}"))
}

fn config_import_preview(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let json: String = required(args, "json")?;
    serde_json::to_value(config::import_preview(
        &json,
        &state.config.lock().unwrap(),
    )?)
    .map_err(|e| format!("编码导入预览失败: {e}"))
}

fn config_import_apply(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let json: String = required(args, "json")?;
    serde_json::to_value(config::import_apply(state, &json)?)
        .map_err(|e| format!("编码导入结果失败: {e}"))
}

fn resources(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let ids = resolve_service_ids(state, &selectors(args, false)?, true)?;
    let snapshots = resources::collect(state, Some(ids));
    for item in &snapshots {
        if let Some(sink) = state.sink() {
            sink.resource(item);
        }
    }
    serde_json::to_value(snapshots).map_err(|e| format!("编码资源快照失败: {e}"))
}

fn logs(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let service_id = resolve_service_id(state, args)?;
    let after_seq: Option<u64> = optional(args, "afterSeq")?;
    let limit: usize = optional(args, "limit")?.unwrap_or(200);
    let search: Option<String> = optional(args, "search")?;
    let service = state
        .config
        .lock()
        .unwrap()
        .services
        .iter()
        .find(|service| service.id == service_id)
        .cloned()
        .ok_or_else(|| "服务不存在".to_string())?;
    let mut page = state
        .logs
        .query(&service, after_seq, limit, search.as_deref())?;
    page.generation = process::snapshots(state, Some(vec![service_id.clone()]))
        .first()
        .and_then(|snapshot| snapshot.generation.clone());
    serde_json::to_value(page).map_err(|e| format!("编码日志页面失败: {e}"))
}

fn open_url(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let service_id = resolve_service_id(state, args)?;
    crate::open_service_url_impl(state, &service_id)?;
    Ok(Value::Null)
}

fn ide_preview(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let project_root: String = required(args, "projectRoot")?;
    let stored = ide_import::preview(IdeImportInput { project_root })?;
    serde_json::to_value(ide_import::store_preview(state, stored)?)
        .map_err(|e| format!("编码 IDE 导入预览失败: {e}"))
}

fn ide_apply(state: &Arc<AppState>, args: &Value) -> Result<Value, String> {
    let preview: IdeImportPreview = required(args, "preview")?;
    let selected_ids: Vec<String> = required(args, "selectedIds")?;
    let group_name: String = required(args, "groupName")?;
    serde_json::to_value(ide_import::apply(
        state,
        &preview,
        selected_ids,
        group_name,
    )?)
    .map_err(|e| format!("编码 IDE 导入结果失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AppConfig, LogPolicy, ServiceStatus};

    fn service(id: &str, name: &str) -> Service {
        Service {
            id: id.into(),
            name: name.into(),
            group_id: None,
            workdir: "/tmp".into(),
            command: "printf ok".into(),
            shell: ShellSpec::default(),
            env: vec![],
            port: None,
            url: None,
            log: LogPolicy::default(),
        }
    }

    #[test]
    fn destructive_operations_require_protocol_confirmation() {
        assert_eq!(
            require_confirmation(false, "删除服务").unwrap_err(),
            "删除服务需要协议确认字段 confirm: true"
        );
        assert!(require_confirmation(true, "删除服务").is_ok());
    }

    #[test]
    fn selectors_trim_empty_values_and_reject_duplicates() {
        let args = json!({ "selectors": ["  api ", "", "worker"] });
        assert_eq!(selectors(&args, true).unwrap(), vec!["api", "worker"]);

        let duplicate = json!({ "selectors": ["api", " api "] });
        assert_eq!(
            selectors(&duplicate, true).unwrap_err(),
            "服务选择器不能重复"
        );
        assert!(selectors(&json!({}), true)
            .unwrap_err()
            .contains("至少需要一个服务选择器"));
    }

    #[test]
    fn service_selectors_support_ids_and_unique_names_but_reject_ambiguous_names() {
        let services = vec![
            service("service-1", "api"),
            service("service-2", "worker"),
            service("service-3", "api"),
        ];

        assert_eq!(
            resolve_service_selector(&services, "service-1").unwrap(),
            "service-1"
        );
        assert_eq!(
            resolve_service_selector(&services[..2], "worker").unwrap(),
            "service-2"
        );
        assert_eq!(
            resolve_service_selector(&services, "api").unwrap_err(),
            "服务名称不唯一，请改用 ID: api"
        );
        assert_eq!(
            resolve_service_selector(&services, "missing").unwrap_err(),
            "找不到服务: missing"
        );
    }

    #[test]
    fn typed_argument_helpers_report_missing_and_invalid_values() {
        let args = json!({ "count": 3, "enabled": true, "name": "api" });

        assert_eq!(required::<String>(&args, "name").unwrap(), "api");
        assert_eq!(optional::<u64>(&args, "count").unwrap(), Some(3));
        assert_eq!(optional::<String>(&args, "missing").unwrap(), None);
        assert!(required::<String>(&args, "missing")
            .unwrap_err()
            .contains("缺少 missing"));
        assert!(optional::<String>(&args, "enabled")
            .unwrap_err()
            .contains("enabled 无效"));
        assert!(object(&Value::Null)
            .unwrap_err()
            .contains("必须是 JSON 对象"));
    }

    #[test]
    fn group_and_service_status_queries_use_the_configured_selectors() {
        let state = AppState::new();
        let group = Group {
            id: "group-1".into(),
            name: "local".into(),
            sort_order: 0,
        };
        let mut api = service("service-1", "api");
        api.group_id = Some(group.id.clone());
        *state.config.lock().unwrap() = AppConfig {
            schema_version: 1,
            groups: vec![group],
            services: vec![api],
        };

        assert_eq!(resolve_group_id(&state, "local").unwrap(), "group-1");
        assert_eq!(
            resolve_service_ids(&state, &[], true).unwrap(),
            vec!["service-1"]
        );
        let status = status(&state, &json!({ "selectors": ["api"] })).unwrap();
        assert_eq!(status["services"][0]["runtime"]["status"], "stopped");
        assert_eq!(status["services"][0]["group"]["name"], "local");
        assert_eq!(
            ServiceStatus::Stopped,
            crate::process::snapshots(&state, Some(vec!["service-1".into()]))[0].status
        );
    }
}
