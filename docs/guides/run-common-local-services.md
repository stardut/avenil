# Run Common Local Development Services on macOS

[Back to the README](../../README.md) · [Using Avenil](../USAGE.md)

Avenil can run any command that stays in the foreground and can be started from a configured working directory. The examples below cover common Node.js, Python, Java, and Rust development services on macOS.

## Common commands

| Stack | Example command | Typical port |
| --- | --- | ---: |
| npm / Node.js | `npm run dev` | `3000` or `5173` |
| pnpm / Node.js | `pnpm dev` | `3000` or `5173` |
| Python HTTP server | `python3 -m http.server 8000` | `8000` |
| Python application | `python3 app.py` | Project-specific |
| Spring Boot / Maven | `mvn spring-boot:run` | `8080` |
| Rust | `cargo run` | Project-specific |

The command is executed with the configured shell and working directory. The default shell is `/bin/zsh -lc`.

## Configure a service

For each service, provide:

1. A descriptive name, such as `Web`, `API`, or `Worker`.
2. The project directory in which the command should run.
3. The same foreground command you would normally use in a terminal.
4. An optional port for a local TCP readiness check.
5. An optional URL that Avenil can open in a browser.

The readiness port and browser URL have different purposes. The port checks whether a TCP listener is reachable on `127.0.0.1`; the URL is only used when you ask Avenil to open a web address.

## Example project group

```text
Project: Storefront

Web     ~/Code/storefront/web     npm run dev                 port 3000
API     ~/Code/storefront/api     mvn spring-boot:run         port 8080
Worker  ~/Code/storefront/worker  python3 worker.py           no port
```

Start services individually while debugging one component, or use the group action to operate on the project as a whole. Group actions do not infer dependency ordering.

## Keep commands in the foreground

Do not detach the command with `nohup`, `&`, or a process manager inside the service command:

```bash
# Use this
npm run dev

# Do not use this
npm run dev &
```

Avenil manages the process groups it creates, including child processes. Existing processes, system daemons, and services started outside Avenil remain outside its control.

## Environment values

Configured environment values override the environment inherited by the desktop app. Avenil does not load `.env` files automatically. Keep local credentials in environment fields rather than embedding them in command strings, and remember that local environment values are not encrypted at rest.

For IDE-based projects, [import the existing VS Code, Cursor, or JetBrains run configurations](import-ide-cursor-jetbrains-run-configurations.md) instead of recreating each command manually.
