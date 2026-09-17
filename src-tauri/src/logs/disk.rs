use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
};

use crate::models::{LogChunk, Service};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RotationManifest {
    service_id: String,
    rotate_count: u8,
    existing: Vec<u8>,
    phase: RotationPhase,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum RotationPhase {
    Prepared,
    Staged,
}

pub(super) struct DiskFile {
    pub(super) path: PathBuf,
    pub(super) file: File,
    pub(super) length: u64,
}

pub(super) fn initialize(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("创建日志目录失败（{}）：{error}", root.display()))?;
    recover_rotations(root)
}

pub(super) fn append(root: &Path, service: &Service, chunk: &LogChunk) -> Result<(), String> {
    let path = root.join(format!("{}.log", service.id));
    let line = serde_json::to_string(chunk)
        .map(|line| line + "\n")
        .map_err(|error| format!("编码磁盘日志失败：{error}"))?;
    let size = match fs::metadata(&path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => {
            return Err(format!(
                "读取磁盘日志大小失败（{}）：{error}",
                path.display()
            ))
        }
    };
    if size.saturating_add(line.len() as u64) > service.log.max_bytes.max(64 * 1024) {
        return rotate_disk(root, &path, service, &line);
    }
    append_line(&path, &line)
}

pub(super) fn prune_rotated_files(root: &Path, service: &Service) -> Result<(), String> {
    let prefix = format!("{}.log.", service.id);
    let entries = fs::read_dir(root)
        .map_err(|error| format!("读取日志目录失败（{}）：{error}", root.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取日志目录项失败：{error}"))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(index) = name
            .strip_prefix(&prefix)
            .and_then(|suffix| suffix.parse::<u16>().ok())
        else {
            continue;
        };
        if index > u16::from(service.log.rotate_count) {
            let path = entry.path();
            fs::remove_file(&path)
                .map_err(|error| format!("清理过期磁盘日志失败（{}）：{error}", path.display()))?;
        }
    }
    Ok(())
}

pub(super) fn next_seq(root: &Path, service: &Service) -> Result<u64, String> {
    let mut next_seq = 0;
    scan_files(open_files(root, service)?, &service.id, |chunk| {
        next_seq = next_seq.max(chunk.seq.saturating_add(1));
    })?;
    Ok(next_seq)
}

pub(super) fn open_files(root: &Path, service: &Service) -> Result<Vec<DiskFile>, String> {
    let mut files = Vec::new();
    // .log is the newest file and .log.N becomes older as N increases.
    for index in (0..=service.log.rotate_count).rev() {
        let path = log_file_path(root, &service.id, index);
        let file = match File::open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("打开磁盘日志失败（{}）：{error}", path.display())),
        };
        let length = file
            .metadata()
            .map_err(|error| format!("读取磁盘日志大小失败（{}）：{error}", path.display()))?
            .len();
        files.push(DiskFile { path, file, length });
    }
    Ok(files)
}

pub(super) fn scan_files<F>(
    files: Vec<DiskFile>,
    service_id: &str,
    mut visit: F,
) -> Result<(), String>
where
    F: FnMut(LogChunk),
{
    for DiskFile { path, file, length } in files {
        let mut reader = BufReader::new(file.take(length));
        let mut line = String::new();
        let mut line_number = 0;
        loop {
            line.clear();
            let read = reader
                .read_line(&mut line)
                .map_err(|error| format!("读取磁盘日志失败（{}）：{error}", path.display()))?;
            if read == 0 {
                break;
            }
            line_number += 1;
            let complete_line = line.ends_with('\n');
            let payload = line.trim_end_matches(&['\r', '\n'][..]);
            if payload.is_empty() {
                continue;
            }
            let chunk = match serde_json::from_str::<LogChunk>(payload) {
                Ok(chunk) => chunk,
                Err(error) if !complete_line => {
                    return Err(format!(
                        "磁盘日志尾行不完整（{} 第 {} 行）：{error}",
                        path.display(),
                        line_number
                    ))
                }
                Err(error) => {
                    return Err(format!(
                        "解析磁盘日志失败（{} 第 {} 行）：{error}",
                        path.display(),
                        line_number
                    ))
                }
            };
            if chunk.service_id != service_id {
                return Err(format!(
                    "磁盘日志服务 ID 不匹配（{} 第 {} 行）",
                    path.display(),
                    line_number
                ));
            }
            visit(chunk);
        }
    }
    Ok(())
}

fn rotate_disk(root: &Path, path: &Path, service: &Service, line: &str) -> Result<(), String> {
    let token = format!(
        "{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let new_path = root.join(format!(".{}.log.rotate.{}.new", service.id, token));
    let manifest_path = root.join(format!(".{}.log.rotate.{}.manifest", service.id, token));
    create_new_line(&new_path, line)?;

    let mut existing = Vec::new();
    for index in 0..=service.log.rotate_count {
        let original = log_file_path(root, &service.id, index);
        match path_exists(&original) {
            Ok(true) => existing.push(index),
            Ok(false) => {}
            Err(error) => {
                let _ = remove_if_exists(&new_path);
                return Err(error);
            }
        }
    }
    let manifest = RotationManifest {
        service_id: service.id.clone(),
        rotate_count: service.log.rotate_count,
        existing,
        phase: RotationPhase::Prepared,
    };
    let manifest_line = serde_json::to_string(&manifest)
        .map(|value| value + "\n")
        .map_err(|error| format!("编码轮转清单失败：{error}"))?;
    if let Err(error) = create_new_line(&manifest_path, &manifest_line) {
        let _ = remove_if_exists(&new_path);
        return Err(error);
    }

    let mut staged = Vec::new();
    for index in &manifest.existing {
        let original = log_file_path(root, &service.id, *index);
        let temporary = root.join(format!(".{}.log.rotate.{}.{}", service.id, token, index));
        match path_exists(&temporary) {
            Ok(false) => {}
            Ok(true) => {
                let rollback = restore_staged(&staged);
                cleanup_after_rollback(&new_path, &manifest_path, &rollback);
                return Err(rotation_error(
                    format!("轮转临时文件已存在（{}）", temporary.display()),
                    rollback,
                ));
            }
            Err(error) => {
                let rollback = restore_staged(&staged);
                cleanup_after_rollback(&new_path, &manifest_path, &rollback);
                return Err(rotation_error(error, rollback));
            }
        }
        if let Err(error) = fs::rename(&original, &temporary) {
            let rollback = restore_staged(&staged);
            cleanup_after_rollback(&new_path, &manifest_path, &rollback);
            return Err(rotation_error(
                format!(
                    "准备轮转磁盘日志失败（{} -> {}）：{error}",
                    original.display(),
                    temporary.display()
                ),
                rollback,
            ));
        }
        staged.push((*index, original, temporary));
    }

    let staged_manifest = RotationManifest {
        phase: RotationPhase::Staged,
        ..manifest
    };
    let staged_manifest_line = serde_json::to_string(&staged_manifest)
        .map(|value| value + "\n")
        .map_err(|error| format!("编码轮转阶段清单失败：{error}"))?;
    if let Err(error) = replace_rotation_manifest(&manifest_path, &staged_manifest_line) {
        let rollback = restore_staged(&staged);
        cleanup_after_rollback(&new_path, &manifest_path, &rollback);
        return Err(rotation_error(error, rollback));
    }

    let mut committed = Vec::new();
    for (index, original, temporary) in &staged {
        if *index == service.log.rotate_count {
            continue;
        }
        let target = log_file_path(root, &service.id, index.saturating_add(1));
        if let Err(error) = fs::rename(temporary, &target) {
            let rollback = rollback_rotation(&new_path, &manifest_path, &staged, &committed);
            return Err(rotation_error(
                format!(
                    "提交轮转磁盘日志失败（{} -> {}）：{error}",
                    temporary.display(),
                    target.display()
                ),
                rollback,
            ));
        }
        committed.push((original.clone(), target));
    }
    if let Err(error) = fs::rename(&new_path, path) {
        let rollback = rollback_rotation(&new_path, &manifest_path, &staged, &committed);
        return Err(rotation_error(
            format!(
                "替换当前磁盘日志失败（{} -> {}）：{error}",
                new_path.display(),
                path.display()
            ),
            rollback,
        ));
    }
    if let Err(error) = remove_if_exists(&manifest_path) {
        eprintln!("轮转清单清理失败：{error}");
    }
    let oldest = staged
        .iter()
        .find(|(index, _, _)| *index == service.log.rotate_count)
        .map(|(_, _, temporary)| temporary);
    if let Some(oldest) = oldest {
        if let Err(error) = remove_if_exists(oldest) {
            eprintln!("清理最旧磁盘日志失败：{error}");
        }
    }
    Ok(())
}

fn append_line(path: &Path, line: &str) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("打开磁盘日志失败（{}）：{error}", path.display()))?;
    let original_len = file
        .metadata()
        .map_err(|error| format!("读取磁盘日志大小失败（{}）：{error}", path.display()))?
        .len();
    file.write_all(line.as_bytes())
        .map_err(|error| append_error(path, "写入磁盘日志失败", error, &mut file, original_len))?;
    file.flush()
        .map_err(|error| append_error(path, "刷新磁盘日志失败", error, &mut file, original_len))?;
    Ok(())
}

fn append_error(
    path: &Path,
    message: &str,
    error: std::io::Error,
    file: &mut File,
    original_len: u64,
) -> String {
    match file.set_len(original_len) {
        Ok(()) => format!("{message}（{}）：{error}", path.display()),
        Err(rollback) => format!(
            "{message}（{}）：{error}；恢复原日志长度失败：{rollback}",
            path.display()
        ),
    }
}

fn create_new_line(path: &Path, line: &str) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("创建轮转临时日志失败（{}）：{error}", path.display()))?;
    if let Err(error) = file.write_all(line.as_bytes()) {
        let _ = remove_if_exists(path);
        return Err(format!(
            "写入轮转临时日志失败（{}）：{error}",
            path.display()
        ));
    }
    if let Err(error) = file.flush() {
        let _ = remove_if_exists(path);
        return Err(format!(
            "刷新轮转临时日志失败（{}）：{error}",
            path.display()
        ));
    }
    Ok(())
}

fn replace_rotation_manifest(path: &Path, line: &str) -> Result<(), String> {
    let temporary = path.with_extension("phase");
    create_new_line(&temporary, line)?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = remove_if_exists(&temporary);
        return Err(format!(
            "更新轮转清单失败（{} -> {}）：{error}",
            temporary.display(),
            path.display()
        ));
    }
    Ok(())
}

fn log_file_path(root: &Path, service_id: &str, index: u8) -> PathBuf {
    if index == 0 {
        root.join(format!("{service_id}.log"))
    } else {
        root.join(format!("{service_id}.log.{index}"))
    }
}

fn rotated_index(path: &Path, service_id: &str) -> Option<u8> {
    let name = path.file_name()?.to_str()?;
    name.strip_prefix(&format!("{service_id}.log."))?
        .parse()
        .ok()
}

fn path_exists(path: &Path) -> Result<bool, String> {
    match fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "读取日志文件状态失败（{}）：{error}",
            path.display()
        )),
    }
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("删除临时日志失败（{}）：{error}", path.display())),
    }
}

fn restore_staged(staged: &[(u8, PathBuf, PathBuf)]) -> Result<(), String> {
    let mut errors = Vec::new();
    for (_, original, temporary) in staged.iter().rev() {
        match path_exists(temporary) {
            Ok(true) => {}
            Ok(false) => continue,
            Err(error) => {
                errors.push(error);
                continue;
            }
        }
        if let Err(error) = fs::rename(temporary, original) {
            errors.push(format!(
                "恢复轮转文件失败（{} -> {}）：{error}",
                temporary.display(),
                original.display()
            ));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn rollback_rotation(
    new_path: &Path,
    manifest_path: &Path,
    staged: &[(u8, PathBuf, PathBuf)],
    committed: &[(PathBuf, PathBuf)],
) -> Result<(), String> {
    let mut errors = Vec::new();
    let Some((service_id, transaction_token, _)) = manifest_path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(rotation_parts)
    else {
        return Err(format!(
            "无法解析轮转清单名称（{}）",
            manifest_path.display()
        ));
    };
    let mut committed_temps = Vec::new();
    for (original, target) in committed {
        let Some(root) = target.parent() else {
            errors.push(format!("无法确定轮转回滚目录（{}）", target.display()));
            continue;
        };
        let Some(index) = rotated_index(target, &service_id) else {
            errors.push(format!("无法解析轮转目标序号（{}）", target.display()));
            continue;
        };
        let temporary = root.join(format!(
            ".{}.log.rotate.{}.rollback.{}",
            service_id, transaction_token, index
        ));
        match fs::rename(target, &temporary) {
            Ok(()) => committed_temps.push((original.clone(), temporary)),
            Err(error) => errors.push(format!(
                "暂存轮转回滚文件失败（{} -> {}）：{error}",
                target.display(),
                temporary.display()
            )),
        }
    }
    if errors.is_empty() {
        for (original, temporary) in committed_temps.iter().rev() {
            if let Err(error) = fs::rename(temporary, original) {
                errors.push(format!(
                    "清理轮转回滚临时文件失败（{} -> {}）：{error}",
                    temporary.display(),
                    original.display()
                ));
            }
        }
    }

    if errors.is_empty() {
        for (_, original, temporary) in staged.iter().rev() {
            match path_exists(temporary) {
                Ok(true) => {}
                Ok(false) => continue,
                Err(error) => {
                    errors.push(error);
                    continue;
                }
            }
            if let Err(error) = fs::rename(temporary, original) {
                errors.push(format!(
                    "恢复轮转源文件失败（{} -> {}）：{error}",
                    temporary.display(),
                    original.display()
                ));
            }
        }
    }
    if errors.is_empty() {
        if let Err(error) = remove_if_exists(new_path) {
            errors.push(error);
        } else if let Err(error) = remove_if_exists(manifest_path) {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn rotation_error(message: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => format!("{message}；已回滚轮转操作"),
        Err(error) => format!("{message}；轮转回滚失败：{error}"),
    }
}

fn cleanup_after_rollback(new_path: &Path, manifest_path: &Path, rollback: &Result<(), String>) {
    if rollback.is_err() {
        return;
    }
    if let Err(error) = remove_if_exists(new_path) {
        eprintln!("轮转临时日志清理失败：{error}");
        return;
    }
    if let Err(error) = remove_if_exists(manifest_path) {
        eprintln!("轮转清单清理失败：{error}");
    }
}

fn recover_rotations(root: &Path) -> Result<(), String> {
    let mut manifests = Vec::new();
    let mut active_tokens = HashSet::new();
    let entries = fs::read_dir(root)
        .map_err(|error| format!("读取日志目录失败（{}）：{error}", root.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取日志目录项失败：{error}"))?;
        let path = entry.path();
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some((service_id, token, suffix)) = rotation_parts(&name) else {
            continue;
        };
        if suffix != "manifest" {
            continue;
        }
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("读取轮转清单失败（{}）：{error}", path.display()))?;
        let manifest: RotationManifest = serde_json::from_str(&content)
            .map_err(|error| format!("解析轮转清单失败（{}）：{error}", path.display()))?;
        if manifest.service_id != service_id {
            return Err(format!("轮转清单服务 ID 不匹配（{}）", path.display()));
        }
        active_tokens.insert(format!("{service_id}:{token}"));
        manifests.push((path, service_id, token, manifest));
    }

    for (manifest_path, service_id, token, manifest) in manifests {
        recover_rotation(root, &manifest_path, &service_id, &token, &manifest)?;
        active_tokens.remove(&format!("{service_id}:{token}"));
    }

    let entries = fs::read_dir(root)
        .map_err(|error| format!("读取日志目录失败（{}）：{error}", root.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取日志目录项失败：{error}"))?;
        let path = entry.path();
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some((service_id, token, suffix)) = rotation_parts(&name) else {
            continue;
        };
        if suffix == "manifest" || active_tokens.contains(&format!("{service_id}:{token}")) {
            continue;
        }
        remove_if_exists(&path)?;
    }
    Ok(())
}

fn rotation_parts(name: &str) -> Option<(String, String, String)> {
    let name = name.strip_prefix('.')?;
    let (service_id, rest) = name.split_once(".log.rotate.")?;
    let (token, suffix) = rest.split_once('.')?;
    (!service_id.is_empty() && !token.is_empty() && !suffix.is_empty()).then(|| {
        (
            service_id.to_string(),
            token.to_string(),
            suffix.to_string(),
        )
    })
}

fn recover_rotation(
    root: &Path,
    manifest_path: &Path,
    service_id: &str,
    token: &str,
    manifest: &RotationManifest,
) -> Result<(), String> {
    if manifest.rotate_count == 0
        || manifest
            .existing
            .iter()
            .any(|index| *index > manifest.rotate_count)
    {
        return Err(format!("轮转清单范围无效（{}）", manifest_path.display()));
    }
    if matches!(manifest.phase, RotationPhase::Prepared) {
        return recover_prepared_rotation(root, manifest_path, service_id, token, manifest);
    }
    finish_staged_rotation(root, manifest_path, service_id, token, manifest)
}

fn finish_staged_rotation(
    root: &Path,
    manifest_path: &Path,
    service_id: &str,
    token: &str,
    manifest: &RotationManifest,
) -> Result<(), String> {
    let new_path = rotation_new_path(root, service_id, token);
    let current_path = log_file_path(root, service_id, 0);
    let new_exists = path_exists(&new_path)?;
    let current_exists = path_exists(&current_path)?;
    if new_exists && current_exists {
        if !rotation_temps_present(root, service_id, token, manifest)? {
            remove_if_exists(&new_path)?;
            return cleanup_rotation_files(root, manifest_path, service_id, token, manifest);
        }
        return Err(format!("轮转事务状态不一致（{}）", manifest_path.display()));
    }

    for index in manifest
        .existing
        .iter()
        .copied()
        .filter(|index| *index < manifest.rotate_count)
    {
        let target = log_file_path(root, service_id, index.saturating_add(1));
        let rollback = rotation_rollback_path(root, service_id, token, index.saturating_add(1));
        let recovery = rotation_recovery_path(root, service_id, token, index);
        let staged = rotation_temp_path(root, service_id, token, index);
        if path_exists(&rollback)? {
            if path_exists(&target)? {
                return Err(format!("轮转回滚目标已存在（{}）", target.display()));
            }
            fs::rename(&rollback, &target).map_err(|error| {
                format!(
                    "恢复轮转回滚文件失败（{} -> {}）：{error}",
                    rollback.display(),
                    target.display()
                )
            })?;
        } else if path_exists(&recovery)? {
            if path_exists(&target)? {
                return Err(format!("轮转提交目标已存在（{}）", target.display()));
            }
            fs::rename(&recovery, &target).map_err(|error| {
                format!(
                    "恢复轮转提交失败（{} -> {}）：{error}",
                    recovery.display(),
                    target.display()
                )
            })?;
        } else if path_exists(&staged)? {
            if path_exists(&target)? {
                return Err(format!("轮转提交目标已存在（{}）", target.display()));
            }
            fs::rename(&staged, &target).map_err(|error| {
                format!(
                    "提交轮转日志失败（{} -> {}）：{error}",
                    staged.display(),
                    target.display()
                )
            })?;
        } else if !path_exists(&target)? {
            return Err(format!("轮转提交源文件缺失（{}）", target.display()));
        }
    }

    if new_exists {
        fs::rename(&new_path, &current_path).map_err(|error| {
            format!(
                "恢复当前磁盘日志失败（{} -> {}）：{error}",
                new_path.display(),
                current_path.display()
            )
        })?;
    } else if !current_exists {
        return Err(format!(
            "轮转当前日志文件缺失（{}）",
            current_path.display()
        ));
    }
    cleanup_rotation_files(root, manifest_path, service_id, token, manifest)
}

fn recover_prepared_rotation(
    root: &Path,
    manifest_path: &Path,
    service_id: &str,
    token: &str,
    manifest: &RotationManifest,
) -> Result<(), String> {
    let mut staged = Vec::new();
    for index in &manifest.existing {
        let original = log_file_path(root, service_id, *index);
        let recovery = rotation_recovery_path(root, service_id, token, *index);
        let temporary_path = rotation_temp_path(root, service_id, token, *index);
        let recovery_exists = path_exists(&recovery)?;
        let staged_exists = path_exists(&temporary_path)?;
        if recovery_exists && staged_exists {
            return Err(format!("轮转准备临时文件重复（{}）", original.display()));
        }
        if recovery_exists || staged_exists {
            if path_exists(&original)? {
                return Err(format!("轮转恢复目标已存在（{}）", original.display()));
            }
            staged.push((
                *index,
                original,
                if recovery_exists {
                    recovery
                } else {
                    temporary_path
                },
            ));
        } else if !path_exists(&original)? {
            return Err(format!("轮转准备文件缺失（{}）", original.display()));
        }
    }
    restore_staged(&staged)?;
    remove_if_exists(&rotation_new_path(root, service_id, token))?;
    remove_if_exists(manifest_path)?;
    Ok(())
}

fn cleanup_rotation_files(
    root: &Path,
    manifest_path: &Path,
    service_id: &str,
    token: &str,
    manifest: &RotationManifest,
) -> Result<(), String> {
    for index in &manifest.existing {
        remove_if_exists(&rotation_temp_path(root, service_id, token, *index))?;
        remove_if_exists(&rotation_recovery_path(root, service_id, token, *index))?;
        if *index < manifest.rotate_count {
            remove_if_exists(&rotation_rollback_path(
                root,
                service_id,
                token,
                index.saturating_add(1),
            ))?;
        }
    }
    remove_if_exists(manifest_path)?;
    Ok(())
}

fn rotation_temps_present(
    root: &Path,
    service_id: &str,
    token: &str,
    manifest: &RotationManifest,
) -> Result<bool, String> {
    for index in &manifest.existing {
        if path_exists(&rotation_temp_path(root, service_id, token, *index))?
            || path_exists(&rotation_recovery_path(root, service_id, token, *index))?
            || (*index < manifest.rotate_count
                && path_exists(&rotation_rollback_path(
                    root,
                    service_id,
                    token,
                    index.saturating_add(1),
                ))?)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn rotation_temp_path(root: &Path, service_id: &str, token: &str, index: u8) -> PathBuf {
    root.join(format!(".{}.log.rotate.{}.{}", service_id, token, index))
}

fn rotation_recovery_path(root: &Path, service_id: &str, token: &str, index: u8) -> PathBuf {
    root.join(format!(
        ".{}.log.rotate.{}.recover.{}",
        service_id, token, index
    ))
}

fn rotation_rollback_path(root: &Path, service_id: &str, token: &str, index: u8) -> PathBuf {
    root.join(format!(
        ".{}.log.rotate.{}.rollback.{}",
        service_id, token, index
    ))
}

fn rotation_new_path(root: &Path, service_id: &str, token: &str) -> PathBuf {
    root.join(format!(".{}.log.rotate.{}.new", service_id, token))
}
