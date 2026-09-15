use std::{collections::HashMap, process::Command, sync::Arc};
use chrono::Utc;
use crate::{models::{Id, ResourceSnapshot}, state::AppState};

pub fn collect(state: &Arc<AppState>, ids: Option<Vec<Id>>) -> Vec<ResourceSnapshot> {
    let wanted: std::collections::HashSet<Id> = ids.unwrap_or_else(|| state.config.lock().unwrap().services.iter().map(|s| s.id.clone()).collect()).into_iter().collect();
    let mut pgids = HashMap::new();
    for id in &wanted { if let Some(record) = state.runtimes.lock().unwrap().get(id) { let snapshot = record.snapshot.lock().unwrap(); if let (Some(generation), Some(pgid)) = (snapshot.generation.clone(), snapshot.pgid) { if matches!(snapshot.status, crate::models::ServiceStatus::Starting | crate::models::ServiceStatus::Running | crate::models::ServiceStatus::Stopping) { pgids.insert(id.clone(), (generation, pgid)); } } } }
    let output = Command::new("ps").args(["-axo", "pid=,pgid=,rss=,%cpu="]).output().ok();
    let mut totals: HashMap<i32, (usize, f32, u64)> = HashMap::new();
    if let Some(output) = output { if output.status.success() { for line in String::from_utf8_lossy(&output.stdout).lines() { let fields: Vec<&str> = line.split_whitespace().collect(); if fields.len() < 4 { continue; } let Ok(pgid) = fields[1].parse::<i32>() else { continue }; let Ok(rss_kb) = fields[2].parse::<u64>() else { continue }; let Ok(cpu) = fields[3].parse::<f32>() else { continue }; let item = totals.entry(pgid).or_default(); item.0 += 1; item.1 += cpu; item.2 = item.2.saturating_add(rss_kb.saturating_mul(1024)); } } }
    pgids.into_iter().map(|(service_id, (generation, pgid))| { let (count, cpu, rss) = totals.get(&pgid).copied().unwrap_or_default(); ResourceSnapshot { service_id, generation, captured_at: Utc::now().to_rfc3339(), process_count: count, cpu_percent: if count == 0 { None } else { Some(cpu) }, rss_bytes: if count == 0 { None } else { Some(rss) } } }).collect()
}
