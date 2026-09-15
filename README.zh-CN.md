<p align="center">
  <img src="docs/assets/banner.svg" alt="Avenil — A quiet place for things to run." width="100%" />
</p>

<p align="center">让本地服务各就其位。<br />在一个桌面工作区里，启动服务、查看日志、掌握运行状态。</p>

<p align="center">
  <a href="https://github.com/stardut/avenil/releases/latest">下载最新版本</a> ·
  <a href="#开始使用">开始使用</a> ·
  <a href="docs/USAGE.md">使用指南</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a> ·
  <a href="README.md">English</a>
</p>

<p align="center"><strong>macOS 15+ · Apple Silicon · MIT · 早期预览</strong></p>

![Avenil 浅色界面与展开的日志面板](docs/assets/workspace-light.jpg)

<p align="center"><sub>实际应用界面，使用内置演示数据。当前界面语言为简体中文。</sub></p>

## 为什么做 Avenil

前端在一个终端，API 在另一个终端，还有一个忘记停止的 Worker。

Avenil 把它们放到同一个工作区。保存工作目录和启动命令，按项目分组，随时查看服务的状态、输出和资源占用。让编辑器专注于写代码，把日常的服务运行管理交给 Avenil。

## 当前能力

- **按项目组织服务**：每个服务拥有独立的工作目录与命令，分组不限制目录结构。
- **控制服务生命周期**：单独或按组启动、停止、重启；管理自己创建的进程组及子进程。
- **集中查看日志**：集中读取 stdout、stderr，支持磁盘日志轮转。
- **查看运行状态**：展示进程数、CPU、内存，支持可选的本地 TCP 就绪检查。
- **导入 IDE 配置**：预览 VS Code、Cursor、JetBrains 中支持的运行配置，确认后添加到新分组。
- **配置保存在本机**：导出时移除全部环境变量值，方便分享服务定义。
- **适应你的桌面**：浅色、深色、跟随系统主题，以及 macOS 原生窗口控制。

<details>
<summary>查看深色模式</summary>

![Avenil 深色界面](docs/assets/workspace-dark.jpg)

</details>

## 开始使用

当前是早期预览版本。推送 `v主版本.次版本.修订版本` tag 后，会自动创建包含 macOS DMG 的 GitHub Release；Developer ID 签名与 Apple 公证仍是后续目标。

### 环境要求

- macOS 15+，Apple Silicon。
- Xcode Command Line Tools、Rust stable 和 Cargo。
- Node.js 20.x 分支至少为 **20.19**，或 **22.12+**，以及 npm；与项目当前 Vite 版本要求一致。

在项目根目录执行：

```bash
npm ci
npm run tauri dev
```

### 添加第一个服务

1. 点击 **添加服务**，填写名称和工作目录。
2. 填入平时使用的前台命令，例如 `npm run dev`、`mvn spring-boot:run` 或 `python3 -m http.server 8000`。
3. 按需填写用于就绪检查的端口，以及用于打开浏览器的 URL。
4. 保存后点击 **启动**，展开服务查看日志。

命令应保持前台运行；分组批量操作不包含依赖排序。已有 IDE 运行配置时，可点击 **从 IDE 导入**，选择项目根目录并确认可导入项。

### 在浏览器中体验

```bash
npm run dev
```

打开 **http://127.0.0.1:1420/?preview=1**。演示数据只在内存中，刷新即重置；浏览器不会读取本机项目文件或管理真实进程。

### 构建桌面应用

```bash
npm run tauri build
```

默认产物位于 `src-tauri/target/release/bundle/dmg/`。打开 DMG 后，将 Avenil 拖入“应用程序”即可安装。本地构建使用 ad-hoc 签名，未使用 Developer ID 签名或 Apple 公证。

### 安装 GitHub Release

1. 打开[最新 GitHub Release](https://github.com/stardut/avenil/releases/latest)，下载适用于 Apple Silicon 的 `.dmg` 文件。
2. 打开磁盘映像，将 **Avenil** 拖入“**应用程序**”。
3. 推出磁盘映像，然后从“应用程序”启动 Avenil。

发布版本前，先确保 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 中的版本号一致，再推送匹配的 tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```

`Release macOS app` 工作流会校验 tag 与版本号，构建 Apple Silicon DMG，并将其发布到该 tag 对应的 GitHub Release。由于仓库当前没有 Apple Developer ID 证书，CI 使用 ad-hoc 签名；macOS 首次启动时仍可能需要在“系统设置 → 隐私与安全性”中手动允许。

## 使用边界

- 仅管理由 Avenil 创建的进程组，不接管已有 PID、系统守护进程或外部后台服务。
- 严格执行配置的 shell、参数和工作目录；默认 shell 为 `/bin/zsh -lc`。
- 可选端口检查连接 `127.0.0.1`，启动期限为 30 秒；这不是 HTTP 健康检查。
- 环境变量覆盖应用继承的环境，不会自动读取 `.env`。
- 本地 JSON 中的环境变量值**没有加密**；导出时全部清空。
- 关闭窗口会隐藏应用；明确退出会停止托管服务，停止失败时保持应用可用。

配置路径、日志策略、IDE 支持范围与常见问题见 [使用指南](docs/USAGE.md)。

## 接下来的方向

以下是待推进的方向，尚未实现，也不代表发布日期承诺：

- [x] 通过版本 tag 触发、可重复的 Apple Silicon DMG 发布流程。
- [ ] Developer ID 签名与 Apple 公证的 macOS 发布包。
- [ ] 英文界面与可维护的多语言结构。
- [ ] 更清晰的首次使用引导和启动错误提示。
- [ ] 根据可复现案例扩大 IDE 配置导入范围。

当前范围聚焦 macOS 本地前台服务，暂不包含远程主机、容器管理、调试器或依赖编排。

## 参与贡献

欢迎带来真实的使用场景、可复现的问题、小范围修复、文档改进和设计反馈。开发结构与验证方式见 [贡献指南](CONTRIBUTING.md)。如果 Avenil 帮你减少了终端管理的负担，也欢迎点一个 Star，让更多人发现它。

## 许可证与致谢

项目采用 [MIT License](LICENSE)。使用 Tauri、Rust、React 和 Vite 构建。改编的 beUI 组件保留 [MIT 声明](THIRD_PARTY_LICENSES/beui-MIT.txt)，Geist 与 Audit Rounded 字体保留[各自的](src/assets/fonts/LICENSE.txt) [OFL 声明](src/assets/fonts/audit-rounded-OFL.txt)。第三方组件仍遵循各自许可证。
