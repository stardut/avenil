use std::{cmp::Ordering, collections::HashMap, sync::Mutex};

use crate::models::{LogChunk, LogPage};

use super::LogBuffer;

const MAX_PAGE_CHUNKS: usize = 1000;

pub(super) struct MemoryState {
    pub(super) chunks: Vec<LogChunk>,
    pub(super) next_seq: u64,
    pub(super) dropped: u64,
}

#[derive(Default)]
pub(super) struct DiskScanMetadata {
    pub(super) first_seq: Option<u64>,
    pub(super) next_seq: u64,
    pub(super) latest: Option<LogChunk>,
}

impl DiskScanMetadata {
    pub(super) fn observe(&mut self, chunk: &LogChunk) {
        self.first_seq = Some(
            self.first_seq
                .map(|first| first.min(chunk.seq))
                .unwrap_or(chunk.seq),
        );
        self.next_seq = self.next_seq.max(chunk.seq.saturating_add(1));
        if self
            .latest
            .as_ref()
            .map(|latest| compare_chunks(latest, chunk) == Ordering::Less)
            .unwrap_or(true)
        {
            self.latest = Some(chunk.clone());
        }
    }
}

pub(super) fn memory_state(
    buffers: &Mutex<HashMap<String, LogBuffer>>,
    service_id: &str,
) -> MemoryState {
    let all = buffers.lock().unwrap();
    let Some(buffer) = all.get(service_id) else {
        return MemoryState {
            chunks: Vec::new(),
            next_seq: 0,
            dropped: 0,
        };
    };
    MemoryState {
        chunks: buffer.chunks.iter().cloned().collect(),
        next_seq: buffer.next_seq,
        dropped: buffer.dropped,
    }
}

pub(super) fn page(
    buffers: &Mutex<HashMap<String, LogBuffer>>,
    service_id: &str,
    after_seq: Option<u64>,
    limit: usize,
) -> LogPage {
    let memory = memory_state(buffers, service_id);
    build_page(
        service_id,
        memory.chunks,
        after_seq,
        limit,
        None,
        memory.next_seq,
        memory.dropped,
    )
}

pub(super) fn build_page(
    service_id: &str,
    raw_chunks: Vec<LogChunk>,
    after_seq: Option<u64>,
    limit: usize,
    search: Option<&str>,
    next_seq: u64,
    dropped_chunks: u64,
) -> LogPage {
    let first_seq = raw_chunks.first().map(|chunk| chunk.seq);
    let generation = raw_chunks.last().and_then(|chunk| chunk.generation.clone());
    finish_page(
        service_id,
        raw_chunks,
        first_seq,
        generation,
        after_seq,
        limit,
        next_seq,
        dropped_chunks,
        search,
    )
}

pub(super) fn finish_page(
    service_id: &str,
    raw_chunks: Vec<LogChunk>,
    first_seq: Option<u64>,
    generation: Option<String>,
    after_seq: Option<u64>,
    limit: usize,
    next_seq: u64,
    dropped_chunks: u64,
    search: Option<&str>,
) -> LogPage {
    let chunks = raw_chunks
        .into_iter()
        .filter(|chunk| after_seq.map(|seq| chunk.seq > seq).unwrap_or(true))
        .filter(|chunk| search.map(|term| chunk.text.contains(term)).unwrap_or(true))
        .take(limit.min(MAX_PAGE_CHUNKS))
        .collect();
    let truncated = after_seq
        .map(|seq| first_seq.map(|first| seq < first).unwrap_or(false))
        .unwrap_or(false);
    LogPage {
        service_id: service_id.to_string(),
        generation,
        chunks,
        next_seq,
        truncated,
        dropped_chunks,
    }
}

pub(super) fn compare_chunks(left: &LogChunk, right: &LogChunk) -> Ordering {
    left.seq
        .cmp(&right.seq)
        .then_with(|| left.timestamp.cmp(&right.timestamp))
        .then_with(|| left.generation.cmp(&right.generation))
        .then_with(|| left.stream.cmp(&right.stream))
        .then_with(|| left.text.cmp(&right.text))
}

pub(super) type ChunkKey = (Option<String>, u64, String, String, String);

pub(super) fn chunk_key(chunk: &LogChunk) -> ChunkKey {
    (
        chunk.generation.clone(),
        chunk.seq,
        chunk.stream.clone(),
        chunk.timestamp.clone(),
        chunk.text.clone(),
    )
}
