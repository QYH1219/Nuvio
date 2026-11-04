# Changelog

All notable changes to this project are documented here.

## [0.6.0] - 2026-11-04

### Added

- Current-wallpaper identity card at the top of the Wallpaper section: 54 px
  thumbnail, title, and source badge (`本地文件` / `创意工坊` / `项目素材` /
  `程序化`). Workshop cards use the real preview image; failed thumbnails fall
  back to the gradient tile.
- Workshop favorites: `☆` / `★` on every card, a `★ 收藏` filter, and a
  persisted `favoriteIds` list (validated, deduplicated, capped at 200).
- Wallpaper rotation (`rotationEnabled`, `rotationMinutes`). The pool prefers
  favorites and otherwise cycles through imported video/scene wallpapers.
  Rotation starts disabled, never replaces the current wallpaper immediately,
  and resets its timer after a manual switch or config change. Fewer than two
  usable entries means no rotation.
- Low-end GPU auto cap: software rasterizers and older integrated GPUs are
  detected and capped at 24 FPS without touching DPR, framing, Bloom, or
  particles. Can be disabled with `低端 GPU 自动限帧`.
- Scene texture diagnostics: missing mask/normal/phase textures and skipped
  `waterripple` / `waterflow` stages are reported in the panel instead of
  silently producing a flat scene.
- Manual update check in the System section. Nuvio still makes no network
  request on startup; only clicking `检查更新` calls the GitHub Releases API
  (through the local injector when available, with a 10-minute cache). The
  result distinguishes up-to-date, update available, and an explicit error.

### Changed

- New panel text uses the 11 px minimum instead of 8.5–10 px badges.
- README documents the current-wallpaper card, favorites/rotation, low-end GPU
  cap, texture diagnostics, manual update check, and the remaining limits.

### Known limitations

- GLB models accept KTX2 textures, but scene wallpaper PNGs are not
  automatically transcoded to KTX2.
- Nuvio paints a single background layer inside the Codex window. It does not
  replace the Windows desktop wallpaper and cannot assign different wallpapers
  to separate monitors.

## [0.5.2] - 2026-11-04

### Fixed

- Quality tiers no longer change framing. `screenUv` was derived from
  `gl_FragCoord / CSS size`, so raising the pixel ratio pushed the UV ceiling
  to 1.25 / 1.5 and the wallpaper looked zoomed and cropped. The material now
  uses `renderer.getDrawingBufferSize()`, and all three tiers clamp to 1.0.
  Switching saver → balanced → high is now a sampling/frame-rate change only.
- `applyQuality()` no longer touches Bloom, particles, MSAA, or `fit`. MSAA is
  off on every tier because the background is a single full-screen quad.
- WebGL creation failure keeps the host element and paints a CSS gradient
  fallback instead of removing the root and leaving a black window.

### Added

- Texture budget in `src/texture.js`: 4096 px long edge for wallpaper base
  textures, 2048 px for mask/normal/phase effect maps, proportional
  downscaling with original/upload size recorded in `texture.userData.nuvio`.
- Runtime diagnostics panel: FPS, tier, drawing-buffer size, texture count and
  estimated VRAM, draw calls, programs, triangles, context-loss state.
- `pauseWhenUnfocused` (default on): the render loop stops while the Codex
  window is unfocused and resumes on focus.
- WebGL context lost/restored handling: stop the loop, mark textures dirty on
  restore, re-upload, resize, and wake without restarting Codex.
- Settings panel polish: collapsible sections (Advanced starts collapsed),
  per-section `↺` reset, export/import moved into a `⋯` menu, 11 px text floor,
  and `auto / cover / contain / stretch` fill labels.

### Changed

- README documents the real quality-tier behavior, the fourth fill mode, the
  five-section panel, the texture budget, and the new diagnostics/pause paths.
- `test/texture.test.mjs` covers downscaling, the 4096/2048 caps, no-upscale,
  byte accounting, and multi-texture summaries.

## [0.5.1] - 2026-11-04

### Fixed

- The resident injector no longer exits when Codex briefly reports zero page
  targets during a renderer restart. It waits for a real `app://` window and
  reattaches automatically, so the saved wallpaper survives Codex updates and
  reloads.
- `npm start -- --force` refuses to stop a healthy injector while Codex has no
  page window, preventing a restart race from wiping the background.
- Injector startup retries once and releases a stale lock after failure.
- `tools/cdp.mjs` now bounds every CDP request with a timeout and retries
  screenshots with a lower-cost capture path instead of hanging forever.

## [0.5.0] - 2026-11-04

### Added

- Wallpaper Engine `web` wallpapers: the whole project folder is copied into
  `public/assets/library/<id>/web/` and rendered in a sandboxed, click-through
  iframe above the WebGL canvas. Single-file HTML wallpapers with inline data
  URIs work without any transcoding.
- Cached lazy runtime: the resident injector serves the injection bundle from
  `/bundle.js` (gzip + ETag + 304) and evaluates a tiny loader, so reloads no
  longer push the ~800 KB IIFE through CDP every time. `--lazy` / `--full`
  force a mode; the injector falls back to the inline bundle automatically if
  the local server is unreachable.
- `npm run size` reports raw and gzip sizes for the embedded runtime.
- `npm run sign` optionally signs the release zip with `signtool` when
  `NUVIO_SIGN_CERT` is configured. It never fabricates a signature.
- `start.sh` for macOS/Linux preview and injection (experimental). The Windows
  path is unchanged. The portable build runs the prebuilt bundle directly, so
  it does not need `npm install` or `node_modules`.
- `tools/launch-codex.sh` is now shipped with the repository and release zip.
  It auto-detects common Codex executable names and honors `CODEX_BIN` for a
  custom install path.
- Autostart is now exercised by the test checklist: `npm run autostart --
  status|enable|disable` writes a single login shortcut and never creates a
  second desktop shortcut.
- Autostart is also available in the settings panel (系统 → 登录时自动恢复壁纸).
  The panel and the CLI share `tools/autostart.mjs`, so both write only
  `Startup\Nuvio.lnk`.
- Shader preview harness: `shader-preview.html` + `src/shader-preview.js`
  render a single Wallpaper Engine effect with live uniforms for comparison
  against the original scene. The private preview fixture is stripped from
  release bundles.
- Wallpaper Engine water effects: `waterwaves`, `waterripple` and `waterflow`
  now run through the same effect graph as the desktop renderer.
- `sceneWater` config value so water effects can be scaled or disabled from the
  panel without touching the rest of the scene animation.

### Fixed

- Wallpaper Engine `web` entries were still disabled in the settings panel even
  though the backend already imported and applied them. The button now works
  and shows the sandboxed rendering hint.
- `waterwaves`, `waterripple` and `waterflow` reproduce the WE shader math:
  masks are sampled in UV space (`maskScale = 1`), effects run in the original
  `effects` array order, `foliagesway` uses its mask as amplitude, and water UVs
  are no longer clamped at the entry point.
- `waterflow` no longer re-runs the whole warp chain on every sample.
- `foliagesway` now uses the screen aspect ratio instead of the texture aspect.
- `readActiveManifest()` shadowed `url` inside its `try` block, so the manifest
  fetch threw a TDZ `ReferenceError` that was swallowed by the `catch`. The
  active wallpaper manifest was therefore ignored on every startup.
- Manifest entries are relative to `public/assets`, but they were joined
  against the server root, producing `/library/...` instead of
  `/assets/library/...`. Web and library wallpapers now resolve correctly.
- Web entries no longer get rejected by the SPA-fallback guard that treats
  `text/html` responses as missing files.
- Wallpaper mode now removes Codex's 1px header/thread separator layers so the
  titlebar boundary no longer draws a bright horizontal seam over artwork.
- `README.md` clone instructions now use the real repository name.
- Online demo/homepage links point at `https://qyh1219.github.io/Nuvio/`
  instead of the 404 `QYH1219` project path.

### Changed

- The GLB validator is loaded lazily, so the main injection bundle dropped from
  about 769 KB to about 633 KB (167 KB gzip), with the model chunk (~138 KB)
  fetched only when a model actually exists.

## [0.4.2] - 2026-11-04

### Fixed

- Update check and repository links now point to `QYH1219/Nuvio` after the
  repository rename. The previous URLs returned 404, so 0.4.1 never reported
  a newer release.

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
