#!/usr/bin/env bash
# then-die — close THIS session's own terminal window/tab.
#
# Never touches "the frontmost window": it resolves the window that belongs to
# this process by walking up the process tree to the outermost tty, the same way
# come-back-when-done does. On Apple Terminal that tty is matched against a tab
# and the window is closed by its stable id; everywhere else the login shell on
# that tty is hung up, which is what closing a tab does at the process level and
# is safe inside VS Code / iTerm / Ghostty where "the window" may hold other tabs.
set -uo pipefail

[ "$(uname -s)" = 'Darwin' ] || { echo "then-die: macOS only." >&2; exit 1; }

LOG="${THEN_DIE_LOG:-$HOME/.claude/then-die.log}"
DELAY="${THEN_DIE_DELAY:-0.4}"

cmd="${1:-close}"
summary="${2:-}"

die() { printf 'then-die: %s\n' "$*" >&2; exit 1; }

# ── which app is the terminal ────────────────────────────────────────────────
resolve_app() {
  if [ -n "${THEN_DIE_TERMINAL_APP:-}" ]; then printf '%s' "$THEN_DIE_TERMINAL_APP"; return; fi
  case "${TERM_PROGRAM:-}" in
    Apple_Terminal)  printf 'Terminal' ;;
    iTerm.app)       printf 'iTerm2' ;;
    vscode)          printf 'Code' ;;
    ghostty|Ghostty) printf 'Ghostty' ;;
    WarpTerminal)    printf 'Warp' ;;
    WezTerm)         printf 'WezTerm' ;;
    Hyper)           printf 'Hyper' ;;
    Tabby)           printf 'Tabby' ;;
    rio)             printf 'rio' ;;
    *)               printf 'unknown' ;;
  esac
}
APP="$(resolve_app)"

# ── which tty is OURS ────────────────────────────────────────────────────────
# This process often has no tty of its own, and wrappers (tmux, script,
# kiro-cli-term) allocate an inner pty that the terminal knows nothing about.
# Keep the LAST tty seen while walking up to pid 1 — the outermost one.
outer_tty() {
  local p="$$" pp tt out=''
  for _ in $(seq 20); do
    read -r pp tt <<<"$(ps -o ppid=,tty= -p "$p" 2>/dev/null)"
    [ -n "${pp:-}" ] || break
    if [ -n "${tt:-}" ] && [ "$tt" != '??' ]; then out="$tt"; fi
    if [ "$pp" -le 1 ] 2>/dev/null; then break; fi
    p="$pp"
  done
  [ -n "$out" ] && printf '%s' "$out"
}
TTY_SHORT="$(outer_tty || true)"

# The login shell is the session leader on that tty ('s' in the stat column).
leader_pid() {
  [ -n "$TTY_SHORT" ] || return 1
  ps -t "$TTY_SHORT" -o pid=,stat= 2>/dev/null | awk '$2 ~ /s/ {print $1; exit}'
}
LEADER="$(leader_pid || true)"

# Apple Terminal exposes a stable per-window id and closes its own windows, so
# no System Events and no Accessibility grant are needed there.
TERM_WIN_ID=''
if [ "$APP" = 'Terminal' ]; then
  if [ -n "${THEN_DIE_WINDOW_ID:-}" ]; then
    TERM_WIN_ID="$THEN_DIE_WINDOW_ID"
  elif [ -n "$TTY_SHORT" ]; then
    TERM_WIN_ID="$(osascript - "/dev/$TTY_SHORT" <<'AS' 2>/dev/null || true
on run argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if (tty of t) is (item 1 of argv) then return (id of w) as text
      end repeat
    end repeat
  end tell
  return ""
end run
AS
)"
  fi
fi

log_line() {
  [ -n "$summary" ] || return 0
  mkdir -p "$(dirname "$LOG")" 2>/dev/null || return 0
  printf '%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$PWD" "$summary" >>"$LOG" 2>/dev/null || true
}

case "$cmd" in
  where)
    printf 'app:      %s\n' "${APP:-?}"
    printf 'tty:      %s\n' "${TTY_SHORT:-<none>}"
    printf 'leader:   %s\n' "${LEADER:-<none>}"
    printf 'windowid: %s\n' "${TERM_WIN_ID:-<n/a>}"
    if [ -n "$TERM_WIN_ID" ]; then printf 'method:   Terminal close window id %s\n' "$TERM_WIN_ID"
    elif [ -n "$LEADER" ];      then printf 'method:   SIGHUP login shell %s on %s\n' "$LEADER" "$TTY_SHORT"
    else                             printf 'method:   NONE — cannot resolve own window; do not call close\n'; exit 1
    fi
    printf 'log:      %s\n' "$LOG"
    ;;

  close)
    [ -n "$TERM_WIN_ID" ] || [ -n "$LEADER" ] \
      || die "cannot resolve this session's own window (app=$APP tty=${TTY_SHORT:-none}). Nothing closed — just report the result normally."
    log_line
    # Detached and delayed, so this call returns 0 before the window (and this
    # very process) goes away — the closing itself is never the thing that fails.
    if [ -n "$TERM_WIN_ID" ]; then
      nohup bash -c "sleep $DELAY; osascript -e 'tell application \"Terminal\" to close window id $TERM_WIN_ID saving no'" \
        >/dev/null 2>&1 &
      printf 'then-die: closing Terminal window id %s.\n' "$TERM_WIN_ID"
    else
      nohup bash -c "sleep $DELAY; kill -HUP $LEADER" >/dev/null 2>&1 &
      printf 'then-die: hanging up shell %s on %s.\n' "$LEADER" "$TTY_SHORT"
    fi
    disown 2>/dev/null || true
    ;;

  *)
    die "unknown command '$cmd' (use: close | where)"
    ;;
esac
