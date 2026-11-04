# Contributing

Thanks for helping. Keep changes focused and verify them locally before opening a PR.

## Development

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5273/?mock=0> for the clean background view.

Before a PR:

```bash
npm run build:all
npm test
node --check tools/inject.mjs
node --check tools/restore.mjs
node --check tools/doctor.mjs
node --check tools/cleanup-expression.mjs
node --check tools/start.mjs
node --check tools/sync-decoders.mjs
```

`npm run build:all` must succeed and produce both `dist/` and `dist-embed/codex-dynamic-bg.iife.js`. `npm test` runs the `node:test` suite under `test/`.

## Code guidelines

- Vanilla ES modules, no UI framework. Keep the runtime dependency surface at Three.js only.
- Everything rendered must be disposed in `dispose()`: geometries, materials, textures, render targets, event listeners.
- Do not add network calls, analytics, remote fonts, or CDN dependencies.
- Keep the background layer non-interactive: `pointer-events: none`, `z-index: -1` relative to the app shell.
- New visual parameters must be added to `DEFAULTS` in `src/config.js`, wired into `BackgroundEngine.setConfig()`, and exposed in the settings panel.
- Codex-specific DOM selectors belong in `CXD_CODEX_CSS` inside `src/embed.js`; do not scatter them through other modules.

## Adding an effect

1. Add the uniform / pass in `src/shaders.js` or `src/post.js`.
2. Expose a config field in `src/config.js`.
3. Apply it in `BackgroundEngine.setConfig()`.
4. Add a control in `src/ui.js`.
5. Document the default in both README files.
6. Verify `quality: 'low'` still runs on an integrated GPU.

## Assets

- Do not commit third-party artwork or models you do not own.
- `public/assets/*` is ignored by Git on purpose. Only `public/assets/README.md` is tracked.
- If you add a demo asset, place it under `docs/` or `examples/` with an explicit license note.

## Pull requests

Include:

- what changed and why
- before/after screenshots for visual changes
- the commands you ran to verify
- known limitations

By contributing you agree your work is licensed under the MIT License.

