# Open findings

From a code review on 2026-08-29 of that day's rewrites. The confirmed bugs were
fixed the same day; what follows is what was left. Each entry says how to settle
it, because most are cheap to check and expensive to assume.

## Verify before trusting

**`reclient --dry-run` may not be inert.** `clients.ts` clicks `#addClientBtn`
("Salveaza date client") even in dry-run — only the *invoice* save is skipped.
The modal is titled "Modifica client **existent**", which suggests that button
posts to the client nomenclator. If it does, a dry run rewrites the client record
for every future invoice while reporting "staged (not saved)".
*Settle it:* `inspect` the modal's form action, or dry-run against a throwaway
client and re-read it. If it posts, move the dry-run exit to before the click —
the `staged` values are already read by then.

**`summarize().party`** (`pdf.ts`) takes whatever sits between "Furnizor Client"
and the first "CIF:" in extraction order. Correct on the current template, one
column reflow away from returning the *supplier* instead of the customer. Both
`pay` (counterparty) and `reclient` (verification) lean on it.
*Settle it:* assert the parsed party is not the issuer's own name.

## Weak verification

**Description check is scoped to the whole page** (`invoices.ts`): it searches
the last 30 characters of the description across `document.body`. Two ways to
pass without the edit landing — a description whose 30-character tail matches
what the template already shows, or any other occurrence of that text elsewhere
on the page. Scope the search to the line row.

**`reclient --ids` skips PDF verification** for ids outside the current report
period, while the CLI header and SKILL.md both promise every document is re-read.
Either verify by id, or make the log line say "saved, NOT verified" and correct
the docs.

**County is second-class**: filled by `reclient`, absent from the read-back and
never checked in the PDF. A silently dropped county passes a whole batch.

## Simplification

**Three hand-rolled deadline-poll loops** in `cli.ts` (series advance; row gone
after delete) and `invoices.ts` (description visible). One
`pollUntil(fn, {timeoutMs, intervalMs, failMsg})` in `session.ts` collapses all
three and gives them one error format. The `whatsapp-web` skill has the same
shape twice more.

**`resolve_node()` and the three-state JSONL logging are duplicated verbatim**
between this skill's `bin/session-lab.sh` and `whatsapp-web/bin/keepalive.sh`,
and the two `install-launchd.sh` are ~90% identical. They live in different
repos, so this one must stay self-contained; the private one could source a
shared file.

## Dead code

- `S_CLIENT.editPencil` (`clients.ts`) — never used; `openClientModal` calls
  `edit_client()` directly.
- `open()`'s `downloadDir` option (`session.ts`) — declared, never read.
- `estimatePdf` / `estimateInvoices` (`api.ts`) — exported, imported nowhere.
- `listStocks` (`api.ts`) — `{ date: o.date ?? today, ...o }` spreads `o` last,
  so an explicit `date: undefined` from the CLI overrides the default and it
  never applies. Two-character fix: spread first, default after.

## Stale docs

The command table and the CLI header still say `edit … --out ./out` re-downloads
PDFs. It does now (fixed the same day) — but check the wording still matches
after any further change to `edit`.
