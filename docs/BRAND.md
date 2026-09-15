# Avenil brand

**Avenil** is the product name. Use this capitalization in prose and `avenil` for package and executable names. Do not spell it as AveNil or AVENIL in normal interface copy.

**Tagline:** A quiet place for things to run.

**Descriptor:** A local service workspace for macOS.

The mark is an arch sheltering a point of light: a calm place for running services. Its outline also loosely suggests the initial A. Keep it still and legible; the brand mark is not a live service-status indicator.

## Assets

| Asset | Purpose |
| --- | --- |
| `public/brand/mark.svg` | Canonical monochrome geometry, used directly as the interface mask. |
| `public/brand/favicon.svg` | Small web icon. |
| `docs/assets/app-icon.svg` | Editable composition for the macOS icon. Generated from the mark. |
| `src-tauri/icons/icon.png` | Raster application icon. |
| `src-tauri/icons/icon.icns` | Multi-resolution macOS icon. |
| `docs/assets/banner.svg` | README header with wordmark and tagline. |
| `docs/assets/workspace-light.jpg` | Actual light-mode browser demo screenshot. |
| `docs/assets/workspace-dark.jpg` | Actual dark-mode browser demo screenshot. |

Primary colors: forest `#183b32`, mint `#c7f0d8`, and warm white `#edf8ee`. The desktop icon uses a restrained forest gradient. The interface mark uses a flat background for small-size clarity in either theme.

Edit `public/brand/mark.svg` to change the geometry. Edit `scripts/generate-brand.mjs` for composition, wordmark, or palette changes, then run `npm run brand:generate`. The script uses the installed Tauri CLI and copies only the macOS assets into the app. Generated assets belong in version control. No image-generation service is required.

## Existing installations

The previous product name was RunDock. To keep existing data available, this rebrand deliberately preserves:

- Tauri application identifier: `com.rundock.desktop`.
- Local configuration filename: `rundock.json`.
- Theme preference key: `rundock.theme-mode`.

These identifiers do not appear as the public brand. Avenil uses the existing storage location directly, without copying or renaming user files. Do not launch the old and new applications simultaneously: they share that configuration directory.

Public app and window names, package and executable names, interface copy, export download names, and the private frontend/backend event namespace use Avenil. Frontend and backend event names must change together.

The development folder is named `avenil`, matching the product and package names. Historical acceptance reports describe the build evaluated at the time and may retain the former name.
