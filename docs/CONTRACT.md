# Avenil MVP 接口与行为合同

本文档冻结前端与 Tauri/Rust 后端之间的最小合同。字段名按 JSON/TypeScript 约定使用 camelCase；Rust 使用 `serde` 映射。时间一律为 ISO 8601 字符串（UTC，带 `Z`）。所有 ID 为 UUID 字符串。

## 数据

```ts
type Id = string;

type Group = {
  id: Id;
  name: string;
  sortOrder: number;
};

type EnvVar = {
  key: string;
  value: string;
  secret: boolean;
};

type LogPolicy = {
  maxBytes: number;       // 当前文件上限，默认 2 * 1024 * 1024
  rotateCount: number;    // 历史文件数，默认 3
  maxMemoryBytes: number; // 内存 ring 上限，默认 256 * 1024
};

type ShellSpec = {
  program: string; // 默认 "/bin/zsh"
  args: string[];  // 默认 ["-lc"]，命令文本作为最后一个参数
};

type Service = {
  id: Id;
  name: string;
  groupId: Id | null;
  workdir: string;
  command: string;       // 用户输入的前台 shell 文本
  shell: ShellSpec;
  env: EnvVar[];
  port: number | null;   // 非空时启用本地 TCP 就绪检查
  url: string | null;
  log: LogPolicy;
};

type AppConfig = {
  schemaVersion: 1;
  groups: Group[];
  services: Service[];
};

type ServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "failed"
  | "unknown";

type RuntimeSnapshot = {
  serviceId: Id;
  generation: string | null; // 未启动时为 null；每次启动唯一
  status: ServiceStatus;
  pid: number | null;
  pgid: number | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  signal: number | null;
  error: string | null;
};

type ResourceSnapshot = {
  serviceId: Id;
  generation: string;
  capturedAt: string;
  processCount: number;
  cpuPercent: number | null;
  rssBytes: number | null;
};

type LogChunk = {
  serviceId: Id;
  generation: string | null;
  seq: number; // 每服务在当前应用会话内跨重启单调递增
  stream: "stdout" | "stderr" | "system";
  timestamp: string;
  text: string;
};

type LogPage = {
  serviceId: Id;
  generation: string | null;
  chunks: LogChunk[];
  nextSeq: number;
  truncated: boolean;
  droppedChunks: number;
};

type ImportPreview = {
  schemaVersion: number;
  groupCount: number;
  serviceCount: number;
  errors: string[];
  warnings: string[];
  changes: {
    addedGroups: number;
    removedGroups: number;
    addedServices: number;
    removedServices: number;
  };
  canApply: boolean;
};

type BatchAction = "start" | "stop" | "restart";

type BatchActionResult = {
  serviceId: Id;
  action: BatchAction;
  accepted: boolean;
  snapshot: RuntimeSnapshot | null;
  error: string | null;
};

type ExportResult = {
  json: string;
  notice: string;
};

type IdeImportInput = {
  projectRoot: string;         // 用户选择的项目根目录，绝对路径
};

type IdeImportSource = {
  path: string;                // 自动发现的配置文件绝对路径
  kind: "vscode" | "jetbrains";
};

type IdeImportCandidate = {
  id: Id;
  name: string;
  status: "ready" | "needsInput" | "unsupported";
  service: Service | null;     // 预览中环境值为空且 secret=true，实际值只保留在短期服务端快照
  warnings: string[];
  missing: string[];
};

type IdeImportPreview = {
  snapshotId: Id;
  projectRoot: string;
  sources: IdeImportSource[];
  suggestedGroupName: string;
  candidates: IdeImportCandidate[];
  warnings: string[];
};
```

`Group` 是界面中的项目逻辑分组；它只通过 `groupId` 关联服务，与服务 `workdir` 是否相同无关。不存在的 `groupId` 不能保存，仍被服务引用的 group 不能删除。未启动服务的 `generation` 为 `null`。空列表参数表示“全部”：`runtime_snapshot()` 和 `resource_snapshot()` 返回所有服务；批量操作必须显式传非空 `serviceIds`，空数组返回空结果，不执行任何操作；`log_page` 的 `limit` 缺省为 200，后端限制为 1000。每个服务的日志 `seq` 在一次应用会话内跨重启保持单调递增。

日志策略允许范围为 `maxBytes` 64 KiB–16 MiB、`rotateCount` 1–10、`maxMemoryBytes` 64 KiB–4 MiB；超出范围拒绝保存。默认值为单文件 2 MiB、轮转 3 个历史文件、内存 ring 256 KiB。磁盘文件按服务隔离并按大小轮转；内存和读写通道均有界，超限丢弃旧内容并反映在 `truncated`/`droppedChunks`。

## Commands

Tauri `invoke` 命令如下。命令失败统一返回一条可直接展示的可读字符串；不额外包装错误码。所有写配置命令都先校验，再原子持久化。

```text
config_load() -> AppConfig
config_save(config: AppConfig) -> void
config_import_preview(json: string) -> ImportPreview
config_import_apply(json: string) -> AppConfig
config_export() -> ExportResult
choose_project_directory() -> string | null
ide_import_preview(input: IdeImportInput) -> IdeImportPreview
ide_import_apply(preview: IdeImportPreview, selectedIds: Id[], groupName: string) -> AppConfig

group_upsert(group: Group) -> Group
group_delete(groupId: Id) -> void
service_upsert(service: Service) -> Service
service_delete(serviceId: Id) -> void

service_start(serviceId: Id) -> RuntimeSnapshot
service_stop(serviceId: Id, graceMs?: number) -> RuntimeSnapshot
service_restart(serviceId: Id, graceMs?: number) -> RuntimeSnapshot
service_batch_action(
  serviceIds: Id[],
  action: BatchAction,
  graceMs?: number
) -> BatchActionResult[]

runtime_snapshot(serviceIds?: Id[]) -> RuntimeSnapshot[]
resource_snapshot(serviceIds?: Id[]) -> ResourceSnapshot[]
log_page(serviceId: Id, afterSeq?: number, limit?: number) -> LogPage
open_service_url(serviceId: Id) -> void
app_quit() -> void
```

`config_export` 只有一种行为：输出脱敏 JSON。每个环境变量保留 `key` 与 `secret`，`value` 固定为空字符串，并在 `notice` 明确提示导入前需要重新填写环境变量值。合同不提供导出完整环境值的模式。

`config_import_preview` 只解析、校验和计算摘要，不写文件。UI 必须展示预览并由用户确认后再调用 `config_import_apply`；apply 是整份替换，不是合并，且必须基于同一份 JSON。只要任意服务处于 `starting`、`running`、`stopping`，或其操作锁仍在执行，preview 可以返回但 apply 必须拒绝。apply 失败不得改变原配置。

`ide_import_preview` 接收用户选择的项目根目录，只在该目录下自动查找 `.vscode/launch.json`、`.idea/runConfigurations/*.xml` 和 `.run/*.xml`，不递归扫描、不执行命令、不执行 IDE 宏。每个配置文件最大 2 MiB；VS Code 使用 JSONC 解析，JetBrains 使用 XML 解析。未找到配置或配置读取/解析失败时返回可读错误；同时存在多个 IDE 来源时合并到同一份预览。预览快照只在内存中保留最多 8 份，apply 只能使用对应快照，不重新读取源文件。

当前导入范围是 VS Code/Cursor 的 `node-terminal`、明确 `program` 的 `node`/`pwa-node`、使用 `runtimeExecutable: npm` 与 `runtimeArgs: run <script>` 的 Node npm 脚本、明确 `mainClass` 且工作目录下声明 `spring-boot-maven-plugin` 的 Java Spring Boot launch、明确解释器和 `program`/`module` 的 Python launch，以及 IDEA 的明确 Maven/Gradle goals/tasks。Java Spring Boot launch 转换为 Maven 前台命令；其 `preLaunchTask` 不单独执行，由 Maven 运行负责编译；Java 非空 `args` 不自动猜测参数边界，会要求在 Avenil 中确认。所有导入均按普通前台 shell 运行，不保留调试能力。`attach`、未知扩展类型、Java 缺少可识别 Maven Spring Boot 构建命令、compound、未被转换的 `postDebugTask`/`dependsOn`、`envFile`、动态变量和 IDEA before-run/JRE/远程目标会标为 `unsupported` 或 `needsInput`，不能静默丢弃。

`ide_import_apply` 必须由 UI 在预览后确认调用；空选择、重复或未知 candidate、非 `ready` candidate、缺失输入、空 groupName、活跃 runtime/operation 均拒绝。apply 是当前配置的原子追加：创建一个新 Group 和所选服务，给 Group/Service 生成新 UUID，保留现有 groups/services 完全不变；失败不得写入部分结果。环境变量字面值在服务端快照中保留，预览 DTO 中统一清空并标记 `secret=true`，因此 UI 不会泄露；导入过程不会自动启动服务。

配置文件位于 Tauri app data 目录的 `rundock.json` 文件（保留原文件名以延续已有配置）。写入顺序是同目录临时文件、完整 flush、rename 覆盖；临时文件或 rename 失败时保留原文件并返回错误。运行中的服务禁止 `group_upsert`、`group_delete`、`service_upsert`、`service_delete` 和 `config_save`；停止、退出、失败后的服务定义才可修改或删除。

## 进程与状态行为

- 启动严格执行 `shell.program shell.args command`，默认 `/bin/zsh -lc <command>`。环境是桌面应用继承环境再覆盖 `env`；不自动读取 `.env`，不自动更换 shell、目录或命令。`shell` 没有可用 fallback。
- 命令必须以前台进程运行。Avenil 不接管已有进程，也不把 `launchctl`、`nohup`、后台 daemon 或外部守护进程纳入生命周期。
- 子进程创建时必须建立独立 process group，并记录 `pid`/`pgid`。`setpgid`/建组实际失败时，启动失败并返回可读错误，不得退回只杀单个 PID 的实现。
- 每次实际 spawn 产生新的 `generation`；未启动时为 `null`。`service_start` 在 spawn 成功后立即返回 `starting`（无端口检查时可为 `running`），端口就绪检查通过后再由事件转为 `running`。旧 generation 的异步结果不得覆盖新 generation。状态判断以持有的 child wait 结果为准，不能只依赖 PID 探测，以避免 PID 复用。
- 同一服务的 start/stop/restart 严格串行化；已有操作锁时重复操作立即返回错误。不同服务可以并行执行批量操作；单项失败只写入该项 `BatchActionResult`。
- stop/restart 先向负 PGID 发送 `SIGTERM`，等待 `graceMs`（默认 5000，限制 1000–30000），仍存活时向同一 PGID 发送 `SIGKILL`。只操作当前 generation 的进程组。停止可以取消尚未完成的端口就绪等待；restart 必须先完成停止，再创建新的 generation 并 spawn。
- 没有配置 `port` 时，spawn 成功且 child 仍存活即转为 `running`。配置 `port` 时，spawn 前先检查本机 TCP 端口；已占用则拒绝启动，不创建服务进程。启动后最多等待 30 秒连接 `127.0.0.1:port` 成功；超时转为 `failed` 并清理整个 process group。等待期间 child 提前退出则直接使用最终退出状态。
- 正常 child 退出码 0 最终为 `exited`；非零退出、信号终止、启动/就绪失败最终为 `failed`。`stopped` 表示由 Avenil 成功完成停止；`unknown` 只用于无法取得可靠状态的异常情况。
- 资源统计按 process group 聚合当前进程及其子进程，至少提供 CPU 百分比、RSS 和进程数；采样失败时对应数值为 `null`，不能伪造 0。

stdout 和 stderr 必须并发读取，统一进入有界通道和内存 ring。日志事件按每服务、跨重启单调递增的 `seq` 发布；读取游标早于 ring/轮转保留范围时返回 `truncated: true`。日志文件按 `maxBytes` 轮转并限制历史数量，不能无限增长。

## Events

事件通过 Tauri `listen` 订阅：

```text
avenil://runtime-changed   RuntimeSnapshot
avenil://resource-changed  ResourceSnapshot
avenil://log               LogChunk
avenil://config-changed    { config: AppConfig }
avenil://shutdown-state    { phase: "stopping" | "completed" | "forced", error?: string }
```

运行状态、日志、资源都必须带 `serviceId` 和 generation。配置成功持久化后才发送 `config-changed`。事件不是状态真相；UI 重连或丢事件后应重新调用 snapshot/log_page。

## 托盘与退出

关闭窗口只隐藏窗口，不退出进程。托盘至少提供显示窗口和退出。`app_quit`、托盘退出和系统退出请求先阻止默认退出，广播 `shutdown-state: stopping`，串行停止所有当前托管服务；只有所有当前 generation 的进程组确认清理后才发送 `completed` 并退出。超时强杀或停止失败后发送 `{ phase: "forced", error }`，取消本次退出、解除 shutdown 门禁并保留运行态，用户可在 UI 中看到错误并重试。应用正常退出不留下由 Avenil 启动的服务进程。
