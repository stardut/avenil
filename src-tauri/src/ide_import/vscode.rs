use std::path::Path;
use serde_json::Value;
use super::{candidate, env_from_object, resolve_value, service_defaults, shell_quote, ParsedResult};

pub fn parse(text: &str, workspace: &Path) -> Result<ParsedResult, String> {
    let root: Value = json5::from_str(text).map_err(|e| format!("launch.json JSONC 解析失败: {e}"))?;
    let object = root.as_object().ok_or_else(|| "launch.json 顶层必须是对象".to_string())?;
    let configurations = object.get("configurations").and_then(Value::as_array).ok_or_else(|| "launch.json 缺少 configurations 数组".to_string())?;
    let mut result = ParsedResult { candidates: vec![], warnings: vec![] };
    for item in configurations {
        let Some(config) = item.as_object() else {
            result.candidates.push(candidate("无名配置".into(), None, "unsupported", vec![], vec!["配置项不是对象".into()]));
            continue;
        };
        let name = config.get("name").and_then(Value::as_str).unwrap_or("无名配置").to_string();
        let kind = config.get("type").and_then(Value::as_str).unwrap_or("");
        let request = config.get("request").and_then(Value::as_str).unwrap_or("");
        if request == "attach" {
            result.candidates.push(candidate(name, None, "unsupported", vec!["Avenil 不提供调试器 attach，未生成服务".into()], vec![]));
            continue;
        }
        if request != "launch" {
            result.candidates.push(candidate(name, None, "unsupported", vec!["只支持 request=launch".into()], vec!["request".into()]));
            continue;
        }
        let parsed = match kind {
            "node-terminal" => parse_node_terminal(config, &name, workspace),
            "node" | "pwa-node" => parse_node(config, &name, workspace),
            "python" | "debugpy" => parse_python(config, &name, workspace),
            "" => Ok(candidate(name, None, "unsupported", vec!["缺少调试扩展 type".into()], vec!["type".into()])),
            _ => Ok(candidate(name, None, "unsupported", vec![format!("未知或扩展专属的 VS Code type: {kind}")], vec![])),
        }?;
        result.candidates.push(parsed);
    }
    if let Some(compounds) = object.get("compounds").and_then(Value::as_array) {
        for compound in compounds {
            let name = compound.get("name").and_then(Value::as_str).unwrap_or("无名 compound").to_string();
            result.candidates.push(candidate(name, None, "unsupported", vec!["compound 只表示 IDE 调试编排，Avenil 不导入依赖关系".into()], vec![]));
        }
    }
    Ok(result)
}

fn parse_node_terminal(config: &serde_json::Map<String, Value>, name: &str, workspace: &Path) -> Result<super::ParsedCandidate, String> {
    let Some(command) = config.get("command").and_then(Value::as_str) else {
        return Ok(candidate(name.into(), None, "needsInput", vec![], vec!["command".into()]));
    };
    let mut warnings = vec!["按普通前台 shell 命令导入，不保留 IDE 调试能力".into()];
    let command = match resolve_value(command, workspace) {
        Ok(value) => value,
        Err(error) => return Ok(candidate(name.into(), None, "needsInput", vec![error], vec!["动态变量".into()])),
    };
    let cwd = match resolve_cwd(config, workspace) {
        Ok(value) => value,
        Err(error) => return Ok(candidate(name.into(), None, "needsInput", vec![error], vec!["cwd".into()])),
    };
    let env = match env_from_object(config.get("env"), workspace) {
        Ok(value) => value,
        Err(error) => return Ok(candidate(name.into(), None, "needsInput", vec![error], vec!["env".into()])),
    };
    let mut missing = special_fields(config);
    if config.contains_key("envFile") { missing.push("envFile".into()); }
    if !missing.is_empty() { warnings.push("存在 IDE 任务或外部环境语义，需在 Avenil 中重新确认".into()); }
    let service = service_defaults(name.into(), &cwd, command, env);
    Ok(candidate(service.name.clone(), Some(service), if missing.is_empty() { "ready" } else { "needsInput" }, warnings, missing))
}

fn parse_node(config: &serde_json::Map<String, Value>, name: &str, workspace: &Path) -> Result<super::ParsedCandidate, String> {
    let Some(program) = config.get("program").and_then(Value::as_str) else {
        return Ok(candidate(name.into(), None, "needsInput", vec![], vec!["program".into()]));
    };
    let executable = config.get("runtimeExecutable").and_then(Value::as_str).unwrap_or("node");
    let values = match resolve_values(executable, config.get("runtimeArgs"), program, config.get("args"), workspace) {
        Ok(values) => values,
        Err(error) => return Ok(candidate(name.into(), None, "needsInput", vec![error], vec!["动态变量或参数".into()])),
    };
    let cwd = match resolve_cwd(config, workspace) {
        Ok(value) => value,
        Err(error) => return Ok(candidate(name.into(), None, "needsInput", vec![error], vec!["cwd".into()])),
    };
    let env = match env_from_object(config.get("env"), workspace) {
        Ok(value) => value,
        Err(error) => return Ok(candidate(name.into(), None, "needsInput", vec![error], vec!["env".into()])),
    };
    let mut warnings = vec!["按普通前台运行导入，不保留 IDE 调试能力".into()];
    let mut missing = special_fields(config);
    if config.contains_key("envFile") { missing.push("envFile".into()); }
    if !missing.is_empty() { warnings.push("存在 IDE 任务或外部环境语义，需在 Avenil 中重新确认".into()); }
    let service = service_defaults(name.into(), &cwd, values, env);
    Ok(candidate(service.name.clone(), Some(service), if missing.is_empty() { "ready" } else { "needsInput" }, warnings, missing))
}

fn parse_python(config: &serde_json::Map<String, Value>, name: &str, workspace: &Path) -> Result<super::ParsedCandidate, String> {
    let interpreter = config.get("python").or_else(|| config.get("pythonPath")).and_then(Value::as_str);
    let Some(interpreter) = interpreter else {
        return Ok(candidate(name.into(), None, "needsInput", vec![], vec!["python interpreter".into()]));
    };
    let program = config.get("program").and_then(Value::as_str);
    let module = config.get("module").and_then(Value::as_str);
    if program.is_none() == module.is_none() { return Ok(candidate(name.into(), None, "needsInput", vec![], vec!["program 或 module（二选一）".into()])); }
    let parsed = (|| -> Result<(std::path::PathBuf, String, Vec<crate::models::EnvVar>), String> {
        let mut command = vec![resolve_value(interpreter, workspace)?];
        let python_args = string_array(config.get("pythonArgs"))?;
        for arg in python_args { command.push(resolve_value(&arg, workspace)?); }
        if let Some(module) = module { command.push("-m".into()); command.push(resolve_value(module, workspace)?); }
        if let Some(program) = program { command.push(resolve_value(program, workspace)?); }
        for arg in string_array(config.get("args"))? { command.push(resolve_value(&arg, workspace)?); }
        let cwd = resolve_cwd(config, workspace)?;
        let env = env_from_object(config.get("env"), workspace)?;
        Ok((cwd, command.iter().map(|item| shell_quote(item)).collect::<Vec<_>>().join(" "), env))
    })();
    let (cwd, command, env) = match parsed {
        Ok(parsed) => parsed,
        Err(error) => return Ok(candidate(name.into(), None, "needsInput", vec![error], vec!["解释器、路径或参数".into()])),
    };
    let mut missing = special_fields(config);
    if config.contains_key("envFile") { missing.push("envFile".into()); }
    let service = service_defaults(name.into(), &cwd, command, env);
    Ok(candidate(service.name.clone(), Some(service), if missing.is_empty() { "ready" } else { "needsInput" }, vec!["按普通前台运行导入，不保留 Python 调试能力".into()], missing))
}

fn resolve_cwd(config: &serde_json::Map<String, Value>, workspace: &Path) -> Result<std::path::PathBuf, String> {
    let raw = config.get("cwd").and_then(Value::as_str).unwrap_or("${workspaceFolder}");
    let value = resolve_value(raw, workspace)?;
    let path = std::path::PathBuf::from(value);
    if !path.is_absolute() { return Err("cwd 解析后必须是绝对路径".into()); }
    if !path.is_dir() { return Err("cwd 目录不存在".into()); }
    Ok(path)
}

fn resolve_values(executable: &str, runtime_args: Option<&Value>, program: &str, args: Option<&Value>, workspace: &Path) -> Result<String, String> {
    let mut values = vec![resolve_value(executable, workspace)?];
    for value in string_array(runtime_args)? { values.push(resolve_value(&value, workspace)?); }
    values.push(resolve_value(program, workspace)?);
    for value in string_array(args)? { values.push(resolve_value(&value, workspace)?); }
    Ok(values.iter().map(|value| shell_quote(value)).collect::<Vec<_>>().join(" "))
}

fn string_array(value: Option<&Value>) -> Result<Vec<String>, String> {
    let Some(value) = value else { return Ok(vec![]); };
    let Some(array) = value.as_array() else { return Err("参数必须是字符串数组".into()); };
    array.iter().map(|item| item.as_str().map(str::to_string).ok_or_else(|| "参数数组包含非字符串".to_string())).collect()
}

fn special_fields(config: &serde_json::Map<String, Value>) -> Vec<String> {
    ["preLaunchTask", "postDebugTask", "dependsOn"].iter().filter(|key| config.contains_key(**key)).map(|key| (*key).to_string()).collect()
}
