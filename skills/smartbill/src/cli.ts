/**
 * SmartBill CLI. Two engines behind one entry point.
 *
 * API commands (no browser, no login, ~200ms/call) - talk to ws.smartbill.ro:
 *   npm run sb -- series [--type factura|proforma|chitanta]
 *   npm run sb -- taxes
 *   npm run sb -- stocks [--date 2026-08-10] [--warehouse X] [--product Y]
 *   npm run sb -- read    --series S --number 324 [--full]
 *   npm run sb -- status  --series S --number 324
 *   npm run sb -- get     --series S --number 324 --out ./out [--name f.pdf]
 *   npm run sb -- recent  [--series S] [--count 10] [--json]
 *   npm run sb -- create  --json invoice.json
 *   npm run sb -- storno  --series S --number 324
 *   npm run sb -- pay     --json payment.json
 *   npm run sb -- cancel  --series S --number 324
 *   npm run sb -- restore --series S --number 324
 *   npm run sb -- rm      --series S --number 324
 *   npm run sb -- email   --series S --number 324 [--to a@b.c] [--subject ..] [--body ..]
 *
 * BROWSER commands (Playwright on cloud.smartbill.ro, need `login` first) -
 * these do what the API cannot:
 *   npm run sb -- login
 *   npm run sb -- touch                     -- keep the saved session from ageing out
 *   npm run sb -- list                     -- the ONLY way to enumerate documents
 *   npm run sb -- copy --template 10000000 --csv rows.csv --out ./out
 *   npm run sb -- edit --csv edits.csv --out ./out
 *   npm run sb -- pdf  --id 10000001 --out ./out [--name INV101.pdf]
 *   npm run sb -- reclient --name "New Ltd" [--address "line1\nline2"] [--city X]
 *                          (--ids 10000001,10000002 | --series A --from 101 --to 125)
 *                          [--dry-run] [--out ./out] [--csv names.csv]
 *
 * `reclient` rewrites the CUSTOMER stored on invoices that are already issued -
 * the one thing neither the API nor a plain re-save can do. Every document is
 * re-read from the PDF endpoint afterwards and the run stops on the first
 * invoice whose customer did not actually change.
 *
 * names.csv : number,filename                -- optional output names for --out
 *
 * rows.csv   : description[,filename]        -- one invoice per row
 * edits.csv  : id,description[,filename]     -- one existing invoice per row
 * Lines starting with # and blank lines are ignored. Values may be quoted.
 *
 * Add --headed to watch a browser command work. Progress is appended to smartbill.log.
 * Add --cdp http://127.0.0.1:9222 to drive a Chrome you are ALREADY signed into
 * (start it with --remote-debugging-port=9222) instead of running `login`.
 */
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as sb from './api.js';
import { pdfText, summarize } from './pdf.js';
import { recent, formatRecent } from './report.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (n: string) => argv.includes(`--${n}`);
const need = (n: string) => {
  const v = flag(n);
  if (!v) throw new Error(`--${n} required`);
  return v;
};

function parseCsv(path: string): string[][] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!
      .map(c => c.replace(/,$/, '').trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
      .filter((_, i, a) => i < a.length - 1 || a[i] !== ''));
}

const log = (line: string) => { console.log(line); appendFileSync('smartbill.log', line + '\n'); };
const out = (data: unknown) => console.log(JSON.stringify(data, null, 2));
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** Save PDF bytes, returning the path written. */
function savePdf(bytes: Buffer, dir: string, filename: string): string {
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, filename);
  writeFileSync(target, bytes);
  return target;
}

/* ------------------------------------------------------------------ *
 * API commands. Return true when handled, so we never launch a browser.*
 * ------------------------------------------------------------------ */
async function runApi(outDir: string): Promise<boolean> {
  switch (cmd) {
    case 'series': {
      for (const s of await sb.listSeries(flag('type'))) {
        console.log(`${s.name}\tnext=${s.nextNumber}\ttype=${s.type}`);
      }
      return true;
    }

    case 'taxes':  out(await sb.listTaxes()); return true;

    case 'stocks': out(await sb.listStocks({
      date: flag('date'), warehouseName: flag('warehouse'), productName: flag('product'),
    })); return true;

    case 'read': {
      const { bytes } = await sb.invoicePdf(need('series'), need('number'));
      const { text, pages } = await pdfText(bytes);
      if (has('full')) { console.log(text); return true; }
      out({ pages, ...summarize(text) });
      return true;
    }

    case 'status': out(await sb.paymentStatus(need('series'), need('number'))); return true;

    case 'get': {
      const series = need('series'), number = need('number');
      const { bytes, filename } = await sb.invoicePdf(series, number);
      log(`PDF ${series}${number} -> ${savePdf(bytes, outDir, flag('name') ?? filename ?? `${series}${number}.pdf`)}`);
      return true;
    }

    /* The API cannot enumerate documents - /series, /tax and /stocks are the only
     * list endpoints there are. This walks backwards from the series' next number
     * instead, which is the closest thing to a listing without a browser. */
    case 'recent': {
      const rows = await recent({ series: flag('series'), count: Number(flag('count', '10')) });
      if (has('json')) out(rows); else console.log(formatRecent(rows));
      return true;
    }

    case 'create': out(await sb.createInvoice(readJson(need('json')))); return true;
    case 'pay':    out(await sb.createPayment(readJson(need('json')))); return true;
    case 'storno': out(await sb.reverseInvoice(need('series'), need('number'), flag('date'))); return true;

    case 'cancel':  out(await sb.cancelInvoice(need('series'), need('number'))); return true;
    case 'restore': out(await sb.restoreInvoice(need('series'), need('number'))); return true;
    case 'rm':      out(await sb.deleteInvoice(need('series'), need('number'))); return true;

    case 'email': out(await sb.sendDocumentEmail({
      seriesName: need('series'), number: need('number'),
      type: flag('type') as any, to: flag('to'), cc: flag('cc'), bcc: flag('bcc'),
      subject: flag('subject'), bodyText: flag('body'),
    })); return true;

    default: return false;
  }
}

/* ------------------------------------------------------------------ *
 * Browser commands. Playwright is imported lazily so the API path stays *
 * fast and works even without `npx playwright install`.                 *
 * ------------------------------------------------------------------ */
const BROWSER_CMDS = ['login', 'list', 'pdf', 'copy', 'edit', 'reclient', 'touch'];

async function runBrowser(outDir: string): Promise<boolean> {
  // Check before importing, so an unknown command prints usage rather than
  // "no saved session" from open().
  if (!BROWSER_CMDS.includes(cmd)) return false;
  const { open, login, jitter } = await import('./session.js');
  const { list, createFromTemplate, editDescription, downloadPdf, url } = await import('./invoices.js');
  const { setInvoiceClient } = await import('./clients.js');

  if (cmd === 'login') { await login(); return true; }

  /* Django rolls a session forward on each request when SESSION_SAVE_EVERY_REQUEST
   * is on, so a periodic authenticated hit keeps `login` from ageing out. Re-saving
   * storageState afterwards captures whatever the server rotated. */
  if (cmd === 'touch') {
    const { STATE } = await import('./session.js');
    const { ctx, page, close } = await open({ headless: !has('headed'), cdp: flag('cdp') });
    try {
      const target = flag('url', '/raport/facturi/')!;
      const res = await page.goto(`https://cloud.smartbill.ro${target}`, { waitUntil: 'domcontentloaded' });
      const landed = page.url();
      const alive = !/\/auth\/login/.test(landed);
      if (alive && !flag('cdp')) await ctx.storageState({ path: STATE });
      out({ alive, status: res?.status() ?? null, landedOn: landed,
            sessionRefreshed: alive && !flag('cdp'),
            hint: alive ? undefined : 'session is gone - run: npm run sb -- login' });
      if (!alive) process.exitCode = 1;
      return true;
    } finally { await close(); }
  }

  const { page, close } = await open({ headless: !has('headed'), cdp: flag('cdp') });
  try {
    if (cmd === 'list') {
      for (const inv of await list(page)) console.log(`${inv.number}\t${inv.id}`);
      return true;
    }

    if (cmd === 'pdf') {
      const id = need('id');
      await page.goto(url.view(id), { waitUntil: 'domcontentloaded' });
      log(`PDF ${id} -> ${await downloadPdf(page, outDir, flag('name'))}`);
      return true;
    }

    if (cmd === 'copy') {
      const tpl = need('template');
      const rows = parseCsv(need('csv'));
      log(`Creating ${rows.length} invoices from template ${tpl}`);
      for (const [i, [description, filename]] of rows.entries()) {
        const num = await createFromTemplate(page, tpl, description);
        const file = await downloadPdf(page, outDir, filename);
        log(`[${i + 1}/${rows.length}] ${num}  ${file}`);
        await jitter();
      }
      return true;
    }

    if (cmd === 'edit') {
      const rows = parseCsv(need('csv'));
      log(`Rewriting ${rows.length} invoices`);
      for (const [i, [id, description, filename]] of rows.entries()) {
        const num = await editDescription(page, id, description);
        const file = await downloadPdf(page, outDir, filename);
        log(`[${i + 1}/${rows.length}] ${num}  ${file}`);
        await jitter();
      }
      return true;
    }
    if (cmd === 'reclient') {
      const want = {
        name: need('name'),
        address: flag('address')?.replace(/\\n/g, '\n'),
        city: flag('city'),
        county: flag('county'),
        country: flag('country'),
      };
      const dry = has('dry-run');

      // number <-> id both ways; ids alone cannot be verified against a PDF.
      const all = await list(page);
      const byNumber = new Map(all.map(i => [i.number.replace(/\s/g, ''), i.id]));
      const byId = new Map(all.map(i => [i.id, i.number.replace(/\s/g, '')]));

      let targets: { number: string; id: string }[];
      if (flag('ids')) {
        targets = flag('ids')!.split(',').map(s => s.trim()).filter(Boolean)
          .map(id => ({ id, number: byId.get(id) ?? '' }));
      } else {
        const series = need('series');
        const from = Number(need('from')), to = Number(need('to'));
        targets = [];
        for (let n = from; n <= to; n++) {
          const number = `${series}${n}`;
          const id = byNumber.get(number);
          if (!id) throw new Error(`${number} is not in the current report period`);
          targets.push({ number, id });
        }
      }

      const names = new Map<string, string>();
      if (flag('csv')) for (const [number, filename] of parseCsv(flag('csv')!)) names.set(number, filename);

      log(`${dry ? 'DRY-RUN: ' : ''}re-clienting ${targets.length} invoice(s) to "${want.name}"`);
      for (const [i, t] of targets.entries()) {
        const staged = await setInvoiceClient(page, t.id, want, { dryRun: dry });
        let verdict = dry ? 'staged (not saved)' : 'saved';

        // Ground truth is the PDF, not the form we just filled in.
        if (!dry && t.number) {
          const m = t.number.match(/^([A-Za-z]+)(\d+)$/);
          if (m) {
            const { bytes } = await sb.invoicePdf(m[1], m[2]);
            const { text } = await pdfText(bytes);
            const party = summarize(text).party ?? '';
            if (party.trim() !== want.name.trim()) {
              throw new Error(`${t.number}: PDF still shows "${party}" - stopping before the rest of the batch`);
            }
            // The name can land while the address silently does not - check both.
            const flat = text.replace(/\s+/g, ' ');
            for (const line of (want.address ?? '').split('\n').map(l => l.trim()).filter(Boolean)) {
              if (!flat.includes(line)) {
                throw new Error(`${t.number}: PDF is missing address line "${line}" - stopping before the rest of the batch`);
              }
            }
            verdict = 'verified in PDF';
            if (flag('out')) {
              savePdf(bytes, outDir, names.get(t.number) ?? `${t.number}.pdf`);
            }
          }
        }
        log(`[${i + 1}/${targets.length}] ${t.number || t.id}  ${verdict}  ${JSON.stringify(staged)}`);
        await jitter();
      }
      return true;
    }

    return false;
  } finally {
    await close();
  }
}

async function main() {
  const outDir = flag('out', './out')!;
  if (await runApi(outDir)) return;
  if (await runBrowser(outDir)) return;
  console.error(readFileSync(new URL('./cli.ts', import.meta.url), 'utf8').split('*/')[0]);
  process.exitCode = 1;
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
