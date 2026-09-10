/**
 * Banca Transilvania PDF statements -> transactions.
 *
 * The reason this exists: SmartBill's own bank feed is a PSD2 connection that
 * expires (~90 days) and, when it does, the report simply shows no rows - so
 * `banktx` can return nothing for a month that plainly had payments. The monthly
 * PDF in ~/My Drive/Conta is the copy that never expires.
 *
 * Extraction goes through `pdftotext -layout` (poppler), not a JS PDF library,
 * because the Debit/Credit distinction is CARRIED ONLY BY THE COLUMN POSITION of
 * the number. A layout-less extraction gives "529.10" with nothing to say whether
 * money left or arrived, and getting that backwards silently books a payment as
 * a receipt.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BankTx } from './acquisitions.js';

/* Page furniture. It has to include the phone-number block: those lines land in
 * the middle of a transaction's detail when a page breaks, and a supplier name
 * buried under "apelabil din orice retea" stops matching. */
const NOISE = /BANCA TRANSILVANIA|Info clienti|BT24@|Solicitant:|Tiparit:|Clasificare BT|Capitalul social|www\.bancatransilvania|apelabil din orice retea|inclusiv international|^\s*004 0264|^\s*Data\s+Descriere\s+Debit\s+Credit\s*$|^\s*\d+\s*\/\s*\d+\s*$/;
const SKIP = /^(SOLD ANTERIOR|RULAJ ZI|SOLD FINAL ZI|RULAJ TOTAL CONT|SOLD FINAL CONT|SUME BLOCATE)/;
const AMOUNT = /(-?[\d]{1,3}(?:,\d{3})*\.\d{2})\s*$/;

export interface BtStatement {
  iban: string;
  from: string;   // dd/mm/yyyy
  to: string;
  currency: string;
  rows: BankTx[];
}

/** dd/mm/yyyy at the start of the Data column. */
const LEADING_DATE = /^\s*(\d{2}\/\d{2}\/\d{4})\b/;

export function parseBtPdf(path: string): BtStatement {
  let raw: string;
  try {
    raw = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 32 << 20 });
  } catch (e: any) {
    throw new Error(`pdftotext failed on ${path} (brew install poppler): ${e.message}`);
  }
  const lines = raw.split('\n').filter(l => !NOISE.test(l));

  const iban = /Cod IBAN:\s*([A-Z0-9]+)/.exec(raw)?.[1] ?? '';
  const period = /din\s+(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/.exec(raw);
  const currency = /Valuta\s*\n\s*([A-Z]{3})/.exec(raw)?.[1] ?? 'RON';

  /* Where the two money columns sit. Taken from the header row rather than
   * guessed, because the header is the only thing that states it. */
  /* Read the column header off the RAW text: it repeats on every page and is
   * filtered out as noise below, because a page break lands it in the middle of
   * a transaction - treating it as a section boundary orphans the detail lines
   * that follow, and with them the supplier name the matcher needs. */
  const header = raw.split('\n').find(l => /\bDebit\b\s+\bCredit\b/.test(l)) ?? '';
  const debitEnd = header.indexOf('Debit') + 'Debit'.length;
  const creditEnd = header.indexOf('Credit') + 'Credit'.length;
  const split = (debitEnd + creditEnd) / 2;
  /* Amounts are right-aligned, so a real money column always ends within a few
   * characters of its header. Description lines wrap far to the left and often
   * END in a number too ("...valoare tranzactie: 291.70") - counting those books
   * the same payment twice, which is exactly how July came out 291.70 heavy. */
  const moneyCol = debitEnd - 8;

  const rows: BankTx[] = [];
  /* Everything above SOLD ANTERIOR is BT's newsletter - fee announcements full
   * of numbers that parse as perfectly good transactions if you let them. */
  let started = false;
  let date = '';
  let cur: BankTx | null = null;
  let inBlocked = false;
  let seq = 0;

  const flush = () => {
    if (cur) { cur.details = cur.details.replace(/\s+/g, ' ').trim(); rows.push(cur); }
    cur = null;
  };

  for (const line of lines) {
    const body = line.trim();
    if (!body) continue;
    if (/^SUME BLOCATE/.test(body)) { inBlocked = true; flush(); continue; }
    if (inBlocked) continue;                      // pre-authorised, not settled

    const d = LEADING_DATE.exec(line);
    if (d) date = d[1];
    /* RULAJ ZI and SOLD FINAL ZI carry the date in the same column as a real
     * transaction, so the skip test has to run on the line WITHOUT it. */
    const afterDate = body.replace(LEADING_DATE, '').trim();
    if (SKIP.test(afterDate) || SKIP.test(body)) {
      if (/^SOLD ANTERIOR/.test(afterDate)) started = true;
      /* Everything after the closing totals is the availability trailer -
       * TOTAL DISPONIBIL / Fonduri proprii / Credit neutilizat - and each of
       * those repeats the balance in the Credit column. Parsed on, March came
       * out 1,080.74 heavy: the same 540.37 counted twice as income. */
      if (/^RULAJ TOTAL CONT/.test(afterDate)) started = false;
      flush(); continue;
    }
    if (!started) continue;

    const trimmedEnd = line.replace(/\s+$/, '').length;
    const m = trimmedEnd >= moneyCol ? AMOUNT.exec(line.replace(/\s+$/, '')) : null;
    if (m) {
      // A new transaction: the amount tells us which column, the column tells us
      // the direction.
      flush();
      const value = Number(m[1].replace(/,/g, ''));
      const isDebit = trimmedEnd <= split;
      const desc = line.slice(0, line.lastIndexOf(m[1])).replace(LEADING_DATE, '').trim();
      cur = {
        id: -(++seq), rowId: '', date, details: desc,
        received: isDebit ? 0 : value, paid: isDebit ? value : 0,
        type: isDebit ? 'plati furnizori' : 'incasari clienti',
        processed: false, supplierId: null, clientId: null, matchQuality: 0, documentId: null,
      };
    } else if (cur) {
      cur.details += ' ' + body;                  // continuation line
    }
  }
  flush();

  const out = rows.filter(r => r.paid > 0 || r.received > 0);

  /* The statement states its own totals. Checking against them is the whole
   * reason this parser can be trusted with money: a dropped or doubled row
   * shows up here rather than as a wrong payment three steps later. */
  const control = /RULAJ TOTAL CONT\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/.exec(raw);
  if (control) {
    const want = [Number(control[1].replace(/,/g, '')), Number(control[2].replace(/,/g, ''))];
    const got = [out.reduce((a, r) => a + r.paid, 0), out.reduce((a, r) => a + r.received, 0)];
    for (const [i, label] of ['debit', 'credit'].entries()) {
      if (Math.abs(want[i] - got[i]) > 0.005) {
        throw new Error(
          `${path}: ${label} parsat ${got[i].toFixed(2)} != RULAJ TOTAL CONT ${want[i].toFixed(2)} ` +
          `(diferenta ${(got[i] - want[i]).toFixed(2)}) - nu folosi rezultatul`,
        );
      }
    }
  }

  return { iban, currency, from: period?.[1] ?? '', to: period?.[2] ?? '', rows: out };
}

/** Every BT statement PDF for one IBAN under a Conta month folder. */
export function findStatements(dir: string, iban?: string): string[] {
  return readdirSync(dir)
    .filter(f => /\.pdf$/i.test(f) && /RO\d{2}[A-Z]{4}/.test(f) && (!iban || f.includes(iban)))
    .map(f => join(dir, f))
    .sort();
}
