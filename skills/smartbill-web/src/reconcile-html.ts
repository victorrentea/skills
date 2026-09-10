/**
 * The reconciliation as a page. Deliberately a LOCAL file, never a published
 * artifact: these are the company's bank movements and supplier invoices.
 */
import type { Match, BankTx, Expense } from './acquisitions.js';

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const lei = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderReconcile(
  r: { matches: Match[]; unmatchedTx: BankTx[]; unmatchedExpenses: Expense[] },
  meta: { from: string; to: string; sources: string[] },
): string {
  const sure = r.matches.filter(m => m.score >= 80);
  const maybe = r.matches.filter(m => m.score < 80);
  const total = (ms: Match[]) => ms.reduce((a, m) => a + m.txAmount, 0);

  const row = (m: Match) => `
    <tr class="${m.score >= 80 ? 'sure' : 'maybe'}${m.ambiguous ? ' amb' : ''}">
      <td class="score">${m.score}</td>
      <td class="nowrap">${esc(m.txDate)}</td>
      <td class="num">${lei(m.txAmount)}</td>
      <td><b>${esc(m.doc)}</b><div class="sub">${esc(m.supplier)} &middot; ${esc(m.docDate)}</div></td>
      <td class="why">${m.why.map(w => `<span>${esc(w)}</span>`).join('')}${m.ambiguous ? `<span class="warn">ambiguu: inca ${m.ambiguous} factura(i) cu aceeasi suma</span>` : ''}
        <div class="stmt">${esc(m.txDetails.replace(/\s+/g, ' ').slice(0, 220))}</div></td>
    </tr>`;

  return `<title>Cuplaj plati - facturi furnizori</title>
<style>
  :root{--bg:#fbfaf8;--fg:#1c1a17;--mut:#6b655d;--line:#e2ddd5;--card:#fff;--ok:#1c6b45;--okbg:#e7f3ec;--may:#8a5a00;--maybg:#fdf3e0;--warn:#a3341f}
  @media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#161513;--fg:#eeeae4;--mut:#9d968c;--line:#2f2c28;--card:#1e1c19;--ok:#7fd4a6;--okbg:#163326;--may:#e5b45f;--maybg:#33270f;--warn:#f0917a}}
  :root[data-theme=dark]{--bg:#161513;--fg:#eeeae4;--mut:#9d968c;--line:#2f2c28;--card:#1e1c19;--ok:#7fd4a6;--okbg:#163326;--may:#e5b45f;--maybg:#33270f;--warn:#f0917a}
  body{background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding-block:32px;padding-left:24px;padding-right:24px;max-width:1180px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px} .lede{color:var(--mut);margin:0 0 24px}
  .cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:28px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:150px;flex:1}
  .card b{display:block;font-size:24px;font-variant-numeric:tabular-nums} .card span{color:var(--mut);font-size:12px}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:32px 0 10px;font-weight:600}
  .wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
  table{border-collapse:collapse;width:100%;min-width:820px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);padding:10px 12px;border-bottom:1px solid var(--line)}
  td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:0}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .nowrap{white-space:nowrap;color:var(--mut)}
  .score{font-variant-numeric:tabular-nums;font-weight:700;width:44px}
  .sure .score{color:var(--ok)} .maybe .score{color:var(--may)}
  .sure{background:var(--okbg)} .maybe{background:var(--maybg)}
  .sub{color:var(--mut);font-size:12px}
  .why span{display:inline-block;border:1px solid var(--line);border-radius:20px;padding:1px 9px;margin:0 4px 4px 0;font-size:11px;background:var(--bg)}
  .why span.warn{border-color:var(--warn);color:var(--warn)}
  .stmt{color:var(--mut);font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:4px;word-break:break-word}
  details{margin-top:10px} summary{cursor:pointer;color:var(--mut);padding:6px 0}
  .foot{color:var(--mut);font-size:12px;margin-top:32px;border-top:1px solid var(--line);padding-top:12px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
</style>
<h1>Cuplaj plati &rarr; facturi furnizori</h1>
<p class="lede">${esc(meta.from)} &ndash; ${esc(meta.to)} &middot; cont RON &middot; ${r.matches.length} potriviri propuse. Nimic nu a fost scris in SmartBill.</p>

<div class="cards">
  <div class="card"><b>${sure.length}</b><span>sigure (scor &ge; 80) &middot; ${lei(total(sure))} RON</span></div>
  <div class="card"><b>${maybe.length}</b><span>de confirmat (scor &lt; 80) &middot; ${lei(total(maybe))} RON</span></div>
  <div class="card"><b>${r.unmatchedTx.length}</b><span>plati fara factura</span></div>
  <div class="card"><b>${r.unmatchedExpenses.length}</b><span>facturi neplatite</span></div>
</div>

<h2>Sigure &mdash; suma si numele (sau numarul) coincid</h2>
<div class="wrap"><table>
  <tr><th>scor</th><th>platit</th><th class="num">suma</th><th>factura</th><th>de ce</th></tr>
  ${sure.map(row).join('')}
</table></div>

<h2>De confirmat &mdash; doar suma si data</h2>
<p class="lede">Tipic o plata cu cardul unde banca tipareste numele comercial, nu pe cel legal.</p>
<div class="wrap"><table>
  <tr><th>scor</th><th>platit</th><th class="num">suma</th><th>factura</th><th>de ce</th></tr>
  ${maybe.map(row).join('')}
</table></div>

<details><summary>${r.unmatchedTx.length} plati fara nicio factura care sa le inchida</summary>
<div class="wrap"><table>
  <tr><th>data</th><th class="num">suma</th><th>detalii extras</th></tr>
  ${r.unmatchedTx.map(t => `<tr><td class="nowrap">${esc(t.date)}</td><td class="num">${lei(t.paid)}</td><td class="stmt">${esc(t.details.replace(/\s+/g, ' ').slice(0, 260))}</td></tr>`).join('')}
</table></div></details>

<details><summary>${r.unmatchedExpenses.length} facturi ramase neplatite</summary>
<div class="wrap"><table>
  <tr><th>data</th><th>document</th><th>furnizor</th><th class="num">rest</th><th>stare</th></tr>
  ${r.unmatchedExpenses.map(e => `<tr><td class="nowrap">${esc(e.date)}</td><td>${esc(e.doc)}</td><td>${esc(e.supplier)}</td><td class="num">${lei(e.remaining)} ${esc(e.currency)}</td><td class="sub">${esc(e.status)}</td></tr>`).join('')}
</table></div></details>

<p class="foot">Extrase citite: ${meta.sources.map(s => `<code>${esc(s.split('/').pop() ?? s)}</code>`).join(', ')}.<br>
Generat de <code>npm run sb -- reconcile --html</code>. Fisier local &mdash; nu se publica nicaieri.</p>`;
}
