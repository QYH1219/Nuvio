# Changelog

All notable changes to this project are documented here.

## [0.4.1] - 2026-11-04

### Added

- `.nuvio.zip` wallpaper bundles: `npm run bundle -- export` packages the
  active wallpaper, scene/mask files, library entries and panel config into a
  single portable file; `npm run bundle -- import <file>` restores it and
  applies the config through the resident injector.
- Portable release package: `npm run pack` produces
  `dist/nuvio-<version>-portable.zip` with no `npm install` required.
- Login autostart without administrator rights:
  `npm run autostart -- enable|disable|status`.
- Version number in the HUD/panel plus a silent update check on startup
  (disable with `NUVIO_NO_UPDATE_CHECK=1`).
- GitHub Actions release workflow: pushing a `v*` tag builds, tests, packs and
  publishes the portable zip.
- Injector control endpoints `GET/POST /config` and `POST /reload`, used by
  bundle import and external tooling.
- The resident injector now polls for a Codex target every 2.5 s and
  reconnects/re-registers automatically after Codex restarts.

### Changed

- `npm start` no longer restarts a running Codex by default. It asks first;
  `--yes` accepts, `--restart` restarts automatically, `--no-restart` keeps
  the current window.
- The resident injector is detached and hidden by default. Use
  `--foreground` for the old attached console.
- `npm run restore` backs up the current config to
  `.nuvio/backups/config-<timestamp>.json` before clearing it.

### Fixed

- `npm run doctor` could pick the spotlight/other page instead of the Codex
  window; target selection now uses the shared score function.
- Orphan launcher windows are cleaned up safely, and a lock file prevents
  duplicate injectors.
- Remaining `codex-dynamic-bg` strings in user-facing `use` / `wallpaper`
  output now say Nuvio.

## [0.4.0] - 2026-11-04

### Added

- **Nuvio** brand. The project is now called Nuvio; internal storage keys,
  wallpaper paths and the config format are unchanged, so existing setups keep
  working after the upgrade.
- A single desktop shortcut (`Nuvio.lnk`) that starts Codex when needed,
  restarts it once if the debugging port is missing, and then injects.
- Automatic reuse of an already resident injector: launching the shortcut again
  does not start duplicate asset or control servers.
- `--force` to replace the resident injector with a fresh one.
- Real-environment NestWave screenshot in the docs, with the original artwork
  credited to 小涂真纪-.

### Changed

- `start.cmd` now handles a running Codex without a CDP port by restarting it
  once instead of failing.
- The launcher window opens minimized; the taskbar button still shows the log.
- README shortcut section rewritten around the single shortcut.
- Log prefix changed from `[cxd]` to `[nuvio]`.

### Fixed

- Repeated shortcut launches no longer start duplicate asset/control servers.
- Codex PID detection no longer depends on localized `tasklist` filter output.
- Legacy `Codex 动态背景` shortcuts are removed automatically so the desktop
  keeps exactly one entry.

## [0.3.0] - 2026-11-04

### Added

- Wallpaper Engine local workshop scanner: detects wallpapers already
  downloaded under `steamapps/workshop/content/431960`, with type, title,
  preview, and size metadata.
- Local wallpaper library under `public/assets/library/<id>/`, plus
  `public/assets/active.json` as the single source of truth for the currently
  applied wallpaper.
- "创意工坊" section in the settings panel: preview cards, one-click import,
  apply, delete, and progress for video/scene conversion.
- `npm run workshop` and `npm run library` CLI helpers.
- Fill modes `auto` / `cover` / `stretch` for images, videos, and scene
  wallpapers. `stretch` samples the full artwork without cropping.
- Quality tiers `saver` / `balanced` / `high`, automatic downgrade on sustained
  low frame rate, and idle pause for static wallpapers.
- Four-section compact settings panel: 壁纸 / 外观 / 性能 / 高级.

### Changed

- Default quality is `saver`; the rendered UI stays responsive on integrated
  GPUs and while Codex is busy.
- Theme and readability preset controls are removed from the panel. Picking a
  wallpaper now owns the palette; the values remain available for the
  procedural fallback and existing configs.
- 30 FPS tiers use timer scheduling instead of an unconditional rAF loop.
- Artwork mode releases PMREM, lights, particles, and the composer, then
  re-creates them lazily when switching back to a procedural/high tier.

### Fixed

- Workshop preview images were never rendered because the panel checked
  `entry.preview` instead of `entry.hasPreview`.
- Switching from `saver` to `high` after startup left particles and Bloom
  missing permanently.
- `active.json` could lose to stale built-in candidate wallpaper files, so the
  last wallpaper chosen in the panel was not the one that loaded.
- The white seam above the chat area in wallpaper mode.

## [0.2.0] - 2026-11-04

### Added

- Wallpaper Engine scene wallpaper import (`shake` and `foliagesway` effects).
- Wallpaper Engine video wallpaper import and current-wallpaper detection.
- Local asset library backed by IndexedDB, with image / video / GLB slots.
- Wallpaper mode: transparent Codex chrome, hidden theme selector, automatic
  readability preset.
- Restore, doctor, shortcut, restart, and start helper tools.
- Build and GitHub Pages workflows.

### Fixed

- Scene wallpapers now use `fit: "stretch"` so the full artwork fills the
  window without cropping.
- The renderer now receives CSS viewport dimensions instead of DPR-scaled
  dimensions, fixing the "only the top-left of the wallpaper" bug.
- Hide Codex's `_MainContentTopFade_` overlay in wallpaper mode, removing the
  white line above the chat area.

### Security

- Build outputs strip user artwork from `dist/` and `dist-embed/` unless
  `CXD_ALLOW_PRIVATE_ASSETS=1` is set.
- CI verifies that no file under `public/assets/` (other than its README)
  reaches a published artifact.

## [0.1.0]

- Initial public release: procedural WebGL background, themes, readability
  presets, Tripo GLB loading, and Codex injection via CDP.
