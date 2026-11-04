#!/usr/bin/env bash
# Nuvio launcher for macOS / Linux.
#
#   ./start.sh                 normal start
#   ./start.sh --force         replace a running injector
#   ./start.sh --no-launch     attach to a Codex that already has CDP enabled
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[nuvio] Node.js 22+ is required: https://nodejs.org/" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[nuvio] Node.js 22+ is required, found $(node -v)" >&2
  exit 1
fi

# The portable release already contains dist-embed/, so npm and node_modules
# are not required. tools/start.mjs only installs dependencies when a source
# checkout needs to rebuild the injection bundle.
exec node tools/start.mjs "$@"
