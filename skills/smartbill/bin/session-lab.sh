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
    res="$(cd "$HERE" && npm run --silent sb -- touch 2>&1 | tr -d '\n' || true)"
    alive=false; case "$res" in *'"alive": true'*) alive=true ;; esac
    printf '{"at":"%s","alive":%s,"ageMinutes":%s}\n' "$(iso)" "$alive" "$age_min" >> "$LOG"
    $alive || echo "SmartBill session DIED at age ${age_min} min - run: npm run sb -- login" >&2
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
    echo "touches:       $(grep -c '"alive"' "$LOG" || true)"
    echo "deaths:        $(grep -c '"alive":false' "$LOG" || true)"
    echo "last 5:"; tail -5 "$LOG"
    ;;

  *) echo "usage: session-lab.sh {keepalive|pause <4h>|resume|status}" >&2; exit 1 ;;
esac
