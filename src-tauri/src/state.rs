use crate::{
    events::SharedSink,
    ide_import::StoredPreview,
    logs::LogHub,
    models::{AppConfig, RuntimeSnapshot},
};
use std::{
    collections::{HashMap, HashSet},
    process::Child,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

pub struct RuntimeRecord {
    pub snapshot: Mutex<RuntimeSnapshot>,
    pub child: Arc<Mutex<Child>>,
    pub cancel: Arc<AtomicBool>,
    pub stop_requested: Arc<AtomicBool>,
    pub failure: Arc<Mutex<Option<String>>>,
    pub cleanup: Mutex<()>,
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub runtimes: Mutex<HashMap<String, Arc<RuntimeRecord>>>,
    pub operations: Mutex<HashSet<String>>,
    pub logs: LogHub,
    pub sink: Mutex<Option<SharedSink>>,
    pub config_path: Mutex<Option<std::path::PathBuf>>,
    pub mutation: Mutex<()>,
    pub lifecycle: Mutex<()>,
    pub shutting_down: AtomicBool,
    pub exit_allowed: AtomicBool,
    pub quit_requested: AtomicBool,
    pub ide_previews: Mutex<HashMap<String, StoredPreview>>,
}

impl AppState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            config: Mutex::new(AppConfig::default()),
            runtimes: Mutex::new(HashMap::new()),
            operations: Mutex::new(HashSet::new()),
            logs: LogHub::default(),
            sink: Mutex::new(None),
            config_path: Mutex::new(None),
            mutation: Mutex::new(()),
            lifecycle: Mutex::new(()),
            shutting_down: AtomicBool::new(false),
            exit_allowed: AtomicBool::new(false),
            quit_requested: AtomicBool::new(false),
            ide_previews: Mutex::new(HashMap::new()),
        })
    }
    pub fn set_sink(&self, sink: SharedSink) {
        *self.sink.lock().unwrap() = Some(sink);
    }
    pub fn sink(&self) -> Option<SharedSink> {
        self.sink.lock().unwrap().clone()
    }
    pub fn active(&self, service_id: &str) -> bool {
        self.operations.lock().unwrap().contains(service_id)
            || self
                .runtimes
                .lock()
                .unwrap()
                .get(service_id)
                .map(|r| is_active_status(&r.snapshot.lock().unwrap().status))
                .unwrap_or(false)
    }
    pub fn runtime_active(&self, service_id: &str) -> bool {
        self.runtimes
            .lock()
            .unwrap()
            .get(service_id)
            .map(|r| is_active_status(&r.snapshot.lock().unwrap().status))
            .unwrap_or(false)
    }
    pub fn mark_operation(&self, service_id: &str) -> Result<(), String> {
        let mut ops = self
            .operations
            .lock()
            .map_err(|_| "操作锁不可用".to_string())?;
        if !ops.insert(service_id.to_string()) {
            return Err("该服务已有操作正在执行".into());
        }
        Ok(())
    }
    pub fn unmark_operation(&self, service_id: &str) {
        self.operations.lock().unwrap().remove(service_id);
    }
    pub fn emit_runtime(&self, snapshot: &RuntimeSnapshot) {
        if let Some(sink) = self.sink() {
            sink.runtime(snapshot);
        }
    }
    pub fn begin_shutdown(&self) -> bool {
        let _guard = self.lifecycle.lock().unwrap();
        if self
            .shutting_down
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            self.exit_allowed.store(false, Ordering::SeqCst);
            true
        } else {
            false
        }
    }
    pub fn abort_shutdown(&self) {
        let _guard = self.lifecycle.lock().unwrap();
        self.exit_allowed.store(false, Ordering::SeqCst);
        self.shutting_down.store(false, Ordering::SeqCst);
    }
    pub fn allow_exit(&self) {
        self.exit_allowed.store(true, Ordering::SeqCst);
    }
    pub fn request_quit(&self) {
        self.quit_requested.store(true, Ordering::SeqCst);
    }
    pub fn clear_quit_request(&self) {
        self.quit_requested.store(false, Ordering::SeqCst);
    }
    pub fn has_quit_request(&self) -> bool {
        self.quit_requested.load(Ordering::SeqCst)
    }
}

pub fn is_active_status(status: &crate::models::ServiceStatus) -> bool {
    matches!(
        status,
        crate::models::ServiceStatus::Starting
            | crate::models::ServiceStatus::Running
            | crate::models::ServiceStatus::Stopping
    )
}
