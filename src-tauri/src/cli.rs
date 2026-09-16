use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{self, Read},
    path::PathBuf,
    process,
};

use serde_json::{json, Value};

use crate::control;

const CLI_COMMANDS: &[&str] = &[
    "help",
    "status",
    "list",
    "start",
    "stop",
    "restart",
    "logs",
    "resources",
    "open",
    "quit",
    "config",
    "group",
    "service",
    "ide",
];

const DEFAULT_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_LOG_ROTATE_COUNT: u64 = 3;
const DEFAULT_LOG_MEMORY_BYTES: u64 = 256 * 1024;

#[derive(Default)]
struct GlobalOptions {
    json: bool,
    socket: Option<PathBuf>,
}

/// Decide whether the app binary should execute the CLI client instead of
/// starting the desktop application.
pub fn is_cli_invocation(args: &[String]) -> bool {
    if args.is_empty() {
        return false;
    }
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "cli" | "--help" | "-h" | "--version" | "-V" => return true,
            "--json" => index += 1,
            "--socket" => index += 2,
            command if CLI_COMMANDS.contains(&command) => return true,
            _ => return true,
        }
    }
    true
}

pub fn run(raw_args: Vec<String>) {
    let raw_args = if raw_args.first().map(String::as_str) == Some("cli") {
        raw_args.into_iter().skip(1).collect()
    } else {
        raw_args
    };
    let (options, args) = match parse_global_options(raw_args) {
        Ok(value) => value,
        Err(error) => fail(&error, 2, false),
    };

    if args.is_empty()
        || matches!(
            args.first().map(String::as_str),
            Some("help") | Some("--help") | Some("-h")
        )
    {
        print_help();
        return;
    }
    if matches!(
        args.first().map(String::as_str),
        Some("--version") | Some("-V")
    ) {
        println!("avenil {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    let command = args[0].clone();
    match execute(&command, &args[1..], &options) {
        Ok(value) => print_value(&command, &value, options.json),
        Err(error) => fail(&error, 1, options.json),
    }
}

fn parse_global_options(raw_args: Vec<String>) -> Result<(GlobalOptions, Vec<String>), String> {
    let mut options = GlobalOptions::default();
    let mut args = Vec::new();
    let mut index = 0;
    while index < raw_args.len() {
        match raw_args[index].as_str() {
            "--json" => index += 1,
            "--socket" => {
                let value = raw_args
                    .get(index + 1)
                    .ok_or_else(|| "--socket 需要路径".to_string())?;
                if value.is_empty() {
                    return Err("--socket 路径不能为空".into());
                }
                options.socket = Some(PathBuf::from(value));
                index += 2;
            }
            value => {
                args.push(value.to_string());
                index += 1;
            }
        }
    }
    options.json = raw_args.iter().any(|arg| arg == "--json");
    Ok((options, args))
}

fn execute(command: &str, raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    match command {
        "status" | "list" => execute_status(raw_args, global),
        "start" | "stop" | "restart" => execute_action(command, raw_args, global),
        "logs" => execute_logs(raw_args, global),
        "resources" => execute_resources(raw_args, global),
        "open" => execute_open(raw_args, global),
        "quit" => execute_quit(raw_args, global),
        "config" => execute_config(raw_args, global),
        "group" => execute_group(raw_args, global),
        "service" => execute_service(raw_args, global),
        "ide" => execute_ide(raw_args, global),
        _ => Err(format!("未知命令：{command}；使用 --help 查看可用命令")),
    }
}

fn execute_status(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let (selectors, options) = parse_options(raw_args)?;
    ensure_options(&options, &[])?;
    call(global, "status", json!({ "selectors": selectors }))
}

fn execute_action(
    action: &str,
    raw_args: &[String],
    global: &GlobalOptions,
) -> Result<Value, String> {
    let (selectors, options) = parse_options(raw_args)?;
    ensure_options(&options, &["grace-ms"])?;
    if selectors.is_empty() {
        return Err(format!("{action} 至少需要一个服务选择器（ID 或名称）"));
    }
    let grace_ms = option_u64(&options, "grace-ms")?;
    call(
        global,
        "service_action",
        json!({ "action": action, "selectors": selectors, "graceMs": grace_ms }),
    )
}

fn execute_logs(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let (selectors, options) = parse_options(raw_args)?;
    ensure_options(&options, &["after-seq", "limit"])?;
    if selectors.len() != 1 {
        return Err("logs 需要且只接受一个服务选择器（ID 或名称）".into());
    }
    let after_seq = option_u64(&options, "after-seq")?;
    let limit = option_usize(&options, "limit")?;
    call(
        global,
        "logs",
        json!({ "selectors": selectors, "afterSeq": after_seq, "limit": limit }),
    )
}

fn execute_resources(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let (selectors, options) = parse_options(raw_args)?;
    ensure_options(&options, &[])?;
    call(global, "resources", json!({ "selectors": selectors }))
}

fn execute_open(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let (selectors, options) = parse_options(raw_args)?;
    ensure_options(&options, &[])?;
    if selectors.len() != 1 {
        return Err("open 需要且只接受一个服务选择器（ID 或名称）".into());
    }
    call(global, "open_url", json!({ "selectors": selectors }))
}

fn execute_quit(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let (selectors, options) = parse_options(raw_args)?;
    ensure_options(&options, &["yes"])?;
    if !selectors.is_empty() {
        return Err("quit 不接受位置参数".into());
    }
    if !has_flag(&options, "yes") {
        return Err("退出会停止所有托管服务；请显式使用 quit --yes".into());
    }
    call_confirmed(global, "quit", Value::Null)
}

fn execute_config(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let subcommand = raw_args
        .first()
        .ok_or_else(|| "config 需要子命令：show、export 或 import".to_string())?;
    match subcommand.as_str() {
        "show" => {
            let (selectors, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &[])?;
            if !selectors.is_empty() {
                return Err("config show 不接受位置参数".into());
            }
            call(global, "config_show", Value::Null)
        }
        "export" => {
            let (selectors, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &["output"])?;
            if !selectors.is_empty() {
                return Err("config export 不接受位置参数".into());
            }
            let result = call(global, "config_export", Value::Null)?;
            if let Some(path) = option_one(&options, "output")? {
                let content = result
                    .get("json")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Avenil 返回的导出结果无效".to_string())?;
                fs::write(&path, content)
                    .map_err(|error| format!("写入导出文件失败（{path}）：{error}"))?;
                Ok(
                    json!({ "path": path, "notice": result.get("notice").cloned().unwrap_or(Value::Null) }),
                )
            } else {
                Ok(result)
            }
        }
        "import" => execute_config_import(&raw_args[1..], global),
        _ => Err(format!("不支持的 config 子命令：{subcommand}")),
    }
}

fn execute_config_import(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let (paths, options) = parse_options(raw_args)?;
    ensure_options(&options, &["yes", "stdin"])?;
    let use_stdin = has_flag(&options, "stdin");
    if use_stdin && !paths.is_empty() {
        return Err("config import --stdin 不能再指定文件路径".into());
    }
    if !use_stdin && paths.len() != 1 {
        return Err("config import 需要一个 JSON 文件路径，或使用 --stdin".into());
    }
    let content = if use_stdin {
        let mut content = String::new();
        io::stdin()
            .read_to_string(&mut content)
            .map_err(|error| format!("读取 stdin 失败：{error}"))?;
        content
    } else {
        fs::read_to_string(&paths[0])
            .map_err(|error| format!("读取配置文件失败（{}）：{error}", paths[0]))?
    };
    let preview = call(
        global,
        "config_import_preview",
        json!({ "json": content.clone() }),
    )?;
    if !has_flag(&options, "yes") {
        return Ok(
            json!({ "applied": false, "preview": preview, "notice": "预览未写入配置；确认后请使用 --yes 再执行" }),
        );
    }
    if preview.get("canApply").and_then(Value::as_bool) != Some(true) {
        return Err("配置预览未通过校验，未写入配置".into());
    }
    let config = call_confirmed(global, "config_import_apply", json!({ "json": content }))?;
    Ok(json!({ "applied": true, "preview": preview, "config": config }))
}

fn execute_group(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let subcommand = raw_args.first().ok_or_else(|| {
        "group 需要子命令：list、add、update、delete、start、stop 或 restart".to_string()
    })?;
    match subcommand.as_str() {
        "list" => {
            let (selectors, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &[])?;
            if !selectors.is_empty() {
                return Err("group list 不接受位置参数".into());
            }
            call(global, "group_list", Value::Null)
        }
        "add" => {
            let (selectors, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &["name", "sort-order"])?;
            if !selectors.is_empty() {
                return Err("group add 不接受位置参数，请使用 --name".into());
            }
            let name = required_option(&options, "name")?;
            let sort_order = option_i32(&options, "sort-order")?;
            call(
                global,
                "group_create",
                json!({ "name": name, "sortOrder": sort_order }),
            )
        }
        "update" => {
            let (selectors, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &["name"])?;
            if selectors.len() != 1 {
                return Err("group update 需要一个分组选择器".into());
            }
            let name = required_option(&options, "name")?;
            call(
                global,
                "group_update",
                json!({ "selector": selectors[0], "name": name }),
            )
        }
        "delete" => {
            let (selectors, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &["yes"])?;
            if selectors.len() != 1 {
                return Err("group delete 需要一个分组选择器".into());
            }
            if !has_flag(&options, "yes") {
                return Err("删除分组前请显式使用 group delete <分组> --yes".into());
            }
            call_confirmed(global, "group_delete", json!({ "selector": selectors[0] }))
        }
        "start" | "stop" | "restart" => {
            let (selectors, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &["grace-ms"])?;
            if selectors.len() != 1 {
                return Err(format!("group {subcommand} 需要一个分组选择器"));
            }
            let grace_ms = option_u64(&options, "grace-ms")?;
            call(
                global,
                "group_action",
                json!({ "action": subcommand, "selector": selectors[0], "graceMs": grace_ms }),
            )
        }
        _ => Err(format!("不支持的 group 子命令：{subcommand}")),
    }
}

fn execute_service(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let subcommand = raw_args
        .first()
        .ok_or_else(|| "service 需要子命令：get、add、update、delete 或 list".to_string())?;
    match subcommand.as_str() {
        "list" => execute_status(&raw_args[1..], global),
        "get" => {
            let (selectors, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &[])?;
            if selectors.len() != 1 {
                return Err("service get 需要一个服务选择器".into());
            }
            call(global, "service_get", json!({ "selectors": selectors }))
        }
        "add" => execute_service_add(&raw_args[1..], global),
        "update" => execute_service_update(&raw_args[1..], global),
        "delete" => {
            let (selectors, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &["yes"])?;
            if selectors.len() != 1 {
                return Err("service delete 需要一个服务选择器".into());
            }
            if !has_flag(&options, "yes") {
                return Err("删除服务前请显式使用 service delete <服务> --yes".into());
            }
            call_confirmed(global, "service_delete", json!({ "selectors": selectors }))
        }
        _ => Err(format!("不支持的 service 子命令：{subcommand}")),
    }
}

fn execute_service_add(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let (selectors, options) = parse_options(raw_args)?;
    ensure_options(
        &options,
        &[
            "name",
            "workdir",
            "command",
            "group",
            "port",
            "url",
            "shell-program",
            "shell-arg",
            "env",
            "log-max-bytes",
            "log-rotate-count",
            "log-memory-bytes",
        ],
    )?;
    if !selectors.is_empty() {
        return Err("service add 不接受位置参数，请使用命名选项".into());
    }
    let name = required_option(&options, "name")?;
    let workdir = required_option(&options, "workdir")?;
    let command = required_option(&options, "command")?;
    let payload = service_options_payload(&options, false)?;
    call(
        global,
        "service_create",
        json!({ "name": name, "workdir": workdir, "command": command, "groupSelector": payload.group_selector, "port": payload.port, "url": payload.url, "shellProgram": payload.shell_program, "shellArgs": payload.shell_args, "env": payload.env, "log": payload.log }),
    )
}

fn execute_service_update(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let (selectors, options) = parse_options(raw_args)?;
    ensure_options(
        &options,
        &[
            "name",
            "workdir",
            "command",
            "group",
            "no-group",
            "port",
            "no-port",
            "url",
            "no-url",
            "shell-program",
            "shell-arg",
            "env",
            "clear-env",
            "log-max-bytes",
            "log-rotate-count",
            "log-memory-bytes",
        ],
    )?;
    if selectors.len() != 1 {
        return Err("service update 需要一个服务选择器".into());
    }
    let payload = service_options_payload(&options, true)?;
    let mut patch = serde_json::Map::new();
    for key in ["name", "workdir", "command"] {
        if let Some(value) = option_one(&options, key)? {
            patch.insert(key.into(), Value::String(value));
        }
    }
    if let Some(value) = payload.group_selector.as_ref() {
        patch.insert("groupSelector".into(), Value::String(value.clone()));
    }
    if has_flag(&options, "no-group") {
        if payload.group_selector.is_some() {
            return Err("--group 与 --no-group 不能同时使用".into());
        }
        patch.insert("groupSelector".into(), Value::Null);
    }
    if let Some(port) = payload.port.as_ref() {
        patch.insert(
            "port".into(),
            port.as_ref().map_or(Value::Null, |value| json!(value)),
        );
    }
    if has_flag(&options, "no-port") {
        if payload.port.is_some() {
            return Err("--port 与 --no-port 不能同时使用".into());
        }
        patch.insert("port".into(), Value::Null);
    }
    if let Some(url) = payload.url.as_ref() {
        patch.insert(
            "url".into(),
            url.as_ref()
                .map_or(Value::Null, |value| Value::String(value.clone())),
        );
    }
    if has_flag(&options, "no-url") {
        if payload.url.is_some() {
            return Err("--url 与 --no-url 不能同时使用".into());
        }
        patch.insert("url".into(), Value::Null);
    }
    if let Some(value) = payload.shell_program.as_ref() {
        patch.insert("shellProgram".into(), Value::String(value.clone()));
    }
    if let Some(value) = payload.shell_args.as_ref() {
        patch.insert("shellArgs".into(), json!(value));
    }
    if let Some(value) = payload.env.as_ref() {
        patch.insert("env".into(), json!(value));
    }
    if let Some(value) = payload.log.as_ref() {
        patch.insert("log".into(), value.clone());
    }
    Ok(call(
        global,
        "service_update",
        json!({ "selector": selectors[0], "patch": Value::Object(patch) }),
    )?)
}

struct ServiceOptionsPayload {
    group_selector: Option<String>,
    port: Option<Option<u16>>,
    url: Option<Option<String>>,
    shell_program: Option<String>,
    shell_args: Option<Vec<String>>,
    env: Option<Vec<Value>>,
    log: Option<Value>,
}

fn service_options_payload(
    options: &HashMap<String, Vec<String>>,
    update: bool,
) -> Result<ServiceOptionsPayload, String> {
    let group_selector = option_one(options, "group")?;
    let port = match option_one(options, "port")? {
        Some(value) => Some(Some(
            value
                .parse::<u16>()
                .map_err(|_| format!("端口无效：{value}"))?,
        )),
        None if update && has_flag(options, "no-port") => None,
        None => None,
    };
    let url = match option_one(options, "url")? {
        Some(value) => Some(Some(value)),
        None => None,
    };
    let shell_program = option_one(options, "shell-program")?;
    let shell_args = option_values(options, "shell-arg");
    let env_values = option_values(options, "env");
    let has_env_options = !env_values.is_empty() || (update && has_flag(options, "clear-env"));
    let env = if has_env_options {
        let mut keys = HashSet::new();
        let mut values = Vec::with_capacity(env_values.len());
        for value in env_values {
            values.push(parse_env(value, &mut keys)?);
        }
        Some(values)
    } else {
        None
    };
    let log_max_bytes = option_u64(options, "log-max-bytes")?;
    let log_rotate_count = option_u64(options, "log-rotate-count")?;
    let log_memory_bytes = option_u64(options, "log-memory-bytes")?;
    let has_log_options =
        log_max_bytes.is_some() || log_rotate_count.is_some() || log_memory_bytes.is_some();
    let log = if has_log_options {
        let mut fields = serde_json::Map::new();
        if update {
            if let Some(value) = log_max_bytes {
                fields.insert("maxBytes".into(), json!(value));
            }
            if let Some(value) = log_rotate_count {
                fields.insert("rotateCount".into(), json!(value));
            }
            if let Some(value) = log_memory_bytes {
                fields.insert("maxMemoryBytes".into(), json!(value));
            }
        } else {
            fields.insert(
                "maxBytes".into(),
                json!(log_max_bytes.unwrap_or(DEFAULT_LOG_MAX_BYTES)),
            );
            fields.insert(
                "rotateCount".into(),
                json!(log_rotate_count.unwrap_or(DEFAULT_LOG_ROTATE_COUNT)),
            );
            fields.insert(
                "maxMemoryBytes".into(),
                json!(log_memory_bytes.unwrap_or(DEFAULT_LOG_MEMORY_BYTES)),
            );
        }
        Some(Value::Object(fields))
    } else {
        None
    };
    Ok(ServiceOptionsPayload {
        group_selector,
        port,
        url,
        shell_program,
        shell_args: (!shell_args.is_empty()).then_some(shell_args),
        env,
        log,
    })
}

fn parse_env(value: String, keys: &mut HashSet<String>) -> Result<Value, String> {
    let (key, value) = value
        .split_once('=')
        .ok_or_else(|| "环境变量必须使用 KEY=VALUE 格式".to_string())?;
    let key = key.trim();
    if key.is_empty() || !keys.insert(key.to_string()) {
        return Err(format!("环境变量键无效或重复：{key}"));
    }
    Ok(json!({ "key": key, "value": value }))
}

fn execute_ide(raw_args: &[String], global: &GlobalOptions) -> Result<Value, String> {
    let subcommand = raw_args
        .first()
        .ok_or_else(|| "ide 需要子命令：preview 或 import".to_string())?;
    match subcommand.as_str() {
        "preview" => {
            let (paths, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &[])?;
            if paths.len() != 1 {
                return Err("ide preview 需要一个项目根目录".into());
            }
            call(global, "ide_preview", json!({ "projectRoot": paths[0] }))
        }
        "import" => {
            let (paths, options) = parse_options(&raw_args[1..])?;
            ensure_options(&options, &["yes", "all", "candidate", "group"])?;
            if has_flag(&options, "all") && has_flag(&options, "candidate") {
                return Err("ide import 的 --all 与 --candidate 不能同时使用".into());
            }
            if paths.len() != 1 {
                return Err("ide import 需要一个项目根目录".into());
            }
            let preview = call(global, "ide_preview", json!({ "projectRoot": paths[0] }))?;
            if !has_flag(&options, "yes") {
                return Ok(
                    json!({ "applied": false, "preview": preview, "notice": "预览未写入配置；确认后请使用 --yes，并用 --candidate 或 --all 选择配置" }),
                );
            }
            let selected_ids = if has_flag(&options, "all") {
                preview
                    .get("candidates")
                    .and_then(Value::as_array)
                    .map_or_else(Vec::new, |candidates| {
                        candidates
                            .iter()
                            .filter_map(|candidate| {
                                (candidate.get("status").and_then(Value::as_str) == Some("ready"))
                                    .then(|| candidate.get("id").and_then(Value::as_str))
                                    .flatten()
                                    .map(str::to_string)
                            })
                            .collect::<Vec<_>>()
                    })
            } else {
                option_values(&options, "candidate")
            };
            if selected_ids.is_empty() {
                return Err("ide import --yes 需要 --candidate <ID>，或使用 --all".into());
            }
            let group_name = option_one(&options, "group")?
                .or_else(|| {
                    preview
                        .get("suggestedGroupName")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .ok_or_else(|| "无法确定导入分组名称，请使用 --group".to_string())?;
            let config = call(
                global,
                "ide_apply",
                json!({ "preview": preview, "selectedIds": selected_ids.clone(), "groupName": group_name }),
            )?;
            Ok(json!({ "applied": true, "selectedIds": selected_ids, "config": config }))
        }
        _ => Err(format!("不支持的 ide 子命令：{subcommand}")),
    }
}

fn call(global: &GlobalOptions, command: &str, args: Value) -> Result<Value, String> {
    control::call(command, args, global.socket.as_deref(), false)
}

fn call_confirmed(global: &GlobalOptions, command: &str, args: Value) -> Result<Value, String> {
    control::call(command, args, global.socket.as_deref(), true)
}

fn parse_options(
    raw_args: &[String],
) -> Result<(Vec<String>, HashMap<String, Vec<String>>), String> {
    let flags = [
        "yes",
        "all",
        "stdin",
        "no-group",
        "no-port",
        "no-url",
        "clear-env",
    ];
    let mut positionals = Vec::new();
    let mut options = HashMap::<String, Vec<String>>::new();
    let mut index = 0;
    while index < raw_args.len() {
        let token = &raw_args[index];
        if token == "--" {
            positionals.extend(raw_args[index + 1..].iter().cloned());
            break;
        }
        if let Some(option) = token.strip_prefix("--") {
            if option.is_empty() {
                return Err("选项名不能为空".into());
            }
            let (name, inline_value) = option
                .split_once('=')
                .map_or((option, None), |(name, value)| {
                    (name, Some(value.to_string()))
                });
            if flags.contains(&name) {
                if inline_value.is_some() {
                    return Err(format!("布尔选项不能带值：--{name}"));
                }
                options
                    .entry(name.to_string())
                    .or_default()
                    .push("true".into());
                index += 1;
                continue;
            }
            let has_inline_value = inline_value.is_some();
            let value = match inline_value {
                Some(value) => value,
                None => raw_args
                    .get(index + 1)
                    .ok_or_else(|| format!("--{name} 需要值"))?
                    .clone(),
            };
            options.entry(name.to_string()).or_default().push(value);
            index += if has_inline_value { 1 } else { 2 };
        } else {
            positionals.push(token.clone());
            index += 1;
        }
    }
    Ok((positionals, options))
}

fn ensure_options(options: &HashMap<String, Vec<String>>, allowed: &[&str]) -> Result<(), String> {
    if let Some(name) = options
        .keys()
        .find(|name| !allowed.contains(&name.as_str()))
    {
        return Err(format!("该命令不支持选项 --{name}"));
    }
    Ok(())
}

fn has_flag(options: &HashMap<String, Vec<String>>, name: &str) -> bool {
    options.contains_key(name)
}

fn option_values(options: &HashMap<String, Vec<String>>, name: &str) -> Vec<String> {
    options.get(name).cloned().unwrap_or_default()
}

fn option_one(
    options: &HashMap<String, Vec<String>>,
    name: &str,
) -> Result<Option<String>, String> {
    let values = option_values(options, name);
    match values.as_slice() {
        [] => Ok(None),
        [value] => Ok(Some(value.clone())),
        _ => Err(format!("选项 --{name} 只能指定一次")),
    }
}

fn required_option(options: &HashMap<String, Vec<String>>, name: &str) -> Result<String, String> {
    option_one(options, name)?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("缺少必填选项 --{name}"))
}

fn option_u64(options: &HashMap<String, Vec<String>>, name: &str) -> Result<Option<u64>, String> {
    option_one(options, name)?
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|_| format!("--{name} 必须是非负整数"))
        })
        .transpose()
}

fn option_usize(
    options: &HashMap<String, Vec<String>>,
    name: &str,
) -> Result<Option<usize>, String> {
    option_one(options, name)?
        .map(|value| {
            value
                .parse::<usize>()
                .map_err(|_| format!("--{name} 必须是非负整数"))
        })
        .transpose()
}

fn option_i32(options: &HashMap<String, Vec<String>>, name: &str) -> Result<Option<i32>, String> {
    option_one(options, name)?
        .map(|value| {
            value
                .parse::<i32>()
                .map_err(|_| format!("--{name} 必须是整数"))
        })
        .transpose()
}

fn print_value(command: &str, value: &Value, json_output: bool) {
    if json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(value).unwrap_or_else(|_| "null".into())
        );
        return;
    }
    match command {
        "status" | "list" => print_status(value),
        "service" if value.get("services").is_some() => print_status(value),
        "start" | "stop" | "restart" | "group" => print_action_or_json(value),
        "logs" => print_logs(value),
        "resources" => print_resources(value),
        _ => {
            if let Some(content) = value.get("json").and_then(Value::as_str) {
                print!("{content}");
                if !content.ends_with('\n') {
                    println!();
                }
            } else if value.is_null() {
                println!("完成");
            } else {
                println!(
                    "{}",
                    serde_json::to_string_pretty(value).unwrap_or_else(|_| "null".into())
                );
            }
        }
    }
}

fn print_status(value: &Value) {
    let Some(items) = value.get("services").and_then(Value::as_array) else {
        print_action_or_json(value);
        return;
    };
    if items.is_empty() {
        println!("没有服务");
        return;
    }
    println!("NAME\tSTATUS\tPID\tGROUP\tID");
    for item in items {
        let service = item.get("service").unwrap_or(&Value::Null);
        let runtime = item.get("runtime").unwrap_or(&Value::Null);
        let group = item
            .get("group")
            .and_then(|group| group.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("-");
        let name = service.get("name").and_then(Value::as_str).unwrap_or("-");
        let id = service.get("id").and_then(Value::as_str).unwrap_or("-");
        let status = runtime
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let pid = runtime
            .get("pid")
            .map(display_value)
            .unwrap_or_else(|| "-".into());
        println!("{name}\t{status}\t{pid}\t{group}\t{id}");
    }
}

fn print_action_or_json(value: &Value) {
    if let Some(items) = value.as_array() {
        for item in items {
            let id = item.get("serviceId").and_then(Value::as_str).unwrap_or("-");
            let action = item.get("action").and_then(Value::as_str).unwrap_or("-");
            let accepted = item
                .get("accepted")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let status = item
                .get("snapshot")
                .and_then(|snapshot| snapshot.get("status"))
                .and_then(Value::as_str)
                .unwrap_or("-");
            let error = item.get("error").and_then(Value::as_str).unwrap_or("");
            if accepted {
                println!("✓ {id}\t{action}\t{status}");
            } else {
                println!("✗ {id}\t{action}\t{error}");
            }
        }
    } else if let Some(group) = value.get("group").and_then(Value::as_str) {
        println!("分组 {group} 操作完成");
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(value).unwrap_or_else(|_| "null".into())
        );
    }
}

fn print_logs(value: &Value) {
    let Some(chunks) = value.get("chunks").and_then(Value::as_array) else {
        print_action_or_json(value);
        return;
    };
    if chunks.is_empty() {
        println!("没有日志");
        return;
    }
    for chunk in chunks {
        let seq = chunk
            .get("seq")
            .and_then(Value::as_u64)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".into());
        let stream = chunk.get("stream").and_then(Value::as_str).unwrap_or("-");
        let timestamp = chunk
            .get("timestamp")
            .and_then(Value::as_str)
            .unwrap_or("-");
        let text = chunk
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim_end_matches('\n');
        println!("[{seq}] {timestamp} {stream} {text}");
    }
    if value.get("truncated").and_then(Value::as_bool) == Some(true) {
        println!("提示：日志游标已截断");
    }
}

fn print_resources(value: &Value) {
    let Some(items) = value.as_array() else {
        print_action_or_json(value);
        return;
    };
    if items.is_empty() {
        println!("没有可用资源快照");
        return;
    }
    println!("SERVICE\tPROCESSES\tCPU\tRSS\tGENERATION");
    for item in items {
        println!(
            "{}\t{}\t{}\t{}\t{}",
            item.get("serviceId").and_then(Value::as_str).unwrap_or("-"),
            display_field(item, "processCount"),
            display_field(item, "cpuPercent"),
            display_field(item, "rssBytes"),
            item.get("generation")
                .and_then(Value::as_str)
                .unwrap_or("-"),
        );
    }
}

fn display_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .map(display_value)
        .unwrap_or_else(|| "-".into())
}

fn display_value(value: &Value) -> String {
    match value {
        Value::Null => "-".into(),
        Value::String(value) => value.clone(),
        _ => value.to_string(),
    }
}

fn print_help() {
    println!(
        r#"Avenil CLI

用法：
  avenil [--json] [--socket PATH] <命令> [参数]
  avenil cli [--json] [--socket PATH] <命令> [参数]

服务控制：
  help                                      查看完整帮助
  status [服务...]                         查看服务配置摘要与运行态
  start <服务...>                          启动一个或多个服务
  stop <服务...> [--grace-ms MS]           停止服务
  restart <服务...> [--grace-ms MS]        重启服务
  logs <服务> [--after-seq N] [--limit N]   读取日志
  resources [服务...]                       读取资源快照
  open <服务>                               打开服务 URL
  quit --yes                                停止托管服务并退出 Avenil

分组与配置：
  group list                                列出分组
  group add --name NAME                    创建分组
  group update <分组> --name NAME           重命名分组
  group delete <分组> --yes                 删除空分组
  group {{start|stop|restart}} <分组>         操作分组内所有服务
  service list                              查看所有服务
  service get <服务>                        查看服务配置
  service add --name NAME --workdir DIR --command CMD [选项]
  service update <服务> [选项]              更新服务配置
  service delete <服务> --yes               删除服务配置
  config show                              查看配置
  config export [--output FILE]            导出配置
  config import FILE [--yes]                预览或确认替换配置
  config import --stdin --yes               从 stdin 预览并替换配置

IDE 配置：
  ide preview PROJECT_ROOT                  预览 IDE 运行配置
  ide import PROJECT_ROOT [选项]             预览或确认导入
    --candidate ID                          选择一个可导入配置（可重复）
    --all                                   选择全部 ready 配置
    --group NAME                            指定分组名称

service add/update 选项：
  --group NAME|ID  --port PORT  --url URL  --shell-program PATH
  --shell-arg ARG（可重复）  --env KEY=VALUE
  --log-max-bytes BYTES  --log-rotate-count N  --log-memory-bytes BYTES
  update 还支持 --no-group --no-port --no-url --clear-env

选择器既可以是服务/分组 ID，也可以是名称；名称重复时请改用 ID。
CLI 通过本机 Unix socket 连接正在运行的 Avenil 桌面应用；请先打开 Avenil。
自动化场景建议使用 --json。也可以设置 AVENIL_SOCKET 指向测试用 socket。
"#
    );
}

fn fail(error: &str, code: i32, json_output: bool) -> ! {
    if json_output {
        eprintln!(
            "{}",
            serde_json::to_string(&json!({ "ok": false, "error": error }))
                .unwrap_or_else(|_| "{\"ok\":false}".into())
        );
    } else {
        eprintln!("错误：{error}");
    }
    process::exit(code);
}
