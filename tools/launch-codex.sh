#!/usr/bin/env sh
set -eu

PORT="${1:-9222}"

if [ -n "${CODEX_APP_PATH:-}" ]; then
  APP="$CODEX_APP_PATH"
elif [ -x "/Applications/Codex.app/Contents/MacOS/Codex" ]; then
  APP="/Applications/Codex.app/Contents/MacOS/Codex"
elif command -v codex-desktop >/dev/null 2>&1; then
  APP="$(command -v codex-desktop)"
elif command -v chatgpt >/dev/null 2>&1; then
  APP="$(command -v chatgpt)"
else
  echo "Codex executable not found. Set CODEX_APP_PATH." >&2
  exit 1
fi

echo "[cxd] launching $APP"
exec "$APP" --remote-debugging-port="$PORT" --remote-allow-origins='*'
