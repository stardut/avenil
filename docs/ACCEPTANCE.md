# RunDock MVP 验收记录

日期：2026-09-14  
验收角色：独立验收代理  
项目路径：`/Users/junran/workspace/mycode/avenil`

## 结论范围

Rust 临时 CLI harness 已复用生产 `src-tauri` crate 的 `rlib`，完成核心进程、配置、日志和资源路径验证。最新一次运行结果为 **21 项通过、0 项失败**。这证明了可公开调用核心的行为；它不等同于完整 Tauri 应用的 native IPC 验收。

前端使用 Chrome CUA 打开的 `http://127.0.0.1:1420/?preview=1` 进行了演示数据预览验收。预览页可操作，但属于显式 mock/演示模式，不能作为真实 Rust IPC 证据。截图见 [rundock-preview.png](/Users/junran/Documents/Codex/2026-09-14/new-chat/outputs/rundock-preview.png)。

最新 `.app` 已通过构建并启动，观察到 `rundock` 进程和 WebKit 页面加载完成。当前 macOS 会话处于锁屏状态，System Events 无法取得应用窗口，故窗口、托盘、关闭隐藏、托盘退出和 native 文件导入导出没有被宣称通过。

## 构建证据

以下命令已在项目目录执行并成功退出：

```text
npm run build
npm run tauri build
```

构建产物：

```text
/Users/junran/workspace/mycode/avenil/src-tauri/target/release/bundle/macos/RunDock.app
```

最终交付包 [RunDock-macos-arm64.zip](/Users/junran/Documents/Codex/2026-09-14/new-chat/outputs/RunDock-macos-arm64.zip) 已独立解压校验：压缩包大小为 `3157723` bytes，SHA-256 为 `c653a9af2e2d66739df37b07a9105e63a31a1e95b59d0eac2d8d46945cd167f3`，与交付声明一致；包内二进制为 Mach-O `arm64`；`codesign --verify --deep --strict` 通过。签名为 ad hoc，`TeamIdentifier=not set`，当前没有 Developer ID 签名或 Apple 公证证据。

## 核心 harness

可复现命令：

```text
cargo run --quiet --manifest-path work/acceptance-harness/Cargo.toml
```

源码保留在 [work/acceptance-harness](/Users/junran/workspace/mycode/avenil/work/acceptance-harness)。它只依赖生产 `src-tauri` crate，不写入生产包，也不是单元测试。每次运行使用随机临时 fixture 和日志目录，结束时删除临时根目录。

最新一次实际结果：

```text
SUMMARY passed=21 failed=0
```

逐项结果：

1. `atomic-persistence`：通过，配置文件写入临时目录。
2. `crud-persist`：通过，跨目录服务与逻辑项目组关系持久化。
3. `redacted-export`：通过，env key 保留、value 为空，并提示重新填写。
4. `import-preview`：通过，预览返回可应用摘要且不直接写入。
5. `start-request`：通过，启动返回 `Running` 且存在 PGID。
6. `running`：通过，运行态快照存在 PGID。
7. `logs-live`：通过，收到日志 chunk 且 generation 存在。
8. `resources`：通过，采集到进程数、CPU 和 RSS；本轮 CPU 为 `Some(1.5)`、RSS 为 `Some(2621440)`。
9. `import-blocked-active`：通过，活跃服务导入返回错误。
10. `delete-blocked-active`：通过，运行中服务删除返回错误。
11. `stop`：通过，最终状态为 `Stopped`。
12. `restart`：通过，返回新的 generation 且状态为 `Running`。
13. `delete-group-blocked-nonempty`：通过，仍被服务引用的分组拒绝删除。
14. `batch-partial`：通过，一个服务接受启动、一个不存在服务返回拒绝，结果按输入顺序返回。
15. `failed-exit`：通过，`exit 7` 得到 `Failed` 且 `exit_code=7`。
16. `port-conflict`：通过，被占用端口返回“端口已被占用”。
17. `port-readiness`：通过，先返回 `Starting`，就绪后变为 `Running`。
18. `bounded-log`：通过，中文日志保持有效边界，产生丢弃计数，本轮 `dropped=19514`、日志文件数为 `2`。
19. `parent-exit-cleans-child-group`：通过，父 shell 退出后状态为 `Exited`，记录 PGID 已无存活进程组（`group_alive=false`）。
20. `stop-all-report`：通过，`attempted=1`、`stopped=1`、`errors=[]`，最终服务不处于活跃态。
21. `cleanup`：通过，最终 `active_snapshots=0`。

本轮 stdout 的逐项转录保存在 [rundock-core-verification.txt](/Users/junran/Documents/Codex/2026-09-14/new-chat/outputs/rundock-core-verification.txt)。该文件由本轮工具实际返回内容整理而成，不是 harness 自动生成的原始日志文件。

## 前端预览证据

在演示模式中实际操作并观察到：

- 空表单提交显示“请填写服务名称、工作目录和启动命令”；
- 有效服务表单保存后列表更新并显示成功 toast；
- 新建项目组后列表更新；
- 环境变量 key/value 和敏感值勾选字段可编辑；
- shell、日志策略等高级设置可展开；
- 全部、运行中、已停止、需关注筛选可切换；
- 详情页可查看配置、日志和资源指标；
- 日志刷新、CPU/RSS 展示、停止状态变化可观察；
- 导入按钮可打开文件选择器，导出按钮可触发预览页动作，但实际 WebView 下载文件和真实 IPC 文件导入未作为通过证据。

已发现并已由前端修正的新建项目组成功 toast 文案问题；最新前端重新 `npm run build` 已通过。该旧问题不列为当前缺陷。

## 未验证和环境限制

以下项目仍需要在可操作的图形会话中完成：

- 完整 `.app` 的 native IPC：Rust command invoke 与事件回传；
- native 窗口可见、关闭窗口后隐藏到菜单栏、托盘“显示窗口”；
- 托盘“退出 RunDock”及退出清理的完整 UI 路径；
- native WebView 中导入文件预览确认、全量替换和导出文件落盘；
- native UI 下服务真实启动、日志实时刷新和资源事件联动。

阻塞原因是本轮 macOS 会话处于锁屏：应用进程启动且 WebKit 页面加载成功，但 System Events 报告 `rundock` 窗口数为 `0`，屏幕截图只能得到锁屏画面。该环境事实不能替代 native 通过结论。

临时 harness 运行期间的服务和 fixture 已清理；保留 harness 源码供后续复验。应用进程按交接要求保持当前状态，未额外执行 native 退出或清理操作。
