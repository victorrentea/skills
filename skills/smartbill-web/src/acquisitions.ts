/**
 * Cheltuieli (expenses) and bank-statement reconciliation.
 *
 * All three reports below are Vue front-ends over plain JSON POST endpoints, so
 * none of this needs to click anything: `open()` gives a browser context whose
 * cookie jar is already signed in, and `ctx.request` replays the same POST the
 * page makes. That is ~200 ms per report instead of ~6 s of page boot, and the
 * rows come back as data rather than as scraped cells whose column order moves.
 *
 * The one thing that is NOT optional: these endpoints are Django views, so the
 * POST needs the `csrftoken` cookie echoed back in `X-CSRFToken`. Without it the
 * server answers 403 with an HTML page, which JSON.parse turns into a confusing
 * "Unexpected token <".
 */
import { open, BASE, type Session } from './session.js';

const DOC_TYPES = 'Factura,Proforma,Bon fiscal,Aviz,Carnet comercializare,Altul';

/** dd/mm/yyyy, which is the only date format these endpoints accept. */
export const ro = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

/** Accepts dd/mm/yyyy or yyyy-mm-dd and returns dd/mm/yyyy. */
export function asRoDate(s: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : s;
}

/** dd/mm/yyyy -> Date (local), for arithmetic on day distances. */
export const parseRo = (s: string) => {
  const [d, m, y] = s.split('/').map(Number);
  return new Date(y, m - 1, d);
};

async function post(s: Session, path: string, form: Record<string, string>, referer: string) {
  const csrf = (await s.ctx.cookies()).find(c => c.name === 'csrftoken')?.value ?? '';
  const res = await s.ctx.request.post(BASE + path, {
    form,
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': csrf, Referer: BASE + referer },
  });
  if (!res.ok()) throw new Error(`${path} -> HTTP ${res.status()}`);
  const body = await res.text();
  let json: any;
  try { json = JSON.parse(body); } catch { throw new Error(`${path} -> not JSON: ${body.slice(0, 200)}`); }
  if (json.successfully === false) throw new Error(`${path} -> ${json.errorText || json.message}`);
  return json;
}

/* ------------------------------------------------------------------ expenses */

export interface Expense {
  docId: number;
  doc: string;          // "Fact RIDPJ-0323019"
  number: string;
  supplier: string;
  cif: string;
  date: string;         // dd/mm/yyyy
  due: string;
  total: number;        // with VAT, in `currency`
  totalRon: number;
  currency: string;
  paid: number;
  remaining: number;
  status: string;       // De verificat / Inregistrata / ...
  payable: boolean;
  source: string;
}

export async function expenses(
  s: Session,
  opts: { from: string; to: string; page?: number; perPage?: number } ,
): Promise<Expense[]> {
  const all: Expense[] = [];
  const perPage = opts.perPage ?? 200;
  for (let page = opts.page ?? 1; ; page++) {
    const json = await post(s, '/achizitii/raport/documente_furnizori/v2/ajax/', {
      sSearch: JSON.stringify({
        from: asRoDate(opts.from), to: asRoDate(opts.to),
        documentType: DOC_TYPES, page, resultsPerPage: perPage,
      }),
      networkEnabled: 'false',
      sessionKey: '',
    }, '/achizitii/raport/documente_furnizori/');
    const docs: any[] = json.documents ?? [];
    for (const d of docs) {
      all.push({
        docId: d.docId, doc: d.docTypeAndSerieAndNo, number: d.nrDoc,
        supplier: d.supplierName, cif: d.supplierCif,
        date: d.docDate, due: d.dueDate,
        total: d.totalWithVat, totalRon: d.totalWithVatRon, currency: d.currency,
        paid: d.paidValue ?? 0, remaining: +(d.totalWithVat - (d.paidValue ?? 0)).toFixed(2),
        status: d.status, payable: !!d.payable, source: String(d.source ?? ''),
      });
    }
    if (docs.length < perPage) break;
    if (opts.page) break;             // explicit page = one page only
  }
  return all;
}

/* ------------------------------------------------------------- bank accounts */

export interface Iban { id: number; label: string }

/** The account picker on the bank report; ids are what `bankTx` takes. */
export async function ibans(s: Session): Promise<Iban[]> {
  await s.page.goto(BASE + '/raport/raport_extrase_v2/', { waitUntil: 'domcontentloaded' });
  await s.page.waitForSelector('#bank_account_balance_iban', { state: 'attached', timeout: 30_000 });
  const raw: string[] = await s.page.evaluate(
    `[...document.querySelector('#bank_account_balance_iban').options].map(o=>o.value+'|'+o.text.trim())`,
  );
  return raw.map(r => {
    const [id, ...rest] = r.split('|');
    return { id: Number(id), label: rest.join('|') };
  }).filter(i => Number.isFinite(i.id));
}

/* -------------------------------------------------------- bank transactions */

export interface BankTx {
  id: number;           // bankStatementImportDataId
  rowId: string;
  date: string;         // dd/mm/yyyy
  details: string;
  received: number;     // valueReceived  (money in)
  paid: number;         // valuePaid      (money out)
  type: string;         // bankStatementType: "plati furnizori" / "incasari clienti" / ...
  processed: boolean;
  supplierId: number | null;
  clientId: number | null;
  matchQuality: number;
  documentId: number | null;
}

export async function bankTx(
  s: Session,
  opts: { from: string; to: string; iban: number; status?: string[]; perPage?: number },
): Promise<BankTx[]> {
  const all: BankTx[] = [];
  const perPage = opts.perPage ?? 200;
  for (let page = 1; ; page++) {
    const json = await post(s, '/raport/raport_extrase_v2/ajax/', {
      sSearch: JSON.stringify({
        from: asRoDate(opts.from), to: asRoDate(opts.to), currency: '',
        page, results_per_page: perPage, transaction_type: '',
        transaction_status: opts.status ?? ['toate', 'salvata', 'nesalvata'],
        match_quality: '0', iban: opts.iban, synced: true,
      }),
    }, '/raport/raport_extrase_v2/');
    const txs: any[] = json.transactions ?? [];
    for (const t of txs) {
      all.push({
        id: t.bankStatementImportDataId, rowId: t.rowId, date: t.transactionDate,
        details: t.details, received: t.valueReceived ?? 0, paid: t.valuePaid ?? 0,
        type: t.bankStatementType, processed: !!t.processed,
        supplierId: t.supplierId, clientId: t.clientId,
        matchQuality: t.matchQuality, documentId: t.documentId,
      });
    }
    if (txs.length < perPage) break;
  }
  return all;
}

/* ------------------------------------------------------------- reconciliation */

export interface Match {
  txId: number;
  txDate: string;
  txAmount: number;
  txDetails: string;
  docId: number;
  doc: string;
  supplier: string;
  docDate: string;
  amount: number;
  score: number;      // 0..100
  why: string[];
  ambiguous?: number; // how many other expenses tie on the same score
}

/** Fold diacritics, drop legal forms and punctuation - "S.C. GLOVOAPPRO S.R.L."
 *  and "GLOVOAPPRO SRL" have to compare equal, because the bank prints one and
 *  SmartBill stores the other. */
export function norm(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\bS\.?\s?C\.?\b|\bS\.?R\.?L\.?\b|\bS\.?A\.?\b|\bSRL\b|\bPFA\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Longest run of supplier words that appears verbatim in the bank details. */
function nameHit(supplier: string, details: string): string | null {
  const d = norm(details);
  // 3, not 4: "Alfa Web SRL" normalises to ALFA WEB, and dropping WEB leaves
  // ALFA alone - too short to be evidence, so the whole supplier stops matching.
  const words = norm(supplier).split(' ').filter(w => w.length >= 3);
  for (let n = words.length; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (phrase.length >= 5 && d.includes(phrase)) return phrase;
    }
  }
  return null;
}

/** Invoice number as printed, and with separators stripped - banks drop dashes. */
function numberHit(number: string, details: string): boolean {
  const d = norm(details);
  const n = norm(number);
  if (n.length >= 5 && d.includes(n)) return true;
  const bare = number.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (bare.length >= 6 && d.replace(/ /g, '').includes(bare)) return true;
  /* Banks retype the number by hand and drop the padding: AS001183 is paid with
   * the reference "as 1183". Compare the unpadded numeric tail too. */
  const tail = /^([A-Z]*)0*(\d+)$/i.exec(bare);
  if (tail && tail[2].length >= 3) {
    const loose = (tail[1] + tail[2]).toUpperCase();
    if (d.replace(/ /g, '').includes(loose)) return true;
    if (tail[1] && d.includes(`${tail[1].toUpperCase()} ${tail[2]}`)) return true;
  }
  return false;
}

/**
 * Propose (transaction -> expense) pairs. Deliberately conservative: an outgoing
 * payment is only offered against an expense whose REMAINING amount it settles
 * exactly, because a wrong amount is a wrong payment record, and no amount of
 * name similarity makes up for it.
 *
 * The score is only used to rank and to decide what is safe to post
 * unattended; `why` says in words what earned it, so a human can check.
 */
export function reconcile(txs: BankTx[], exps: Expense[], opts: { windowDays?: number } = {}): {
  matches: Match[];
  unmatchedTx: BankTx[];
  unmatchedExpenses: Expense[];
} {
  const windowDays = opts.windowDays ?? 60;
  const open = exps.filter(e => e.remaining > 0.005);
  const outgoing = txs.filter(t => !t.processed && t.paid > 0);

  const matches: Match[] = [];
  const takenDoc = new Set<number>();

  for (const t of outgoing) {
    const cands: Match[] = [];
    for (const e of open) {
      if (takenDoc.has(e.docId)) continue;
      if (Math.abs(e.remaining - t.paid) > 0.005) continue;      // amount is non-negotiable
      const days = Math.round((parseRo(t.date).getTime() - parseRo(e.date).getTime()) / 86_400_000);
      if (days < -3 || days > windowDays) continue;              // paid before issued / far too late

      const why: string[] = [`suma ${t.paid.toFixed(2)} = rest de plata`];
      let score = 45;
      const hit = nameHit(e.supplier, t.details);
      if (hit) { score += 35; why.push(`furnizor "${hit}" apare in extras`); }
      if (numberHit(e.number, t.details)) { score += 20; why.push(`nr. document ${e.number} apare in extras`); }
      if (days >= 0 && days <= 14) { score += 5; why.push(`la ${days} zile de la factura`); }
      else why.push(`la ${days} zile de la factura`);

      cands.push({
        txId: t.id, txDate: t.date, txAmount: t.paid, txDetails: t.details,
        docId: e.docId, doc: e.doc, supplier: e.supplier, docDate: e.date,
        amount: e.remaining, score: Math.min(score, 100), why,
      });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0];
    best.ambiguous = cands.filter(c => c.score === best.score).length - 1;
    matches.push(best);
    takenDoc.add(best.docId);
  }

  const matchedTx = new Set(matches.map(m => m.txId));
  const matchedDoc = new Set(matches.map(m => m.docId));
  return {
    matches: matches.sort((a, b) => b.score - a.score),
    unmatchedTx: outgoing.filter(t => !matchedTx.has(t.id)),
    unmatchedExpenses: open.filter(e => !matchedDoc.has(e.docId)),
  };
}

/* ------------------------------------------------------- platform payments */

export interface Basket {
  txId: number;
  txDate: string;
  txAmount: number;
  txDetails: string;
  eposDate: string | null;
  items: Expense[];
  sum: number;
  diff: number;          // txAmount - sum; 0 means the basket closes exactly
  exact: boolean;
}

/** "EPOS 22/07/2026 ..." - when the order was actually placed, which is what the
 *  supplier invoices are dated against. The settlement date is 1-3 days later. */
export const eposOf = (details: string): string | null =>
  /\bE?POS\s+(\d{2}\/\d{2}\/\d{4})/.exec(details)?.[1] ?? null;

const dayDiff = (a: string, b: string) =>
  Math.round((parseRo(a).getTime() - parseRo(b).getTime()) / 86_400_000);

/**
 * One card payment to a delivery platform is NOT one invoice. Glovo invoices only
 * its own fees (taxa de livrare, service fee); the food is invoiced by the
 * restaurant, separately, into SPV. So the payment closes against a BASKET:
 * typically one GLOVOAPPRO fee invoice plus one restaurant invoice, dated around
 * the order date rather than the settlement date.
 *
 * Hence subset-sum rather than the 1:1 match `reconcile` does. Baskets are capped
 * at `maxItems` because the search is exponential and, more importantly, because
 * a four-way coincidence of small amounts is far more likely to be arithmetic
 * than a real order.
 */
export function baskets(
  txs: BankTx[],
  exps: Expense[],
  opts: { platform?: RegExp; before?: number; after?: number; maxItems?: number; tolerance?: number } = {},
): { closed: Basket[]; open: Basket[]; leftover: Expense[] } {
  const platform = opts.platform ?? /glovo/i;
  const before = opts.before ?? 3;     // invoice may predate the order date slightly
  const after = opts.after ?? 6;       // ...and usually trails it by a day or two
  const maxItems = opts.maxItems ?? 3;
  const tol = opts.tolerance ?? 0.005;

  const pays = txs
    .filter(t => t.paid > 0 && platform.test(t.details))
    .sort((a, b) => parseRo(a.date).getTime() - parseRo(b.date).getTime());

  const pool = exps.filter(e => e.remaining > 0.005);
  const used = new Set<number>();
  const closed: Basket[] = [];
  const openB: Basket[] = [];

  for (const t of pays) {
    const anchor = eposOf(t.details) ?? t.date;
    const cands = pool
      .filter(e => !used.has(e.docId) && e.currency === 'RON')
      .filter(e => { const d = dayDiff(e.date, anchor); return d >= -before && d <= after; })
      .sort((a, b) => Math.abs(dayDiff(a.date, anchor)) - Math.abs(dayDiff(b.date, anchor)));

    /* Depth-first over at most maxItems invoices. Scored, not just found: a
     * basket that pairs the platform's own fee invoice with a merchant invoice
     * is the shape we expect, so it outranks an equal-summing pile of fees. */
    let best: { items: Expense[]; diff: number; score: number } | null = null;
    const consider = (items: Expense[]) => {
      const sum = items.reduce((a, e) => a + e.remaining, 0);
      const diff = +(t.paid - sum).toFixed(2);
      /* Every order produces a fee invoice from the platform itself, so a basket
       * without one is not an order - it is arithmetic. Requiring it is what
       * stops the search pairing a Glovo payment with a bookshop and an energy
       * bill that happen to add up. */
      const hasPlatform = items.some(e => platform.test(e.supplier));
      if (!hasPlatform) return;
      const hasOther = items.some(e => !platform.test(e.supplier));
      const score = (Math.abs(diff) <= tol ? 100 : 0)
        + (hasOther ? 20 : 0)
        - items.length
        - Math.abs(diff);
      if (!best || score > best.score) best = { items: [...items], diff, score };
    };
    const walk = (start: number, items: Expense[]) => {
      if (items.length) consider(items);
      if (items.length >= maxItems) return;
      for (let i = start; i < cands.length; i++) walk(i + 1, [...items, cands[i]]);
    };
    walk(0, []);

    if (!best) continue;
    const b = best as { items: Expense[]; diff: number; score: number };
    const basket: Basket = {
      txId: t.id, txDate: t.date, txAmount: t.paid, txDetails: t.details,
      eposDate: eposOf(t.details),
      items: b.items, sum: +b.items.reduce((a, e) => a + e.remaining, 0).toFixed(2),
      diff: b.diff, exact: Math.abs(b.diff) <= tol,
    };
    if (basket.exact) { basket.items.forEach(e => used.add(e.docId)); closed.push(basket); }
    else openB.push(basket);
  }

  return { closed, open: openB, leftover: pool.filter(e => !used.has(e.docId)) };
}
