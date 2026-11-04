# Injection

## Why CDP

Codex Desktop is an Electron app, so its renderer is a Chromium page. The injection tool uses the Chrome DevTools Protocol to register a script before document load, reload the page, and keep the background layer mounted. The installed application is never modified.

The remote debugging port can only be opened when Codex starts. An already-running Electron process cannot open it retroactively.

## Prerequisites

- Codex Desktop installed and working normally
- Node.js >= 22
- `npm install` completed
- `public/vendor/` populated (`npm run sync:decoders`, also runs before build/dev)
- `dist-embed/codex-dynamic-bg.iife.js` built (`npm run embed` or `npm run build:all`)

## One-command flow

On Windows, quit Codex and run `npm start` (or double-click `start.cmd`). `tools/start.mjs` handles dependency install, bundle build, Codex launch, CDP readiness, and injection in order. It refuses to kill an already-running Codex; restart explicitly with `npm run launch:codex -- -KillExisting` when that is acceptable.

If Codex is already running with CDP enabled elsewhere, skip the launcher:

```powershell
npm start -- --no-launch
```

## Full flow

```powershell
# 1. close Codex and relaunch with CDP
powershell -NoProfile -ExecutionPolicy Bypass -File tools/launch-codex.ps1 -KillExisting

# 2. verify the target is visible
npm run inject -- --list

# 3. build, inject (wait up to 30s for CDP), and check the environment
npm run build:all
npm run inject -- --wait 30
npm run doctor
```

The injector prints the selected target, the asset server URL, and whether `#cxd-bg-root` exists after reload.

## Resident injector

`Page.addScriptToEvaluateOnNewDocument` only stays registered while the CDP WebSocket that created it is alive. For that reason the default injector is a resident process:

- It keeps the CDP connection open after the first successful injection.
- Refreshing Codex does not lose the background.
- Closing the injector process removes the registration and the next page reload returns to normal.
- Keep the terminal running, or stop it with `npm run restore`.

Use `npm run inject -- --once` only for a one-shot test. The current document keeps the background until it reloads; there is no resident control server in this mode.

## CSP and asset loading

Codex serves the renderer from `app://` and ships a Content-Security-Policy that
blocks `fetch()`, images and WebGL textures pointed at `http://127.0.0.1`. The
injector therefore enables `Page.setBypassCSP` before registering the layer.

As a second line of defence, the default project wallpaper
(`public/assets/wallpaper/scene.json` plus its image and shake masks) is inlined
as `data:` URLs into the injected prelude. The page can render the wallpaper even
when the local asset server is unreachable or CSP bypass is unavailable. Explicit
`--image`, `--video` or `--scene` flags keep their normal URL semantics.

## State file

After a successful injection, the tool writes `.cxd-inject.json` in the repository root. It is gitignored and contains local runtime metadata:

```json
{
  "port": 9222,
  "targetId": "...",
  "targetTitle": "Codex",
  "targetUrl": "app://...",
  "identifier": "1",
  "controlPort": 5276,
  "token": "...",
  "pid": 12345,
  "injectedAt": "2026-11-04T..."
}
```

`identifier` is the CDP identifier returned by `Page.addScriptToEvaluateOnNewDocument`. `pid` and `controlPort` let `npm run restore` find the resident injector without guessing.

## Control server

The resident injector starts a control server bound to `127.0.0.1`:

```text
GET  /status
GET  /api/workshop/list
GET  /api/workshop/progress?id=<workshopId>
POST /api/workshop/import      { "id": "<workshopId>" }
POST /api/library/apply        { "id": "<workshopId>" }
POST /api/library/delete       { "id": "<workshopId>" }
GET  /workshop/<id>/preview?token=<token>
POST /restore
```

- The requested port is `--control-port` (default `5276`); if it is busy, the injector tries the next ports.
- `/status` returns the injector PID, CDP port, target, injection time, and control port.
- Every route except `/status` requires the random per-injection token stored in `.cxd-inject.json`. Send it as the `x-cxd-token` header, or as a `?token=` query parameter.
- `/workshop/<id>/preview` accepts the query parameter because it is loaded directly by `<img>` / CSS, which cannot set headers.
- `/api/workshop/list` merges Steam's downloaded workshop items with local imports. Items already imported keep working when the Steam library disappears (`orphaned`).
- `/api/workshop/import` returns a job immediately; poll `/api/workshop/progress?id=` for state and progress.
- `/api/library/apply` writes `public/assets/active.json` and switches the live background. `/api/library/delete` removes the imported copy only, never the Steam source.
- The token is not printed as a command-line argument and the control server never listens on a LAN interface.
- `--once` mode does not start the control server at all.

Example:

```powershell
$state = Get-Content .cxd-inject.json | ConvertFrom-Json
Invoke-RestMethod "http://127.0.0.1:$($state.controlPort)/api/workshop/list" `
  -Headers @{ 'x-cxd-token' = $state.token }
```

The restore body can contain:

```json
{ "keepConfig": false, "reload": false }
```

## Restore flow

`npm run restore` uses two paths:

1. Read `.cxd-inject.json` and call the resident control server. The injector removes the scheduled script, disposes the live layer, optionally clears `localStorage`, optionally reloads, and exits.
2. If the control server is not reachable, connect directly to the recorded CDP target, call `Page.removeScriptToEvaluateOnNewDocument` with the stored identifier, run the shared cleanup expression, and remove the local state file when successful.

Useful forms:

```powershell
npm run restore
npm run restore -- --keep-config
npm run restore -- --reload
npm run restore -- --port 9222
npm run restore -- --target "codex"
```

`window.cxdBg.dispose()` only unmounts the current page. It does not remove the scheduled CDP script, so the background returns after a reload.

## How the script survives a reload

After `Page.reload`, the registered bundle runs at document start. At that moment `document.body` may not exist yet, so `src/embed.js` waits for `DOMContentLoaded`, then:

1. inserts the base stylesheet and Codex transparency CSS
2. disposes any previous live instance
3. sets `html[data-cxd-background]`
4. creates `#cxd-bg-root`
5. calls `mount(host, { embed: true })`

The injected bundle does not rely on Codex's internal framework. Selectors are isolated in `CXD_CODEX_CSS` inside `src/embed.js`.

## Selecting a target

Codex may expose several pages (main window and hidden utility pages). By default the injector picks the first page target. If it picked the wrong one:

```powershell
npm run inject -- --list
npm run inject -- --target "codex"
```

`--target` matches a substring of the target id, title, or URL.

## Asset serving

By default the injector starts an HTTP server on `127.0.0.1:5275`:

- `/assets/*` -> `public/assets`
- `/vendor/*` -> `public/vendor`

It blocks path traversal, sets MIME types, and sends CORS headers. Use `--asset-port` to change the port, `--assets` / `--vendor` to change directories, or `--no-serve` to disable it.

With `--no-serve`, point the page at a reachable base URL:

```powershell
npm run inject -- --no-serve --asset-base "https://your-host/bg/"
```

## Explicit assets

Auto-detection only looks for the standard filenames. Override them with:

```powershell
npm run inject -- --image /assets/hero.webp --model /assets/tripo/scene.glb
npm run inject -- --video /assets/background.mp4
npm run inject -- --scene /assets/wallpaper/scene.json
```

Values under `/assets/` are resolved against the local asset server. Absolute `http(s)` URLs are passed through.

## Injector options

```text
--port 9222          CDP port
--asset-port 5275    local asset server port
--control-port 5276  local restore-control port
--assets PATH        directory mapped to /assets/
--vendor PATH        directory mapped to /vendor/
--bundle PATH        injected IIFE bundle
--target TEXT        target id/title/URL substring
--image URL          explicit image background
--video URL          explicit video background
--scene URL          explicit scene.json
--model URL          explicit GLB/glTF model
--surface NUMBER     panel opacity, 0..1
--dim NUMBER         background dim, 0..1
--asset-base URL     override the asset base URL
--no-reload          inject without reloading
--no-serve           do not start the local asset server
--wait SECONDS       poll for CDP instead of failing immediately
--once               inject once and exit (registration dies with the process)
--list               list CDP page targets and exit
```

## Troubleshooting

### `[cxd] fetch failed`

Nothing is listening on the CDP port. Codex was not started with `--remote-debugging-port=9222`, or it is still the old process. Quit Codex completely and relaunch with the launcher. For a slow first launch, retry with `npm run inject -- --wait 30`; the injector then polls until CDP answers or the wait window expires.

### `No page targets found`

The port is open but no page target matched. Run `--list`, then pass `--target`. Some Electron builds keep the window hidden until fully initialized; wait a few seconds and retry.

### Injected but no background

1. Check the DevTools console for `[codex-bg]` errors.
2. Confirm `document.getElementById('cxd-bg-root')` exists.
3. Confirm `dist-embed/codex-dynamic-bg.iife.js` is newer than your last source edit.
4. Run `npm run doctor` and inspect the resident injector status.
5. Try `--no-reload` to inject into the current document and inspect immediately.

### Background exists but panels are opaque

Codex changed its DOM classes. Inspect the app shell and update the selectors in `CXD_CODEX_CSS` (`src/embed.js`), then rebuild and reinject.

### Background is hard to see

Lower the panel opacity and dim:

```powershell
npm run inject -- --surface 0.15 --dim 0.05
```

You can also use the compact settings panel in injected mode (`G`) and choose the `清晰` readability preset.

### Blank / black window

Usually WebGL initialization failure or a CSP issue with the asset server. Check the console; the app should fall back to a CSS gradient instead of a blank page.

### Assets 404

`public/assets/` is served from the repository root. Verify the file exists and that its extension is in the MIME map (`.glb`, `.gltf`, `.bin`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.ktx2`, `.mp4`, `.webm`, `.m4v`).

### Stale injection state

If `npm run doctor` reports that the recorded PID or control port is stale, run:

```powershell
npm run restore
npm run inject
```

As a final fallback, quit Codex completely and start it normally.

## Removing the injection

Recommended:

```powershell
npm run restore
npm run restore -- --keep-config
npm run restore -- --reload
```

Extreme fallback: quit Codex completely. The scheduled script and control server only live for the current process.

## Safety

Keep both the CDP port and the control port on `127.0.0.1`. An open debugging port grants full renderer control to any local process that can reach it. The control token protects `/restore`, but it does not make a publicly exposed CDP port safe.
