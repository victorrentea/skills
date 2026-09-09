import type { Page } from 'playwright';
import { BASE, jitter } from './session.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------------ *
 * Selectors, in one place. If SmartBill changes its UI, fix them here. *
 * ------------------------------------------------------------------ */
export const S = {
  editPencil: 'a.emitere_edit',                    // pencil on invoice line 1
  modalName: '[name="edit_product_name"]',         // "Denumire" in Modificare produs
  modalDesc: '[name="edit_product_description"]',  // "Descriere (BT-154)"
  modalSubmit: 'button:visible:has-text("Modifica produs")',
  saveInvoice: '#saveInvoiceBtn',                  // "Salvati Factura"
  invoiceLink: 'a[href^="/raport/factura/"]',
  /* After saving, SmartBill renders the document inside an IFRAME. Everything
   * below lives in that frame, NOT in the main document - this is the single
   * biggest gotcha in this app. */
  // The name attribute is NOT always present - match on the src instead.
  viewerFrame: 'iframe[src*="compact-view"]',
  confirmSave: '#view_save_disposition',           // blue "Salveaza" (drafts only)
  exportPdf: '#viewer_pdf_id',                     // PDF icon, inside the viewer
  // '#view_export_disposition' also exists in the MAIN document but is hidden
  // and clicking it navigates to the dashboard. Do not use it.
};

export const url = {
  copy: (id: string | number) => `${BASE}/documente/copiaza/factura/${id}/`,
  edit: (id: string | number) => `${BASE}/documente/editare/factura/${id}/`,
  view: (id: string | number) => `${BASE}/raport/factura/${id}/`,
  report: `${BASE}/raport/facturi/`,
};

export interface InvoiceRef { number: string; id: string }

/** All invoices currently listed in the report, newest first. */
export async function list(page: Page): Promise<InvoiceRef[]> {
  await page.goto(url.report, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(S.invoiceLink, { timeout: 30_000 });
  return page.$$eval(S.invoiceLink, links =>
    links.map(a => ({
      number: (a.textContent || '').trim(),
      id: (a.getAttribute('href') || '').split('/').filter(Boolean).pop()!,
    })).filter(x => x.number && x.id)
  );
}

/* ------------------------------------------------------------------ *
 * Searching the invoice report                                        *
 * ------------------------------------------------------------------ */

/* The report shows ONE period at a time and that period is SERVER-SIDE state,
 * not a query parameter: there is no ?from=&to= to navigate to, and reloading
 * /raport/facturi/ after setting it in the DOM throws the change away. The page
 * keeps it in `input.period_filter` ("dd/mm/yyyy - dd/mm/yyyy") and pushes it to
 * the server through window.save_interval(). Set both, then WAIT - the table
 * redraws by ajax; a reload at this point resets you to the current month. */
export async function setPeriod(page: Page, from: string, to: string): Promise<string> {
  await page.evaluate(
    `(function(){ var e = document.querySelector('input.period_filter');
       if (!e) throw new Error('no period filter on this page');
       e.value = ${JSON.stringify(`${from} - ${to}`)}; window.save_interval(); })()`
  );
  const want = `${from} - ${to}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    const now = await page.evaluate<string>(`(document.querySelector('input.period_filter')||{}).value || ''`);
    // save_interval() normalises spacing; compare on the dates alone.
    if (now.replace(/\s/g, '') === want.replace(/\s/g, '')) break;
    if (Date.now() > deadline) throw new Error(`report period did not take: wanted ${want}, page says ${now}`);
    await new Promise(r => setTimeout(r, 250));
  }
  // The dates land in the input before the table finishes redrawing.
  await page.waitForLoadState('networkidle').catch(() => {});
  return want;
}

export interface ReportRow {
  number: string; id: string; client: string;
  issueDate: string; dueDate: string;
  net: string; vat: string; total: string; currency: string; status: string;
}

const FILTER = {
  client: '#client_name2',      // customer name, substring
  product: '#product_name',     // matches the LINE text, which is where the
                                // participant name lives on these invoices
  submit: '#advanced_filter',
};

/** Run the report's advanced filter and read the rows back.
 *  `product` searches invoice LINES - that is how you find one participant. */
export async function report(
  page: Page,
  opts: { from?: string; to?: string; client?: string; product?: string } = {}
): Promise<ReportRow[]> {
  await page.goto(url.report, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(S.invoiceLink, { timeout: 30_000 });
  if (opts.from && opts.to) await setPeriod(page, opts.from, opts.to);

  await page.evaluate(
    `(function(){
       var c = document.querySelector(${JSON.stringify(FILTER.client)});
       var p = document.querySelector(${JSON.stringify(FILTER.product)});
       if (c) c.value = ${JSON.stringify(opts.client ?? '')};
       if (p) p.value = ${JSON.stringify(opts.product ?? '')};
     })()`
  );
  /* The table is a DataTable redrawn by ajax. Waiting on 'networkidle' does NOT
   * work here - datadog and survicate beacons keep the network busy, the wait
   * times out, and the rows read back are the ones from BEFORE the filter: an
   * unfiltered listing that looks exactly like "the filter matched everything".
   * Wait for the report's own response, then for the table to stop changing. */
  await Promise.all([
    page.waitForResponse(r => /\/raport\/facturi/.test(r.url()), { timeout: 30_000 }).catch(() => null),
    page.evaluate(`document.querySelector(${JSON.stringify(FILTER.submit)}).click()`),
  ]);
  await settleTable(page);

  /* Zero hits is a legitimate answer ("this participant was never invoiced"),
   * so this must not wait for a row to appear. */
  return readRows(page);
}

/** Poll until the results table stops changing. */
async function settleTable(page: Page, quietMs = 1_200, timeoutMs = 30_000): Promise<void> {
  const sig = () => page.evaluate<string>(
    `[...document.querySelectorAll('a[href^="/raport/factura/"]')].map(a => a.textContent.trim()).join(',')`
  ).catch(() => '');
  const deadline = Date.now() + timeoutMs;
  let last = await sig(), quietSince = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 250));
    const now = await sig();
    if (now !== last) { last = now; quietSince = Date.now(); }
    else if (Date.now() - quietSince >= quietMs) return;
    if (Date.now() > deadline) return;
  }
}

/* Column positions shift with the leading checkbox/icon cells, so the row is
 * read RELATIVE to the cell holding the document link rather than by fixed
 * indexes. */
async function readRows(page: Page): Promise<ReportRow[]> {
  return JSON.parse(await page.evaluate<string>(`JSON.stringify(
    [...document.querySelectorAll('a[href^="/raport/factura/"]')]
      .map(function (a) {
        var td = a.closest('td'), r = a.closest('tr');
        if (!td || !r) return null;
        var cells = [...r.querySelectorAll('td')].map(function (t) {
          return (t.innerText || '').replace(/\\s+/g, ' ').trim();
        });
        var i = cells.indexOf(td.innerText.replace(/\\s+/g, ' ').trim());
        if (i < 0) i = 2;
        return {
          number: (a.textContent || '').trim(),
          id: (a.getAttribute('href') || '').split('/').filter(Boolean).pop(),
          client: cells[i + 1] || '', issueDate: cells[i + 2] || '', dueDate: cells[i + 3] || '',
          net: cells[i + 4] || '', vat: cells[i + 5] || '', total: cells[i + 6] || '',
          currency: cells[i + 7] || '', status: cells[i + 9] || cells[i + 8] || '',
        };
      })
      .filter(Boolean)
      .filter(function (x, i, all) { return all.findIndex(function (y) { return y.id === x.id; }) === i; })
  )`));
}

/** The line text of one document, read off its view page.
 *  The report lists totals only; the participant and order number are in here. */
export async function lineText(page: Page, id: string | number): Promise<string> {
  await page.goto(url.view(id), { waitUntil: 'domcontentloaded' });
  /* The document body arrives after the page chrome. Without this poll the
   * regex below runs against the navigation menu and returns it verbatim. */
  const deadline = Date.now() + 20_000;
  let txt = '';
  for (;;) {
    txt = await page.evaluate<string>(`document.body.innerText.replace(/\\s+/g, ' ')`);
    if (/\bbuc\b/.test(txt) || Date.now() > deadline) break;
    await new Promise(r => setTimeout(r, 250));
  }
  /* Squeeze whitespace before matching: the viewer wraps long lines, so
   * "RAB-425628" comes back as "RAB- 425628" and a strict match misses. */
  const m = txt.match(/(?:Workshop|Training|Curs|One-day|Consultanta|Consulting)[^|]{0,240}?(?=\s+buc\b|\s+Exchange rate)/i);
  return (m ? m[0] : txt.slice(0, 200)).trim();
}

/** Replace the description of line 1. Assumes the invoice form page is open. */
async function setLineDescription(page: Page, description: string) {
  await page.waitForSelector(S.editPencil, { timeout: 30_000 });
  await page.click(S.editPencil);
  const name = page.locator(S.modalName);
  await name.waitFor({ state: 'visible', timeout: 15_000 });
  await name.fill(description);
  const desc = page.locator(S.modalDesc);
  if (await desc.count()) await desc.first().fill('');   // never leave a stray BT-154
  await page.locator(S.modalSubmit).first().click();
  await name.waitFor({ state: 'hidden', timeout: 15_000 });
  /* The line row must now carry the new text - fail loud if it does not, rather
   * than save an invoice whose description never took.
   *
   * NOT `waitForSelector('text="..."')`: quoting makes Playwright match the
   * element's WHOLE text exactly, and the row holds the full description, so a
   * tail fragment never matches and every copy died on a healthy page. Substring
   * against normalised text, polled until it shows up - no fixed sleep. */
  const needle = description.slice(-30).replace(/\s+/g, ' ').trim();
  const deadline = Date.now() + 15_000;
  for (;;) {
    const seen = await page.evaluate<boolean>(
      `document.body.innerText.replace(/\\s+/g, ' ').includes(${JSON.stringify(needle)})`
    );
    if (seen) break;
    if (Date.now() > deadline) {
      throw new Error(`line description did not appear on the invoice: ${JSON.stringify(needle)}`);
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

/** The document viewer that appears after saving. Lives in its own iframe. */
export const viewer = (page: Page) => page.frameLocator(S.viewerFrame);

/* Click save and wait for SmartBill to accept it. Deliberately does NOT look
 * inside the compact-view iframe any more: both handles this used - the EMISA
 * badge and #viewer_pdf_id - stopped matching, and a copy that had in fact
 * created a document died on the confirmation instead, leaving an unnumbered
 * draft behind. Whether the document really got issued is settled by the API
 * (the series number advances), not by anything on this page. */
async function saveDocument(page: Page, opts: { strict?: boolean } = {}): Promise<void> {
  await page.click(S.saveInvoice);
  /* A brand-new document may still need confirming. NOT isVisible(): that
   * returns immediately and IGNORES its timeout option, so the confirm was only
   * clicked if the iframe happened to be rendered at that instant - which is how
   * documents ended up saved-but-unissued, as unnumbered drafts. */
  const confirm = viewer(page).locator(S.confirmSave);
  await confirm.waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => confirm.click())
    .catch(() => { /* no confirm step for this document - fine */ });

  const saved = await page.waitForSelector('text=/salvat cu succes/i', { timeout: 30_000 })
    .then(() => true).catch(() => false);
  /* Callers that verify afterwards (copy polls the series) can tolerate a missing
   * notice. Callers that do NOT verify must fail loudly here, or they report
   * success over a save that never happened. */
  if (!saved && opts.strict !== false) {
    throw new Error('no "salvat cu succes" after saving - the document may be unchanged');
  }
}

/** Download the PDF of the currently open invoice into `dir`.
 *
 * `#viewer_pdf_id` moved OUT of the compact-view iframe and into the main
 * document, where it is a plain anchor to /documente/pdf/factura/<id>/. When it
 * is an anchor, fetch the href through the page's request context: that reuses
 * the session cookies and sidesteps the whole download-event dance (a
 * programmatic click carries no user activation, so Chrome refuses the save
 * silently - which is why this used to need a real Playwright click). */
export async function downloadPdf(page: Page, dir: string, filename?: string): Promise<string> {
  mkdirSync(dir, { recursive: true });

  const main = page.locator('#viewer_pdf_id').first();
  const inFrame = viewer(page).locator(S.exportPdf);
  const anchor = (await main.count()) ? main : null;
  const href = anchor ? await anchor.getAttribute('href').catch(() => null) : null;

  if (href) {
    const res = await page.request.get(new URL(href, BASE).toString());
    if (!res.ok()) throw new Error(`PDF fetch failed: HTTP ${res.status()}`);
    const bytes = await res.body();
    if (bytes.slice(0, 5).toString() !== '%PDF-') {
      throw new Error(`not a PDF (${bytes.length} bytes) - the session may be stale`);
    }
    const target = resolve(dir, filename ?? `${href.split('/').filter(Boolean).pop()}.pdf`);
    writeFileSync(target, bytes);
    return target;
  }

  // Older layout: the icon lives inside the viewer iframe and only a real click works.
  const pdfBtn = anchor ?? inFrame;
  await pdfBtn.waitFor({ timeout: 30_000 });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    pdfBtn.click(),
  ]);
  const target = resolve(dir, filename ?? dl.suggestedFilename());
  await dl.saveAs(target);
  return target;
}

/** Copy `templateId`, swap the line description, save it. The CALLER confirms
 *  the issue against the API - see saveDocument. */
export async function createFromTemplate(
  page: Page, templateId: string | number, description: string
): Promise<void> {
  await page.goto(url.copy(templateId), { waitUntil: 'domcontentloaded' });
  await setLineDescription(page, description);
  await jitter();
  await saveDocument(page, { strict: false });   // caller polls the series
}

/** Rewrite the line description of an existing invoice and re-save it. */
export async function editDescription(
  page: Page, invoiceId: string | number, description: string
): Promise<void> {
  await page.goto(url.edit(invoiceId), { waitUntil: 'domcontentloaded' });
  await setLineDescription(page, description);
  await jitter();
  await saveDocument(page);
}

/* ------------------------------------------------------------------ *
 * Issuing through the UI                                              *
 * ------------------------------------------------------------------ */

/* Since Sep 2026 this account's subscription no longer includes API issuing
 * ("Abonamentul tau nu include emiteri prin API" on /core/integrari/ - it is a
 * Platinum/eCommerce feature, NOT a stale token), so `create` is unavailable and
 * a document can only be issued by driving the emitere form. `copy` inherits the
 * client, series, currency, VAT rate and UM from a template invoice; this goes
 * one step further and also sets the PRICE and the payment term, which is what
 * separates "same workshop again" from a real new invoice. */
export const ISSUE = {
  paymentTerm: '#payment_term_select',
  dueDay: '#due_day', dueMonth: '#due_month', dueYear: '#due_year',
  modalPrice: '#edit_product_price',
  modalApply: '#editBtn',                  // "Modifica produs"
};

export interface IssueOpts {
  template: string | number;
  description: string;
  price: string;                 // net unit price, as typed into the form
  qty?: string;
  term?: string;                 // payment term label, e.g. "60 de zile"
  dryRun?: boolean;
}

export async function issueFromTemplate(page: Page, o: IssueOpts): Promise<{ staged: string }> {
  await page.goto(url.copy(o.template), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(S.editPencil, { timeout: 30_000 });

  if (o.term) {
    /* The term drives the due date, so setting it by label is safer than typing
     * three date boxes and hoping the hidden due_date follows. selectOption
     * dispatches a real change event; assigning .value would not. */
    await page.selectOption(ISSUE.paymentTerm, { label: o.term });
  }

  await page.click(S.editPencil);
  const name = page.locator(S.modalName);
  await name.waitFor({ state: 'visible', timeout: 15_000 });
  await name.fill(o.description);
  const desc = page.locator(S.modalDesc);
  if (await desc.count()) await desc.first().fill('');    // never leave a stray BT-154
  const price = page.locator(ISSUE.modalPrice);
  await price.fill(o.price);
  /* The modal recomputes VAT and total from the price on blur, not on input.
   * Applying without it saves the OLD total against the NEW price. */
  await price.press('Tab');
  if (o.qty) await page.locator('#edit_product_quantity').fill(o.qty);
  await page.locator(ISSUE.modalApply).click();
  await name.waitFor({ state: 'hidden', timeout: 15_000 });

  /* Verify against the LINE ROW, before saving: the modal is reset once closed,
   * so reading it back would report blanks for a change that did land. */
  const row = await page.evaluate<string>(
    `(function(){ var a = document.querySelector('a.emitere_edit');
       var p = a && (a.closest('tr') || a.parentElement.parentElement);
       return p ? p.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`
  );
  const needle = o.description.slice(-30).replace(/\s+/g, ' ').trim();
  if (!row.includes(needle)) throw new Error(`line did not take the description: ${row}`);
  if (!row.replace(/\s/g, '').includes(o.price.replace(/\s/g, ''))) {
    throw new Error(`line did not take the price ${o.price}: ${row}`);
  }

  const totals = await page.evaluate<string>(
    `JSON.stringify({ net: (document.querySelector('#total_value_input')||{}).value,
                      vat: (document.querySelector('#total_vat_input')||{}).value,
                      total: (document.querySelector('#total_input')||{}).value,
                      due: [(document.querySelector('#due_day')||{}).value,
                            (document.querySelector('#due_month')||{}).value,
                            (document.querySelector('#due_year')||{}).value].join('/') })`
  );
  const staged = `${row} | ${totals}`;
  if (o.dryRun) return { staged };

  await page.click(S.saveInvoice);
  /* What follows the save moved once already (the old #view_save_disposition in
   * the compact-view iframe is gone), so react to whatever shows up rather than
   * insisting on one selector: either the success notice, or a confirm button
   * in the viewer. */
  const deadline = Date.now() + 45_000;
  for (;;) {
    const done = await page.locator('text=/salvat cu succes/i').count().catch(() => 0);
    if (done) break;
    const confirm = viewer(page).locator(S.confirmSave);
    if (await confirm.isVisible().catch(() => false)) { await confirm.click().catch(() => {}); }
    if (Date.now() > deadline) throw new Error('no confirmation after saving - check the report before retrying, a document may exist');
    await new Promise(r => setTimeout(r, 500));
  }
  return { staged };
}

/* Turn the unnumbered DRAFT that `issue` leaves behind into an issued document.
 *
 * Saving the emitere form no longer finishes the job: it lands a "Ciorna" with
 * number "S" and no fiscal number. The control that finalises it is NOT the old
 * #view_save_disposition inside the compact-view iframe (that one is gone) - it
 * is `#viewer_save_id` ("Salveaza") on the document's own view page, in the MAIN
 * document. The page's iframe has the SAME src as the page, which is why looking
 * inside frames for it finds nothing. */
export async function finalizeDraft(page: Page, id: string | number): Promise<void> {
  await page.goto(url.view(id), { waitUntil: 'domcontentloaded' });
  const btn = page.locator('#viewer_save_id');
  await btn.waitFor({ state: 'visible', timeout: 30_000 });
  await btn.click();
  /* The verdict is the document losing its draft status, not the click. */
  const deadline = Date.now() + 45_000;
  for (;;) {
    const txt = await page.evaluate<string>(`document.body.innerText.replace(/\\s+/g, ' ')`).catch(() => '');
    if (/salvat cu succes/i.test(txt) || !(await page.locator('#viewer_save_id').isVisible().catch(() => false))) break;
    if (Date.now() > deadline) throw new Error(`draft ${id} still shows the Salveaza button - it was not finalised`);
    await new Promise(r => setTimeout(r, 500));
  }
}
