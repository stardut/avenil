use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

const CLI_NAME: &str = "avenil";
const INSTALL_DIR_DISPLAY: &str = "~/.local/bin";
const PROFILE_EXPORT: &str = "export PATH=\"$HOME/.local/bin:$PATH\"";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallInfo {
    pub supported: bool,
    pub installed: bool,
    pub path_configured: bool,
    pub link_path: String,
    pub executable_path: String,
    pub install_command: String,
    pub path_command: String,
    pub reload_command: String,
    pub conflict: Option<String>,
}

pub fn inspect() -> Result<CliInstallInfo, String> {
    #[cfg(not(unix))]
    {
        return Ok(CliInstallInfo {
            supported: false,
            installed: false,
            path_configured: false,
            link_path: format!("{INSTALL_DIR_DISPLAY}/{CLI_NAME}"),
            executable_path: String::new(),
            install_command: String::new(),
            path_command: String::new(),
            reload_command: String::new(),
            conflict: None,
        });
    }

    #[cfg(unix)]
    {
        let home = home_dir()?;
        let executable = executable_path()?;
        let executable_text = executable.display().to_string();
        let install_dir = home.join(".local").join("bin");
        let link = install_dir.join(CLI_NAME);
        let (installed, conflict) = inspect_link(&link, &executable);
        let path_configured = env::var_os("PATH")
            .map(|value| env::split_paths(&value).any(|entry| entry == install_dir))
            .unwrap_or(false);

        return Ok(CliInstallInfo {
            supported: true,
            installed,
            path_configured,
            link_path: format!("{INSTALL_DIR_DISPLAY}/{CLI_NAME}"),
            executable_path: executable_text.clone(),
            install_command: format!(
                "mkdir -p \"$HOME/.local/bin\" && if [ -L \"$HOME/.local/bin/{CLI_NAME}\" ] && [ \"$HOME/.local/bin/{CLI_NAME}\" -ef {} ]; then :; elif [ -e \"$HOME/.local/bin/{CLI_NAME}\" ] || [ -L \"$HOME/.local/bin/{CLI_NAME}\" ]; then printf '%s\\n' {} >&2; exit 1; else ln -s {} \"$HOME/.local/bin/{CLI_NAME}\"; fi",
                shell_quote(&executable_text),
                shell_quote("Avenil CLI install path is already occupied."),
                shell_quote(&executable_text)
            ),
            path_command: format!(
                "grep -qxF {} \"$HOME/.zprofile\" 2>/dev/null || printf '\\n# Avenil CLI\\n{}\\n' >> \"$HOME/.zprofile\"",
                shell_quote(PROFILE_EXPORT),
                PROFILE_EXPORT
            ),
            reload_command: "source \"$HOME/.zprofile\"".into(),
            conflict,
        });
    }
}

#[cfg(unix)]
pub fn install() -> Result<CliInstallInfo, String> {
    let info = inspect()?;
    if !info.supported {
        return Err("当前系统不支持安装 Avenil CLI".into());
    }
    if info.installed {
        return Ok(info);
    }
    if let Some(conflict) = info.conflict {
        return Err(format!("CLI 安装路径已被占用：{conflict}"));
    }

    let home = home_dir()?;
    let install_dir = home.join(".local").join("bin");
    fs::create_dir_all(&install_dir).map_err(|error| format!("创建 CLI 安装目录失败：{error}"))?;
    let link = install_dir.join(CLI_NAME);
    let executable = executable_path()?;
    std::os::unix::fs::symlink(&executable, &link)
        .map_err(|error| format!("创建 CLI 命令链接失败：{error}"))?;
    inspect()
}

#[cfg(not(unix))]
pub fn install() -> Result<CliInstallInfo, String> {
    Err("当前系统不支持安装 Avenil CLI".into())
}

#[cfg(unix)]
fn home_dir() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| "无法确定当前用户主目录".into())
}

#[cfg(unix)]
fn executable_path() -> Result<PathBuf, String> {
    let path =
        env::current_exe().map_err(|error| format!("无法确定 Avenil 可执行文件路径：{error}"))?;
    Ok(path.canonicalize().unwrap_or(path))
}

#[cfg(unix)]
fn inspect_link(link: &Path, executable: &Path) -> (bool, Option<String>) {
    let metadata = match fs::symlink_metadata(link) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (false, None),
        Err(_) => return (false, Some(link.display().to_string())),
    };
    if !metadata.file_type().is_symlink() {
        return (false, Some(link.display().to_string()));
    }
    match link.canonicalize() {
        Ok(target) if target == executable => (true, None),
        Ok(_) | Err(_) => (false, Some(link.display().to_string())),
    }
}

fn shell_quote(value: impl AsRef<str>) -> String {
    format!("'{}'", value.as_ref().replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quote_preserves_spaces_and_single_quotes() {
        assert_eq!(shell_quote("Avenil CLI"), "'Avenil CLI'");
        assert_eq!(shell_quote("it's ready"), "'it'\\''s ready'");
    }

    #[cfg(unix)]
    #[test]
    fn inspect_link_distinguishes_the_expected_target_from_conflicts() {
        let root =
            std::env::temp_dir().join(format!("avenil-cli-install-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let executable = root.join("avenil");
        let link = root.join("bin");
        fs::write(&executable, b"binary").unwrap();
        let executable = executable.canonicalize().unwrap();

        assert_eq!(inspect_link(&link, &executable), (false, None));
        std::os::unix::fs::symlink(&executable, &link).unwrap();
        assert_eq!(inspect_link(&link, &executable), (true, None));
        fs::remove_file(&link).unwrap();
        fs::write(&link, b"occupied").unwrap();
        assert_eq!(
            inspect_link(&link, &executable),
            (false, Some(link.display().to_string()))
        );

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn inspect_describes_a_supported_installation() {
        let info = inspect().unwrap();

        assert!(info.supported);
        assert!(info.link_path.ends_with("/.local/bin/avenil"));
        assert!(info.install_command.contains("ln -s"));
        assert_eq!(info.reload_command, "source \"$HOME/.zprofile\"");
    }
}
