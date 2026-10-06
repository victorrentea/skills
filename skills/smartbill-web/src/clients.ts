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
  /** VAT / fiscal code (`#client_cif`). Printed on the invoice as "VAT CODE",
   *  so a reverse-charge invoice is WRONG without it: leaving the template's
   *  code in place prints one company's name over another company's VAT id. */
  cif?: string;
  /** Registrar-of-companies / organisation number. */
  regCom?: string;
  email?: string;
  /** Trading name. The template's value survives an edit that ignores it, so
   *  pass '' to clear it rather than leaving the previous customer's brand on. */
  brand?: string;
}

export const S_CLIENT = {
  nameOnInvoice: '#client_name',      // autocomplete in the invoice header
  idOnInvoice: '#client_id',
  editPencil: '#client_details_span a[title="Modifica client"]',
  modal: '#modal-emitere-add-client',
  modalName: '#client_name_input',
  modalCif: '#client_cif',
  modalRegCom: '#client_reg_com',
  modalEmail: '#client_email',
  modalBrand: '#client_brand',
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
 * Attach a BRAND-NEW client to an invoice, instead of rewriting the one it
 * inherited from a template.
 *
 * `add_new_client(e)` branches on `e.id`: empty means "add", anything else means
 * "modify". The id comes from the modal's `client-data`, which `clean_client_modal()`
 * removes - so cleaning first is the whole difference between creating
 * a new customer and silently RENAMING the template's customer in the
 * nomenclator, taking its VAT code with it.
 *
 * That is why `setInvoiceClient` must not be pointed at a template: it opens
 * `edit_client()`, which keeps the id and therefore always modifies.
 */
export async function addInvoiceClient(
  page: Page,
  invoiceId: string | number,
  want: ClientSnapshot,
  opts: { dryRun?: boolean } = {}
): Promise<Record<string, string>> {
  await page.goto(url.edit(invoiceId), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(S_CLIENT.nameOnInvoice, { timeout: 30_000 });

  // String form: tsx compiles arrows with a `__name` helper the page lacks.
  const cleaned = await page.evaluate<boolean>(
    "(function(){ if (typeof window.clean_client_modal !== 'function') return false;"
    + " window.clean_client_modal();"
    + " $('#modal-emitere-add-client').modal('show'); return true; })()"
  );
  if (!cleaned) throw new Error('clean_client_modal() missing - SmartBill changed the issuing page');
  await page.waitForSelector(`${S_CLIENT.modalSave}:visible`, { timeout: 20_000 });

  /* `add_new_client(e)` branches on `e.id`, and that id comes from `#client_id`
   * - which lives in the INVOICE header, not in the modal. clean_client_modal()
   * only empties the modal (`removeData('client-data')` + its own inputs), so
   * the template's client id survives the clean and the POST goes out as a
   * MODIFY: the template's customer is renamed in the nomenclator and loses its
   * VAT code, silently, off-invoice. Checking `client-data` alone stopped
   * catching this - verified 22 Sep 2026, payload carried the template
   * customer's id after a clean that the old guard passed. */
  await page.evaluate("$('#client_id').val(''); $('#old_client_cif').val('');");
  const carriesId = await page.evaluate<boolean>(
    "!!$('#modal-emitere-add-client').data('client-data') || !!$('#client_id').val()"
  );
  if (carriesId) throw new Error('invoice still carries a client id - saving would MODIFY an existing client, not add one');

  await page.fill(S_CLIENT.modalName, want.name);
  if (want.cif !== undefined) await page.fill(S_CLIENT.modalCif, want.cif);
  if (want.regCom !== undefined) await page.fill(S_CLIENT.modalRegCom, want.regCom);
  if (want.email !== undefined) await page.fill(S_CLIENT.modalEmail, want.email);
  if (want.address !== undefined) await page.fill(S_CLIENT.modalAddress, want.address);
  if (want.city !== undefined) await page.fill(S_CLIENT.modalCity, want.city);
  if (want.county !== undefined) await page.fill(S_CLIENT.modalCounty, want.county);
  // clean_client_modal() defaults the country to Romania, so this is not optional
  // for a foreign customer even when the caller leaves it out.
  await page.fill(S_CLIENT.modalCountry, want.country ?? '');

  const q = (sel: string) => `((document.querySelector(${JSON.stringify(sel)}) || {}).value || '')`;
  const staged = await page.evaluate<Record<string, string>>(
    `({ name: ${q(S_CLIENT.modalName)}, cif: ${q(S_CLIENT.modalCif)},`
    + ` regCom: ${q(S_CLIENT.modalRegCom)}, address: ${q(S_CLIENT.modalAddress)},`
    + ` city: ${q(S_CLIENT.modalCity)}, country: ${q(S_CLIENT.modalCountry)} })`
  );

  if (opts.dryRun) return staged;

  await page.click(S_CLIENT.modalSave);
  await page.waitForSelector(`${S_CLIENT.modal}:visible`, { state: 'hidden', timeout: 20_000 })
    .catch(() => { throw new Error('client modal stayed open - the save was rejected'); });
  const headerShowsName =
    `((document.querySelector(${JSON.stringify(S_CLIENT.nameOnInvoice)}) || {}).value || '').trim()`
    + ` === ${JSON.stringify(want.name)}`;
  await page.waitForFunction(headerShowsName, undefined, { timeout: 20_000 })
    .catch(() => { throw new Error(`invoice header still not showing "${want.name}"`); });

  await page.click(S_CLIENT.saveInvoice);
  await page.waitForSelector(S_CLIENT.savedNotice, { timeout: 30_000 })
    .catch(() => { throw new Error('no "salvat cu succes" after saving the invoice'); });
  return staged;
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
  if (want.cif !== undefined) await page.fill(S_CLIENT.modalCif, want.cif);
  if (want.regCom !== undefined) await page.fill(S_CLIENT.modalRegCom, want.regCom);
  if (want.email !== undefined) await page.fill(S_CLIENT.modalEmail, want.email);
  if (want.brand !== undefined) await page.fill(S_CLIENT.modalBrand, want.brand);
  if (want.address !== undefined) await page.fill(S_CLIENT.modalAddress, want.address);
  if (want.city !== undefined) await page.fill(S_CLIENT.modalCity, want.city);
  if (want.county !== undefined) await page.fill(S_CLIENT.modalCounty, want.county);
  if (want.country !== undefined) await page.fill(S_CLIENT.modalCountry, want.country);

  // Read the modal back BEFORE saving it: closing the modal resets these inputs,
  // so anything read afterwards describes a blank form, not the document.
  const q = (sel: string) => `((document.querySelector(${JSON.stringify(sel)}) || {}).value || '')`;
  const staged = await page.evaluate<Record<string, string>>(
    `({ id: ${q(S_CLIENT.idOnInvoice)}, name: ${q(S_CLIENT.modalName)},`
    + ` cif: ${q(S_CLIENT.modalCif)}, regCom: ${q(S_CLIENT.modalRegCom)},`
    + ` brand: ${q(S_CLIENT.modalBrand)},`
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

/**
 * Attach an EXISTING client to an invoice through the header autocomplete.
 *
 * Neither `setInvoiceClient` (edits the client record in place) nor
 * `addInvoiceClient` (creates a new one) is right when the customer is already
 * in the nomenclator: the first corrupts it, the second leaves a duplicate CIF.
 * `#client_name` is a jQuery-UI autocomplete whose placeholder says
 * "CIF pt. firme/CNP...", so the fiscal code is the natural key.
 */
export async function pickInvoiceClient(
  page: Page,
  invoiceId: string | number,
  query: string,
  opts: { dryRun?: boolean } = {}
): Promise<{ options: string[]; picked?: string }> {
  await page.goto(url.edit(invoiceId), { waitUntil: 'domcontentloaded' });
  const box = page.locator(S_CLIENT.nameOnInvoice);
  await box.waitFor({ state: 'visible', timeout: 30_000 });

  // Type, never assign: jQuery-UI listens for real key events, and a value set
  // through the DOM leaves the widget's own state untouched, so the menu never
  // opens - which looks exactly like "this client does not exist".
  await box.click();
  await box.fill('');
  await box.type(query, { delay: 60 });

  const menu = page.locator('ul.ui-autocomplete:visible li');
  await menu.first().waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => { throw new Error(`no autocomplete suggestion for "${query}"`); });
  const options = (await menu.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  if (opts.dryRun) return { options };

  const picked = options[0];
  await menu.first().click();
  // The header must end up carrying a name - anything else means the pick was
  // swallowed, and saving then would store the template's customer.
  await page.waitForFunction(
    `((document.querySelector('#client_name')||{}).value||'').trim().length > 0`,
    undefined, { timeout: 20_000 }
  );
  await page.click(S_CLIENT.saveInvoice);
  // The "salvat cu succes" notice is unreliable (Sep 2026); the caller verifies
  // against the PDF instead, so do not fail the whole run on its absence.
  await page.waitForSelector(S_CLIENT.savedNotice, { timeout: 15_000 }).catch(() => {});
  return { options, picked };
}
