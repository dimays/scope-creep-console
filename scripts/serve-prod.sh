#!/bin/bash
# Build, serve (production mode), and open the Scope Creep console in a browser.
# Robust: pins node@22 by absolute path, waits for the port to accept a connection
# (not /healthz==200), and never closes silently. Usage: bash scripts/serve-prod.sh
CONSOLE="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
URL="http://localhost:$PORT"
N22="/opt/homebrew/opt/node@22/bin"

keep_open() { echo; echo "$1"; echo "— press Return to close —"; read -r _ 2>/dev/null || sleep 6; }

[ -d "$N22" ] && export PATH="$N22:$PATH"
NPM="npm"; [ -x "$N22/npm" ] && NPM="$N22/npm"

cd "$CONSOLE" || { keep_open "Can't find the console at $CONSOLE"; exit 1; }

if curl -s -o /dev/null --max-time 2 "$URL" 2>/dev/null; then
  echo "Already running — opening $URL"; open "$URL" 2>/dev/null || true; exit 0
fi

echo "Loading env..."; if [ -f ./.env ]; then set -a; . ./.env; set +a; fi
echo "Building (prod) with npm $("$NPM" --version 2>/dev/null)..."
if ! "$NPM" run build; then keep_open "Build failed - see output above."; exit 1; fi

echo "Starting server on :$PORT..."
"$NPM" run start &
SERVER_PID=$!

for _ in $(seq 1 90); do
  if curl -s -o /dev/null --max-time 2 "$URL" 2>/dev/null; then open "$URL" 2>/dev/null || true; break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || { keep_open "Server exited during startup (is :$PORT already in use?)."; exit 1; }
  sleep 1
done

echo "Running at $URL - Ctrl-C to stop."
wait "$SERVER_PID"
keep_open "The server has stopped."
