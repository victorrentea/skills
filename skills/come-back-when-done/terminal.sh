#!/usr/bin/env bash
# Move the terminal window between displays, and summon it back with a sound.
#
#   terminal.sh where        print which display the terminal window is on
#   terminal.sh off-retina   if it sits on a Retina display, move it to another one
#   terminal.sh to-retina    move it onto the Retina display
#   terminal.sh shake        wobble the window in place
#   terminal.sh summon       to-retina + raise + sound and shake together
#
# Everything is discovered at run time — the Retina display is identified by its
# backing scale factor and the terminal app by $TERM_PROGRAM — so there are no
# machine-specific coordinates or app names anywhere in here.
#
# The window driven is THIS session's own window, never merely the frontmost one:
# with several terminal windows open (and Victor runs several Claude sessions at
# once), "window 1" is whichever window happens to be in front, so the naive
# version yanked a colleague window off the screen. On Apple Terminal the window
# is resolved by tty and addressed by its stable window id.
#
# Overrides, if the guesses are ever wrong:
#   CBWD_TERMINAL_APP   process name to drive (e.g. "Terminal", "iTerm2", "Ghostty")
#   CBWD_WINDOW_ID      Apple Terminal window id to drive, skipping tty resolution
#   CBWD_SOUND          path to an .aiff/.wav to play instead of the default
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOUND="${CBWD_SOUND:-/System/Library/Sounds/Glass.aiff}"

die() { printf '%s\n' "$*" >&2; exit 1; }

# ── which app is the terminal ────────────────────────────────────────────────
# System Events drives windows by PROCESS name, which is not always the value of
# $TERM_PROGRAM, hence the translation table.
resolve_app() {
  if [ -n "${CBWD_TERMINAL_APP:-}" ]; then printf '%s' "$CBWD_TERMINAL_APP"; return; fi
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
    *)
      # Last resort: whatever is frontmost right now.
      osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' 2>/dev/null \
        || die "Cannot tell which terminal app to drive. Set CBWD_TERMINAL_APP."
      ;;
  esac
}
APP="$(resolve_app)"
[ -n "$APP" ] || die "Cannot tell which terminal app to drive. Set CBWD_TERMINAL_APP."

# ── which window is OURS ──────────────────────────────────────────────────────
# The tty of this process is useless: the tool that runs these commands has none,
# and wrappers that allocate an inner pty (kiro-cli-term, tmux, script) hide the
# real one anyway. So walk up the process tree and keep the LAST tty seen — the
# outermost one, on the process the terminal itself started, which is the tty the
# terminal reports for that tab.
outer_tty() {
  local p="$$" pp tt out=''
  for _ in $(seq 20); do
    read -r pp tt <<<"$(ps -o ppid=,tty= -p "$p" 2>/dev/null)"
    if [ -z "${pp:-}" ]; then break; fi
    if [ -n "${tt:-}" ] && [ "$tt" != '??' ]; then out="$tt"; fi
    if [ "$pp" -le 1 ] 2>/dev/null; then break; fi
    p="$pp"
  done
  [ -n "$out" ] && printf '/dev/%s' "$out"
}

# Apple Terminal exposes a stable per-window id and can move windows itself, so
# on Terminal we need neither System Events nor Accessibility.
TERM_WIN_ID=''
if [ "$APP" = 'Terminal' ]; then
  if [ -n "${CBWD_WINDOW_ID:-}" ]; then
    TERM_WIN_ID="$CBWD_WINDOW_ID"
  else
    _tty="$(outer_tty || true)"
    if [ -n "$_tty" ]; then
      TERM_WIN_ID="$(osascript - "$_tty" <<'JXA' 2>/dev/null || true
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
JXA
)"
    fi
  fi
fi

# ── window geometry ───────────────────────────────────────────────────────────
# Terminal's "bounds" is {left, top, right, bottom} in the same top-left-origin
# screen space screens.sh already reports, so no conversion is needed.
win_get() { # -> x y w h
  if [ -n "$TERM_WIN_ID" ]; then
    osascript -e "tell application \"Terminal\" to get bounds of window id $TERM_WIN_ID" 2>/dev/null \
      | awk -F', *' '{print $1, $2, $3 - $1, $4 - $2}' \
      | grep . || die "Could not read Terminal window id $TERM_WIN_ID — was it closed?"
    return
  fi
  osascript -e "tell application \"System Events\" to tell process \"$APP\"
    set p to position of window 1
    set s to size of window 1
    return ((item 1 of p) as text) & \" \" & ((item 2 of p) as text) & \" \" & ((item 1 of s) as text) & \" \" & ((item 2 of s) as text)
  end tell" 2>/dev/null || die "Could not read the window of \"$APP\". Is it running, and is Accessibility granted to your terminal in System Settings > Privacy & Security > Accessibility?"
}

win_set() { # x y w h
  if [ -n "$TERM_WIN_ID" ]; then
    osascript -e "tell application \"Terminal\" to set bounds of window id $TERM_WIN_ID to {$1, $2, $(( $1 + $3 )), $(( $2 + $4 ))}" \
      >/dev/null 2>&1 || die "Could not move Terminal window id $TERM_WIN_ID — was it closed?"
    return
  fi
  osascript -e "tell application \"System Events\" to tell process \"$APP\"
    set position of window 1 to {$1, $2}
    set size of window 1 to {$3, $4}
  end tell" >/dev/null 2>&1 || die "Could not move the window of \"$APP\" (Accessibility permission?)"
}

raise() {
  if [ -n "$TERM_WIN_ID" ]; then
    osascript -e "tell application \"Terminal\"
      activate
      set frontmost of window id $TERM_WIN_ID to true
    end tell" >/dev/null 2>&1 && return 0
  fi
  osascript -e "tell application \"$APP\" to activate" >/dev/null 2>&1 \
    || osascript -e "tell application \"System Events\" to set frontmost of process \"$APP\" to true" >/dev/null 2>&1 || true
}

screens() { bash "$HERE/screens.sh"; }

# Which screen contains the window's centre point?
screen_of_window() {
  read -r wx wy ww wh <<<"$(win_get)"
  local cx=$(( wx + ww / 2 )) cy=$(( wy + wh / 2 ))
  screens | awk -v cx="$cx" -v cy="$cy" '
    { if (cx >= $2 && cx < $2 + $4 && cy >= $3 && cy < $3 + $5) { print; found=1; exit } }
    END { if (!found) exit 3 }
  ' || return 3
}

# Place the window centred on a screen line, shrinking it if it does not fit.
place_on() { # "idx x y w h scale retina primary"
  local sx sy sw sh; read -r _ sx sy sw sh _ _ _ <<<"$1"
  read -r _ _ ww wh <<<"$(win_get)"
  local maxw=$(( sw * 92 / 100 )) maxh=$(( sh * 92 / 100 ))
  [ "$ww" -gt "$maxw" ] && ww=$maxw
  [ "$wh" -gt "$maxh" ] && wh=$maxh
  win_set $(( sx + (sw - ww) / 2 )) $(( sy + (sh - wh) / 2 )) "$ww" "$wh"
}

# A short horizontal wobble, so the summon is visible even with the volume down.
# The whole oscillation runs inside ONE osascript call: launching osascript per
# step costs ~50ms and turns a shake into a stutter.
shake() {
  [ "${CBWD_SHAKE:-1}" = "0" ] && return 0
  local px="${CBWD_SHAKE_PX:-14}" times="${CBWD_SHAKE_TIMES:-3}"
  if [ -n "$TERM_WIN_ID" ]; then
    osascript -e "tell application \"Terminal\"
      set b to bounds of window id $TERM_WIN_ID
      set l to item 1 of b
      set t to item 2 of b
      set r to item 3 of b
      set bt to item 4 of b
      repeat $times times
        set bounds of window id $TERM_WIN_ID to {l - $px, t, r - $px, bt}
        delay 0.03
        set bounds of window id $TERM_WIN_ID to {l + $px, t, r + $px, bt}
        delay 0.03
      end repeat
      set bounds of window id $TERM_WIN_ID to b
    end tell" >/dev/null 2>&1 || true
    return 0
  fi
  osascript -e "tell application \"System Events\" to tell process \"$APP\"
    set p to position of window 1
    set x0 to item 1 of p
    set y0 to item 2 of p
    repeat $times times
      set position of window 1 to {x0 - $px, y0}
      delay 0.03
      set position of window 1 to {x0 + $px, y0}
      delay 0.03
    end repeat
    set position of window 1 to {x0, y0}
  end tell" >/dev/null 2>&1 || true
}

retina_line()     { screens | awk -F'\t' '$7 == 1 {print; exit}'; }
# Prefer the roomiest non-Retina display, so the window lands somewhere usable.
non_retina_line() { screens | awk -F'\t' '$7 == 0 {a=$4*$5; if (a > best) {best=a; l=$0}} END {if (l) print l}'; }

case "${1:-}" in
  where)
    cur="$(screen_of_window || true)"
    if [ -z "$cur" ]; then echo "window is not on any known display"; exit 0; fi
    idx=$(printf '%s' "$cur" | cut -f1); ret=$(printf '%s' "$cur" | cut -f7)
    printf 'app=%s window=%s display=%s retina=%s bounds=%s\n' "$APP" \
      "${TERM_WIN_ID:-frontmost}" "$idx" \
      "$( [ "$ret" = 1 ] && echo yes || echo no )" "$(win_get | tr ' ' ',')"
    ;;

  off-retina)
    cur="$(screen_of_window || true)"
    if [ -z "$cur" ] || [ "$(printf '%s' "$cur" | cut -f7)" != "1" ]; then
      echo "terminal is not on the Retina display — leaving it where it is"; exit 0
    fi
    target="$(non_retina_line || true)"
    if [ -z "$target" ]; then
      echo "no non-Retina display attached — nothing to move to, leaving it where it is"; exit 0
    fi
    place_on "$target"
    echo "moved terminal off the Retina display onto display $(printf '%s' "$target" | cut -f1)"
    ;;

  to-retina)
    target="$(retina_line || true)"
    [ -n "$target" ] || { echo "no Retina display attached — leaving the window where it is"; exit 0; }
    place_on "$target"
    echo "moved terminal onto the Retina display (display $(printf '%s' "$target" | cut -f1))"
    ;;

  shake)
    shake; echo "shook the \"$APP\" window"
    ;;

  summon)
    # Park it and raise it FIRST, so the sound and the wobble land together on a
    # window that is already where the user will be looking.
    target="$(retina_line || true)"
    [ -n "$target" ] && place_on "$target"
    raise
    [ -f "$SOUND" ] && afplay "$SOUND" &
    shake                      # runs while the sound plays, not after it
    wait 2>/dev/null || true
    echo "summoned: sound + shake, \"$APP\" raised${target:+ on the Retina display}"
    ;;

  *)
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
