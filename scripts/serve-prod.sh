#!/bin/bash
# Build, serve (production mode), and open the Scope Creep console in a browser.
# Absorbs the two known gotchas:
#   • the console needs node 22 (Heroku's node 16 otherwise shadows it)
#   • prod (react-router-serve) does NOT auto-load .env, so we source it here
# Usage: bash scripts/serve-prod.sh   (Ctrl-C to stop). macOS-oriented.
set -u
CONSOLE="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
URL="http://localhost:$PORT"
cd "$CONSOLE" || exit 1
[ -d /opt/homebrew/opt/node@22/bin ] && export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

if curl -fsS "$URL/healthz" >/dev/null 2>&1; then
  echo "Already running — opening $URL"; open "$URL" 2>/dev/null || true; exit 0
fi

echo "Loading env…"; if [ -f ./.env ]; then set -a; . ./.env; set +a; fi
echo "Building (prod)…"; npm run build || { echo "Build failed."; exit 1; }
echo "Serving on :$PORT…"; npm run start &
SERVER_PID=$!
for _ in $(seq 1 60); do
  if curl -fsS "$URL/healthz" >/dev/null 2>&1; then open "$URL" 2>/dev/null || true; break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "Server exited during startup."; break; }
  sleep 1
done
echo "Running at $URL — Ctrl-C to stop."
wait "$SERVER_PID"
