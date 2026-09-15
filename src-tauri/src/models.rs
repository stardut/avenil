use serde::{Deserialize, Serialize};

pub type Id = String;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: Id,
    pub name: String,
    pub sort_order: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    pub secret: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPolicy {
    pub max_bytes: u64,
    pub rotate_count: u8,
    pub max_memory_bytes: u64,
}

impl Default for LogPolicy {
    fn default() -> Self {
        Self { max_bytes: 2 * 1024 * 1024, rotate_count: 3, max_memory_bytes: 256 * 1024 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSpec {
    pub program: String,
    pub args: Vec<String>,
}

impl Default for ShellSpec {
    fn default() -> Self {
        Self { program: "/bin/zsh".into(), args: vec!["-lc".into()] }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: Id,
    pub name: String,
    pub group_id: Option<Id>,
    pub workdir: String,
    pub command: String,
    pub shell: ShellSpec,
    pub env: Vec<EnvVar>,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub log: LogPolicy,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub groups: Vec<Group>,
    pub services: Vec<Service>,
}

impl Default for AppConfig {
    fn default() -> Self { Self { schema_version: 1, groups: vec![], services: vec![] } }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus { Stopped, Starting, Running, Stopping, Exited, Failed, Unknown }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub service_id: Id,
    pub generation: Option<String>,
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub pgid: Option<i32>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
    pub error: Option<String>,
}

impl RuntimeSnapshot {
    pub fn stopped(service_id: Id) -> Self {
        Self { service_id, generation: None, status: ServiceStatus::Stopped, pid: None, pgid: None, started_at: None, ended_at: None, exit_code: None, signal: None, error: None }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSnapshot {
    pub service_id: Id,
    pub generation: String,
    pub captured_at: String,
    pub process_count: usize,
    pub cpu_percent: Option<f32>,
    pub rss_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogChunk {
    pub service_id: Id,
    pub generation: Option<String>,
    pub seq: u64,
    pub stream: String,
    pub timestamp: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub service_id: Id,
    pub generation: Option<String>,
    pub chunks: Vec<LogChunk>,
    pub next_seq: u64,
    pub truncated: bool,
    pub dropped_chunks: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub schema_version: u32,
    pub group_count: usize,
    pub service_count: usize,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub changes: ImportChanges,
    pub can_apply: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportChanges {
    pub added_groups: usize,
    pub removed_groups: usize,
    pub added_services: usize,
    pub removed_services: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchActionResult {
    pub service_id: Id,
    pub action: String,
    pub accepted: bool,
    pub snapshot: Option<RuntimeSnapshot>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult { pub json: String, pub notice: String }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeImportInput {
    pub project_root: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeImportSource {
    pub path: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeImportCandidate {
    pub id: Id,
    pub name: String,
    pub status: String,
    pub service: Option<Service>,
    pub warnings: Vec<String>,
    pub missing: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeImportPreview {
    pub snapshot_id: Id,
    pub project_root: String,
    pub sources: Vec<IdeImportSource>,
    pub suggested_group_name: String,
    pub candidates: Vec<IdeImportCandidate>,
    pub warnings: Vec<String>,
}
