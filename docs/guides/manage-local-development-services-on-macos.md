# Manage Local Development Services on macOS with Avenil

[Back to the README](../../README.md) · [Using Avenil](../USAGE.md)

Avenil is a native macOS local development service manager for developers who run several foreground services at the same time. It keeps frontend servers, APIs, workers, test servers, and other local commands in project groups so you can start, stop, and inspect them from one workspace.

## When Avenil fits

Avenil is a good fit when your daily workflow looks like this:

- A frontend runs with `npm run dev` or `pnpm dev`.
- An API runs from a different directory.
- A worker or background-looking process must stay in the foreground.
- You need to see logs, process state, and local port readiness without switching between several terminal windows.

Avenil manages the process groups it starts. It does not adopt existing processes, replace Docker or a remote host manager, or infer dependency ordering between services.

## Add a project group

1. Open Avenil and choose **Add service** (`添加服务` in the current preview interface).
2. Give the service a name and select its working directory.
3. Enter the command that normally runs the service in a terminal.
4. Optionally configure a local TCP port and a browser URL.
5. Save the service and choose **Start** (`启动`).
6. Expand the service to inspect its combined stdout and stderr output.

Group related services together. A group changes how services are organized and operated; each service still keeps its own working directory and command.

## Example local development stack

| Service | Working directory | Command | Optional port |
| --- | --- | --- | --- |
| Web | `~/Code/example/web` | `npm run dev` | `3000` |
| API | `~/Code/example/api` | `npm run dev` | `4000` |
| Worker | `~/Code/example/worker` | `python3 worker.py` | — |

The port check waits for a TCP listener on `127.0.0.1`. It confirms that something is listening, but it is not an HTTP health check. A service that does not expose a port can still be started and monitored without a readiness check.

## Start, stop, and monitor services

Use individual service actions when you are iterating on one part of a project. Use group actions when you want to start or stop the local stack together. Group actions do not create dependency ordering: if the API must be ready before the frontend starts, configure that workflow explicitly in your commands or start the services in sequence.

While a service is running, Avenil can show:

- Combined standard output and standard error.
- Process count for the managed process group.
- CPU and resident memory usage.
- Optional local TCP readiness state.
- Bounded in-memory and rotated disk logs.

Closing the window hides Avenil in the macOS menu bar. Choosing Quit from the tray menu asks for confirmation and attempts to stop the services Avenil manages.

## Use foreground commands

Keep configured commands in the foreground. Avoid commands that detach themselves:

```bash
# Good
npm run dev

# Avoid
nohup npm run dev &
```

Avenil owns the process groups it creates and can stop their child processes. It does not take ownership of an already-running PID or a system daemon managed by `launchctl`.

## Configuration and privacy

Service definitions are saved locally. Environment values are stored in local JSON and are not encrypted at rest. Exports remove environment values while preserving their key names and secret flags, so re-enter local values after importing an export.

For port checks, IDE import behavior, logs, and storage details, see the [complete usage guide](../USAGE.md).

## Related guides

- [Run common Node, Python, Java, and Rust services](run-common-local-services.md)
- [Import VS Code, Cursor, and JetBrains run configurations](import-ide-cursor-jetbrains-run-configurations.md)
