---
name: why
description: Explains or audits Claude's own reasoning or a surprising choice in this session, reconstructed from the transcript and chain-of-thought. Trigger on "why did you...", investigating drift, or /why.
---

# Why — explain my own reasoning from the session trace

Reconstruct *why* I did what I did, grounded in the actual transcript: the captured
chain-of-thought **summaries** interleaved with the user / assistant / tool message
log. Use when the user asks "why did you X", wants reasoning audited, or is
investigating drift — never answer from memory of the conversation alone; read the
trace.

## Steps

1. **Extract the trace**:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/why/extract_reasoning.py" --tail 12
   ```

   - Defaults to the **current** session (newest `.jsonl` under `~/.claude/projects/`).
   - Focus on a specific decision: add `--grep "<keyword>"` (e.g. the file, tool, or
     topic the user named). Whole session: `--tail 0`. Untruncated text: `--full`.
   - A *different* session: `--session <path>`.

2. **Read the header.** It reports the `non-empty` thinking-summary count:
   - `non-empty > 0` → real captured reasoning exists in the `THINK:` lines — use it.
   - `non-empty = 0` → no summaries were captured (older session, `showThinkingSummaries`
     off, or the model didn't think). You must **infer** reasoning from the `SAY:` /
     `TOOL:` actions — say so plainly. **Do not invent a `THINK:` that wasn't there.**

3. **Explain, grounded in evidence.** For each decision the user cares about:
   - **What I was thinking** — quote/paraphrase the `THINK:` summary (the captured CoT).
   - **What I did** — the `SAY:` / `TOOL:` actions that followed it.
   - **Inference** — only where no `THINK:` exists; label it clearly as reconstruction.

   Tie thinking → action → outcome. Call out where the *stated* reasoning and the
   *actual* action diverged — that gap is the signal when investigating drift.

4. **State the caveat once:** `THINK:` lines are **summaries**, not the verbatim
   chain-of-thought, and per Anthropic's research may not be faithful to the true
   reasoning. Treat them as "what I said I was thinking," not ground truth.

## Prerequisite

`THINK:` summaries are captured only when `~/.claude/settings.json` has
`"showThinkingSummaries": true`, and only for sessions started after it was set.
Without it, `/why` still works but explains from the action log alone (and says so).

## Don't

- Don't fabricate reasoning for turns with an empty `THINK:` — infer, and label it.
- Don't present a summary as the literal raw chain-of-thought.
- Don't narrate the whole session when the user asked about one decision — `--grep` it.
