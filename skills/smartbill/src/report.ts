/**
 * Walking the series backwards — the closest thing to a document listing that
 * the REST API allows.
 *
 * SmartBill's public API has no listing endpoint: /series, /tax and /stocks are
 * the only ones that return a list. But /series reports the next number each
 * series will issue, so counting down from there and fetching each document
 * reconstructs a recent-invoices view without a browser.
 *
 * Shared by the CLI (`sb -- recent`) and the MCP server, so both report the same
 * thing.
 */
import * as sb from './api.js';
import { pdfText, summarize, type Summary } from './pdf.js';

export interface RecentRow extends Partial<Summary> {
  doc: string;
  paid?: boolean;
  unpaid?: number;
  error?: string;
}

export async function recent(
  opts: { series?: string; count?: number } = {},
): Promise<RecentRow[]> {
  const count = opts.count ?? 10;
  const all = await sb.listSeries('factura');
  const series = all.filter(s => !opts.series || s.name === opts.series);
  if (!series.length) {
    throw new Error(
      `No invoice series named "${opts.series}". Available: ${all.map(s => s.name).join(', ')}`,
    );
  }

  const rows: RecentRow[] = [];
  for (const s of series) {
    for (let n = s.nextNumber - 1; n > s.nextNumber - 1 - count && n > 0; n--) {
      const number = String(n);
      try {
        const [{ bytes }, status] = await Promise.all([
          sb.invoicePdf(s.name, number),
          // A document can exist without a payment status; the summary still stands.
          sb.paymentStatus(s.name, number).catch(() => null),
        ]);
        rows.push({
          doc: `${s.name}${number}`,
          ...summarize((await pdfText(bytes)).text),
          paid: status?.paid,
          unpaid: status?.unpaidAmount,
        });
      } catch (e: any) {
        rows.push({ doc: `${s.name}${number}`, error: e.message });
      }
    }
  }
  return rows;
}

/** One line per document, for a terminal. */
export function formatRecent(rows: RecentRow[]): string {
  return rows.flatMap(r => {
    if (r.error) return [`${r.doc}\tERROR ${r.error}`];
    const paid = r.paid === undefined ? '?' : r.paid ? 'PAID' : `UNPAID ${r.unpaid}`;
    const head = `${r.doc}\t${r.date ?? '?'}\t${r.total ?? '?'}\t${paid}\t${r.party ?? '?'}`;
    return r.lines?.[0] ? [head, `\t${r.lines[0].slice(0, 110)}`] : [head];
  }).join('\n');
}
