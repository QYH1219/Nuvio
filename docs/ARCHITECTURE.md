# Architecture

## Overview

```text
Codex renderer (Electron)
├─ #cxd-bg-root                 injected host, fixed inset 0, z-index -1
│  └─ .cxd-root                 WebGL canvas + HUD + mock + panel
│     ├─ BackgroundEngine       three.js renderer / scene / loop
│     │  ├─ background.js       fullscreen shader plane
│     │  ├─ model.js            GLB loader + auto fit + placeholder
│     │  └─ particles.js        GPU points
│     └─ post.js                bloom + grade pass
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
3. removing any previous instance
4. setting `html[data-cxd-background]`
5. creating `#cxd-bg-root` and calling `mount(host, { embed: true })`

## Boot sequence

```text
mount()
 ├─ loadConfig()                  localStorage -> DEFAULTS merge
 ├─ apply URL overrides           mock / panel / embed
 ├─ new BackgroundEngine()        renderer, camera, post, particles
 ├─ probeAssets()                 HEAD requests for known filenames
 ├─ setBackgroundImage()          custom image or procedural canvas
 ├─ loadModel()                   GLB/glTF, 15s timeout, fallback to placeholder
 ├─ engine.setConfig()            apply visual parameters
 ├─ createPanel()                 preview only
 ├─ engine.start()                requestAnimationFrame loop
 └─ expose window.cxdBg
```

`mount()` returns the API object and never throws on missing assets. WebGL init failure falls back to a CSS gradient.

## Render pipeline

1. Background plane: fullscreen shader sampling the background texture with drift, vignette, and mouse parallax.
2. Model: GLTF scene centered and normalized to 3.35 units, plus a wireframe shell for edge glow.
3. Particles: `THREE.Points` with additive blending.
4. Post: `UnrealBloomPass` then a custom grade shader (grain, vignette, color grade).

The background plane accepts a `THREE.Texture` or a `THREE.VideoTexture`. Video takes priority over a still image; both feed the same shader, so parallax, dim, grain, and motion apply identically. `BackgroundEngine.disposeBackgroundTexture()` pauses and releases the video element.

Quality presets change device pixel ratio, bloom enablement, particle count scale, and shadow usage.

## Configuration flow

```text
panel input -> config object -> engine.setConfig(config)
                             -> saveConfig(config) -> localStorage
```

`window.cxdBg.setConfig()` uses the same path, so external scripts and the panel stay consistent.

## Lifecycle and disposal

`BackgroundEngine.dispose()` stops the RAF loop, removes listeners, and disposes:

- renderer and its DOM canvas
- composer / passes / render targets
- geometries, materials, textures
- loaders and their workers

`window.cxdBg.dispose()` also removes `#cxd-bg-root` and the `cxd-embedded` body class.

## Injection pipeline

```text
inject.mjs
 ├─ GET /json/list                     find page targets
 ├─ WebSocket -> CDP
 ├─ Page.enable / Runtime.enable
 ├─ Page.addScriptToEvaluateOnNewDocument(bundle)
 ├─ Page.reload
 └─ Runtime.evaluate -> check #cxd-bg-root
```

Assets are served by a small Node HTTP server so the injected page can fetch `/assets/*` and `/vendor/*` from `127.0.0.1`.

## Design constraints

- No framework, no state library: config is a plain object.
- No build-time dependency on Codex internals: selectors are isolated in one CSS string.
- Asset loading is optional at every step.
- The background layer must never intercept pointer events.

