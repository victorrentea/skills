#!/bin/bash
# Keep the saved SmartBill session alive, and record enough to answer two
# questions that look alike but are not:
#
#   1. How long does an IDLE session last?  -> `pause`, then look at the log.
#   2. Does touching it keep it alive FOREVER, or is there an absolute max age?
#      -> the log answers this on its own: if the session dies while touches
#      were landing, the age at death is the cap.
#
# Copies of storageState.json are NOT independent sessions - they carry the
# same sessionid, so they all touch the same server-side session. That is why
# there is one arm here, not two.
#
#   bin/session-lab.sh keepalive   # run by launchd
#   bin/session-lab.sh pause 4h    # skip touches for 4h, to measure idle timeout
#   bin/session-lab.sh resume
#   bin/session-lab.sh status
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAB="$HOME/.smartbill-session-lab"
LOG="$LAB/touches.jsonl"
PAUSE="$LAB/paused-until"
BORN="$LAB/session-born"
mkdir -p "$LAB"

# launchd starts jobs with a minimal environment - not your login shell - so a
# node installed through nvm is NOT on PATH. Without this the npm call fails and
# the script cannot tell "could not run" from "session is dead".
resolve_node() {
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" --no-use >/dev/null 2>&1 || true
    local n; n="$(nvm which default 2>/dev/null | tail -1)" || true
    if [ -n "${n:-}" ] && [ -x "$n" ]; then export PATH="$(dirname "$n"):$PATH"; return 0; fi
  fi
  command -v node >/dev/null 2>&1
}
now() { date +%s; }
iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# The session's birth must be STAMPED once. storageState's mtime cannot stand in
# for it: `touch` rewrites that file on every run, so the mtime is always "just
# now" and the age at death - the one number that reveals an absolute cap -
# would read as zero forever.
born_at() {
  if [ ! -f "$BORN" ]; then
    stat -f %m "$HERE/storageState.json" 2>/dev/null > "$BORN" || now > "$BORN"
  fi
  cat "$BORN"
}

case "${1:-keepalive}" in
  keepalive)
    if [ -f "$PAUSE" ] && [ "$(now)" -lt "$(cat "$PAUSE")" ]; then
      printf '{"at":"%s","skipped":"paused"}\n' "$(iso)" >> "$LOG"; exit 0
    fi
    [ -f "$PAUSE" ] && rm -f "$PAUSE"
    age_min=$(( ( $(now) - $(born_at) ) / 60 ))
    if ! resolve_node; then
      printf '{"at":"%s","status":"error","why":"no node on PATH","ageMinutes":%s}\n' "$(iso)" "$age_min" >> "$LOG"
      echo "keepalive could not run: no node on PATH" >&2; exit 1
    fi
    res="$(cd "$HERE" && npm run --silent sb -- touch 2>&1 | tr -d '\n' || true)"
    # Three outcomes, not two. A monitor that reports "dead" when it merely
    # failed to run sends you off to re-login for nothing.
    if ! printf '%s' "$res" | grep -q '"alive"'; then
      printf '{"at":"%s","status":"error","ageMinutes":%s}\n' "$(iso)" "$age_min" >> "$LOG"
      echo "keepalive could not run - output was: $res" >&2; exit 1
    fi
    case "$res" in *'"alive": true'*) st=alive ;; *) st=dead ;; esac
    printf '{"at":"%s","status":"%s","ageMinutes":%s}\n' "$(iso)" "$st" "$age_min" >> "$LOG"
    [ "$st" = alive ] || echo "SmartBill session DIED at age ${age_min} min - run: npm run sb -- login" >&2
    ;;

  pause)
    secs="${2:-4h}"
    case "$secs" in *h) secs=$(( ${secs%h} * 3600 ));; *m) secs=$(( ${secs%m} * 60 ));; esac
    echo $(( $(now) + secs )) > "$PAUSE"
    echo "touches paused until $(date -r "$(cat "$PAUSE")")"
    echo "when it resumes, the first line in the log tells you whether an idle"
    echo "gap of that length survives. That IS the idle-timeout measurement."
    ;;

  resume) rm -f "$PAUSE"; echo "resumed" ;;

  # Call this right after `sb -- login`, so the age clock starts at zero.
  reborn) now > "$BORN"; rm -f "$PAUSE"; echo "session birth stamped $(date)" ;;

  status)
    echo "session born:  $(date -r "$(born_at)")"
    echo "age:           $(( ( $(now) - $(born_at) ) / 3600 )) h"
    [ -f "$PAUSE" ] && [ "$(now)" -lt "$(cat "$PAUSE")" ] && echo "PAUSED until $(date -r "$(cat "$PAUSE")")"
    [ -f "$LOG" ] || { echo "no touches logged yet"; exit 0; }
    echo "touches:       $(grep -c '"status"' "$LOG" || true)"
    echo "deaths:        $(grep -c '"status":"dead"' "$LOG" || true)"
    echo "run errors:    $(grep -c '"status":"error"' "$LOG" || true)"
    echo "last 5:"; tail -5 "$LOG"
    ;;

  *) echo "usage: session-lab.sh {keepalive|pause <4h>|resume|status}" >&2; exit 1 ;;
esac
