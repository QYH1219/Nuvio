# Injection

## Why CDP

Codex Desktop is an Electron app. Its renderer is a Chromium page, so the Chrome DevTools Protocol can attach to it, register a script before document load, and reload the page. This leaves the installed application untouched.

The debugging port can only be opened at process start. Attaching to an already-running Electron instance is not supported.

## Prerequisites

- Codex Desktop installed and working normally
- Node.js >= 22
- `npm install` completed
- `public/vendor/` populated (`npm run sync:decoders`, also runs before build/dev)
- `dist-embed/codex-dynamic-bg.iife.js` built (`npm run embed`)

## Full flow

```powershell
# 1. close Codex and relaunch with CDP
powershell -NoProfile -ExecutionPolicy Bypass -File tools/launch-codex.ps1 -KillExisting

# 2. verify the target is visible
npm run inject -- --list

# 3. build and inject
npm run build:all
npm run inject
```

The injector prints the selected target, the asset server URL, and whether `#cxd-bg-root` was found after reload.

## How the script survives a reload

`Page.addScriptToEvaluateOnNewDocument` registers the bundle for every new document in that target. After `Page.reload`, the script runs before the app boots, creates the background layer, and waits for Codex to paint its shell.

The registration is tied to the current CDP session / process. It is not written to disk and disappears when Codex exits.

## Selecting a target

Codex may expose several pages (main window, hidden utility pages). By default the injector picks the first page target. If it picked the wrong one:

```powershell
npm run inject -- --list
npm run inject -- --target "codex"
```

`--target` matches a substring of the target id, title, or URL.

## Asset serving

By default the injector starts an HTTP server on `127.0.0.1:5275`:

- `/assets/*` → `public/assets`
- `/vendor/*` → `public/vendor`

It blocks path traversal, sets correct MIME types, and sends CORS headers. Use `--asset-port` to change the port, `--assets` / `--vendor` to change directories, or `--no-serve` to disable it.

With `--no-serve`, point the page at a reachable base URL:

```powershell
npm run inject -- --no-serve --asset-base "https://your-host/bg/"
```

## Explicit assets

Auto-detection only looks for the standard filenames. Override them:

```powershell
npm run inject -- --image /assets/hero.webp --model /assets/tripo/scene.glb
```

Values under `/assets/` are resolved against the local asset server. Absolute `http(s)` URLs are passed through.

## Troubleshooting

### `[cxd] fetch failed`

Nothing is listening on the CDP port. Codex was not started with `--remote-debugging-port=9222`, or it is still the old process. Quit Codex completely and relaunch with the script.

### `No page targets found`

The port is open but no page target matched. Run `--list`, then pass `--target`. Some Electron builds keep the window hidden until fully initialized; wait a few seconds and retry.

### Injected but no background

1. Check the DevTools console for `[codex-bg]` errors.
2. Confirm `document.getElementById('cxd-bg-root')` exists.
3. Confirm `dist-embed/codex-dynamic-bg.iife.js` is newer than your last source edit.
4. Try `--no-reload` to inject into the current document and inspect immediately.

### Background exists but panels are opaque

Codex changed its DOM classes. Inspect the app shell and update the selectors in `CXD_CODEX_CSS` (`src/embed.js`), then rebuild and re-inject.

### Blank / black window

Usually WebGL initialization failure or a CSP issue with the asset server. Check the console; the app should still fall back to a CSS gradient instead of a blank page.

### Assets 404

`public/assets/` is served from the repository root. Verify the file exists and that its extension is in the MIME map (`.glb`, `.gltf`, `.bin`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.ktx2`, `.mp4`, `.webm`, `.m4v`).

## Removing the injection

- Quit and restart Codex normally, or
- run `window.cxdBg.dispose()` in the console, or
- navigate the target to reload without the CDP registration (restart is simplest).

## Safety

Keep the CDP port on `127.0.0.1`. An open debugging port grants full renderer control to any local process that can reach it. See [SECURITY.md](../SECURITY.md).

