# Contributing to Avenil

Thanks for helping make local service management simpler. A useful contribution can be a reproducible bug report, a clearer explanation, an IDE configuration example, a design improvement, or a focused code change.

## Start with the workflow

For a bug, include:

- macOS version, hardware architecture, and Avenil version or source revision.
- The smallest command and configuration that reproduce the problem.
- Expected behavior, actual behavior, and relevant log excerpts.

Remove credentials, private paths, and environment values before sharing. IDE import reports are most useful with a minimal sanitized configuration and its expected foreground command.

For a substantial feature or architectural change, describe the user problem and proposed scope before implementation. Current focus: local foreground services on macOS. The [README](README.md#scope-and-direction) lists proposed next milestones.

## Development

Use macOS 15+ on Apple Silicon, Xcode Command Line Tools, Rust stable, and a Node version supported by `package.json`.

```bash
npm ci
npm run tauri dev
```

For interface work, `npm run dev` serves a browser preview at `http://127.0.0.1:1420/?preview=1`. Its data is synthetic and resets on reload. Use the desktop runtime to validate actual process behavior.

## Project map

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Service workspace and user actions. |
| `src/api.ts` | Tauri bridge and isolated browser demo. |
| `src/IdeImportDialog.tsx` | IDE import preview and selection. |
| `src/components/` | Shared interface components and branding. |
| `src-tauri/src/process.rs` | Process lifecycle and process group ownership. |
| `src-tauri/src/config.rs` | Local persistence, validation, import, and export. |
| `src-tauri/src/ide_import/` | VS Code and JetBrains configuration parsers. |
| `src-tauri/src/logs.rs` | Bounded logs, cursors, and disk rotation. |
| `src-tauri/src/resources.rs` | macOS process resource sampling. |
| `public/brand/mark.svg` | Shared vector mark used by the UI and generated brand assets. |

## Validate your change

```bash
npm run build
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

For interface changes, check light and dark appearance, keyboard focus, and the minimum 900 × 600 window size. For lifecycle, import, or persistence changes, reproduce the affected workflow in the desktop app and describe what you observed. Add targeted tests when the behavior needs automated regression coverage.

Keep changes focused. Reuse existing components, preserve meaningful errors, and avoid silently guessing a different shell, command, or environment. Update the English and Chinese READMEs together when their shared product information changes.

For brand changes, edit the vector source and run:

```bash
npm run brand:generate
```

See [brand notes](docs/BRAND.md) for outputs and the compatibility boundary. Screenshots in the README must show the actual app with synthetic or sanitized data.

## Pull requests

Explain the user-visible problem, resulting behavior, and how you validated it. Include before/after screenshots for visible changes. Identify any platform or runtime behavior you could not verify.

Avenil's original code is MIT-licensed. Keep existing third-party copyright and license notices with the components they cover.
