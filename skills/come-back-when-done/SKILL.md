---
name: come-back-when-done
description: Use when the user asks to be fetched once the work is finished — "come back when done", "come get me when it's ready", "call me when you finish", "let me know when done", „anunță-mă când e gata", „strigă-mă când termini", or the /come-back-when-done command. Clears the terminal off the Retina screen up front so the user can walk away and use that screen, then plays a sound and pulls the terminal back in front of them at the very end of the turn. Do NOT trigger on a mere mention of finishing, only on an actual request to be summoned.
---

# Come back when done

The user is stepping away. Two things happen — one now, one at the very end of the
turn — and both are one command each.

## 1. Immediately, before any other work

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/come-back-when-done/terminal.sh" off-retina
```

This frees the Retina screen: if the terminal window is sitting on it, the window
is moved to the roomiest non-Retina display. If it is already elsewhere, or there
is no second display, the script says so and changes nothing.

Do this **first**, before starting the actual task — the point is that the user
can walk away right now, not after the work finishes. Say one short line
confirming it, then get on with the real work.

## 2. As the last tool call of the turn

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/come-back-when-done/terminal.sh" summon
```

Moves the terminal back onto the Retina display, raises it, then plays a sound and
gives the window a short wobble at the same time — so the summon still registers
when the volume is down. Run it **after** everything else is finished, including
the final summary — it is the signal that the turn is over, so anything that
happens after it is something the user has already been told is done.

If the work ends in a question rather than a finished result, still summon: the
user asked to be fetched, and a blocked task is exactly when being fetched matters.

## Rules

- Only on an explicit request to be summoned. Never wire this into a Stop hook or
  run it on every long turn — an unrequested noise on every task is the thing the
  user does not want.
- Never claim the work is done just because the summon ran. Report the real
  outcome, including failures, exactly as you otherwise would.

## Checking and overriding

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/come-back-when-done/terminal.sh" where   # which display, is it Retina
bash "${CLAUDE_PLUGIN_ROOT}/skills/come-back-when-done/screens.sh"          # all displays, TSV
```

Nothing is hardcoded: the Retina display is whichever one reports a backing scale
factor of 2 or more, and the terminal app is derived from `$TERM_PROGRAM`. Two
environment variables override the guesses if needed:

| variable | use |
|---|---|
| `CBWD_TERMINAL_APP` | process name to drive, e.g. `Terminal`, `iTerm2`, `Ghostty`, `Code` |
| `CBWD_WINDOW_ID` | Apple Terminal window id to drive, skipping tty resolution |
| `CBWD_SOUND` | path to a different sound file |
| `CBWD_SHAKE=0` | turn the wobble off |
| `CBWD_SHAKE_PX` / `CBWD_SHAKE_TIMES` | wobble amplitude in pixels (default 14) and number of oscillations (default 3) |

`where` prints the window it resolved, so it doubles as the check that the right
one is being driven.

On Apple Terminal nothing else is needed. On any other terminal the fallback path
moves windows through System Events, which needs **Accessibility** permission
(System Settings → Privacy & Security → Accessibility); the scripts fail with that
exact hint if it is missing.

## Notes

- macOS only. Display geometry comes from AppKit's `NSScreen` via JXA, which ships
  with the OS — there is nothing to install.
- The window moved is **this session's own**, not the frontmost one. That matters
  whenever more than one terminal window is open: System Events' `window 1` is
  whichever window is in front at that instant, so a session that summoned itself
  could drag an unrelated window — including another Claude session's — across the
  desktop. On Apple Terminal the own window is found by walking up the process tree
  to the outermost tty (the shell's own tty is invisible here, and wrappers like
  `kiro-cli-term`, `tmux` or `script` insert an inner pty that must be skipped),
  matching that tty against Terminal's tabs, and then addressing the window by its
  stable id — which also means Terminal moves its own windows, with no System
  Events and no Accessibility grant.
- `NSScreen` reports Cocoa coordinates (origin bottom-left, y upwards) while
  window positions use top-left origin with y downwards. `screens.sh` flips the
  axis, so every coordinate the other commands touch is already in window space.
- With no Retina display attached, both moves become no-ops and say so; the summon
  still plays its sound and raises the window.
