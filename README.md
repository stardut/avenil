<p align="center">
  <img src="docs/assets/banner.svg" alt="Avenil — A quiet place for things to run." width="100%" />
</p>

<p align="center">
  A local service workspace for macOS.<br />
  Start services, follow logs, and see what is running — in one place.
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#why-avenil">Why Avenil</a> ·
  <a href="docs/USAGE.md">Guide</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center"><strong>macOS 15+ · Apple Silicon · MIT · Early preview</strong></p>

![Avenil service workspace in light mode, with the log panel expanded](docs/assets/workspace-light.jpg)

<p align="center"><sub>Actual application UI with built-in demo data. The current interface is in Simplified Chinese.</sub></p>

## Why Avenil

A frontend in one terminal. An API in another. A worker you forgot to stop.

Avenil gives those services a place of their own. Save the command and working directory once, arrange services into project groups, and return to a clear view of their state, output, and resource use.

Keep your editor for writing code. Let Avenil handle the everyday work of running it.

## What you can do today

- **Keep services organized.** Group services by project, with an independent working directory and command for each service.
- **Control their lifecycle.** Start, stop, and restart individual services or run group actions. Avenil manages the process groups it creates, including child processes.
- **Follow the output.** Read stdout and stderr together, and keep disk usage bounded with log rotation.
- **See the runtime state.** Inspect process count, CPU, memory, and optional local TCP readiness checks.
- **Bring your IDE configuration.** Preview supported VS Code, Cursor, and JetBrains run configurations before adding them to a new group.
- **Keep configuration local.** Save service definitions on your Mac. Export a shareable configuration with environment values removed.
- **Make it comfortable.** Use light, dark, or system appearance, with native macOS window controls.

<details>
<summary>See dark mode</summary>

![Avenil service workspace in dark mode](docs/assets/workspace-dark.jpg)

</details>

## Get started

Avenil is an early preview. The supported starting point is a local source build; signed and notarized downloads are a future release milestone.

### Requirements

- macOS 15 or later on Apple Silicon.
- Xcode Command Line Tools.
- Rust stable and Cargo.
- Node.js **20.19+ on the 20.x line, or 22.12+**, with npm. These are the requirements of the included Vite version.

### Run the desktop app

From the repository root:

```bash
npm ci
npm run tauri dev
```

### Add your first service

1. Click **添加服务** (Add service).
2. Give it a name and select its working directory.
3. Enter the command you normally run, such as `npm run dev`, `mvn spring-boot:run`, or `python3 -m http.server 8000`.
4. Optionally set a port for readiness checks and a URL to open in your browser.
5. Save, then click **启动** (Start). Expand the service to inspect its output.

Use commands that stay in the foreground. Group actions do not imply dependency ordering.

Already have IDE run configurations? Click **从 IDE 导入** (Import from IDE), choose the project root, and review the supported entries before importing. [Supported formats and limits →](docs/USAGE.md#ide-import)

### Try the interface in a browser

```bash
npm run dev
```

Open **http://127.0.0.1:1420/?preview=1** for an interactive demo. Demo changes stay in memory and reset on reload. The browser preview does not read local project files or manage real processes.

### Build a macOS app

```bash
npm run tauri build
```

The default build produces `src-tauri/target/release/bundle/macos/Avenil.app`. Local builds are not developer-signed or notarized.

## How it behaves

| Area | Current behavior |
| --- | --- |
| Process ownership | Manages only the process groups Avenil starts. Existing processes and system daemons remain outside its control. |
| Commands | Executes the configured shell, arguments, command, and working directory. The default shell is `/bin/zsh -lc`. |
| Readiness | An optional port checks TCP connectivity to `127.0.0.1`, with a 30-second startup deadline. This is not an HTTP health check. |
| Environment | Configured values override the app's inherited environment. `.env` files are not loaded automatically. |
| Configuration | Stored locally as JSON. Environment values are **not encrypted at rest**; exports remove all values. |
| Closing the window | Hides the window. Explicitly quitting stops managed services; a failed shutdown keeps the app available. |

See the [usage guide](docs/USAGE.md) for configuration storage, logging, import rules, and troubleshooting.

## Direction

The focus is a dependable, approachable home for local services. These are proposed next milestones, not shipped features or release commitments:

- [ ] Signed and notarized macOS releases, with a repeatable release process.
- [ ] An English interface and a maintainable localization structure.
- [ ] Better first-run guidance and actionable startup errors.
- [ ] Broader IDE import coverage, driven by reproducible examples.

The current scope is **local foreground services on macOS**. Remote hosts, container management, debuggers, and dependency orchestration are outside this release.

## Contributing

Useful contributions begin with a real workflow: an import that cannot be translated, an unclear error, or a service that is awkward to run. Reproduction steps, small fixes, documentation improvements, and design feedback are welcome.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, project structure, and validation. If Avenil makes your local workflow easier, a star helps others discover it.

## License and credits

Avenil is released under the [MIT License](LICENSE).

Built with Tauri, Rust, React, and Vite. Adapted beUI components retain their [MIT notice](THIRD_PARTY_LICENSES/beui-MIT.txt). Bundled Geist and Audit Rounded fonts retain their [respective](src/assets/fonts/LICENSE.txt) [OFL notices](src/assets/fonts/audit-rounded-OFL.txt). Dependency and font licenses continue to apply to their respective components.
