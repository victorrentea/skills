/**
 * SmartBill MCP server — the same operations as the CLI, for clients that speak
 * MCP instead of running shell commands (Claude Desktop).
 *
 * It exists because a Claude *Skill* is useless in Desktop: skills execute in
 * Anthropic's sandbox, which has no network and no access to this machine. An
 * MCP server is spawned as a LOCAL process, so it can reach ws.smartbill.ro,
 * read ~/.claude/smartbill.env and drive the logged-in Chromium.
 *
 * Every tool delegates to api.ts / report.ts — the CLI and this server share one
 * implementation.
 *
 * Deliberately NOT exposed: `copy` and `edit` (bulk template copying and
 * description rewriting). They run a headed browser for ~1.6s per invoice and
 * are driven from CSV files; that belongs in the terminal, not in a chat tool
 * call. Use the CLI for those.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as sb from './api.js';
import { pdfText, summarize } from './pdf.js';
import { recent } from './report.js';

const server = new McpServer({ name: 'smartbill', version: '1.0.0' });

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

const ref = {
  seriesName: z.string().describe('Invoice series, e.g. "S" or "P". List them with smartbill_series.'),
  number: z.string().describe('Invoice number as printed on the document, leading zeros included — "0159", not "159" on accounts that pad.'),
};

/* ---------------------------------------------------------------- *
 * Read-only                                                          *
 * ---------------------------------------------------------------- */

server.registerTool('smartbill_series', {
  title: 'List document series',
  description:
    'List the document series on the account, each with the next number it will issue. Read-only and cheap.\n\n' +
    'This is also the entry point for finding documents: there is no listing endpoint, so smartbill_recent counts ' +
    'backwards from these numbers.',
  inputSchema: { documentType: z.enum(['factura', 'proforma', 'chitanta']).optional().describe('Restrict to one type. Omit for all.') },
  annotations: { readOnlyHint: true },
}, async ({ documentType }) => json(await sb.listSeries(documentType)));

server.registerTool('smartbill_taxes', {
  title: 'List VAT rates',
  description:
    'List the VAT rates configured for the company, as name/percentage pairs. Read-only.\n\n' +
    'Call this before smartbill_create_invoice rather than guessing a rate — Romanian VAT rates and their names ' +
    'change over time and differ per account. Copy taxName and taxPercentage onto the line items verbatim.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => json(await sb.listTaxes()));

server.registerTool('smartbill_stocks', {
  title: 'List stock levels',
  description: 'Read stock levels as of a date, optionally narrowed to one warehouse or product. Read-only.',
  inputSchema: {
    date: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
    warehouseName: z.string().optional(),
    productName: z.string().optional(),
  },
  annotations: { readOnlyHint: true },
}, async (args) => json(await sb.listStocks(args)));

server.registerTool('smartbill_read_invoice', {
  title: 'Read an invoice',
  description:
    'Read an issued invoice: issue date, due date, total, CURRENCY, counterparty and line items.\n\n' +
    'This is the only way to see any of those — no SmartBill endpoint reports them, they exist solely inside the ' +
    'PDF, so this fetches the document and extracts its text. Always call this before quoting an amount, because ' +
    'smartbill_payment_status does not say which currency its numbers are in.',
  inputSchema: { ...ref, full: z.boolean().optional().describe('Return the raw document text instead of the parsed summary.') },
  annotations: { readOnlyHint: true },
}, async ({ seriesName, number, full }) => {
  const { bytes } = await sb.invoicePdf(seriesName, number);
  const { text: raw, pages } = await pdfText(bytes);
  return full ? text(raw) : json({ pages, ...summarize(raw) });
});

server.registerTool('smartbill_payment_status', {
  title: 'Invoice payment status',
  description:
    'Whether an invoice has been paid and how much of it: invoiceTotalAmount, paidAmount, unpaidAmount, paid.\n\n' +
    'It does NOT report the currency. Never quote a figure from this alone — read the invoice first, or a 1250 EUR ' +
    'invoice gets reported as 1250 RON.',
  inputSchema: ref,
  annotations: { readOnlyHint: true },
}, async ({ seriesName, number }) => json(await sb.paymentStatus(seriesName, number)));

server.registerTool('smartbill_recent', {
  title: 'Recent invoices',
  description:
    'The closest thing to a document listing. Returns recent invoices with date, total, currency, counterparty and ' +
    'paid/unpaid state.\n\n' +
    'SmartBill\'s API has no listing endpoint, so this reads the next number from each series and walks backwards, ' +
    'fetching each document. It costs about one second per invoice, so keep `count` modest — this is for "what did ' +
    'I issue lately" and "who has not paid", not for scanning a whole year.',
  inputSchema: {
    seriesName: z.string().optional().describe('Restrict to one series. Omit to cover every invoice series.'),
    count: z.number().int().min(1).max(50).optional().describe('How many to walk back per series. Default 10.'),
  },
  annotations: { readOnlyHint: true },
}, async ({ seriesName, count }) => json(await recent({ series: seriesName, count })));

server.registerTool('smartbill_download_pdf', {
  title: 'Download invoice PDF',
  description:
    'Save an invoice PDF to a local directory and return the path. The server runs on this machine, so the path is ' +
    'a real file the user can open.',
  inputSchema: { ...ref, outDir: z.string().optional().describe('Directory. Default ~/Downloads.'), filename: z.string().optional() },
  annotations: { readOnlyHint: true },
}, async ({ seriesName, number, outDir, filename }) => {
  const { bytes, filename: suggested } = await sb.invoicePdf(seriesName, number);
  const dir = outDir ?? resolve(process.env.HOME ?? '.', 'Downloads');
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, filename ?? suggested ?? `${seriesName}${number}.pdf`);
  writeFileSync(target, bytes);
  return json({ path: target, bytes: bytes.length });
});

server.registerTool('smartbill_list_documents', {
  title: 'List documents with their internal ids',
  description:
    'Enumerate every invoice in the current report period as number + internal id, by driving the SmartBill web UI ' +
    'in a local headless browser.\n\n' +
    'Slower than the API tools (it starts a browser) and needs a saved login — run `npm run sb -- login` in the ' +
    'skill directory once if it errors. Use it only when you need the internal ids, which appear nowhere in the ' +
    'API; for reading recent invoices prefer smartbill_recent.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => {
  const { open } = await import('./session.js');
  const { list } = await import('./invoices.js');
  const { page, close } = await open({ headless: true });
  try {
    return json(await list(page));
  } finally {
    await close();
  }
});

/* ---------------------------------------------------------------- *
 * Mutating. These touch real fiscal documents.                       *
 * ---------------------------------------------------------------- */

server.registerTool('smartbill_create_invoice', {
  title: 'Issue an invoice',
  description:
    'Issue a new invoice from a full payload. Returns { series, number, url }.\n\n' +
    'Call smartbill_taxes and smartbill_series first rather than guessing a VAT rate or series. Confirm client, ' +
    'amounts and VAT rate with the user before calling: an issued invoice is a fiscal document that generally ' +
    'cannot be deleted. Pass isDraft true while details are still unsettled — a draft can be edited or discarded.\n\n' +
    'The payload mirrors the SmartBill API: client {name, vatCode, address, city, country, ...}, products [{name, ' +
    'quantity, price, isTaxIncluded, taxName, taxPercentage, currency, exchangeRate, isService}], plus seriesName, ' +
    'currency, language, issueDate, dueDate, isDraft. companyVatCode is filled in automatically.',
  inputSchema: { invoice: z.record(z.string(), z.any()).describe('The invoice payload.') },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async ({ invoice }) => json(await sb.createInvoice(invoice)));

server.registerTool('smartbill_record_payment', {
  title: 'Record a payment',
  description:
    'Record money received from a client (incasare) against one or more invoices.\n\n' +
    'Payload: client {name, vatCode}, type (Chitanta, Ordin plata, Card, Extras de cont, ...), value, currency, ' +
    'issueDate, invoicesList [{seriesName, number}]. seriesName at the top level is required only for type ' +
    '"Chitanta" and is rejected for the others.',
  inputSchema: { payment: z.record(z.string(), z.any()).describe('The payment payload.') },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async ({ payment }) => json(await sb.createPayment(payment)));

server.registerTool('smartbill_reverse_invoice', {
  title: 'Storno an invoice',
  description:
    'Issue a storno invoice that reverses an existing one in full, into the same series. This is the accounting-' +
    'correct undo: it leaves both documents in place and visible.\n\n' +
    'Prefer it over cancel when the reversal has to appear in the accounts. Confirm with the user first.',
  inputSchema: { ...ref, issueDate: z.string().optional().describe('YYYY-MM-DD. Defaults to today.') },
  annotations: { readOnlyHint: false, destructiveHint: true },
}, async ({ seriesName, number, issueDate }) => json(await sb.reverseInvoice(seriesName, number, issueDate)));

server.registerTool('smartbill_cancel_invoice', {
  title: 'Cancel (void) an invoice',
  description:
    'Void an invoice (anulare). It stays in SmartBill, keeps its number and is marked cancelled, so the series has ' +
    'no gap. Reversible with smartbill_restore_invoice. Confirm with the user — this changes the status of a real ' +
    'fiscal document.',
  inputSchema: ref,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
}, async ({ seriesName, number }) => json(await sb.cancelInvoice(seriesName, number)));

server.registerTool('smartbill_restore_invoice', {
  title: 'Restore a cancelled invoice',
  description: 'Undo a cancel and put the invoice back into its normal, valid state. It cannot bring back a deleted one.',
  inputSchema: ref,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, async ({ seriesName, number }) => json(await sb.restoreInvoice(seriesName, number)));

server.registerTool('smartbill_delete_invoice', {
  title: 'Delete an invoice permanently',
  description:
    'Permanently remove an invoice, freeing its number for reuse. IRREVERSIBLE — there is no restore.\n\n' +
    'SmartBill only allows this for the LAST invoice in a series and rejects it for any earlier one. Destroys a ' +
    'fiscal document: ask the user to confirm explicitly, and prefer smartbill_cancel_invoice when unsure.',
  inputSchema: ref,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
}, async ({ seriesName, number }) => json(await sb.deleteInvoice(seriesName, number)));

server.registerTool('smartbill_send_email', {
  title: 'Email a document to the client',
  description:
    'Have SmartBill email an existing invoice or proforma to the client, with the PDF attached on its side.\n\n' +
    'This sends real mail to a real recipient and cannot be recalled. Confirm the address with the user before ' +
    'calling. Omitting `to` uses the client email stored in SmartBill.',
  inputSchema: {
    ...ref,
    type: z.enum(['factura', 'proforma']).optional().describe('Default factura.'),
    to: z.string().optional(), cc: z.string().optional(), bcc: z.string().optional(),
    subject: z.string().optional(), bodyText: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async ({ seriesName, number, ...rest }) => json(await sb.sendDocumentEmail({ seriesName, number, ...rest })));

await server.connect(new StdioServerTransport());
