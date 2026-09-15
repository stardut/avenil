use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::models::{LogChunk, ResourceSnapshot, RuntimeSnapshot};

pub trait EventSink: Send + Sync {
    fn runtime(&self, snapshot: &RuntimeSnapshot);
    fn resource(&self, snapshot: &ResourceSnapshot);
    fn log(&self, chunk: &LogChunk);
    fn config(&self, config: &crate::models::AppConfig);
    fn shutdown(&self, phase: &str);
    fn shutdown_error(&self, phase: &str, error: &str) { let _ = error; self.shutdown(phase); }
}

pub struct TauriEventSink(pub AppHandle);

impl EventSink for TauriEventSink {
    fn runtime(&self, snapshot: &RuntimeSnapshot) { let _ = self.0.emit("avenil://runtime-changed", snapshot); }
    fn resource(&self, snapshot: &ResourceSnapshot) { let _ = self.0.emit("avenil://resource-changed", snapshot); }
    fn log(&self, chunk: &LogChunk) { let _ = self.0.emit("avenil://log", chunk); }
    fn config(&self, config: &crate::models::AppConfig) { let _ = self.0.emit("avenil://config-changed", serde_json::json!({ "config": config })); }
    fn shutdown(&self, phase: &str) { let _ = self.0.emit("avenil://shutdown-state", serde_json::json!({ "phase": phase })); }
    fn shutdown_error(&self, phase: &str, error: &str) { let _ = self.0.emit("avenil://shutdown-state", serde_json::json!({ "phase": phase, "error": error })); }
}

pub type SharedSink = Arc<dyn EventSink>;
