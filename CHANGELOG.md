# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- **Offline background guard.** Codex launched outside Nuvio has no debugging
  port, so the layer cannot attach. After 15 seconds with a Codex process alive
  and no CDP listener, the tray tooltip changes to "背景未连接", shows one
  balloon, and double-clicking runs `launch-hidden.vbs --yes`. It never restarts
  the editor on its own; the menu also exposes the action explicitly.

## [0.7.3] - 2026-11-11

### Fixed

- **The tray icon disappeared again after a relaunch.** Three separate races:
  the replacement helper exited instantly while the previous mutex was still
  held; it treated the state file's momentary absence during an injector swap
  as "injector gone"; and nothing restarted it after it died. The helper now
  waits up to 4 seconds for the mutex, tolerates three missing ticks (6s), and
  writes `.nuvio/tray.heartbeat`; the resident injector checks that heartbeat
  (pid included) every 30 seconds and restarts a dead helper. A fresh heartbeat
  whose pid is already gone no longer counts as alive.
- Compile the helper to a content-addressed `nuvio-tray-<build>.exe` and stop
  older helpers before starting the new one. Rebuilding over a running exe
  fails with a sharing violation on Windows, which previously left the upgrade
  with no icon at all.
- **Reattach threw on every Codex restart.** `target` was declared `const` but
  assigned again after a successful reconnect, so the assignment raised
  "Assignment to constant variable"; the empty catch hid it and the next target
  check compared the new page with the old target id. The result was a reload
  loop every few seconds. Declare it mutable and close a half-initialized CDP
  client when a reconnect attempt fails instead of leaking the socket.
- `/status` now carries a content hash of `inject.mjs`; the launcher replaces a
  resident injector whose hash differs even when the semver string is unchanged.
- Take over a stale lock with an atomic rename instead of overwriting it, and
  write the state file with write-then-rename. Exit only deletes a state file
  whose `pid` still matches this process.
- **Two launchers could run at once.** Windows now holds a kernel-owned named
  pipe per checkout for the whole start sequence; the second double-click exits
  with a clear message. Injector probes read `controlPort` from the state file
  before falling back to 5276, accept `Codex.exe` as well as `ChatGPT.exe`, and
  require the full `tools/inject.mjs` path (not `inject.mjs.bak`, not another
  checkout) before stopping a PID.
- Magpie's watch CLI call is bounded (10s per command, capped by the remaining
  watch window) and a per-config named mutex prevents repeated launches from
  stacking reconcilers. A missing `powershell.exe` in `startMagpieWatch` is
  handled instead of crashing the launcher.
- **Magpie coexistence.** Starting Magpie rewrote `~/.codex/config.toml`,
  which switched the Codex model back to Magpie's own default and dropped the
  `ultra` effort from the picker. The launcher now runs
  `tools/compat/magpie-ultra.ps1` before Codex starts: it brings up Magpie's
  local gateway when needed, pins the model and effort through Magpie's own
  CLI, and trims `[desktop].enabled-reasoning-efforts` to
  `ultra`/`high`/`medium`. Machines without Magpie are unaffected.
- Run that preflight in the shared Node launcher so terminal starts and
  restarts receive the same behavior as the hidden shortcut. Include both
  PowerShell dependencies in portable archives; bound the subprocess lifetime.
- Scope effort edits to `[desktop]`, support multiline arrays and inline table
  comments, preserve Unicode/line endings, back up configuration and reject
  detected concurrent edits. Re-read effort after model changes and verify CLI
  success before narrowing the picker. Never log provider CLI output.
- Honor explicit `--no-restart` even with `--yes`, consume `--console` before
  forwarding arguments, and keep Magpie fallback startup hidden.
- Add Windows PowerShell 5.1 fixture tests and a Windows CI job. Document that
  launch-time restoration is not a persistent configuration lock and that token
  usage alone does not establish provider effort fidelity.
- **Ultra survived only until Magpie attached.** `magpie.exe` is a GUI-subsystem
  binary, so `& magpie codex …` returned immediately with `$LASTEXITCODE = $null`
  and the old helper treated every successful call as a failure. Apply the model
  and effort through `Start-Process -Wait -PassThru` and check the real exit
  code. Verify the pin for 10 seconds (early exit after 3 stable seconds) and
  re-pin on drift instead of writing once and hoping.
- Keep a bounded, detached 30-second reconciler alive after launch, because
  Magpie's own autostart rewrites `config.toml` seconds *after* Codex opens.
  It retries at most 8 times and exits by itself. The early-return paths
  ("already running", "no page window yet") arm it too.
- **Zombie injector blocked the next launch.** A resident injector whose
  `/status` reports a different CDP port is now treated as orphaned and stopped
  before Codex restarts, so the replacement no longer dies with
  "another injector is already running" while the launcher reports the dead pid
  as ready.
- A resident injector keeps executing the code it started with, so after an
  update the old process would silently keep every bug it was launched with.
  `/status` now carries the build version and the launcher replaces an injector
  whose version does not match, instead of reporting it as active.
- **Half-open CDP socket never healed.** While the WebSocket still looked open,
  the injector now checks the DevTools target every 8 seconds and reconnects
  after two consecutive misses. Probe failures count as "unknown" and never
  trigger a reconnect, so a slow `/json/list` cannot drop a healthy link.

## [0.7.2] - 2026-11-09

### Added

- **Tray icon.** The injector is a detached process with no window, so Windows
  never gives it a taskbar button — that is correct for a background process
  but left users with no visible proof it was running. `tools/tray/tray.cs` is
  a small Win32 notification-area helper: double-click reloads, right-click
  offers 重新加载背景 / 切换到 Codex / 打开日志 / 恢复并退出（保留壁纸设置）.
  It is compiled on demand with the in-box `csc.exe` into `.nuvio/`, so the
  repository carries no binary; set `NUVIO_NO_TRAY=1` to skip it.
- The icon exits within two seconds once the injector dies or the state file is
  removed, and re-adds itself on Explorer's `TaskbarCreated` broadcast.
- On Windows 11 the icon marks itself promoted once, so a new install does not
  start buried in the overflow flyout.

### Notes

- No taskbar button is added. A button requires a real window, and a resident
  window would cost more than the whole tray helper.

## [0.7.1] - 2026-11-08

### Fixed

- **Baked scenes are no longer upside down.** Baked scene material sampled
  `PlaneGeometry`'s bottom-left UVs while scene textures are uploaded with
  `flipY = false` (Wallpaper Engine stores them top-left first). The lite
  shader now flips V once, so a baked wallpaper matches the full shader and the
  source artwork exactly.
- **Wallpaper no longer looks muddy or over-darkened.** Automatic readability
  stopped over-dimming: `dim` now tops out at 0.28 and typically lands near
  0.04, and panel frost lands near 0.15 instead of 0.27.
- **Panel frost follows the host theme.** The shell tint was hardcoded to a
  near-black scrim, which turned a light Codex theme into grey-on-grey with
  unreadable text. Frost is now white on light themes and near-black on dark
  themes, with the same alpha on the main pane and the sidebar.
- **No pale seam at the main/sidebar boundary.** The nested focus-area wrapper
  no longer composites the frost twice, and Codex's 0.667px dark left border on
  `<main>` is removed instead of left to outline the transparent pane.
- **No first-frame dark flash on light themes.** The injected bootstrap seeded
  `--cxd-ui-surface` with a dark value before `mount.js` ran; it now reads
  `data-theme` and seeds the matching shade.

## [0.7.0] - 2026-11-08

### Added

- **Automatic workshop indexing.** The panel no longer has a scan button. The
  injector warms the Wallpaper Engine cache on startup, watches
  `steamapps/workshop/content/431960` on every Steam library, and invalidates
  the cache as soon as Steam finishes a download. The list polls a cheap
  `scannedAt` stamp every 15s, so a new subscription shows up on its own.
- **Baked scene wallpapers.** Scene art now plays through a single-pass lite
  material: one artwork texture, at most two amplitude masks, sine
  displacement, parallax and the same fit/letterbox math. Normal and phase maps
  are skipped entirely, which drops the typical scene from five textures to
  three and removes the per-pass shader cost. Scenes without any mask fall back
  to the full shader, now loading its textures only in that case.
- **Automatic readability.** The wallpaper is sampled once on a 32×32 offscreen
  canvas (luminance, edge density, contrast) and the result drives background
  dim and panel frost. Hysteresis keeps sampling noise from rewriting the
  config, and re-enabling the switch re-samples the artwork already on screen.
  The manual dim/frost sliders are gone from the panel.
- **One motion preset.** `off` / `light` / `standard` replaces the motion and
  parallax sliders. `applyDerived()` expands the preset (and the power-saver
  switch) into the legacy keys the renderer still reads.

### Changed

- **Panel reduced from 30 controls to 12**, grouped into 壁纸 / 外观 / 性能 /
  系统. Theme, vignette, bloom, grain, particles, scene sway/water/shake, model
  placement and config import/export are no longer sliders; the values still
  exist in the config and are still honoured by the renderer.
- Wallpaper fitting is now `拉伸铺满` (default) or `完整留边`, so a wallpaper is
  never cropped by default.
- Workshop cache TTL 45s → 8s.

### Fixed

- Baking a scene that has no mask no longer drops its water/normal effects: the
  full shader now loads normal and phase maps in that fallback path.

## [0.6.5] - 2026-11-07

### Added

- **One-click update apply.** The panel can now download the portable release,
  verify its SHA-256 digest, unpack it, replace the local files, and re-inject
  the new bundle without a manual reinstall. Locked files (only `runtime/node.exe`
  in practice) are reported instead of aborting the update.
- **Portable Node runtime.** Release builds bundle `runtime/node.exe`, and
  `start.cmd` / `restart.cmd` prefer it over a system Node install, so the ZIP
  runs on a machine that has never installed Node.
- **`npm run doctor -- --memory`.** Samples the resident injector for 30s and
  reports RSS/heap growth as a leak regression check.
- **Copy diagnostics.** The advanced panel can copy version, FPS/tier, GPU,
  buffer size, texture cost, compatibility gaps and missing textures in one
  click, instead of asking users to retype the panel.
- Windows code-signing steps are documented for the optional Authenticode path
  (`NUVIO_SIGN_CERT`); unsigned portable ZIPs remain the default.

### Fixed

- **Performance governor no longer over-downgrades.** It now waits through a
  3s warm-up, compares the 95th-percentile frame time in a rolling window, and
  scales the failure line to the tier's own target (`target × 0.6`). A 30 FPS
  tier running at 24–26 FPS stays put; a genuinely struggling high tier still
  steps down once.
- **Control port hardening.** `127.0.0.1:5276` no longer answers arbitrary
  websites with `Access-Control-Allow-Origin: *`. Only the Codex renderer and
  the local preview origin get CORS headers, and `/status` rejects untrusted
  origins while still allowing native tools that send no `Origin`.
- **Compatibility probe covers 10 surfaces.** Shell, sidebar and composer stay
  required; page surface, transcript, dialog, feature navigation, portal and
  toast are reported separately. When a required selector disappears, a
  geometry/opacity heuristic marks the painted rectangle and the wallpaper CSS
  neutralises only its paint, so an upstream rename shows a badge instead of a
  white slab.
- **Web wallpapers stop rendering off-screen.** A web wallpaper iframe is
  hidden on tab hide / window blur, which lets Chromium stop its rAF loop
  instead of burning GPU behind Codex.
- **High tier DPR is capped at 2×.** 3× retina buffers tripled fragment cost
  for a wallpaper behind a blurred UI and were the main cause of dropped frames
  on laptops.
- The grain slider is now only shown for procedural backgrounds, where it
  actually has an effect.

## [0.6.4] - 2026-11-06

### Fixed

- Settings, archived chats and other utility routes no longer paint an opaque
  surface sheet over the wallpaper. The route sheet and its `rounded-2xl`
  cards now inherit the same frosted tint as the rest of the shell, so the
  artwork stays visible across the whole page.
- Sticky page headers on settings sub-pages (plugins, skills, integrations)
  painted a solid white `::before` band that cut the wallpaper in half. The
  band now uses the panel tint instead.
- Video wallpapers now pause when Codex is hidden or unfocused, and resume on
  return. The element kept decoding frames even after the render loop was
  cancelled, which wasted GPU time in the background.
- The refused-autoplay retry listeners are dropped as soon as a wallpaper is
  replaced, so an old video can no longer start playing after a later click.
- Local video and Wallpaper Engine scene imports now show a first-frame
  thumbnail in the current-wallpaper card instead of a blank slot.
- Asset imports report stage progress and can be cancelled. Cancelling after
  the record was written rolls back to the previous asset instead of leaving a
  half-applied wallpaper.
- Dragging a slider no longer stringifies the config to `localStorage` and
  rebuilds the 2048×1152 fallback texture on every pointer event. Saves are
  debounced and flushed when the panel closes, the page hides, or the runtime
  is disposed.
- Numeric settings restored from `localStorage` or an import are clamped to
  their real control ranges. An out-of-range `dim`/`motion` value can no longer
  paint the scene black with no obvious way back.
- Rotation minutes now share a single 1–240 range between config restore, the
  panel, and the scheduler.
- The vignette slider is hidden in wallpaper mode, where the post-processing
  chain is not loaded and the control had no effect.
- Resetting the look section also restores the readability preset instead of
  leaving the panel claiming a custom/dimmed look.
- A Codex selector mismatch now shows a small warning dot on the gear instead
  of silently leaving parts of the host UI opaque.
- Video thumbnails now clear their 1500 ms fallback timer as soon as the first
  frame arrives, so switching wallpapers no longer leaves a timer behind.
- A slow thumbnail capture from a replaced video can no longer overwrite the
  preview of the wallpaper that replaced it.
- Visibility and focus changes only resume a video that Nuvio itself paused, so
  an external pause (media keys, OS, user code) is no longer overridden.
- A video element that fails before it reaches the renderer is disposed instead
  of being left loading in the background.
- README bundle figures now match the shipped build (about 836 KB raw, 231 KB
  gzip).

## [0.6.3] - 2026-11-05

### Fixed

- No entry point can leave a Windows Terminal window behind any more.
  `start.cmd` now re-launches itself through `launch-hidden.vbs` whenever
  `NUVIO_HIDDEN` is missing, so a stale shortcut, an Explorer double-click or
  a taskbar pin behaves exactly like the packaged shortcut. `start.cmd
  --console` keeps the old visible behaviour for debugging.
- A lost WebGL context no longer turns the whole Codex window black. The
  renderer now uses an alpha-capable drawing buffer, hides the canvas while
  the context is gone, and retries `forceContextRestore()` three times over
  six seconds.
- The Nuvio layer always paints a themed CSS backdrop under the canvas.
  Because Codex surfaces are forced transparent while Nuvio is active, a blank
  canvas (context lost, first frame not painted, wallpaper still decoding)
  used to composite as a solid black page. The backdrop also follows theme
  changes, so it never clashes with the selected palette.

## [0.6.2] - 2026-11-05

### Fixed

- Windows launch no longer flashes or leaves a blank console / Windows Terminal
  window. The desktop and Startup shortcuts now call `launch-hidden.vbs`
  (`wscript.exe`, hidden window), which starts `start.cmd` with a fully hidden
  console.
- `start.cmd` skips `pause` in hidden mode and writes startup failures to
  `%TEMP%\nuvio-launch.log`, so a failed launch cannot leave an invisible
  console waiting forever.
- `start.mjs` never waits on the Codex restart confirmation while running
  hidden (`NUVIO_HIDDEN=1`). Both shortcuts pass `--yes`, so a one-click start
  can add the CDP port once instead of hanging on an unseen `Y/N` prompt.

### Changed

- `restart.mjs` starts the replacement process with `windowsHide` as well.
- CI now runs `node --check` against every `tools/*.mjs` instead of a
  hand-maintained subset, so `shortcut.mjs`, `autostart.mjs`, `restart.mjs`
  and `pack.mjs` can no longer rot silently.
- Hidden-launch logging is now bounded. `start.cmd` rotates
  `%TEMP%\nuvio-launch.log` to `nuvio-launch.log.1` once it exceeds 256 KiB,
  so repeated launches cannot grow the log without limit.
- Codex surface detection is now compatibility-probed instead of assumed.
  `src/compat.js` checks the main surface, sidebar and composer against
  several selector generations, reports `ok` / `partial` / `unknown`, and the
  diagnostics panel shows which surface is missing. Transparent fallback
  rules also cover `data-testid` variants (`left-panel`, `main-surface`,
  `composer`).
- Automatic quality downgrades are now reversible. The perf governor records
  the pre-downgrade tier in `autoQualityFrom`, and the performance panel shows
  a "restore pre-downgrade quality" button that only appears while an
  automatic downgrade is active.
- Shortcut restarts shut Codex down gracefully: `taskkill /PID <pid> /T`
  without `/F` is tried first, then force-kill only after a 6 s grace period.
- Advanced settings are hidden by default (`showAdvanced: false`) and can be
  revealed from the performance panel, so the default UI stays simple.
- Texture budgets now scale with the actual screen instead of a fixed
  4096/2048 cap: 1080p/1440p stay at 4096/2048, ultrawide and 4K HiDPI scale
  up to 6144/3072, and weak GPUs remain clamped by `maxTextureSize`.
- Web wallpapers can be interactive (opt-in, off by default) and are now part
  of the rotation pool.

### Added

- `test/compat.test.mjs`, `test/launcher.test.mjs` and `test/texture.test.mjs`
  cover the compatibility probe, hidden launcher and adaptive texture budgets.

## [0.6.1] - 2026-11-04

### Fixed

- Newer Codex builds changed hashed class names from `_ComposerLayoutRoot_…` to
  `ComposerLayoutRoot-…`. Nuvio now matches the stable component name instead
  of the leading underscore, so the composer, workspace, page surface, footer,
  and transcript selectors work across both naming schemes.
- Removed the opaque composer body, attachment strip, action bar, footer
  background, dark/white scroll fades, and the `MainContentTopFade` white band
  in wallpaper mode. The chat box and the area above it now show the wallpaper
  instead of reverting to a white card or a horizontal white seam.
- The floating turn-summary pill (`N 个文件已更改`) now uses a lighter frosted
  tint instead of a solid white block.
- The lazy injector loader revalidates `codex-dynamic-bg.iife.js` with the local
  asset server (`no-cache`). Rebuilding the skin no longer leaves Codex running
  the previous cached bundle.

### Tests

- Updated layout regression tests for both hashed class-name formats and added
  coverage for the attachment strip and top scroll fade.

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
