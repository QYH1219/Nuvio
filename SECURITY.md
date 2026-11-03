# Security

## Scope

This project injects JavaScript into a local Electron application through the Chrome DevTools Protocol. It does not patch binaries, install services, or modify files inside the Codex installation.

## Reporting

Open a private security advisory on GitHub, or contact the maintainer directly. Do not publish a working exploit before a fix is available.

Please include:

- affected version / commit
- Codex version
- reproduction steps
- impact

## Known risk surface

- **CDP port**: `--remote-debugging-port` exposes full control over the renderer to anything that can reach the port. Keep it bound to `127.0.0.1`. Do not run on untrusted networks, and do not forward the port.
- **`--remote-allow-origins=*`**: required by some Electron builds for WebSocket CDP connections. It widens the origin check, which is another reason the port must stay local.
- **Local asset server**: binds to `127.0.0.1`, serves only the configured asset directory, blocks path traversal, and sends permissive CORS headers for the local page. It is not intended for public exposure.
- **Asset files**: GLB/glTF and images are parsed by Three.js loaders. Treat downloaded models as untrusted input and prefer assets you exported yourself.

## What the project does not do

- No telemetry, analytics, or remote logging.
- No network requests other than the local asset server.
- No credential access, no filesystem writes outside the repository.
- No persistence across Codex restarts.

## Hardening checklist

- Bind CDP and the asset server to `127.0.0.1`.
- Close the debugging port when you are done (restart Codex normally).
- Review `src/embed.js` before injecting a fork.
- Keep dependencies updated (`npm audit`).

