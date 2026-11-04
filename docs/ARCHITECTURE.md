# Architecture

## Overview

```text
Codex renderer (Electron)
├─ #cxd-bg-root                 injected background host
│  │                            position: fixed; inset: 0; z-index: -1
│  │                            pointer-events: none
│  └─ .cxd-root                 WebGL canvas + HUD + mock
│     ├─ BackgroundEngine       three.js renderer / scene / loop
│     │  ├─ background.js       fullscreen image/video/scene shader plane
│     │  ├─ wallpaper.js        Wallpaper Engine shake + foliage sway material
│     │  ├─ model.js            GLB loader + auto fit + placeholder
│     │  └─ particles.js        GPU points
│     ├─ library.js             IndexedDB user assets + validation + object URLs
│     ├─ workshop.js            workshop library client + preview thumbnails
│     ├─ perf.js                frame sampling + one-step quality downgrade
│     └─ post.js                bloom + grade pass
├─ .cxd-ui-layer                injected settings host (embed mode only)
│  │                            position: fixed; inset: 0
│  │                            z-index: 2147483000; pointer-events: none
│  ├─ gear button               pointer-events: auto
│  └─ panel/                    compact panel: wallpaper / look / perf / advanced
│     └─ workshop.js            workshop picker UI (list, import, apply, delete)
└─ Codex app shell              translucent surfaces via CSS variables
```

The same `mount()` function powers both the standalone preview (`src/main.js`) and the injected bundle (`src/embed.js`).

## Entry points

| Entry | Built by | Use |
| --- | --- | --- |
| `src/main.js` | `vite build` | Standalone preview site |
| `src/embed.js` | `vite build --mode embed` | IIFE bundle injected via CDP |

`src/embed.js` is responsible for:

1. inlining `style.css`
2. injecting `CXD_CODEX_CSS` (Codex surface transparency)
3. waiting until `document.body` exists
4. disposing any previous instance
5. setting `html[data-cxd-background]`
6. creating `#cxd-bg-root` and calling `mount(host, { embed: true })`

The bundle is registered at document start. Because `<body>` may not exist yet, `boot()` waits for `DOMContentLoaded` before doing any DOM work.

## Layer contract

The background must never intercept input:

- `#cxd-bg-root`: `z-index: -1`, `pointer-events: none`, `contain: strict`.
- `.cxd-root`: canvas and decorative HUD only.
- `.cxd-ui-layer`: fixed, `z-index: 2147483000`, `pointer-events: none`.
- Gear button and open panel inside `.cxd-ui-layer`: `pointer-events: auto`.

The UI host is separate from the background host because a `z-index: -1` subtree cannot reliably receive clicks even when a child re-enables pointer events.

## Boot sequence

```text
embed.js boot()
 ├─ wait for DOMContentLoaded if body is missing
 ├─ ensure #cxd-bg-style and #cxd-bg-codex-style
 ├─ dispose previous window.cxdBg if present
 ├─ set html[data-cxd-background]
 ├─ create #cxd-bg-root
 └─ mount(host, { embed: true })
     ├─ loadConfig()                  localStorage -> DEFAULTS merge
     ├─ apply URL overrides           mock / panel / embed
     ├─ new BackgroundEngine()        renderer, camera, post, particles
     ├─ loadUserAssetUrls()           IndexedDB -> temporary object URLs
     ├─ probeAssets()                 HEAD requests for known disk filenames
     ├─ resolve assets                user > video/scene/image > procedural
     ├─ setBackgroundVideo()          MP4/WebM texture (highest priority)
     ├─ setSceneWallpaper()           Wallpaper Engine scene material + masks
     ├─ setBackgroundImage()          custom image or procedural canvas
     ├─ loadModel()                   GLB/glTF, 15s timeout, fallback placeholder
     ├─ engine.setConfig()            apply visual parameters
     ├─ createPanel()                 preview and injected compact panel
     ├─ createHud() / mock            preview-only decoration
     ├─ engine.start()                requestAnimationFrame loop
     └─ expose window.cxdBg
```

`mount()` returns the API object and never throws on missing assets. WebGL init failure falls back to a CSS gradient.

## Render pipeline

1. Background plane: fullscreen shader sampling image/video, or the `SceneWallpaperMaterial` replaying imported `shake`/`foliagesway` passes.
2. Model: GLTF scene centered and normalized to 3.35 units, plus a wireframe shell for edge glow.
3. Particles: `THREE.Points` with additive blending.
4. Post: `UnrealBloomPass` then a custom grade shader (grain, vignette, color grade).

The background plane accepts a `THREE.Texture`, `THREE.VideoTexture`, or a scene material. Resolved asset priority is:

```text
IndexedDB user background
> disk video > disk scene > disk image
> procedural background
```

The model slot resolves independently:

```text
IndexedDB user GLB > disk GLB/glTF > placeholder crystal
```

Scene wallpapers sample the artwork in screen space so the imported UV masks remain aligned while the background plane is cover-fitted. `BackgroundEngine.disposeBackgroundTexture()` pauses and releases video, image, and scene resources.

Quality presets change device pixel ratio, bloom enablement, particle count scale, and shadow usage.

## Themes and readability

Themes are defined in `src/presets.js`:

- `aurora`
- `deep-space`
- `cyber`
- `rain`
- `paper`
- `mono`

A theme changes palette and effect values only. It never replaces the user's image, video, scene, or model.

Readability presets (`wallpaper`, `clear`, `balanced`, `immersive`) set the related group:

- `surfaceOpacity`
- `dim`
- `vignette`

Manually changing one of those values marks `readability` as `custom`.

`wallpaperMode` is a derived state in `src/mount.js`. When the active
background is an image, video, or scene, `backgroundIsArtwork()` returns true:

- the mount root gets `.cxd-wallpaper`;
- the injected page gets `data-cxd-wallpaper="on"`;
- `applyWallpaperLook()` sets the `wallpaper` readability values once;
- the panel hides the theme section, because themes only affect procedural art.

Clearing the wallpaper removes the class/attribute, reapplies the selected
theme, and restores the theme section. In injected mode the attribute lets
`src/embed.js` suppress Codex's `WorkspaceContent` pseudo-surface, header tint,
sidebar blur, and extra page-surface shadow without making menus/dialogs
transparent.

## Configuration flow

```text
panel input -> config object -> engine.setConfig(config)
                             -> saveConfig(config) -> localStorage
```

`window.cxdBg.setConfig()` uses the same path, so external scripts and the panel stay consistent. A theme is applied first, then explicit patch values override it.

## User asset flow

Settings panel picks are handled by `src/library.js` and `src/mount.js`:

```text
file picker / drop
 ├─ type + extension + size check          background 192 MiB, model 128 MiB
 ├─ temporary object URL
 ├─ real decode                             img / video metadata / GLTFLoader
 ├─ IndexedDB put                           database codex-dynamic-bg, store assets
 ├─ create fresh object URL
 ├─ apply to scene
 └─ on failure: restore previous IndexedDB record and visible asset
```

The library stores one record per slot (`background`, `model`), with the Blob,
original name, MIME type, size, kind, and `updatedAt`. Object URLs are scoped to
the mount and revoked by slot when an asset is replaced or the mount is disposed.

Clearing a slot deletes the IndexedDB record, re-probes disk assets, and applies
the next fallback. That is why clearing a user model restores
`public/assets/model.glb` before showing the placeholder crystal.

The preview site and injected Codex page use different origins, so each keeps
its own IndexedDB contents. This is intentional: a public preview deployment
never sees a user's local artwork.

## Lifecycle and disposal

`BackgroundEngine.dispose()` stops the RAF loop, removes listeners, and disposes:

- renderer and its DOM canvas
- composer / passes / render targets
- geometries, materials, textures
- loaders and their workers
- IndexedDB-backed object URLs owned by the current mount

`window.cxdBg.dispose()` also removes:

- `#cxd-bg-root`
- `.cxd-ui-layer`
- `body.cxd-embedded`
- the live API reference

The CDP scheduled script is not removed by `dispose()`. Use `npm run restore` for a full removal.

## Injection pipeline

`tools/start.mjs` orchestrates dependency install, bundle build, Codex launch, and CDP readiness, then spawns `inject.mjs`. The injector remains the single owner of the CDP WebSocket and the resident lifecycle.

```text
inject.mjs
 ├─ GET /json/list                     find page targets
 ├─ WebSocket -> CDP
 ├─ Page.enable / Runtime.enable
 ├─ start control server (resident)    /status, /api/workshop/*, /api/library/*, /restore
 ├─ Page.addScriptToEvaluateOnNewDocument(bundle)
 ├─ Page.reload
 ├─ Runtime.evaluate -> check #cxd-bg-root
 └─ write .cxd-inject.json
```

The injector stays resident because the scheduled script is tied to the live CDP session. The control server is bound to `127.0.0.1` and uses a random token for restore requests.

Workshop support is split across three tools:

```text
tools/workshop-scan.mjs   scan local Steam libraries -> workshop items (types: scene/web/video)
tools/library.mjs         list / import / apply / delete downloaded items in public/assets/library
tools/inject.mjs          expose the control API and serve /workshop/<id>/preview
```

`npm run workshop` runs the scanner and prints the local inventory. It only reads
what Steam already downloaded; nothing is fetched from the network.

`restore.mjs` prefers the resident control server. If it is gone, it reconnects to CDP, removes the recorded scheduled script, runs the shared page-cleanup expression, and deletes stale state.

Assets are served by a small Node HTTP server so the injected page can fetch `/assets/*` and `/vendor/*` from `127.0.0.1`.

## Design constraints

- No framework, no state library: config is a plain object.
- No build-time dependency on Codex internals: selectors are isolated in one CSS string.
- Asset loading is optional at every step.
- The background layer must never intercept pointer events.
- The scheduling registration must be treated as session-scoped, not persistent application state.
