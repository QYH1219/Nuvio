#!/usr/bin/env bash
# Launch Codex Desktop with Chromium CDP enabled on macOS / Linux.
#
#   bash tools/launch-codex.sh [port]
#   CODEX_BIN="/path/to/Codex" bash tools/launch-codex.sh 9222
#
# Nuvio can only attach through CDP, so Codex must be launched with
# --remote-debugging-port. Quit an already-running Codex first; Electron cannot
# add the debugging port to an existing process.
set -euo pipefail

PORT="${1:-9222}"
if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "[nuvio] port must be an integer, got: $PORT" >&2
  exit 1
fi

CODEX_BIN="${CODEX_BIN:-${CODEX_APP_PATH:-}}"

if [ -z "$CODEX_BIN" ]; then
  for name in codex-desktop codex chatgpt; do
    if command -v "$name" >/dev/null 2>&1; then
      CODEX_BIN="$(command -v "$name")"
      break
    fi
  done
fi

if [ -z "$CODEX_BIN" ]; then
  for candidate in \
    "/Applications/ChatGPT.app" \
    "/Applications/Codex.app" \
    "$HOME/Applications/ChatGPT.app" \
    "$HOME/Applications/Codex.app" \
    "/opt/ChatGPT/chatgpt" \
    "/opt/Codex/codex" \
    "/usr/local/bin/codex"; do
    if [ -e "$candidate" ]; then
      CODEX_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$CODEX_BIN" ]; then
  echo "[nuvio] Codex Desktop was not found." >&2
  echo "[nuvio] Set CODEX_BIN to the executable path, then retry:" >&2
  echo "  CODEX_BIN='/path/to/Codex' bash tools/launch-codex.sh $PORT" >&2
  exit 1
fi

echo "[nuvio] app: $CODEX_BIN"
echo "[nuvio] CDP: http://127.0.0.1:$PORT"

if [[ "$CODEX_BIN" == *.app ]]; then
  if ! command -v open >/dev/null 2>&1; then
    echo "[nuvio] macOS .app bundle requires the 'open' command." >&2
    exit 1
  fi
  open -a "$CODEX_BIN" --args --remote-debugging-port="$PORT" --remote-allow-origins='*'
  exit 0
fi

exec "$CODEX_BIN" --remote-debugging-port="$PORT" --remote-allow-origins='*'
