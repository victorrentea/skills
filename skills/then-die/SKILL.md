---
name: then-die
description: Close this terminal window after the work, if it all went fine.
disable-model-invocation: true
---

# Then die

The user is walking away and does not intend to read this window again. Do the
work they asked for, and if it ended cleanly, close the window behind you.

## The bargain

Closing the window destroys everything on screen, including the summary you would
otherwise have written — anything printed after the closing command is never seen.
So the window may only close when there is **nothing left for the user to read**.

Finish the entire task first. Then, as the **very last tool call of the turn**:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/then-die/die.sh" close "one-line summary of what was done"
```

The summary argument is appended to `~/.claude/then-die.log` (timestamp, working
directory, text) — it is the only trace the user gets of a turn that closed itself,
so write it as the one line you would want to read tomorrow. The full transcript
survives too: `claude --resume` in the same folder reopens the session.

## Die only if ALL of these hold

- Every part of the requested work is **finished**, not partially done or deferred.
- Nothing failed: builds, tests, linters, deploys you ran all passed. If you did
  not run the checks the change obviously called for, that counts as unfinished.
- You have **no question** for the user — no ambiguity you resolved by guessing
  and wanted to flag, no "I assumed X, tell me if that's wrong".
- You have **no warning** — nothing surprising found, no risk introduced, no
  follow-up the user needs to know about, no unrelated breakage discovered.
- Nothing is still running that the user might want to watch, and no output
  matters that exists only on this screen.
- The turn produced no result that is **only** useful on screen (a diff you were
  asked to read out, an answer to a question, a table of findings). If the user
  asked to be *told* something rather than to have something *done*, stay.

## Otherwise: stay alive

If any condition fails, **do not run the script**. Report normally, ending with a
plain line saying why the window is still open — e.g. "Not closing: 2 tests fail"
or "Not closing: needs your call on the migration order". That sentence is the
whole point of staying; do not bury it.

Staying is never a failure of the skill. A window left open with a real question
in it is exactly right; a window closed over a broken build is the one outcome
that costs the user something.

## Rules

- Invocation is the user's alone (`disable-model-invocation`). Never wire it into
  a Stop hook and never offer it — a turn that "felt complete" is not a reason.
- Never close early to signal progress — one turn, one death, at the very end.
- Never claim success just to be allowed to close. If in doubt, stay.
- The turn's real outcome still gets written normally before the call, even though
  the window eats it: the transcript keeps it, and the user may resume.

## Checking

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/then-die/die.sh" where
```

Dry run: prints the terminal app, the resolved tty, the login shell, the window id
and which method `close` would use — without closing anything. If it prints
`method: NONE`, the session's own window cannot be resolved; `close` will refuse
and change nothing, so just report the result normally.

## Notes

- macOS only. The window closed is **this session's own**, never the frontmost
  one — resolved by walking up the process tree to the outermost tty, so a second
  Claude session in another window is never killed by mistake.
- On Apple Terminal the tty is matched to a tab and the window is closed by its
  stable id. Everywhere else (iTerm2, Ghostty, WezTerm, Warp, VS Code's panel) the
  login shell on that tty is sent SIGHUP — that closes the tab, and the window with
  it if it was the last tab, without ever quitting the whole app. Closing VS Code
  itself, in particular, is not something this does.
- The kill is detached and delayed ~0.4s so the tool call returns success before
  the process running it disappears; the closing is never reported as a failure.
- Inside `tmux` this ends the client, not the tmux session — reattach and the work
  is still there.
- Overrides: `THEN_DIE_TERMINAL_APP`, `THEN_DIE_WINDOW_ID` (Apple Terminal window
  id), `THEN_DIE_LOG` (default `~/.claude/then-die.log`), `THEN_DIE_DELAY`.
