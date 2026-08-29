import type { Page } from 'playwright';
import { BASE, jitter } from './session.js';
import { mkdirSync } from 'node:fs';
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

/** Download the PDF of the currently open invoice into `dir`. */
export async function downloadPdf(page: Page, dir: string, filename?: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const pdfBtn = viewer(page).locator(S.exportPdf);
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
