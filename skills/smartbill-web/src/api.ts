/**
 * SmartBill Cloud REST client — the fast path.
 *
 * Everything here talks to ws.smartbill.ro over HTTPS with a Basic-auth token.
 * No browser, no login session, ~200 ms a call. What it CANNOT do lives in
 * invoices.ts (Playwright): enumerate documents, and edit an issued one.
 *
 * Endpoints and payload shapes are those of bogdanripa/smartbill-mcp, which is
 * where this started life before being flattened into a CLI.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const API_BASE = 'https://ws.smartbill.ro/SBORO/api';

/** Where the token lives. Same convention as ~/.claude/agentmail.env. */
export const CREDS = resolve(homedir(), '.claude/smartbill.env');

export interface Creds { username: string; token: string; cif: string }

/**
 * Token from ~/.claude/smartbill.env, overridable by the environment.
 * Never inline the token in a command — it ends up in shell history and logs.
 */
export function creds(): Creds {
  const file: Record<string, string> = {};
  if (existsSync(CREDS)) {
    for (const line of readFileSync(CREDS, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*)$/);
      if (m) file[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const pick = (k: string) => process.env[k] || file[k];
  const username = pick('SMARTBILL_USERNAME');
  const token = pick('SMARTBILL_TOKEN');
  const cif = pick('SMARTBILL_VAT_CODE');
  if (!username || !token || !cif) {
    throw new Error(
      `Missing SmartBill API credentials.\nCreate ${CREDS} with:\n` +
      `  SMARTBILL_USERNAME=you@example.com\n  SMARTBILL_TOKEN=<token>\n  SMARTBILL_VAT_CODE=RO12345678\n` +
      `The token is in SmartBill Cloud > Contul meu > Integrari > API.`
    );
  }
  return { username, token, cif };
}

type Query = Record<string, string | number | undefined>;

/* SmartBill caps at 3 calls/second. Serialise and space them out, so a loop
 * over 40 invoices degrades into a queue instead of into 429s. */
const MIN_GAP = 1000 / 3;
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function throttle<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const wait = lastAt + MIN_GAP - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastAt = Date.now();
    return run();
  });
  chain = next.then(() => undefined, () => undefined);
  return next as Promise<T>;
}

function auth(): string {
  const { username, token } = creds();
  return 'Basic ' + Buffer.from(`${username}:${token}`).toString('base64');
}

function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  }
  return p.toString() ? `?${p}` : '';
}

/**
 * SmartBill signals business failures with HTTP 200 and a non-empty errorText,
 * so a bare response.ok check is not enough to know the call worked.
 */
function assertOk(payload: unknown, status: number, fallback: string): void {
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, any>;
    if (typeof rec.errorText === 'string' && rec.errorText.trim()) throw new Error(rec.errorText.trim());
    const code = rec.status?.code;                       // POST /document/send answers this way
    if (code !== undefined && Number(code) !== 0 && Number(code) !== 200) {
      throw new Error(rec.status?.message?.trim() || `SmartBill returned status code ${code}`);
    }
  }
  if (status >= 400) throw new Error(fallback);
}

export interface Req { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; query?: Query; body?: unknown }

export async function api<T = any>({ method = 'GET', path, query, body }: Req): Promise<T> {
  const res = await throttle(() => fetch(API_BASE + path + qs(query), {
    method,
    headers: {
      Authorization: auth(),
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text.trim() ? JSON.parse(text) : undefined; } catch { parsed = text; }
  assertOk(parsed, res.status, text || res.statusText);
  return parsed as T;
}

/** Binary GET, for the PDF endpoints. An error can still arrive as JSON under a 200. */
export async function apiBinary({ path, query }: Req): Promise<{ bytes: Buffer; filename?: string }> {
  const res = await throttle(() => fetch(API_BASE + path + qs(query), {
    method: 'GET',
    headers: { Authorization: auth(), Accept: 'application/octet-stream' },
  }));
  const bytes = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('application/json')) {
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch { parsed = bytes.toString('utf8'); }
    assertOk(parsed, res.status, bytes.toString('utf8') || res.statusText);
    if (!res.ok) throw new Error(res.statusText);
  }
  const cd = res.headers.get('content-disposition');
  const m = cd && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return { bytes, filename: m ? decodeURIComponent(m[1].trim()) : undefined };
}

const omit = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/* ------------------------------------------------------------------ *
 * Typed calls. `cif` defaults to the configured company.               *
 * ------------------------------------------------------------------ */

export interface SeriesEntry { name: string; nextNumber: number; type: string }

const SERIES_TYPE: Record<string, string> = { factura: 'f', proforma: 'p', chitanta: 'c' };

export const listSeries = (type?: string) =>
  api<{ list: SeriesEntry[] }>({
    path: '/series',
    query: { cif: creds().cif, type: type ? SERIES_TYPE[type] ?? type : undefined },
  }).then(r => r.list ?? []);

export const listTaxes = () =>
  api<{ taxes: any[] }>({ path: '/tax', query: { cif: creds().cif } });

export const listStocks = (o: { date?: string; warehouseName?: string; productName?: string } = {}) =>
  api({
    path: '/stocks',
    query: { cif: creds().cif, date: o.date ?? new Date().toISOString().slice(0, 10), ...o },
  });

export interface PaymentStatus {
  invoiceTotalAmount: number; paidAmount: number; unpaidAmount: number; paid: boolean;
}

/** Amounts only. It does NOT report the currency — read the PDF before quoting a figure. */
export const paymentStatus = (seriesName: string, number: string) =>
  api<PaymentStatus>({ path: '/invoice/paymentstatus', query: { cif: creds().cif, seriesname: seriesName, number } });

export const invoicePdf = (seriesName: string, number: string) =>
  apiBinary({ path: '/invoice/pdf', query: { cif: creds().cif, seriesname: seriesName, number } });

export const estimatePdf = (seriesName: string, number: string) =>
  apiBinary({ path: '/estimate/pdf', query: { cif: creds().cif, seriesname: seriesName, number } });

/** Which invoices came out of a proforma. */
export const estimateInvoices = (seriesName: string, number: string) =>
  api({ path: '/estimate/invoices', query: { cif: creds().cif, seriesname: seriesName, number } });

/** Issue an invoice from a full JSON payload. See invoice.example.json. */
export const createInvoice = (body: Record<string, unknown>) =>
  api<{ series: string; number: string; url: string }>({
    method: 'POST', path: '/invoice',
    body: omit({ companyVatCode: creds().cif, ...body }),
  });

/** Storno: reverses an existing invoice in full, into the same series. */
export const reverseInvoice = (seriesName: string, number: string, issueDate?: string) =>
  api({
    method: 'POST', path: '/invoice/reverse',
    body: omit({ companyVatCode: creds().cif, seriesName, number, issueDate }),
  });

/** Record money received (incasare). */
export const createPayment = (body: Record<string, unknown>) =>
  api({ method: 'POST', path: '/payment', body: omit({ companyVatCode: creds().cif, ...body }) });

const lifecycle = (method: 'PUT' | 'DELETE', path: string) =>
  (seriesName: string, number: string) =>
    api({ method, path, query: { cif: creds().cif, seriesname: seriesName, number } });

export const cancelInvoice = lifecycle('PUT', '/invoice/cancel');
export const restoreInvoice = lifecycle('PUT', '/invoice/restore');
/** Irreversible, and SmartBill only allows it for the LAST invoice in a series. */
export const deleteInvoice = lifecycle('DELETE', '/invoice');

/** SmartBill mails the document, with the PDF attached on its side. */
export const sendDocumentEmail = (o: {
  seriesName: string; number: string; type?: 'factura' | 'proforma';
  to?: string; cc?: string; bcc?: string; subject?: string; bodyText?: string;
}) => api({
  method: 'POST', path: '/document/send',
  body: omit({
    companyVatCode: creds().cif,
    seriesName: o.seriesName,
    number: o.number,
    type: o.type ?? 'factura',
    to: o.to, cc: o.cc, bcc: o.bcc,
    // SmartBill wants these base64-encoded.
    subject: o.subject === undefined ? undefined : Buffer.from(o.subject, 'utf8').toString('base64'),
    bodyText: o.bodyText === undefined ? undefined : Buffer.from(o.bodyText, 'utf8').toString('base64'),
  }),
});
