# Avenil — Native macOS Local Development Service Manager

Avenil is a native macOS app for running and monitoring local development services. Group your dev servers, start and stop them together, inspect logs and resource usage, check local ports, and import run configurations from VS Code, Cursor, and JetBrains.

<p align="center">
  <img src="docs/assets/banner.svg" alt="Avenil, a native macOS local development service manager" width="100%" />
</p>

<p align="center">
  A quiet place for things to run.<br />
  Keep local services organized and see what is running — in one place.
</p>

<p align="center">
  <a href="https://github.com/stardut/avenil/releases/latest">Download latest</a> ·
  <a href="#download-and-run">Download and run</a> ·
  <a href="#what-you-can-do-today">What you can do</a> ·
  <a href="docs/USAGE.md">Guide</a> ·
  <a href="#for-contributors">Contribute</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center"><strong>macOS 15+ · Apple Silicon · Early preview · MIT License</strong></p>

![Avenil service workspace in light mode with grouped local services](docs/assets/workspace-light.jpg)

<p align="center"><sub>Actual application UI with built-in demo data. The current interface is in Simplified Chinese.</sub></p>

## Download and run

Avenil is available as a ready-to-use macOS DMG. [Download the latest release](https://github.com/stardut/avenil/releases/latest), open it, and drag **Avenil** to **Applications**. The release app runs without Node.js, Rust, or Xcode.

Current preview releases use an ad-hoc signature, so macOS may require you to approve the first launch in **System Settings → Privacy & Security**.

For a guided walkthrough, see [how to manage local development services on macOS](docs/guides/manage-local-development-services-on-macos.md), [how to import IDE run configurations](docs/guides/import-ide-cursor-jetbrains-run-configurations.md), and [examples for common local services](docs/guides/run-common-local-services.md).

## Who Avenil is for

Avenil is for developers who run several foreground services during local development: a frontend, an API, a worker, a local database proxy, or a test server. It gives those commands a small native workspace without requiring a separate terminal window for every service.

If you are looking for a macOS tool to manage multiple local dev servers, monitor their logs and ports, or keep project services together in the menu bar, Avenil is designed for that workflow.

## Why Avenil

A frontend in one terminal. An API in another. A worker you forgot to stop.

Avenil is a native desktop workspace for those services. Save each command and working directory once, arrange services into project groups, and return to a clear view of their state, output, and resource use.

Keep your editor for writing code. Let Avenil handle the everyday work of running it.

## What you can do today

- **Keep services organized.** Group services by project, with an independent working directory and command for each service.
- **Control their lifecycle.** Start, stop, and restart individual services or run group actions. Avenil manages the process groups it creates, including child processes.
- **Follow the output.** Read stdout and stderr together, and keep disk usage bounded with log rotation.
- **See the runtime state.** Inspect process count, CPU, memory, and optional local TCP readiness checks.
- **Bring your IDE configuration.** Preview supported VS Code, Cursor, and JetBrains run configurations before adding them to a new group.
- **Control it from an agent-friendly CLI.** Use the same service, group, configuration, log, and resource actions from a shell or AI agent while the desktop app remains the single process owner.
- **Keep configuration local.** Save service definitions on your Mac. Export a shareable configuration with environment values preserved as configured.
- **Make it comfortable.** Use light, dark, or system appearance, with native macOS window controls.

<details>
<summary>See dark mode</summary>

![Avenil service workspace in dark mode with grouped local services](docs/assets/workspace-dark.jpg)

</details>

## Add your first service

1. Click **添加服务** (Add service).
2. Give it a name and select its working directory.
3. Enter the command you normally run, such as `npm run dev`, `mvn spring-boot:run`, or `python3 -m http.server 8000`.
4. Optionally set a port for readiness checks and a URL to open in your browser.
5. Save, then click **启动** (Start). Expand the service to inspect its output.

Use commands that stay in the foreground. Group actions do not imply dependency ordering.

Already have IDE run configurations? Click **从 IDE 导入** (Import from IDE), choose the project root, and review the supported entries before importing. [Supported formats and limits →](docs/USAGE.md#ide-import)

## Use the CLI

The desktop app exposes a local Unix socket for the CLI. Keep Avenil open (closing the window only hides it), then run commands against the same runtime that the interface displays:

```bash
# From a source checkout
npm run cli -- status --json
npm run cli -- start "订单 API"
npm run cli -- logs "订单 API" --limit 100
npm run cli -- logs "订单 API" --search "ERROR" --limit 100
npm run cli -- group restart "电商本地环境"

# With an installed app, choose "Install CLI" on first launch
avenil status --json
```

Service and group selectors accept either UUIDs or exact names. Use `--json` for automation. Configuration replacement, service/group deletion, and quitting require an explicit `--yes`; configuration export preserves environment variable values. Run `avenil help` (or `avenil --help`) for the complete command list. The socket is local to the current Mac and is not a remote-control or network API.

`logs` reads the service's retained in-memory and active/rotated disk logs. `--search TEXT` performs a case-sensitive literal match against log text across both stores; `--after-seq` and `--limit` remain available for cursor-based reads and bounded output.

On first launch, Avenil can install a per-user `~/.local/bin/avenil` link without changing system directories. The same action and the exact commands for adding `~/.local/bin` to `~/.zprofile` are available later in **Settings → CLI**. Open a new terminal, or source the displayed profile command, after changing PATH.

Pass environment values directly with `--env KEY=VALUE`; configured values are stored and exported as entered.

## How it behaves

| Area | Current behavior |
| --- | --- |
| Process ownership | Manages only the process groups Avenil starts. Existing processes and system daemons remain outside its control. |
| Commands | Executes the configured shell, arguments, command, and working directory. The default shell is `/bin/zsh -lc`. |
| Readiness | An optional port checks TCP connectivity to `127.0.0.1`, with a 30-second startup deadline. This is not an HTTP health check. |
| Environment | Configured values override the app's inherited environment. `.env` files are not loaded automatically. |
| Configuration | Stored locally as JSON. Environment values are **not encrypted at rest**; exports preserve configured values. |
| Closing the window | Hides the window and keeps Avenil in the macOS menu bar. Choosing Quit from the tray menu asks for confirmation, then stops managed services; a failed shutdown keeps the app available. |

See the [usage guide](docs/USAGE.md) for configuration storage, logging, import rules, and troubleshooting.

## Scope and direction

The focus is a dependable, approachable home for local services. These are proposed next milestones, not shipped features or release commitments:

- [x] Repeatable Apple Silicon DMG releases triggered by version tags.
- [ ] Developer ID signed and notarized macOS releases.
- [ ] An English interface and a maintainable localization structure.
- [ ] Better first-run guidance and actionable startup errors.
- [ ] Broader IDE import coverage, driven by reproducible examples.

The current scope is **local foreground services on macOS**. Avenil is not a remote host manager, container manager, debugger, or dependency orchestrator. Remote hosts, container management, debuggers, and dependency orchestration are outside this release.

## For contributors

Avenil is open source under the [MIT License](LICENSE). Useful contributions begin with a real workflow: an import that cannot be translated, an unclear error, or a service that is awkward to run. Reproduction steps, small fixes, documentation improvements, and design feedback are welcome.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, project structure, and validation. If Avenil makes your local workflow easier, a star helps others discover it.

<details>
<summary>Run, preview, build, or publish from source</summary>

To develop Avenil itself, use macOS 15 or later on Apple Silicon, Xcode Command Line Tools, Rust stable and Cargo, and Node.js **20.19+ on the 20.x line, or 22.12+**, with npm.

From the repository root:

```bash
npm ci
npm run tauri dev
```

For an interface-only browser preview, run `npm run dev` and open **http://127.0.0.1:1420/?preview=1**. It uses synthetic in-memory data and does not read local project files or manage real processes.

To build a macOS DMG locally:

```bash
npm run tauri build
```

The default output is under `src-tauri/target/release/bundle/dmg/`. Local builds use an ad-hoc signature and are not Developer ID signed or notarized.

To publish a release, create and push an annotated tag for the intended version. Business commits do not need to update version files in advance: the tag is the release version, and the workflow synchronizes that version in its temporary CI workspace before building. The repository currently uses tags without a `v` prefix:

```bash
git tag -a 0.2.0 -m "Avenil 0.2.0 release"
git push origin 0.2.0
```

The `Release macOS app` workflow reads the tag, synchronizes `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` in the temporary checkout, builds the Apple Silicon DMG, publishes it to that tag's GitHub Release, and verifies that the Release contains a `.dmg` asset. It can also be run manually from the Actions page with an existing tag to recover or republish a release. Developer ID signing and Apple notarization remain future release work.

</details>

## License and credits

Built with Tauri, Rust, React, and Vite. Adapted beUI components retain their [MIT notice](THIRD_PARTY_LICENSES/beui-MIT.txt). Bundled Geist and Audit Rounded fonts retain their [respective](src/assets/fonts/LICENSE.txt) [OFL notices](src/assets/fonts/audit-rounded-OFL.txt). Dependency and font licenses continue to apply to their respective components.
