use chrono::Utc;
use std::{
    io::{BufRead, BufReader},
    net::{SocketAddr, TcpListener, TcpStream},
    process::{ChildStderr, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, SyncSender, TrySendError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

use crate::{
    models::{BatchActionResult, Id, RuntimeSnapshot, Service, ServiceStatus},
    state::{AppState, RuntimeRecord},
};

type PendingLog = (String, String, Option<String>);

#[derive(Default)]
pub struct StopAllReport {
    pub attempted: usize,
    pub stopped: usize,
    pub errors: Vec<String>,
}

fn service(state: &Arc<AppState>, id: &str) -> Result<Service, String> {
    state
        .config
        .lock()
        .unwrap()
        .services
        .iter()
        .find(|s| s.id == id)
        .cloned()
        .ok_or_else(|| "服务不存在".into())
}
fn snapshot(state: &Arc<AppState>, id: &str) -> RuntimeSnapshot {
    state
        .runtimes
        .lock()
        .unwrap()
        .get(id)
        .map(|r| r.snapshot.lock().unwrap().clone())
        .unwrap_or_else(|| RuntimeSnapshot::stopped(id.to_string()))
}
fn set_snapshot(
    state: &Arc<AppState>,
    id: &str,
    update: impl FnOnce(&mut RuntimeSnapshot),
) -> Option<RuntimeSnapshot> {
    let record = state.runtimes.lock().unwrap().get(id).cloned()?;
    let mut current = record.snapshot.lock().unwrap();
    update(&mut current);
    let current = current.clone();
    drop(current.clone());
    state.emit_runtime(&current);
    Some(current)
}
fn process_group_exists(pgid: i32) -> bool {
    let result = unsafe { libc::kill(-pgid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}
fn process_group_signal(pgid: i32, signal: i32) -> Result<(), String> {
    let result = unsafe { libc::kill(-pgid, signal) };
    if result == -1 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(())
        } else {
            Err(format!("发送进程组信号失败: {error}"))
        }
    } else {
        Ok(())
    }
}
fn cleanup_owned_group(record: &Arc<RuntimeRecord>) -> Result<(), String> {
    let _cleanup = record
        .cleanup
        .lock()
        .map_err(|_| "进程组清理锁不可用".to_string())?;
    let pgid = record
        .snapshot
        .lock()
        .map_err(|_| "运行态锁不可用".to_string())?
        .pgid;
    let Some(pgid) = pgid else { return Ok(()) };
    if !process_group_exists(pgid) {
        return Ok(());
    }
    process_group_signal(pgid, libc::SIGTERM)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if !process_group_exists(pgid) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }
    process_group_signal(pgid, libc::SIGKILL)?;
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if !process_group_exists(pgid) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err(format!("进程组 {pgid} 在清理后仍存活"))
}

pub fn start(state: Arc<AppState>, service_id: Id) -> Result<RuntimeSnapshot, String> {
    state.mark_operation(&service_id)?;
    let result = (|| {
        let _mutation = state
            .mutation
            .lock()
            .map_err(|_| "状态变更锁不可用".to_string())?;
        start_locked(state.clone(), &service_id)
    })();
    state.unmark_operation(&service_id);
    result
}

fn start_locked(state: Arc<AppState>, service_id: &str) -> Result<RuntimeSnapshot, String> {
    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| "生命周期锁不可用".to_string())?;
    if state.shutting_down.load(Ordering::SeqCst) {
        return Err("应用正在退出，不能启动新服务".into());
    }
    let service = service(&state, service_id)?;
    if state.runtime_active(service_id) {
        return Err("服务正在运行".into());
    }
    if let Some(port) = service.port {
        if TcpListener::bind(("127.0.0.1", port)).is_err() {
            return Err(format!("端口 {port} 已被占用"));
        }
    }
    let generation = Uuid::new_v4().to_string();
    let mut command = Command::new(&service.shell.program);
    command
        .args(&service.shell.args)
        .arg(&service.command)
        .current_dir(&service.workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for env in &service.env {
        command.env(&env.key, &env.value);
    }
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if libc::setpgid(0, 0) != 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let mut child = command.spawn().map_err(|e| format!("启动服务失败: {e}"))?;
    let pid = child.id();
    let pgid = i32::try_from(pid).map_err(|_| "PID 超出进程组范围".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法取得 stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法取得 stderr".to_string())?;
    let initial_status = if service.port.is_some() {
        ServiceStatus::Starting
    } else {
        ServiceStatus::Running
    };
    let initial = RuntimeSnapshot {
        service_id: service.id.clone(),
        generation: Some(generation.clone()),
        status: initial_status,
        pid: Some(pid),
        pgid: Some(pgid),
        started_at: Some(Utc::now().to_rfc3339()),
        ended_at: None,
        exit_code: None,
        signal: None,
        error: None,
    };
    let record = Arc::new(RuntimeRecord {
        snapshot: Mutex::new(initial.clone()),
        child: Arc::new(Mutex::new(child)),
        cancel: Arc::new(AtomicBool::new(false)),
        stop_requested: Arc::new(AtomicBool::new(false)),
        failure: Arc::new(Mutex::new(None)),
        cleanup: Mutex::new(()),
    });
    state
        .runtimes
        .lock()
        .unwrap()
        .insert(service.id.clone(), record.clone());
    state.emit_runtime(&initial);
    start_log_threads(
        state.clone(),
        service.clone(),
        Some(generation.clone()),
        stdout,
        stderr,
    );
    start_monitor(
        state.clone(),
        service.clone(),
        record.clone(),
        generation.clone(),
    );
    if service.port.is_some() {
        start_readiness_waiter(state.clone(), service.clone(), record.clone(), generation);
    }
    Ok(initial)
}

fn start_log_threads(
    state: Arc<AppState>,
    service: Service,
    generation: Option<String>,
    stdout: ChildStdout,
    stderr: ChildStderr,
) {
    let (sender, receiver) = sync_channel::<PendingLog>(256);
    spawn_reader(
        sender.clone(),
        stdout,
        "stdout".into(),
        generation.clone(),
        service.id.clone(),
        state.clone(),
    );
    spawn_reader(
        sender,
        stderr,
        "stderr".into(),
        generation.clone(),
        service.id.clone(),
        state.clone(),
    );
    thread::spawn(move || {
        while let Ok((stream, text, generation)) = receiver.recv() {
            let sink = state.sink();
            if let Err(error) =
                state
                    .logs
                    .append(&service, generation, &stream, text, sink.as_ref())
            {
                state.logs.record_dropped(&service.id);
                eprintln!("服务 {} 的日志写入失败：{error}", service.name);
            }
        }
    });
}

fn spawn_reader<R: std::io::Read + Send + 'static>(
    sender: SyncSender<PendingLog>,
    reader: R,
    stream: String,
    generation: Option<String>,
    service_id: String,
    state: Arc<AppState>,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        while reader.read_line(&mut line).unwrap_or(0) > 0 {
            let value = std::mem::take(&mut line);
            match sender.try_send((stream.clone(), value, generation.clone())) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) => state.logs.record_dropped(&service_id),
                Err(TrySendError::Disconnected(_)) => break,
            }
        }
    });
}

fn start_monitor(
    state: Arc<AppState>,
    service: Service,
    record: Arc<RuntimeRecord>,
    generation: String,
) {
    thread::spawn(move || loop {
        let result = record.child.lock().unwrap().try_wait();
        match result {
            Ok(Some(exit)) => {
                let stopped = record.stop_requested.load(Ordering::SeqCst);
                let mut failure = record.failure.lock().unwrap().clone();
                if let Err(error) = cleanup_owned_group(&record) {
                    failure = Some(error);
                }
                let status = if failure.is_some() {
                    ServiceStatus::Failed
                } else if stopped {
                    ServiceStatus::Stopped
                } else if exit.code() == Some(0) {
                    ServiceStatus::Exited
                } else {
                    ServiceStatus::Failed
                };
                let _ = set_snapshot(&state, &service.id, |snapshot| {
                    if snapshot.generation.as_deref() == Some(&generation) {
                        snapshot.status = status;
                        snapshot.ended_at = Some(Utc::now().to_rfc3339());
                        snapshot.exit_code = exit.code();
                        snapshot.error = failure;
                    }
                });
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = set_snapshot(&state, &service.id, |snapshot| {
                    if snapshot.generation.as_deref() == Some(&generation) {
                        snapshot.status = ServiceStatus::Unknown;
                        snapshot.error = Some(error.to_string());
                    }
                });
                break;
            }
        }
    });
}

fn start_readiness_waiter(
    state: Arc<AppState>,
    service: Service,
    record: Arc<RuntimeRecord>,
    generation: String,
) {
    thread::spawn(move || {
        let port = match service.port {
            Some(port) => port,
            None => return,
        };
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if record.cancel.load(Ordering::SeqCst) {
                return;
            }
            let address = SocketAddr::from(([127, 0, 0, 1], port));
            if TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok() {
                let _ = set_snapshot(&state, &service.id, |snapshot| {
                    if snapshot.generation.as_deref() == Some(&generation)
                        && snapshot.status == ServiceStatus::Starting
                    {
                        snapshot.status = ServiceStatus::Running;
                    }
                });
                return;
            }
            if record
                .child
                .lock()
                .unwrap()
                .try_wait()
                .ok()
                .flatten()
                .is_some()
            {
                return;
            }
            thread::sleep(Duration::from_millis(200));
        }
        if !record.cancel.load(Ordering::SeqCst) {
            *record.failure.lock().unwrap() = Some("端口就绪检查超时（30 秒）".into());
            let pgid = record.snapshot.lock().unwrap().pgid;
            if let Some(pgid) = pgid {
                let _ = process_group_signal(pgid, libc::SIGTERM);
                let deadline = Instant::now() + Duration::from_secs(5);
                while Instant::now() < deadline {
                    if record
                        .child
                        .lock()
                        .unwrap()
                        .try_wait()
                        .ok()
                        .flatten()
                        .is_some()
                    {
                        return;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                let _ = process_group_signal(pgid, libc::SIGKILL);
                let _ = record.child.lock().unwrap().wait();
            }
        }
    });
}

pub fn stop(
    state: Arc<AppState>,
    service_id: Id,
    grace_ms: Option<u64>,
) -> Result<RuntimeSnapshot, String> {
    state.mark_operation(&service_id)?;
    let result = (|| {
        let _mutation = state
            .mutation
            .lock()
            .map_err(|_| "状态变更锁不可用".to_string())?;
        stop_locked(state.clone(), &service_id, grace_ms.unwrap_or(5000))
    })();
    state.unmark_operation(&service_id);
    result
}

pub fn stop_async(
    state: Arc<AppState>,
    service_id: Id,
    grace_ms: Option<u64>,
) -> Result<RuntimeSnapshot, String> {
    state.mark_operation(&service_id)?;
    let result = (|| {
        let _mutation = state
            .mutation
            .lock()
            .map_err(|_| "状态变更锁不可用".to_string())?;
        request_stop_locked(&state, &service_id)
    })();

    match result {
        Ok((Some(record), initial)) => {
            let worker_state = state.clone();
            let worker_service_id = service_id.clone();
            let grace_ms = grace_ms.unwrap_or(5000);
            thread::spawn(move || {
                let _ = wait_for_stop(worker_state.clone(), &worker_service_id, record, grace_ms);
                worker_state.unmark_operation(&worker_service_id);
            });
            Ok(initial)
        }
        Ok((None, snapshot)) => {
            state.unmark_operation(&service_id);
            Ok(snapshot)
        }
        Err(error) => {
            state.unmark_operation(&service_id);
            Err(error)
        }
    }
}

fn stop_locked(
    state: Arc<AppState>,
    service_id: &str,
    grace_ms: u64,
) -> Result<RuntimeSnapshot, String> {
    let (record, current) = request_stop_locked(&state, service_id)?;
    let Some(record) = record else {
        return Ok(current);
    };
    wait_for_stop(state, service_id, record, grace_ms)
}

fn request_stop_locked(
    state: &Arc<AppState>,
    service_id: &str,
) -> Result<(Option<Arc<RuntimeRecord>>, RuntimeSnapshot), String> {
    let record = state.runtimes.lock().unwrap().get(service_id).cloned();
    let Some(record) = record else {
        return Ok((None, snapshot(state, service_id)));
    };
    if !state.runtime_active(service_id) {
        return Ok((None, snapshot(state, service_id)));
    }
    record.cancel.store(true, Ordering::SeqCst);
    record.stop_requested.store(true, Ordering::SeqCst);
    let _ = set_snapshot(&state, service_id, |snapshot| {
        snapshot.status = ServiceStatus::Stopping
    });
    if let Some(pgid) = record.snapshot.lock().unwrap().pgid {
        if let Err(error) = process_group_signal(pgid, libc::SIGTERM) {
            record.stop_requested.store(false, Ordering::SeqCst);
            record.cancel.store(false, Ordering::SeqCst);
            let _ = set_snapshot(&state, service_id, |snapshot| {
                snapshot.status = ServiceStatus::Running;
                snapshot.error = Some(error.clone());
            });
            return Err(error);
        }
    }
    Ok((Some(record), snapshot(state, service_id)))
}

fn wait_for_stop(
    state: Arc<AppState>,
    service_id: &str,
    record: Arc<RuntimeRecord>,
    grace_ms: u64,
) -> Result<RuntimeSnapshot, String> {
    let deadline = Instant::now() + Duration::from_millis(grace_ms.clamp(1000, 30000));
    while Instant::now() < deadline {
        if record
            .child
            .lock()
            .unwrap()
            .try_wait()
            .ok()
            .flatten()
            .is_some()
        {
            if let Err(error) = cleanup_owned_group(&record) {
                record.stop_requested.store(false, Ordering::SeqCst);
                record.cancel.store(false, Ordering::SeqCst);
                let _ = set_snapshot(&state, service_id, |snapshot| {
                    snapshot.status = ServiceStatus::Failed;
                    snapshot.error = Some(error.clone());
                });
                return Err(error);
            }
            let _ = set_snapshot(&state, service_id, |snapshot| {
                snapshot.status = ServiceStatus::Stopped
            });
            return Ok(snapshot(&state, service_id));
        }
        thread::sleep(Duration::from_millis(50));
    }
    if let Err(error) = cleanup_owned_group(&record) {
        record.stop_requested.store(false, Ordering::SeqCst);
        record.cancel.store(false, Ordering::SeqCst);
        let _ = set_snapshot(&state, service_id, |snapshot| {
            snapshot.status = ServiceStatus::Running;
            snapshot.error = Some(error.clone());
        });
        return Err(error);
    }
    let _ = record.child.lock().unwrap().wait();
    let _ = set_snapshot(&state, service_id, |snapshot| {
        snapshot.status = ServiceStatus::Stopped
    });
    Ok(snapshot(&state, service_id))
}

pub fn restart(
    state: Arc<AppState>,
    service_id: Id,
    grace_ms: Option<u64>,
) -> Result<RuntimeSnapshot, String> {
    state.mark_operation(&service_id)?;
    let result = (|| {
        let _mutation = state
            .mutation
            .lock()
            .map_err(|_| "状态变更锁不可用".to_string())?;
        if state.runtimes.lock().unwrap().contains_key(&service_id) {
            let _ = stop_locked(state.clone(), &service_id, grace_ms.unwrap_or(5000))?;
        }
        start_locked(state.clone(), &service_id)
    })();
    state.unmark_operation(&service_id);
    result
}

pub fn batch(
    state: Arc<AppState>,
    service_ids: Vec<Id>,
    action: String,
    grace_ms: Option<u64>,
) -> Vec<BatchActionResult> {
    if action == "stop" {
        return service_ids
            .into_iter()
            .map(
                |service_id| match stop_async(state.clone(), service_id.clone(), grace_ms) {
                    Ok(snapshot) => BatchActionResult {
                        service_id,
                        action: action.clone(),
                        accepted: true,
                        snapshot: Some(snapshot),
                        error: None,
                    },
                    Err(error) => BatchActionResult {
                        service_id,
                        action: action.clone(),
                        accepted: false,
                        snapshot: None,
                        error: Some(error),
                    },
                },
            )
            .collect();
    }

    let _mutation = state.mutation.lock().unwrap();
    let (sender, receiver) = std::sync::mpsc::channel();
    for (index, service_id) in service_ids.iter().cloned().enumerate() {
        let sender = sender.clone();
        let state = state.clone();
        let action = action.clone();
        thread::spawn(move || {
            let result = match action.as_str() {
                "start" => {
                    run_action_without_mutation(state, service_id.clone(), "start", grace_ms)
                }
                "stop" => run_action_without_mutation(state, service_id.clone(), "stop", grace_ms),
                "restart" => {
                    run_action_without_mutation(state, service_id.clone(), "restart", grace_ms)
                }
                _ => Err("不支持的批量操作".into()),
            };
            let item = match result {
                Ok(snapshot) => BatchActionResult {
                    service_id,
                    action,
                    accepted: true,
                    snapshot: Some(snapshot),
                    error: None,
                },
                Err(error) => BatchActionResult {
                    service_id,
                    action,
                    accepted: false,
                    snapshot: None,
                    error: Some(error),
                },
            };
            let _ = sender.send((index, item));
        });
    }
    drop(sender);
    let mut ordered: Vec<Option<BatchActionResult>> =
        (0..service_ids.len()).map(|_| None).collect();
    for (index, item) in receiver {
        ordered[index] = Some(item);
    }
    ordered.into_iter().flatten().collect()
}

fn run_action_without_mutation(
    state: Arc<AppState>,
    service_id: Id,
    action: &str,
    grace_ms: Option<u64>,
) -> Result<RuntimeSnapshot, String> {
    state.mark_operation(&service_id)?;
    let result = match action {
        "start" => start_locked(state.clone(), &service_id),
        "stop" => stop_locked(state.clone(), &service_id, grace_ms.unwrap_or(5000)),
        "restart" => (|| {
            if state.runtimes.lock().unwrap().contains_key(&service_id) {
                let _ = stop_locked(state.clone(), &service_id, grace_ms.unwrap_or(5000))?;
            }
            start_locked(state.clone(), &service_id)
        })(),
        _ => Err("不支持的批量操作".into()),
    };
    state.unmark_operation(&service_id);
    result
}

pub fn snapshots(state: &Arc<AppState>, ids: Option<Vec<Id>>) -> Vec<RuntimeSnapshot> {
    let wanted = ids.unwrap_or_else(|| {
        state
            .config
            .lock()
            .unwrap()
            .services
            .iter()
            .map(|s| s.id.clone())
            .collect()
    });
    wanted.iter().map(|id| snapshot(state, id)).collect()
}

pub fn stop_all(state: Arc<AppState>) -> StopAllReport {
    let ids: Vec<Id> = state
        .runtimes
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(id, record)| {
            is_active(&record.snapshot.lock().unwrap().status).then_some(id.clone())
        })
        .collect();
    let mut report = StopAllReport {
        attempted: ids.len(),
        ..StopAllReport::default()
    };
    for id in ids {
        match stop(state.clone(), id.clone(), Some(5000)) {
            Ok(snapshot) if !is_active(&snapshot.status) => report.stopped += 1,
            Ok(snapshot) => report
                .errors
                .push(format!("服务 {} 停止后仍为 {:?}", id, snapshot.status)),
            Err(error) => report.errors.push(format!("服务 {id}: {error}")),
        }
    }
    report
}

fn is_active(status: &ServiceStatus) -> bool {
    matches!(
        status,
        ServiceStatus::Starting | ServiceStatus::Running | ServiceStatus::Stopping
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AppConfig;

    #[test]
    fn missing_services_return_actionable_errors() {
        let state = AppState::new();

        assert_eq!(
            start(state.clone(), "missing".into()).unwrap_err(),
            "服务不存在"
        );
        assert_eq!(
            stop(state.clone(), "missing".into(), Some(0))
                .unwrap()
                .status,
            ServiceStatus::Stopped
        );
        assert_eq!(
            snapshots(&state, Some(vec!["missing".into()]))[0].status,
            ServiceStatus::Stopped
        );
    }

    #[test]
    fn start_is_rejected_once_shutdown_has_started() {
        let state = AppState::new();
        let service = Service {
            id: "service-1".into(),
            name: "api".into(),
            group_id: None,
            workdir: "/tmp".into(),
            command: "sleep 1".into(),
            shell: crate::models::ShellSpec::default(),
            env: vec![],
            port: None,
            url: None,
            log: crate::models::LogPolicy::default(),
        };
        *state.config.lock().unwrap() = AppConfig {
            schema_version: 1,
            groups: vec![],
            services: vec![service],
        };
        state.begin_shutdown();

        assert_eq!(
            start(state, "service-1".into()).unwrap_err(),
            "应用正在退出，不能启动新服务"
        );
    }

    #[test]
    fn async_stop_returns_while_the_service_is_stopping() {
        let state = AppState::new();
        let service_id = "async-stop-service";
        *state.config.lock().unwrap() = AppConfig {
            schema_version: 1,
            groups: vec![],
            services: vec![Service {
                id: service_id.into(),
                name: "slow service".into(),
                group_id: None,
                workdir: "/tmp".into(),
                command: "sleep 30".into(),
                shell: crate::models::ShellSpec::default(),
                env: vec![],
                port: None,
                url: None,
                log: crate::models::LogPolicy::default(),
            }],
        };

        assert_eq!(
            start(state.clone(), service_id.into()).unwrap().status,
            ServiceStatus::Running
        );
        let stopping = stop_async(state.clone(), service_id.into(), Some(30000)).unwrap();

        assert_eq!(stopping.status, ServiceStatus::Stopping);
        for _ in 0..100 {
            if !state.active(service_id) {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!state.active(service_id));
        assert_eq!(
            snapshots(&state, Some(vec![service_id.into()]))[0].status,
            ServiceStatus::Stopped
        );
    }

    #[test]
    fn batch_stop_returns_before_services_finish_stopping() {
        let state = AppState::new();
        let service_id = "batch-stop-service";
        *state.config.lock().unwrap() = AppConfig {
            schema_version: 1,
            groups: vec![],
            services: vec![Service {
                id: service_id.into(),
                name: "slow service".into(),
                group_id: None,
                workdir: "/tmp".into(),
                command: "sleep 30".into(),
                shell: crate::models::ShellSpec::default(),
                env: vec![],
                port: None,
                url: None,
                log: crate::models::LogPolicy::default(),
            }],
        };

        assert_eq!(
            start(state.clone(), service_id.into()).unwrap().status,
            ServiceStatus::Running
        );
        let results = batch(
            state.clone(),
            vec![service_id.into()],
            "stop".into(),
            Some(30000),
        );

        assert_eq!(results.len(), 1);
        assert!(results[0].accepted);
        assert_eq!(
            results[0].snapshot.as_ref().unwrap().status,
            ServiceStatus::Stopping
        );
        for _ in 0..100 {
            if !state.active(service_id) {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!state.active(service_id));
        assert_eq!(
            snapshots(&state, Some(vec![service_id.into()]))[0].status,
            ServiceStatus::Stopped
        );
    }

    #[test]
    fn batch_keeps_one_result_for_each_requested_service() {
        let state = AppState::new();

        let results = batch(
            state,
            vec!["missing-1".into(), "missing-2".into()],
            "start".into(),
            Some(0),
        );

        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .all(|result| !result.accepted && result.snapshot.is_none()));
        assert_eq!(results[0].service_id, "missing-1");
        assert_eq!(results[1].service_id, "missing-2");
    }
}
