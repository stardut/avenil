use std::{collections::{HashMap, VecDeque}, fs::{self, OpenOptions}, io::Write, path::PathBuf, sync::Mutex};
use chrono::Utc;

use crate::models::{LogChunk, LogPage, Service};
use crate::events::SharedSink;

const MAX_LINE_BYTES: usize = 1024 * 1024;

struct LogBuffer {
    chunks: VecDeque<LogChunk>,
    bytes: u64,
    next_seq: u64,
    dropped: u64,
}

impl Default for LogBuffer {
    fn default() -> Self { Self { chunks: VecDeque::new(), bytes: 0, next_seq: 0, dropped: 0 } }
}

pub struct LogHub {
    buffers: Mutex<HashMap<String, LogBuffer>>,
    root: Mutex<Option<PathBuf>>,
}

impl Default for LogHub { fn default() -> Self { Self { buffers: Mutex::new(HashMap::new()), root: Mutex::new(None) } } }

impl LogHub {
    pub fn set_root(&self, root: PathBuf) { let _ = fs::create_dir_all(&root); *self.root.lock().unwrap() = Some(root); }

    pub fn append(&self, service: &Service, generation: Option<String>, stream: &str, text: String, sink: Option<&SharedSink>) {
        let mut text = text;
        if text.is_empty() { return; }
        if text.len() > MAX_LINE_BYTES { let mut end = MAX_LINE_BYTES; while end > 0 && !text.is_char_boundary(end) { end -= 1; } text.truncate(end); }
        let (chunk, dropped) = {
            let mut all = self.buffers.lock().unwrap();
            let buffer = all.entry(service.id.clone()).or_default();
            let seq = buffer.next_seq;
            buffer.next_seq = buffer.next_seq.saturating_add(1);
            let chunk = LogChunk { service_id: service.id.clone(), generation, seq, stream: stream.to_string(), timestamp: Utc::now().to_rfc3339(), text };
            let bytes = chunk.text.len() as u64;
            buffer.bytes = buffer.bytes.saturating_add(bytes);
            buffer.chunks.push_back(chunk.clone());
            let mut removed = 0;
            while buffer.bytes > service.log.max_memory_bytes.max(64 * 1024) {
                if let Some(old) = buffer.chunks.pop_front() { buffer.bytes = buffer.bytes.saturating_sub(old.text.len() as u64); removed += 1; }
                else { break; }
            }
            buffer.dropped = buffer.dropped.saturating_add(removed);
            (chunk, removed)
        };
        self.append_disk(service, &chunk);
        if let Some(sink) = sink { sink.log(&chunk); }
        if dropped > 0 { /* reflected by the next log_page call */ }
    }

    pub fn record_dropped(&self, service_id: &str) { if let Some(buffer) = self.buffers.lock().unwrap().get_mut(service_id) { buffer.dropped = buffer.dropped.saturating_add(1); } }

    fn append_disk(&self, service: &Service, chunk: &LogChunk) {
        let root = match self.root.lock().unwrap().clone() { Some(root) => root, None => return };
        let path = root.join(format!("{}.log", service.id));
        let line = match serde_json::to_string(chunk) { Ok(line) => line + "\n", Err(_) => return };
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size.saturating_add(line.len() as u64) > service.log.max_bytes.max(64 * 1024) {
            for index in (1..=service.log.rotate_count).rev() {
                let from = if index == 1 { path.clone() } else { root.join(format!("{}.log.{}", service.id, index - 1)) };
                let to = root.join(format!("{}.log.{}", service.id, index));
                if from.exists() { let _ = fs::rename(from, to); }
            }
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) { let _ = file.write_all(line.as_bytes()); let _ = file.flush(); }
    }

    pub fn page(&self, service_id: &str, after_seq: Option<u64>, limit: usize) -> LogPage {
        let all = self.buffers.lock().unwrap();
        let buffer = all.get(service_id);
        let chunks = buffer.map(|buffer| buffer.chunks.iter().filter(|chunk| after_seq.map(|seq| chunk.seq > seq).unwrap_or(true)).take(limit.min(1000)).cloned().collect()).unwrap_or_default();
        let next_seq = buffer.map(|b| b.next_seq).unwrap_or(0);
        let truncated = buffer.map(|b| after_seq.map(|seq| b.chunks.front().map(|first| seq < first.seq).unwrap_or(false)).unwrap_or(false)).unwrap_or(false);
        let generation = buffer.and_then(|b| b.chunks.back().and_then(|chunk| chunk.generation.clone()));
        LogPage { service_id: service_id.to_string(), generation, chunks, next_seq, truncated, dropped_chunks: buffer.map(|b| b.dropped).unwrap_or(0) }
    }
}
