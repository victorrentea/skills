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

# Memoised: the display layout cannot change mid-command, and each call is a JXA
# process. Same reason every osascript here is fought over — one costs ~0.3s to
# start, while a hundred window moves *inside* one cost 3ms each.
SCREENS_CACHE=''
screens() {
  if [ -z "$SCREENS_CACHE" ]; then SCREENS_CACHE="$(bash "$HERE/screens.sh")"; fi
  printf '%s\n' "$SCREENS_CACHE"
}

# Which screen contains the window's centre point?
screen_of_window() {
  read -r wx wy ww wh <<<"$(win_get)"
  local cx=$(( wx + ww / 2 )) cy=$(( wy + wh / 2 ))
  screens | awk -v cx="$cx" -v cy="$cy" '
    { if (cx >= $2 && cx < $2 + $4 && cy >= $3 && cy < $3 + $5) { print; found=1; exit } }
    END { if (!found) exit 3 }
  ' || return 3
}

# Slide the window to its destination instead of teleporting it, so the eye can
# follow it across the monitors and land on it. Interpolated inside ONE osascript
# call — a process per frame costs ~50ms and there goes the animation. Eased at
# both ends (smoothstep), so it leaves and arrives gently.
# AppleScript's `delay` never gets below ~100ms however small a number you hand
# it, so the pace comes from the frame count instead: one window move costs ~3ms,
# which puts the default around two thirds of a second.
glide() { # x1 y1 w1 h1  x0 y0 w0 h0   (the from-geometry is passed in, never re-read)
  local x1="$1" y1="$2" w1="$3" h1="$4" x0="$5" y0="$6" w0="$7" h0="$8"
  local steps="${CBWD_GLIDE_STEPS:-200}"
  if [ "$x0" = "$x1" ] && [ "$y0" = "$y1" ] && [ "$w0" = "$w1" ] && [ "$h0" = "$h1" ]; then return; fi
  if [ "${CBWD_GLIDE:-1}" = "0" ] || [ "$steps" -lt 2 ]; then win_set "$x1" "$y1" "$w1" "$h1"; return; fi

  local body="set t to i / $steps
      set e to t * t * (3 - 2 * t)
      set nx to round ($x0 + ($x1 - $x0) * e) rounding to nearest
      set ny to round ($y0 + ($y1 - $y0) * e) rounding to nearest
      set nw to round ($w0 + ($w1 - $w0) * e) rounding to nearest
      set nh to round ($h0 + ($h1 - $h0) * e) rounding to nearest"

  # The exact landing is the script's last statement rather than a follow-up
  # win_set: that would be another 0.3s of process start for a 3ms move.
  if [ -n "$TERM_WIN_ID" ]; then
    osascript -e "tell application \"Terminal\"
      repeat with i from 1 to $steps
        $body
        set bounds of window id $TERM_WIN_ID to {nx, ny, nx + nw, ny + nh}
      end repeat
      set bounds of window id $TERM_WIN_ID to {$x1, $y1, $(( x1 + w1 )), $(( y1 + h1 ))}
    end tell" >/dev/null 2>&1 || true
  else
    osascript -e "tell application \"System Events\" to tell process \"$APP\"
      repeat with i from 1 to $steps
        $body
        set position of window 1 to {nx, ny}
        set size of window 1 to {nw, nh}
      end repeat
      set position of window 1 to {$x1, $y1}
      set size of window 1 to {$w1, $h1}
    end tell" >/dev/null 2>&1 || true
  fi
}

# Place the window centred on a screen line, shrinking it if it does not fit.
place_on() { # "idx x y w h scale retina primary"
  local sx sy sw sh; read -r _ sx sy sw sh _ _ _ <<<"$1"
  local wx wy ow oh; read -r wx wy ow oh <<<"$(win_get)"
  local maxw=$(( sw * 92 / 100 )) maxh=$(( sh * 92 / 100 )) ww="$ow" wh="$oh"
  [ "$ww" -gt "$maxw" ] && ww=$maxw
  [ "$wh" -gt "$maxh" ] && wh=$maxh
  # from-geometry is the window as it is now, so a size that has to shrink shrinks
  # over the trip instead of snapping on the first frame.
  glide $(( sx + (sw - ww) / 2 )) $(( sy + (sh - wh) / 2 )) "$ww" "$wh" "$wx" "$wy" "$ow" "$oh"
}

# A short horizontal wobble, so the summon is visible even with the volume down.
# Damped: each swing is a fraction of the one before, so it reads as a window
# settling down rather than a window being rattled — and it ends in place.
# The whole oscillation runs inside ONE osascript call: launching osascript per
# step costs ~50ms and turns a shake into a stutter.
shake() {
  [ "${CBWD_SHAKE:-1}" = "0" ] && return 0
  local px="${CBWD_SHAKE_PX:-26}" times="${CBWD_SHAKE_TIMES:-4}" frames="${CBWD_SHAKE_FRAMES:-260}"

  # A damped sinusoid: `times` swings there-and-back under an envelope that fades
  # to zero, so the window rings down and stops exactly where it started. The
  # offsets are computed here (awk has sin, AppleScript does not) and handed over
  # as a list — one number per frame keeps the script small and its compile fast.
  local offs
  offs="$(awk -v a="$px" -v c="$times" -v n="$frames" 'BEGIN {
    pi = 3.14159265358979
    for (i = 1; i <= n; i++) {
      t = i / n
      printf "%s%d", (i > 1 ? ", " : ""), int(a * (1 - t) ^ 1.6 * sin(2 * pi * c * t) + 0.5)
    }
  }')"

  if [ -n "$TERM_WIN_ID" ]; then
    osascript -e "tell application \"Terminal\"
      set b to bounds of window id $TERM_WIN_ID
      set l to item 1 of b
      set t to item 2 of b
      set r to item 3 of b
      set bt to item 4 of b
      repeat with o in {$offs}
        set bounds of window id $TERM_WIN_ID to {l + o, t, r + o, bt}
      end repeat
      set bounds of window id $TERM_WIN_ID to b
    end tell" >/dev/null 2>&1 || true
    return 0
  fi
  osascript -e "tell application \"System Events\" to tell process \"$APP\"
    set p to position of window 1
    set x0 to item 1 of p
    set y0 to item 2 of p
    repeat with o in {$offs}
      set position of window 1 to {x0 + o, y0}
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
    # Raise it BEFORE the move: the window slides across the monitors to the
    # Retina screen, and a slide nobody can see (because the window was buried)
    # is just a teleport. Sound and wobble then land together, on a window that
    # has already arrived where the user is looking.
    raise
    target="$(retina_line || true)"
    [ -n "$target" ] && place_on "$target"
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
