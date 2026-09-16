# Using Avenil

[Back to the README](../README.md)

Quick guides: [manage local development services](guides/manage-local-development-services-on-macos.md) · [import IDE run configurations](guides/import-ide-cursor-jetbrains-run-configurations.md) · [run common local services](guides/run-common-local-services.md)

Avenil manages local foreground services on macOS. A service is a working directory, a command, a shell specification, and optional environment, port, and URL settings. Groups organize services without changing their working directories.

## Commands and process ownership

The default execution is `/bin/zsh -lc <command>`. Avenil uses the shell program and argument list you configure. Service environment values override the environment inherited by the desktop app; `.env` files are not loaded automatically.

Keep the command in the foreground. Do not use `nohup`, append `&`, or ask the command to detach into a daemon. Avenil manages only the process groups it creates and does not adopt existing PIDs or `launchctl` services.

Stopping sends `SIGTERM` to the process group, followed by `SIGKILL` if the grace period expires. Closing the window hides it and leaves Avenil running in the macOS menu bar. Choosing Quit from the tray menu requires confirmation, then attempts to stop all managed services; shutdown failures leave the app available with an error.

Group actions are a convenience for operating on multiple services. They do not define dependencies or wait for upstream services before starting downstream services.

## Ports and URLs

A port is optional. If supplied:

1. An occupied port prevents startup.
2. After launching the command, Avenil waits up to 30 seconds for a TCP connection to `127.0.0.1` on that port.
3. A timeout cleans up the process group and marks the service as failed.

This proves that a TCP listener is reachable, not that a particular HTTP endpoint is healthy. Without a port, the running state does not verify application readiness.

A service URL is separate from the readiness port. It is used only to open an HTTP(S) address in the browser.

## Configuration and privacy

Service definitions are stored in the Tauri application data directory:

```text
~/Library/Application Support/com.rundock.desktop/rundock.json
```

Avenil was previously named RunDock. The application identifier, configuration filename, and local theme preference key intentionally keep their original names so existing installations retain their configuration, logs, and appearance preference. They are storage identifiers, not the current product name. See [brand notes](BRAND.md#existing-installations).

Configuration writes use a temporary file in the same directory, flush it, and atomically rename it. A failed write preserves the previous configuration.

Service definitions cannot be changed or deleted while the affected service is active. Whole-configuration saves and imports are blocked while any service or operation is active. Importing JSON requires a preview and confirmation.

Environment values are stored in plain JSON. Marking a value as secret masks it in the interface; it does not encrypt the value on disk. Exports remove **all** environment values while preserving key names and secret flags. Re-enter the values after importing an exported configuration.

Commands themselves are included in exports. Keep credentials in environment fields instead of embedding them in command strings.

## IDE import

Choose a project root in **从 IDE 导入**. Avenil looks for:

- `.vscode/launch.json`, parsed as JSONC. This also covers Cursor projects using this format.
- `.idea/runConfigurations/*.xml`.
- `.run/*.xml`.

Each configuration file is limited to 2 MiB. The preview classifies candidates as `ready`, `needsInput`, or `unsupported`. Only ready entries can be selected. Confirming appends a new group and its services; it does not execute the commands or overwrite existing services.

Supported starting points include:

| Configuration | Required information |
| --- | --- |
| VS Code / Cursor `node-terminal` | An explicit runnable command and working directory. |
| VS Code / Cursor `node` / `pwa-node` | An explicit entry point and determinable runtime settings, or an `npm run` script in `runtimeExecutable`/`runtimeArgs`. |
| VS Code Java Spring Boot | `mainClass` and a Maven project declaring `spring-boot-maven-plugin`; imported as `mvn spring-boot:run`. |
| Python launch | An explicit interpreter and entry point. |
| JetBrains Maven / Gradle | Explicit goals or tasks and a working directory. |

Attach configurations, compound launches, unsupported task dependencies, `envFile`, dynamic variables, and unknown extensions are not silently converted. Java entries without a detectable Spring Boot Maven project still cannot determine a classpath, module path, JRE, or build command and require input. A recognized Java `preLaunchTask` is not executed separately because the generated Maven run performs the project compilation itself. Non-empty Java `args` are left for confirmation instead of guessing argument boundaries.

Environment values are redacted in the preview and preserved in the imported service configuration, where the UI masks them.

## Logs and resources

Avenil reads stdout and stderr. In-memory logging and the read channel are bounded. The default in-memory budget is 256 KiB per service; disk logs default to 2 MiB per file with three rotated files, under the application data directory's `logs` folder.

Log events have a sequence number that increases across service restarts. Reads use a cursor; discarded data is reported as truncated.

Resource snapshots report process count, CPU, and resident memory (RSS) for the service's process group. Failed system samples are unavailable, not fabricated as zero.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A command works in a terminal but fails in the app | Confirm the working directory, configured shell, executable availability, and environment inherited by the desktop app. Use an explicit executable path where appropriate. |
| Startup is rejected | Check whether another process is already listening on the configured port. Avenil will not take over that process. |
| Startup times out | Check the logs, the configured port, and whether the server binds to `127.0.0.1` or an address reachable through it. |
| A service exits immediately | Confirm the command remains in the foreground and does not detach. |
| Imported environment values are blank | JSON exports deliberately remove them. Re-enter the values locally. |
| The browser asks for the desktop runtime | Use the desktop app for real processes, or add `?preview=1` to the preview URL for demo data. |
| An IDE entry cannot be imported | Review its missing fields and warnings. Configure the equivalent foreground command manually if needed. |
