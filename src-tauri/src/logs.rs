use chrono::Utc;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex, Weak},
};

use crate::events::SharedSink;
use crate::models::{LogChunk, LogPage, Service};

#[path = "logs/disk.rs"]
mod disk;
#[path = "logs/query.rs"]
mod query;

const MAX_LINE_BYTES: usize = 1024 * 1024;

pub(super) struct LogBuffer {
    pub(super) chunks: VecDeque<LogChunk>,
    pub(super) bytes: u64,
    pub(super) next_seq: u64,
    pub(super) dropped: u64,
    pub(super) rotate_count: u8,
}

impl Default for LogBuffer {
    fn default() -> Self {
        Self {
            chunks: VecDeque::new(),
            bytes: 0,
            next_seq: 0,
            dropped: 0,
            rotate_count: 0,
        }
    }
}

impl LogBuffer {
    fn with_next_seq(next_seq: u64, rotate_count: u8) -> Self {
        Self {
            next_seq,
            rotate_count,
            ..Self::default()
        }
    }
}

pub struct LogHub {
    buffers: Mutex<HashMap<String, LogBuffer>>,
    root: Mutex<Option<PathBuf>>,
    service_locks: Mutex<HashMap<String, Weak<Mutex<()>>>>,
    storage_errors: Mutex<HashMap<String, String>>,
}

impl Default for LogHub {
    fn default() -> Self {
        Self {
            buffers: Mutex::new(HashMap::new()),
            root: Mutex::new(None),
            service_locks: Mutex::new(HashMap::new()),
            storage_errors: Mutex::new(HashMap::new()),
        }
    }
}

impl LogHub {
    pub fn set_root(&self, root: PathBuf) -> Result<(), String> {
        disk::initialize(&root)?;
        *self.root.lock().unwrap() = Some(root);
        Ok(())
    }

    pub fn append(
        &self,
        service: &Service,
        generation: Option<String>,
        stream: &str,
        text: String,
        sink: Option<&SharedSink>,
    ) -> Result<(), String> {
        let mut text = text;
        if text.is_empty() {
            return Ok(());
        }
        if text.len() > MAX_LINE_BYTES {
            let mut end = MAX_LINE_BYTES;
            while end > 0 && !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
        }
        let service_lock = self.service_lock(&service.id);
        let _service_guard = service_lock
            .lock()
            .map_err(|_| "日志服务锁不可用".to_string())?;
        if let Some(error) = self
            .storage_errors
            .lock()
            .unwrap()
            .get(&service.id)
            .cloned()
        {
            return Err(format!("服务日志存储不可用，需要恢复：{error}"));
        }
        let (initial_next_seq, should_prune) = {
            let all = self.buffers.lock().unwrap();
            match all.get(&service.id) {
                Some(buffer) => (
                    Some(buffer.next_seq),
                    buffer.rotate_count != service.log.rotate_count,
                ),
                None => (None, true),
            }
        };
        if should_prune {
            self.prune_rotated_files(service)?;
        }
        let next_seq = match initial_next_seq {
            Some(next_seq) => next_seq,
            None => self.disk_next_seq(service)?,
        };
        let chunk = LogChunk {
            service_id: service.id.clone(),
            generation,
            seq: next_seq,
            stream: stream.to_string(),
            timestamp: Utc::now().to_rfc3339(),
            text,
        };
        self.append_disk(service, &chunk)?;
        let dropped = {
            let mut all = self.buffers.lock().unwrap();
            let buffer = all
                .entry(service.id.clone())
                .or_insert_with(|| LogBuffer::with_next_seq(next_seq, service.log.rotate_count));
            buffer.next_seq = buffer.next_seq.max(next_seq.saturating_add(1));
            buffer.rotate_count = service.log.rotate_count;
            let bytes = chunk.text.len() as u64;
            buffer.bytes = buffer.bytes.saturating_add(bytes);
            buffer.chunks.push_back(chunk.clone());
            let mut removed = 0;
            while buffer.bytes > service.log.max_memory_bytes.max(64 * 1024) {
                if let Some(old) = buffer.chunks.pop_front() {
                    buffer.bytes = buffer.bytes.saturating_sub(old.text.len() as u64);
                    removed += 1;
                } else {
                    break;
                }
            }
            buffer.dropped = buffer.dropped.saturating_add(removed);
            removed
        };
        if let Some(sink) = sink {
            sink.log(&chunk);
        }
        if dropped > 0 { /* reflected by the next log_page call */ }
        Ok(())
    }

    pub fn record_dropped(&self, service_id: &str) {
        if let Some(buffer) = self.buffers.lock().unwrap().get_mut(service_id) {
            buffer.dropped = buffer.dropped.saturating_add(1);
        }
    }

    pub fn page(&self, service_id: &str, after_seq: Option<u64>, limit: usize) -> LogPage {
        query::page(&self.buffers, service_id, after_seq, limit)
    }

    pub fn query(
        &self,
        service: &Service,
        after_seq: Option<u64>,
        limit: usize,
        search: Option<&str>,
    ) -> Result<LogPage, String> {
        let service_lock = self.service_lock(&service.id);
        let (memory, disk_files) = {
            let _service_guard = service_lock
                .lock()
                .map_err(|_| "日志服务锁不可用".to_string())?;
            if let Some(error) = self
                .storage_errors
                .lock()
                .unwrap()
                .get(&service.id)
                .cloned()
            {
                return Err(format!("服务日志存储不可用，需要恢复：{error}"));
            }
            (
                query::memory_state(&self.buffers, &service.id),
                disk::open_files(&self.log_root()?, service)?,
            )
        };
        let result_limit = limit.min(1000);
        let memory_keys = memory
            .chunks
            .iter()
            .map(query::chunk_key)
            .collect::<HashSet<_>>();
        let mut disk_candidates = Vec::new();
        let mut disk_metadata = query::DiskScanMetadata::default();
        disk::scan_files(disk_files, &service.id, |chunk| {
            disk_metadata.observe(&chunk);
            if memory_keys.contains(&query::chunk_key(&chunk)) || result_limit == 0 {
                return;
            }
            if !after_seq.map(|seq| chunk.seq > seq).unwrap_or(true)
                || !search.map(|term| chunk.text.contains(term)).unwrap_or(true)
            {
                return;
            }
            disk_candidates.push(chunk);
            disk_candidates.sort_by(query::compare_chunks);
            if disk_candidates.len() > result_limit {
                disk_candidates.pop();
            }
        })?;

        let first_seq = match (
            memory.chunks.iter().map(|chunk| chunk.seq).min(),
            disk_metadata.first_seq,
        ) {
            (Some(memory), Some(disk)) => Some(memory.min(disk)),
            (Some(seq), None) | (None, Some(seq)) => Some(seq),
            (None, None) => None,
        };
        let mut latest = disk_metadata.latest.as_ref();
        for chunk in &memory.chunks {
            if latest
                .map(|current| query::compare_chunks(current, chunk) == std::cmp::Ordering::Less)
                .unwrap_or(true)
            {
                latest = Some(chunk);
            }
        }
        let generation = latest.and_then(|chunk| chunk.generation.clone());
        let mut chunks = memory.chunks;
        chunks.extend(disk_candidates);
        chunks.sort_by(query::compare_chunks);
        Ok(query::finish_page(
            &service.id,
            chunks,
            first_seq,
            generation,
            after_seq,
            limit,
            memory.next_seq.max(disk_metadata.next_seq),
            memory.dropped,
            search,
        ))
    }

    fn append_disk(&self, service: &Service, chunk: &LogChunk) -> Result<(), String> {
        let root = self.log_root()?;
        match disk::append(&root, service, chunk) {
            Ok(()) => Ok(()),
            Err(error) => {
                if error.contains("轮转回滚失败") || error.contains("恢复原日志长度失败")
                {
                    self.storage_errors
                        .lock()
                        .unwrap()
                        .insert(service.id.clone(), error.clone());
                }
                Err(error)
            }
        }
    }

    fn service_lock(&self, service_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.service_locks.lock().unwrap();
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(service_id).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(Mutex::new(()));
        locks.insert(service_id.to_string(), Arc::downgrade(&lock));
        lock
    }

    fn log_root(&self) -> Result<PathBuf, String> {
        self.root
            .lock()
            .map_err(|_| "日志目录锁不可用".to_string())?
            .clone()
            .ok_or_else(|| "日志目录尚未初始化".to_string())
    }

    fn prune_rotated_files(&self, service: &Service) -> Result<(), String> {
        disk::prune_rotated_files(&self.log_root()?, service)
    }

    fn disk_next_seq(&self, service: &Service) -> Result<u64, String> {
        disk::next_seq(&self.log_root()?, service)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{LogPolicy, ShellSpec};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn service(id: &str) -> Service {
        Service {
            id: id.into(),
            name: "logs".into(),
            group_id: None,
            workdir: "/tmp".into(),
            command: "printf logs".into(),
            shell: ShellSpec::default(),
            env: vec![],
            port: None,
            url: None,
            log: LogPolicy::default(),
        }
    }

    fn temp_root() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("avenil-log-test-{suffix}"));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn append_exposes_ordered_chunks_and_searchable_disk_history() {
        let root = temp_root();
        let hub = LogHub::default();
        hub.set_root(root.clone()).unwrap();
        let service = service("service-logs");

        hub.append(
            &service,
            Some("generation-1".into()),
            "stdout",
            "ready".into(),
            None,
        )
        .unwrap();
        hub.append(
            &service,
            Some("generation-1".into()),
            "stderr",
            "failed".into(),
            None,
        )
        .unwrap();

        let page = hub.page(&service.id, None, 10);
        assert_eq!(page.chunks.len(), 2);
        assert_eq!(page.chunks[0].seq, 0);
        assert_eq!(page.chunks[1].stream, "stderr");
        assert_eq!(page.next_seq, 2);

        let filtered = hub.query(&service, None, 10, Some("ready")).unwrap();
        assert_eq!(filtered.chunks.len(), 1);
        assert_eq!(filtered.chunks[0].text, "ready");
        assert_eq!(filtered.generation.as_deref(), Some("generation-1"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn page_marks_history_truncated_after_memory_eviction() {
        let root = temp_root();
        let hub = LogHub::default();
        hub.set_root(root.clone()).unwrap();
        let mut service = service("service-bounded");
        service.log.max_memory_bytes = 64 * 1024;

        for index in 0..3 {
            hub.append(
                &service,
                None,
                "stdout",
                format!("{}{}", index, "x".repeat(32 * 1024)),
                None,
            )
            .unwrap();
        }

        let page = hub.page(&service.id, Some(0), 10);
        assert!(page.truncated);
        assert!(page.dropped_chunks > 0);
        assert!(page.chunks.iter().all(|chunk| chunk.seq > 0));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_utf8_lines_are_truncated_at_a_character_boundary() {
        let root = temp_root();
        let hub = LogHub::default();
        hub.set_root(root.clone()).unwrap();
        let service = service("service-utf8");
        let text = "中".repeat(600_000);

        hub.append(&service, None, "stdout", text, None).unwrap();

        let chunk = &hub.page(&service.id, None, 1).chunks[0];
        assert!(chunk.text.len() <= MAX_LINE_BYTES);
        assert!(chunk.text.is_char_boundary(chunk.text.len()));
        assert!(chunk.text.ends_with('中'));

        let _ = std::fs::remove_dir_all(root);
    }
}
