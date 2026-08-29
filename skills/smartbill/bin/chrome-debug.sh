#!/bin/bash
# Start a Chrome that Playwright (and any CDP client) can attach to, so
# automation runs inside a session a human signed into by hand.
#
# Chrome 136+ refuses --remote-debugging-port on the DEFAULT profile - that hole
# was being used to lift cookies - so this uses a profile of its own. Sign into
# whatever the automation needs ONCE in the window that opens; the session
# persists in that profile across restarts.
#
#   bin/chrome-debug.sh              # port 9222, profile ~/.chrome-smartbill
#   bin/chrome-debug.sh 9333 ~/.chrome-other
#
# Then:  npm run sb -- <cmd> --cdp http://127.0.0.1:9222
set -euo pipefail

PORT="${1:-9222}"
PROFILE="${2:-$HOME/.chrome-smartbill}"
CHROME="/Applications/Google Chrome.app"

if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "Chrome is already listening on $PORT - reusing it."
  exit 0
fi

[ -d "$CHROME" ] || { echo "Google Chrome not found at $CHROME" >&2; exit 1; }
mkdir -p "$PROFILE"
open -na "$CHROME" --args --remote-debugging-port="$PORT" --user-data-dir="$PROFILE"

for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "CDP ready on http://127.0.0.1:$PORT (profile: $PROFILE)"
    exit 0
  fi
  sleep 1
done
echo "Chrome did not open a CDP port on $PORT within 30s" >&2
exit 1
