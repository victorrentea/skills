/**
 * The Glovo correlations as a PDF for the accountant.
 *
 * The whole point of the layout is that a Glovo payment and the invoice that
 * documents it are NOT the same number, so the two sources are coloured as
 * separate column bands - blue for what comes off the bank statement, green for
 * what comes off the e-invoice, amber for the part no invoice covers. Printed as
 * one flat table it reads as "payment 219.38, invoice 12.98" and looks like an
 * error rather than a structure.
 */
import type { OrderMatch } from './glovo.js';

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const lei = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function glovoPdfHtml(ms: OrderMatch[], meta: { iban: string; from: string; to: string }): string {
  /* Chronological, the way an accountant reads a statement. */
  const key = (d: string) => d.split('/').reverse().join('');
  const dated = ms.filter(m => m.tx).sort((a, b) => key(a.tx!.date) < key(b.tx!.date) ? -1 : 1);
  const withFee = dated.filter(m => m.feeInvoice);
  const noFee = dated.filter(m => !m.feeInvoice);
  const sum = (xs: OrderMatch[], f: (m: OrderMatch) => number) => xs.reduce((a, m) => a + f(m), 0);

  const rows = withFee.map(m => `
    <tr>
      <td class="e d">${esc(m.tx!.date)}</td>
      <td class="e n strong">${lei(m.order.total)}</td>
      <td class="e">${esc(m.order.store)}</td>
      <td class="f">${esc(m.feeInvoice!.doc.replace(/^Fact /, ''))}</td>
      <td class="f d">${esc(m.feeInvoice!.date)}</td>
      <td class="f n strong">${lei(m.order.fees)}</td>
      <td class="x n">${m.foodInvoice ? `<span class="ok">${lei(m.order.food)}</span>` : lei(m.order.food)}</td>
      <td class="x n">${m.order.tip ? lei(m.order.tip) : '&ndash;'}</td>
    </tr>`).join('');

  return `<title>Plati Glovo - facturi GLOVOAPPRO</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box }
  body { font: 9.5px/1.45 "Helvetica Neue", Arial, sans-serif; color: #1b1a18; background: #fff; margin: 0 }
  h1 { font-size: 15px; margin: 0 0 2px }
  .sub { color: #6b655d; font-size: 9px; margin: 0 0 10px }
  .legend { display: flex; gap: 14px; margin: 0 0 8px; font-size: 8.5px; align-items: center }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px }
  .li-e i { background: #cfe0f5 } .li-f i { background: #cfe9d8 } .li-x i { background: #f6e3c4 }
  table { border-collapse: collapse; width: 100%; }
  caption { caption-side: top; text-align: left }
  th, td { padding: 3.5px 6px; border-bottom: 1px solid #e6e2db }
  thead th { font-size: 8px; text-transform: uppercase; letter-spacing: .04em; color: #4a463f; border-bottom: 1px solid #b9b3a8; font-weight: 700 }
  thead tr.grp th { text-align: center; font-size: 8.5px; padding: 4px 6px; border-bottom: 0; color: #24221e }
  thead tr.grp th.e { background: #cfe0f5 } thead tr.grp th.f { background: #cfe9d8 } thead tr.grp th.x { background: #f6e3c4 }
  td.e, th.e { background: #eef4fc } td.f, th.f { background: #eef8f2 } td.x, th.x { background: #fdf6ea }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap }
  .d { white-space: nowrap; color: #55504a }
  .strong { font-weight: 700 }
  .ok { background: #bfe8cd; padding: 0 4px; border-radius: 3px; font-weight: 700 }
  tr.tot td { font-weight: 700; border-top: 1px solid #b9b3a8; border-bottom: 0; padding-top: 5px }
  thead { display: table-header-group }
  tr { break-inside: avoid }
  .note { font-size: 8.5px; color: #4a463f; margin-top: 10px; line-height: 1.5 }
  .note b { color: #1b1a18 }
  .miss { margin-top: 8px; font-size: 8.5px; break-inside: avoid }
  .miss table { width: auto } .miss td { background: #fdf6ea }
</style>
<h1>Plăți Glovo &rarr; facturi GLOVOAPPRO</h1>
<p class="sub">VICTOR RENTEA CONSULTING S.R.L. &middot; cont ${esc(meta.iban)} &middot; ${esc(meta.from)} &ndash; ${esc(meta.to)} &middot; ${withFee.length} corelații</p>

<div class="legend">
  <span class="li-e"><i></i>albastru = din extrasul de cont (ce s-a plătit)</span>
  <span class="li-f"><i></i>verde = din factura primită în SPV (ce e documentat)</span>
  <span class="li-x"><i></i>ocru = fără factură</span>
</div>

<table>
  <thead>
    <tr class="grp">
      <th class="e" colspan="3">DIN EXTRAS &mdash; plata cu cardul</th>
      <th class="f" colspan="3">DIN FACTURĂ &mdash; GLOVOAPPRO (taxe)</th>
      <th class="x" colspan="2">RESTUL PLĂȚII &mdash; fără factură</th>
    </tr>
    <tr>
      <th class="e">Data plății</th><th class="e n">Sumă plătită</th><th class="e">Magazin</th>
      <th class="f">Nr. factură</th><th class="f">Data facturii</th><th class="f n">Valoare</th>
      <th class="x n">Mâncare</th><th class="x n">Bacșiș</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tr class="tot">
      <td class="e" colspan="1">TOTAL</td><td class="e n">${lei(sum(withFee, m => m.order.total))}</td><td class="e"></td>
      <td class="f" colspan="2"></td><td class="f n">${lei(sum(withFee, m => m.order.fees))}</td>
      <td class="x n">${lei(sum(withFee, m => m.order.food))}</td><td class="x n">${lei(sum(withFee, m => m.order.tip))}</td>
  </tr>
</table>

<p class="note">
<b>Cum se citește:</b> factura GLOVOAPPRO acoperă doar taxele Glovo (livrare + service fee), deci coloana verde e mult mai mică decât suma plătită. Diferența este mâncarea, facturată separat de restaurant, plus bacșișul curierului, care nu e facturat de nimeni.<br>
<b>Singura comandă documentată integral</b> este cea din 07/07/2026: 219,38 = <span class="ok">180,60</span> factura DV7653 de la Restaurante Trattoria Il Calcio SRL + 12,98 factura Glovo RIDPJ-0303978 + 25,80 bacșiș. Pentru restul comenzilor nu există factură de la restaurant în SPV.<br>
<b>Corelarea</b> s-a făcut prin istoricul de comenzi din contul Glovo: totalul comenzii este exact suma debitată pe card, iar taxele din comandă sunt exact valoarea facturii GLOVOAPPRO.<br>
<b>Aprilie 2026 lipsește</b> &mdash; nu există extras PDF pe contul RON pentru luna aceea.
</p>

${noFee.length ? `<div class="miss"><b>Plăți Glovo din extras fără factură GLOVOAPPRO corespondentă:</b>
<table><tbody>${noFee.map(m => `<tr><td class="d">${esc(m.tx!.date)}</td><td class="n">${lei(m.order.total)}</td><td>${esc(m.order.store)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}
