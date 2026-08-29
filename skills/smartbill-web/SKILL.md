---
name: smartbill-web
description: Read, issue, rewrite and download invoices on SmartBill via one CLI with two engines - a fast REST API path and a Playwright fallback for what the API cannot do. Use when the user wants to read invoices or payment status, create many similar invoices from one template (e.g. one per training participant), mass-edit the description line of issued invoices, re-download PDFs, record payments, or cancel/storno a document. Trigger on "SmartBill", "facturi", "emite factura", "factura per participant", "cine nu a platit", "regenerate invoice PDFs". Do NOT use for accounting advice or anything outside SmartBill.
---

# SmartBill

One CLI, `npm run sb -- <cmd>`, with **two engines**. Picking the wrong one is the
main way to waste time here, so start with the table below.

```bash
cd "${CLAUDE_PLUGIN_ROOT:-$HOME/workspace/victor-skills}/skills/smartbill"
```

## Which engine

| Engine | How | Cost | Needs |
|---|---|---|---|
| **API** | REST on `ws.smartbill.ro` | ~200 ms/call | token in `~/.claude/smartbill.env` |
| **Browser** | Playwright on `cloud.smartbill.ro` | ~1.6 s/invoice + browser start | `sb -- login` once |

**Default to the API.** Fall back to the browser only for the three things the
API genuinely cannot do:

| Need | Why the API can't | Use |
|---|---|---|
| **Enumerate documents** | SmartBill's public API has no listing endpoint. Only `/series`, `/tax` and `/stocks` return lists — there is no `GET /invoices`. | `sb -- list` (browser) — or `sb -- recent`, see below |
| **Edit an issued invoice** | No update endpoint exists. The API can only create, cancel, storno or delete. | `sb -- edit` (browser) |
| **Copy an existing invoice** | No "duplicate document" endpoint. `create` needs the full client + line payload spelled out. | `sb -- copy` (browser) |
| **Change the customer on an issued invoice** | No update endpoint, and the client endpoints are read-only. | `sb -- reclient` (browser) |

Everything else — reading a document, payment status, PDFs, issuing, payments,
cancel/storno/delete, emailing — goes through the API.

## Setup

**API** (once): create `~/.claude/smartbill.env`, mode 600:

```
SMARTBILL_USERNAME=you@example.com
SMARTBILL_TOKEN=<token>
SMARTBILL_VAT_CODE=RO12345678
```

The token is in SmartBill Cloud → Contul meu → Integrari → API; the circular
arrow next to it regenerates it (do that if it ever leaks — a screenshot of that
page is enough to leak it). Env vars of the same names override the file. Never
pass the token on the command line; it would land in shell history.

**Browser** (once, and again whenever the session expires):

```bash
npm install && npx playwright install chromium
npm run sb -- login          # log in manually; cookies saved to storageState.json
```

`storageState.json` is gitignored.

## API commands

| Command | What it does |
|---|---|
| `sb -- series [--type factura\|proforma\|chitanta]` | series + the next number each will issue |
| `sb -- taxes` | VAT rates as name/percentage. **Read these before issuing** — names and rates differ per account and change over time |
| `sb -- stocks [--date] [--warehouse] [--product]` | stock levels as of a date |
| `sb -- read --series S --number 324 [--full]` | **reads the document**: date, due date, total, currency, counterparty, line items. `--full` dumps the raw text |
| `sb -- status --series S --number 324` | `invoiceTotalAmount` / `paidAmount` / `unpaidAmount` / `paid` |
| `sb -- get --series S --number 324 --out ./out [--name f.pdf]` | download the PDF |
| `sb -- recent [--series S] [--count 10] [--json]` | the closest thing to a listing without a browser — see below |
| `sb -- create --json invoice.json` | issue an invoice from a full payload (`invoice.example.json`) |
| `sb -- pay --series S --number 324 [--date] [--value] [--type] [--vat]` | record money received; amount, currency and client are read off the invoice |
| `sb -- pay --json payment.json` | the same, spelled out in full (`payment.example.json`) |
| `sb -- storno --series S --number 324` | reverse an invoice in full, into the same series |
| `sb -- cancel` / `restore --series S --number 324` | void / un-void; the number is kept, so the series has no gap |
| `sb -- rm --series S --number 324` | **irreversible**, and only allowed for the LAST invoice in a series |
| `sb -- email --series S --number 324 [--to] [--subject] [--body]` | SmartBill mails the document with the PDF attached |

### Recording a payment

`pay` needs no JSON file for the usual case. Given `--series` and `--number` it
reads the **amount, currency and counterparty off the invoice itself**, defaults
the value to whatever is still unpaid, and defaults the date to today:

```bash
npm run sb -- pay --series P --number 209 --date 2026-08-27 --vat NL001797931B01
```

It then **re-reads the payment status** and says `settled: true/false`, exiting
non-zero when the invoice is still open. A 200 from the POST is not evidence the
document is settled - only the status endpoint is. It also refuses to double-pay:
an invoice already marked paid comes back as `alreadyPaid` untouched.

Pick the value date from the payment advice, not from the day the email arrived -
those differ, and the advice is what the client's books show.

### Reading a document is a PDF operation

Issue date, client, line items and **currency** exist only inside the PDF — no
endpoint returns them. `status` deliberately does not say which currency its
numbers are in, so **never quote a figure from `status` alone**: reporting
"1250 RON" for a 1250 EUR invoice misstates it fivefold. Run `read` first.

`read` parses both SmartBill templates — the Romanian one for domestic clients
("Data emiterii" / "TOTAL PLATA") and the English one for foreign-currency
invoices ("Issue date" / "Total value"). A parser that only knows the first
returns blank fields for every EUR/USD invoice.

### `recent` — listing without a browser

There is no list endpoint, so `recent` reads the next number from `series` and
walks backwards, fetching each document. Output is
`doc / date / total / paid state / counterparty`, one line item under each.

```bash
npm run sb -- recent --count 10             # all invoice series
npm run sb -- recent --series S --count 20  # one series
npm run sb -- recent --json                 # for scripting
```

It costs one PDF download + one status call per invoice (throttled to 3 req/s,
SmartBill's cap), so it is fine for tens of documents and wrong for thousands.
Use it for "what did I issue lately", "who hasn't paid". When you need internal
document **ids** — which `edit` and `pdf --id` take — use `list` instead; ids
appear nowhere in the API.

## Browser commands

| Command | What it does |
|---|---|
| `sb -- login` | interactive login, saves cookies |
| `sb -- touch` | hit an authenticated page and re-save the session; keeps `login` from ageing out |
| `sb -- list` | `number<TAB>id` for every invoice in the current report period. **The only source of internal ids.** |
| `sb -- copy --template <id> --csv rows.csv --out ./out` | copies a template invoice once per CSV row, swaps the line description, issues it, downloads the PDF |
| `sb -- edit --csv edits.csv --out ./out` | rewrites the line description of existing invoices and re-downloads their PDFs |
| `sb -- pdf --id <id> --out ./out [--name INV101.pdf]` | re-download one PDF by internal id |
| `sb -- rmdraft --id <id>` | delete an **unnumbered draft** through the row menu; refuses anything issued |
| `sb -- inspect --id <id> [--page edit\|view\|report] [--js expr]` | read-only dump, for when SmartBill moves a selector |
| `sb -- reclient --name X [--address ..] [--city ..] (--ids .. \| --series S --from 1 --to 9)` | rewrite the **customer** on invoices already issued; verifies every PDF afterwards |

Add `--headed` to watch it work. Progress is appended to `smartbill.log`.

> `copy` was called `create` before the API path existed. `create` now means the
> API one, which builds an invoice from a JSON payload rather than from a template.

### CSV formats

`rows.csv` — one new invoice per line:

```csv
# description,filename(optional)
"One-day onsite workshop for employee Alex Smith, order REF-000101",INV101_Alex-Smith.pdf
```

`edits.csv` — one existing invoice per line:

```csv
# id,description,filename(optional)
10000001,"One-day onsite workshop for employee Alex Smith, order REF-000101",INV101_Alex-Smith.pdf
```

Get the ids from `list`.

### Changing the customer on an issued invoice

An invoice keeps its **own snapshot** of the client, frozen at issue time. Three
things follow, and each one has cost an afternoon:

- **Fixing the client record does not reach invoices already issued.** The
  nomenclator and the document are separate copies. A client whose name and
  address you corrected last week still prints the old ones on last month's
  invoices.
- **Re-saving the invoice does not refresh the snapshot either.** The invoice
  form does not even contain the client fields - they live in a separate form
  (`filter_form2_emitere`) that is not submitted with the document. SmartBill
  answers "Documentul a fost salvat cu succes!" and the PDF comes back byte-for-byte
  the same.
- **Only the "Modifica client existent" modal rewrites it**, opened by the
  page-global `edit_client()`. Its inputs must receive **real input events**;
  values assigned to `.value` from injected JS are dropped on save, which looks
  exactly like the silent no-op above.

`reclient` does that flow, then re-reads each document from the PDF endpoint and
checks the customer name **and every line of the address**. The name can land
while the address quietly does not, so checking only the name passes a batch
that is still wrong. The run stops on the first document that did not change,
rather than working through the other twenty-four.

```bash
npm run sb -- reclient --series P --from 210 --to 234 \
  --name 'New Name B.V.' --address 'T.a.v. Dept\nStreet 18\n1234 AB' --city 'Utrecht' \
  --out ./out --csv names.csv        # names.csv: number,filename
```

Add `--dry-run` to stage the modal without saving the document.

### How long a login lasts, and keeping it alive

`sessionid` is a **browser-session cookie** - no expiry of its own - so `login`
writing it to `storageState.json` is what lets the CLI keep working after the
browser closes. Do not read the other cookies as a lifetime: `srvid` and `dsc`
carry 30-day expiries but have nothing to do with authentication. What ends the
session is the **server**, and observed behaviour is an **idle timeout measured
in hours**, not days.

```bash
npm run sb -- touch                    # {"alive":true,"sessionRefreshed":true}
bin/install-launchd.sh 900             # touch every 15 min, forever
bin/session-lab.sh status              # age, touches, deaths
bin/install-launchd.sh --uninstall
```

`touch` exits non-zero when the session is gone, so it doubles as a health check
before a long batch. launchd rather than cron: a crontab on recent macOS needs
Full Disk Access or it dies silently.

Run `bin/session-lab.sh reborn` right after `login` so the age clock restarts.

**Measuring, without a second account.** Two different questions hide here, and
one experimental design answers both:

- *How long does an idle session last?* `bin/session-lab.sh pause 4h` stops the
  touches. Whether the next touch after the gap finds the session alive is the
  measurement.
- *Does touching keep it alive forever, or is there an absolute cap?* The log
  answers on its own. If the session dies while touches were landing, the
  `ageMinutes` at death is the cap.

**Do not** try to build a control arm by copying `storageState.json`. Every copy
carries the same `sessionid` and therefore touches the same server-side session:
keeping one alive keeps them all alive, and the "control" measures nothing. An
independent control needs a second real login.

One more trap: do not take `storageState.json`'s mtime as the session's birth.
`touch` rewrites that file every run, so the mtime is always "just now" and the
age at death - the single number that reveals an absolute cap - reads as zero
forever. `session-lab.sh` stamps the birth once, in its own file.

### Driving a browser you are already signed into

`--cdp http://127.0.0.1:9222` attaches to a running Chrome instead of using the
saved `login` session. Use it when the account owner is not at the keyboard, or
when you want the automation to share a session a human keeps alive.

Chrome 136 and later **refuse remote debugging on the default profile** - that
hole was being used to lift cookies - so this needs its own profile directory,
signed into SmartBill once:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-smartbill"
```

Do not try to reach the session by reading Chrome's cookie store instead: those
files are encrypted against the login keychain, and copying them around is
credential theft with extra steps.

### page.evaluate and the `__name` helper

The CLI runs through `tsx`, whose esbuild pass rewrites arrow functions with a
`__name` helper. That helper does not exist inside the page, so **a function
passed to `page.evaluate` / `page.waitForFunction` dies with
`ReferenceError: __name is not defined`**. Pass a **string expression** instead,
interpolating any values with `JSON.stringify`. Everything in `clients.ts` does.

### Deleting a draft

`rm` goes through the API and needs a series and a number; a draft has neither,
so the only way to clear one is the row menu in the invoice report - the same
clicks a human makes. `rmdraft` does exactly that, and three details make the
difference between working and silently doing nothing:

- **Open the row menu first.** `ul.dropDown.tools_<id>` is `display:none` until
  `li.unelte_ico_<id>` is clicked (it calls `show_tools(<id>)`). Clicking Delete
  without it just retries against an invisible element until it times out.
- **Confirm inside the dialog.** A page-wide search for a "Sterge" button finds
  the menu link you just clicked before it finds the dialog's button, so the menu
  reopens and nothing is deleted - which looks exactly like a click that missed.
- **Refuse anything that is not a draft.** The row carries `span.is_draft`, and
  the dialog itself warns that deleting a finalised document *rolls the series
  number back to the previous one*. On a page full of issued invoices, a mistyped
  id must not be able to do that.

Playwright also **dismisses native dialogs by default**, so if a delete ever
hides behind `window.confirm()` it cancels itself. `rmdraft` accepts them.

### Prefer `create` over `copy` for bulk issuing

**`copy` no longer issues anything.** SmartBill's copy flow now ends in an
UNNUMBERED draft that needs a confirmation step, and the control that used to
provide it - `#view_save_disposition` inside `iframe[src*=compact-view]` - is
gone, along with the EMISA badge and `#viewer_pdf_id` next to it. A run reports
failure while having created a document, so re-running silently issues the same
line twice. `copy` now stops and names the leftover instead, but the leftover
still has to be deleted by hand: `rm` needs a series and a number, and a draft
has neither.

Issue in bulk through the **API** instead. `create` numbers and issues the
document in one call, returns the number, and never opens a browser:

```bash
npm run sb -- create --json one-invoice.json     # -> {"series":"P","number":"235"}
npm run sb -- get --series P --number 235 --out ./out --name whatever.pdf
```

Spelling out ~20 fields per invoice was the reason `copy` existed, but that is
what a loop is for: generate the payloads from your own data, POST each one,
then re-read each PDF and check the party, the total and the line before moving
on. A 22-invoice batch this way took under two minutes with every document
verified, after `copy` could not manage one.

When comparing a line against the PDF, **squeeze whitespace on both sides**. The
PDF wraps long lines and extraction turns the break into a space, so
`RAB-425628` reads back as `RAB- 425628` and a strict equality check fails on a
perfectly good invoice.

### Why bulk issuing stayed on the browser (historical)

`copy` inherits client, currency, VAT rate, payment term and price from the
template and changes only the description — one CSV column instead of the ~20
fields `create` needs per invoice. For "one invoice per training participant"
that is both less typing and less to get wrong.

**Do not drive SmartBill by screenshot-and-click.** The UI shifts vertically
between loads and coordinate clicks land on the wrong field — that is how a
description once ended up in the BT-154 field. Everything below waits on
selectors and verifies the line text before saving.

### How it maps to the UI

| Step | URL / selector |
|---|---|
| copy an invoice | `/documente/copiaza/factura/<templateId>/` |
| edit an issued one | `/documente/editare/factura/<id>/` |
| open the line editor | `a.emitere_edit` (pencil on line 1) |
| description field | `[name="edit_product_name"]` — **not** `[name="edit_product_description"]`, that is BT-154 |
| apply | submit button of the *Modificare produs* modal |
| save | `#saveInvoiceBtn` |
| confirm (drafts only) | `#view_save_disposition` — **inside the viewer iframe** |
| PDF | `#viewer_pdf_id` — **inside the viewer iframe** |

### The iframe trap

After `#saveInvoiceBtn`, SmartBill renders the document inside
`iframe[name="show_document_iframe"]` (`/documente/compact-view/factura/<id>/`).
The confirm button, the PDF icon and the `EMISA` badge all live **in that frame**.
Querying the main document for them returns nothing — which reads exactly like
"the save silently failed" when in fact it succeeded. Use `page.frameLocator(...)`
(helper `viewer(page)` in `invoices.ts`).

Two traps inside the trap:

- the iframe does **not** always carry `name="show_document_iframe"` — match on
  `src*="compact-view"`;
- `#view_export_disposition` exists in the main document too, but it is hidden and
  clicking it dumps you on the dashboard. The real PDF button is `#viewer_pdf_id`
  inside the frame.

### Why the browser path must be Playwright, not injected JS

Injected JS can do the edit and the save (~1.6 s round-trip). It **cannot** do
the PDF export: a programmatic `.click()` carries no user activation, so Chrome
silently refuses the download — no file, no error. Playwright dispatches real
input events through CDP, so `waitForEvent('download')` works.

## Cost

| Operation | Time |
|---|---|
| any API call | ~200 ms (throttled to 3/s) |
| `recent`, per invoice | ~700 ms (PDF + status) |
| browser `copy`/`edit`, per invoice | ~1.6 s (573 ms modal + 992 ms save) |
| the same by screenshot-and-click | ~45 s — almost all of it fixed sleeps |

## Rules

- **Issuing, cancelling and deleting touch real fiscal documents.** Confirm client,
  amounts and VAT rate with the user before `create`, `copy`, `storno`, `cancel`
  or `rm`. Pass `"isDraft": true` while details are unsettled.
- `rm` is irreversible and only works on the last invoice in a series. Prefer
  `cancel` (reversible) or `storno` (leaves an accounting trail).
- `email` sends real mail to a real client. Confirm the recipient first.
- Invoice numbers go in **as printed**, leading zeros included — `0159`, not `159`
  on accounts that pad. An unpadded number comes back as "not found".
- Run `taxes` and `series` before issuing rather than reusing remembered values.
- After typing a description, the browser path waits for that text to appear in
  the line row; if it does not, it throws instead of saving a wrong invoice.
- Sleeps are 1–2 s with jitter, only *between* invoices. Never sleep to "wait for
  the page" — that is what `waitForSelector` is for.
- One invoice line only in `copy`/`edit`. Multi-line invoices need
  `setLineDescription` to take an index.
- Dry-run with `--headed` on one row before a bulk run.
- After any browser write, **verify against the PDF endpoint**, never against the
  form you just filled in. The form reports what you typed; the PDF reports what
  was stored. Reading the modal back after it closes is worse than useless - it
  has been reset by then, so it reports blanks for a change that did land.

## Claude Desktop

A Claude *Skill* is useless in Desktop: skills run in Anthropic's sandbox, which
has **no network access and no access to this machine** — so the API calls, the
credentials file and the local Chromium are all out of reach. An **MCP server**
is spawned as a local process instead, so it can do all three.

`src/mcp.ts` exposes the same operations as tools, delegating to the same
`api.ts` / `report.ts`. It is already wired into
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
"smartbill": { "command": "/absolute/path/to/skills/smartbill/bin/smartbill-mcp.sh" }
```

Spelled out in full on purpose: Desktop expands neither `~` nor
`$CLAUDE_PLUGIN_ROOT` in this file, so it is the one place a hardcoded
absolute path is correct. Move the checkout and this line must be edited by hand.

Restart Desktop after changing that file — it is not re-read while running.

Two reasons it points at a shell script rather than at `node` directly:

- Desktop spawns servers with a **minimal environment**, not your login shell, so
  `node` is not on PATH and `"command": "npx"` fails with `spawn ENOENT`;
- node here comes from nvm, so the absolute path carries a version number
  (`~/.nvm/versions/node/v22.21.1/bin/node`) that breaks on the next patch
  release. The launcher asks nvm for its `default` alias at startup instead.

The token is **not** in the Desktop config — the server reads
`~/.claude/smartbill.env` like the CLI does, so the config file stays free of
secrets.

Tools: `smartbill_series`, `_taxes`, `_stocks`, `_read_invoice`,
`_payment_status`, `_recent`, `_download_pdf`, `_list_documents`,
`_create_invoice`, `_record_payment`, `_reverse_invoice`, `_cancel_invoice`,
`_restore_invoice`, `_delete_invoice`, `_send_email`.

`copy` and `edit` are deliberately **not** exposed as tools. They drive a browser
for ~1.6 s per invoice and are fed from CSV files; that belongs in a terminal.
Run them from the CLI.

## Layout

| File | |
|---|---|
| `src/api.ts` | REST client, credentials, typed calls |
| `src/pdf.ts` | PDF text extraction + the two-template parser |
| `src/report.ts` | `recent` — walking a series backwards; shared by the CLI and the MCP server |
| `src/invoices.ts` | Playwright flows and selectors |
| `src/session.ts` | browser session / login |
| `src/cli.ts` | argument parsing; API commands dispatch before Playwright is imported |
| `src/mcp.ts` | MCP server for Claude Desktop |
| `bin/smartbill-mcp.sh` | launcher that resolves node for a minimal-env spawn |
| `invoice.example.json`, `payment.example.json` | payloads for `create` / `pay` |
| `rows.example.csv`, `edits.example.csv` | inputs for `copy` / `edit` |

The API layer is a flattened port of [bogdanripa/smartbill-mcp](https://github.com/bogdanripa/smartbill-mcp)
— same endpoints and payload shapes, no MCP server to run.
