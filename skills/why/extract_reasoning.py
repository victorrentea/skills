#!/usr/bin/env python3
"""
extract_reasoning.py — distill a Claude Code session transcript into a compact,
labeled reasoning trace for the /why skill.

It interleaves, in order:
  USER:  genuine user prompts
  THINK: the assistant's captured chain-of-thought SUMMARY for that turn
         (only present when showThinkingSummaries was on; empty otherwise)
  SAY:   the assistant's visible reply (truncated)
  TOOL:  each tool the assistant invoked (name + key args)
  ERR:   tool results that were errors

so /why can explain *why* the assistant did what it did, grounding each step in
the THINK summary when available and flagging where it must infer instead.

Usage:
  extract_reasoning.py [--session PATH] [--tail N] [--full] [--grep TEXT]

  --session PATH   transcript .jsonl (default: the most recently modified one
                   under ~/.claude/projects/, i.e. the current session)
  --tail N         only the last N user-exchanges (default: 12; 0 = all)
  --full           don't truncate THINK/SAY text
  --grep TEXT      only show exchanges whose text mentions TEXT (case-insensitive)
"""
from __future__ import annotations
import argparse
import glob
import json
import os
import sys

PROJECTS = os.path.expanduser("~/.claude/projects")


def newest_transcript() -> str | None:
    files = glob.glob(os.path.join(PROJECTS, "**", "*.jsonl"), recursive=True)
    return max(files, key=os.path.getmtime) if files else None


def _trunc(s: str, n: int, full: bool) -> str:
    s = (s or "").strip().replace("\n", " ⏎ ")
    if full or len(s) <= n:
        return s
    return s[:n] + f" …[+{len(s) - n}c]"


def _tool_args(inp) -> str:
    if not isinstance(inp, dict):
        return ""
    for k in ("file_path", "command", "path", "url", "pattern", "query",
              "description", "prompt", "skill", "subagent_type", "old_string"):
        if k in inp and isinstance(inp[k], str):
            v = inp[k].strip().replace("\n", " ")
            return f"{k}={v[:80]}"
    keys = ",".join(list(inp.keys())[:4])
    return keys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--session")
    ap.add_argument("--tail", type=int, default=12)
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--grep")
    a = ap.parse_args()

    path = a.session or newest_transcript()
    if not path or not os.path.exists(path):
        print("No transcript found under ~/.claude/projects/", file=sys.stderr)
        return 1
    txt_cap = 10_000 if a.full else 600
    say_cap = 10_000 if a.full else 220

    # Build an ordered list of "exchanges": each starts at a genuine user prompt.
    exchanges: list[dict] = []
    cur: dict | None = None
    n_think = n_think_ne = n_tools = 0

    def push_event(ev):
        nonlocal cur
        if cur is None:  # events before the first user prompt (session bootstrap)
            cur = {"user": "(session start / system)", "events": []}
            exchanges.append(cur)
        cur["events"].append(ev)

    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            msg = o.get("message")
            if not isinstance(msg, dict):
                continue
            role = msg.get("role")
            content = msg.get("content")

            if role == "user":
                # genuine prompt = string, or a list that contains a text block.
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    texts = [b.get("text", "") for b in content
                             if isinstance(b, dict) and b.get("type") == "text"]
                    is_tool_result = any(isinstance(b, dict) and b.get("type") == "tool_result"
                                         for b in content)
                    if is_tool_result and not texts:
                        # tool result feeding back to the model — note errors only
                        for b in content:
                            if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error"):
                                push_event(("ERR", "tool returned an error"))
                        continue
                    text = "\n".join(t for t in texts if t)
                else:
                    continue
                # skip pure system-reminder noise as a "prompt" if empty
                cur = {"user": text, "events": []}
                exchanges.append(cur)

            elif role == "assistant" and isinstance(content, list):
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    bt = b.get("type")
                    if bt == "thinking":
                        n_think += 1
                        t = (b.get("thinking") or "").strip()
                        if t:
                            n_think_ne += 1
                            push_event(("THINK", t))
                    elif bt == "text":
                        t = (b.get("text") or "").strip()
                        if t:
                            push_event(("SAY", t))
                    elif bt == "tool_use":
                        n_tools += 1
                        push_event(("TOOL", f"{b.get('name','?')}({_tool_args(b.get('input'))})"))

    if a.grep:
        g = a.grep.lower()
        exchanges = [e for e in exchanges
                     if g in e["user"].lower()
                     or any(g in str(v).lower() for _, v in e["events"])]
    if a.tail and a.tail > 0:
        exchanges = exchanges[-a.tail:]

    fname = os.path.basename(path)
    print(f"# Reasoning trace — {fname}")
    print(f"# thinking_blocks={n_think} (non-empty={n_think_ne})  tool_calls={n_tools}")
    if n_think_ne == 0:
        print("# NOTE: 0 captured chain-of-thought summaries — either showThinkingSummaries")
        print("#       was off when this session ran, or the model didn't think (adaptive).")
        print("#       /why must INFER reasoning from the actions below, not from THINK lines.")
    print("# CAVEAT: THINK lines are SUMMARIES, not the verbatim chain-of-thought, and")
    print("#         per Anthropic's research may not be faithful to the true reasoning.")
    print()
    for i, e in enumerate(exchanges, 1):
        print(f"[{i}] USER: {_trunc(e['user'], txt_cap, a.full)}")
        for kind, val in e["events"]:
            if kind == "THINK":
                print(f"    THINK: {_trunc(val, txt_cap, a.full)}")
            elif kind == "SAY":
                print(f"    SAY:   {_trunc(val, say_cap, a.full)}")
            elif kind == "TOOL":
                print(f"    TOOL:  {val}")
            elif kind == "ERR":
                print(f"    ERR:   {val}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
