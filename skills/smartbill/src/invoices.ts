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
  issuedBadge: 'text=/EMISA/i',
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
  // the line row must now carry the new text - fail loud if it does not
  await page.waitForSelector(`text=${JSON.stringify(description.slice(-30))}`, { timeout: 15_000 });
}

/** The document viewer that appears after saving. Lives in its own iframe. */
export const viewer = (page: Page) => page.frameLocator(S.viewerFrame);

async function saveAndIssue(page: Page): Promise<string> {
  await page.click(S.saveInvoice);
  const v = viewer(page);
  // A draft shows a preview with a confirm button; an already-issued invoice
  // saves straight away. Both render inside the viewer iframe.
  const confirm = v.locator(S.confirmSave);
  if (await confirm.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await confirm.click();
  }
  await v.locator(S.issuedBadge).first().waitFor({ timeout: 30_000 });
  const body = (await v.locator('body').innerText()) ?? '';
  return body.match(/Emitere factura\s+([A-Z]+\d+)/)?.[1] ?? (await page.title());
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

/** Copy `templateId`, swap the line description, issue it. Returns the new number. */
export async function createFromTemplate(
  page: Page, templateId: string | number, description: string
): Promise<string> {
  await page.goto(url.copy(templateId), { waitUntil: 'domcontentloaded' });
  await setLineDescription(page, description);
  await jitter();
  return saveAndIssue(page);
}

/** Rewrite the line description of an existing invoice and re-save it. */
export async function editDescription(
  page: Page, invoiceId: string | number, description: string
): Promise<string> {
  await page.goto(url.edit(invoiceId), { waitUntil: 'domcontentloaded' });
  await setLineDescription(page, description);
  await jitter();
  return saveAndIssue(page);
}
