/**
 * Changing the CUSTOMER on an already-issued invoice.
 *
 * An invoice stores its own SNAPSHOT of the client, frozen at issue time. Fixing
 * the client record in the nomenclator does NOT reach invoices already issued,
 * and neither does re-saving the invoice: the invoice form does not even carry
 * the client detail fields - they live in a separate form (`filter_form2_emitere`)
 * that is not submitted with the document.
 *
 * The only thing that rewrites the snapshot is SmartBill's own
 * "Modifica client existent" modal, opened by the page-global `edit_client()`.
 * Fields must receive REAL input events; assigning `.value` from injected JS is
 * silently ignored when the form is saved, which looks exactly like a no-op save.
 */
import type { Page } from 'playwright';
import { url } from './invoices.js';

export interface ClientSnapshot {
  /** Customer name as it must appear on the invoice. */
  name: string;
  /** Address block; newlines are real lines on the PDF. */
  address?: string;
  city?: string;
  county?: string;
  country?: string;
}

export const S_CLIENT = {
  nameOnInvoice: '#client_name',      // autocomplete in the invoice header
  idOnInvoice: '#client_id',
  editPencil: '#client_details_span a[title="Modifica client"]',
  modal: '#modal-emitere-add-client',
  modalName: '#client_name_input',
  modalAddress: '#client_address',
  modalCity: '#client_city',
  modalCounty: '#client_county',
  modalCountry: '#client_country',
  modalSave: '#addClientBtn',         // "Salveaza date client"
  saveInvoice: '#saveInvoiceBtn',     // "Salveaza Factura"
  savedNotice: 'text=/salvat cu succes/i',
};

/** Open the "Modifica client existent" modal on an open invoice edit page. */
async function openClientModal(page: Page) {
  await page.waitForSelector(S_CLIENT.nameOnInvoice, { timeout: 30_000 });
  // The pencil is revealed on hover; calling the page's own handler is steadier
  // than chasing hover state, and it is the same code path the click triggers.
  /* String form on purpose: tsx/esbuild compiles arrow functions with a
   * `__name` helper that does not exist in the page, so a function passed to
   * evaluate() dies with "__name is not defined". */
  const opened = await page.evaluate<boolean>(
    "typeof window.edit_client === 'function' ? (window.edit_client(), true) : false"
  );
  if (!opened) throw new Error('edit_client() missing - SmartBill changed the issuing page');
  await page.waitForSelector(`${S_CLIENT.modalSave}:visible`, { timeout: 20_000 });
}

/**
 * Rewrite the client snapshot of ONE issued invoice. Does not save the document
 * when `dryRun`, so the staged values can be inspected first.
 * Returns what the form holds after the modal closes.
 */
export async function setInvoiceClient(
  page: Page,
  invoiceId: string | number,
  want: ClientSnapshot,
  opts: { dryRun?: boolean } = {}
): Promise<Record<string, string>> {
  await page.goto(url.edit(invoiceId), { waitUntil: 'domcontentloaded' });
  await openClientModal(page);

  // fill() dispatches real input events - see the note at the top of this file.
  await page.fill(S_CLIENT.modalName, want.name);
  if (want.address !== undefined) await page.fill(S_CLIENT.modalAddress, want.address);
  if (want.city !== undefined) await page.fill(S_CLIENT.modalCity, want.city);
  if (want.county !== undefined) await page.fill(S_CLIENT.modalCounty, want.county);
  if (want.country !== undefined) await page.fill(S_CLIENT.modalCountry, want.country);

  // Read the modal back BEFORE saving it: closing the modal resets these inputs,
  // so anything read afterwards describes a blank form, not the document.
  const q = (sel: string) => `((document.querySelector(${JSON.stringify(sel)}) || {}).value || '')`;
  const staged = await page.evaluate<Record<string, string>>(
    `({ id: ${q(S_CLIENT.idOnInvoice)}, name: ${q(S_CLIENT.modalName)},`
    + ` address: ${q(S_CLIENT.modalAddress)}, city: ${q(S_CLIENT.modalCity)},`
    + ` country: ${q(S_CLIENT.modalCountry)} })`
  );

  await page.click(S_CLIENT.modalSave);

  // The modal must close AND the header must carry the new name. Waiting on only
  // one of the two has let a half-applied edit through.
  await page.waitForSelector(`${S_CLIENT.modal}:visible`, { state: 'hidden', timeout: 20_000 })
    .catch(() => { throw new Error('client modal stayed open - the save was rejected'); });
  const headerShowsName =
    `((document.querySelector(${JSON.stringify(S_CLIENT.nameOnInvoice)}) || {}).value || '').trim()`
    + ` === ${JSON.stringify(want.name)}`;
  await page.waitForFunction(headerShowsName, undefined, { timeout: 20_000 })
    .catch(() => { throw new Error(`invoice header still not showing "${want.name}"`); });

  if (opts.dryRun) return staged;

  await page.click(S_CLIENT.saveInvoice);
  await page.waitForSelector(S_CLIENT.savedNotice, { timeout: 30_000 })
    .catch(() => { throw new Error('no "salvat cu succes" after saving the invoice'); });
  return staged;
}
