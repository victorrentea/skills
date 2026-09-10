import { open, BASE } from './src/session.js';
const s = await open({ headless: true });
await s.page.goto(BASE + '/raport/raport_extrase_v2/', { waitUntil: 'domcontentloaded' });
for (const f of ['raport_extrase_v2', 'extrase_modules', 'analiza_extras']) {
  const r = await s.ctx.request.get(`${BASE}/media/js/build/reports/${f}.sbc30451.js`);
  const t = await r.text();
  const urls = [...new Set((t.match(/["'`]\/[a-z0-9_\/-]{6,}\/["'`]/gi) || []).map(x => x.slice(1, -1)))];
  console.log('###', f, t.length, JSON.stringify(urls.filter(u => !/media|static/.test(u)), null, 0));
}
const r = await s.ctx.request.get(`${BASE}/media/js/build/smartaccounts/raport-extrase.sbc30451.js`);
const t = await r.text();
console.log('### smartaccounts/raport-extrase', JSON.stringify([...new Set((t.match(/["'`]\/[a-z0-9_\/-]{6,}\/["'`]/gi)||[]).map(x=>x.slice(1,-1)))], null, 0));
await s.close();
