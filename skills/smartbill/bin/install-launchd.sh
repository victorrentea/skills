#!/bin/bash
# Install (or remove) the launchd job that keeps the SmartBill session alive.
#
# launchd rather than cron: on recent macOS a crontab needs Full Disk Access or
# it dies silently, and cron does not survive as cleanly across logout/reboot.
#
#   bin/install-launchd.sh            # install, every 15 min
#   bin/install-launchd.sh 900        # custom interval, seconds
#   bin/install-launchd.sh --uninstall
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="ro.victorrentea.smartbill-keepalive"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LAB="$HOME/.smartbill-session-lab"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

INTERVAL="${1:-900}"
mkdir -p "$HOME/Library/LaunchAgents" "$LAB"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HERE/bin/session-lab.sh</string>
    <string>keepalive</string>
  </array>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LAB/launchd.out</string>
  <key>StandardErrorPath</key><string>$LAB/launchd.err</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLISTEOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "installed $LABEL, every ${INTERVAL}s"
echo "  log:     $LAB/touches.jsonl"
echo "  status:  $HERE/bin/session-lab.sh status"
