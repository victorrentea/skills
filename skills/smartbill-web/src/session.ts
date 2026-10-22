import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const STATE = resolve(ROOT, 'storageState.json');
export const BASE = 'https://cloud.smartbill.ro';

/** Short human-ish pause. Never used to "wait for the page" - that is what
 *  waitForSelector is for. Only to avoid hammering the app between actions. */
export const jitter = (min = 1000, max = 2000) =>
  new Promise<void>(r => setTimeout(r, min + Math.random() * (max - min)));

export interface Session {
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export async function open(opts: { headless?: boolean; downloadDir?: string; cdp?: string; state?: string } = {}): Promise<Session> {
  /* Attaching to a Chrome you are already signed into beats `login` whenever the
   * person who owns the account is not at the keyboard. Start Chrome with
   *   --remote-debugging-port=9222
   * and pass --cdp (or set SMARTBILL_CDP). Nothing is read from the profile on
   * disk; Chrome itself does the decrypting. */
  const endpoint = opts.cdp ?? process.env.SMARTBILL_CDP;
  if (endpoint) {
    const browser = await chromium.connectOverCDP(endpoint);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = await ctx.newPage();
    return {
      browser, ctx, page,
      // Close only the tab we opened. Closing the context would take the user's
      // own tabs with it; browser.close() merely detaches on a CDP connection.
      close: async () => { await page.close().catch(() => {}); await browser.close().catch(() => {}); },
    };
  }

  const stateFile = opts.state ?? STATE;
  if (!existsSync(stateFile)) {
    throw new Error(
      `No saved session at ${stateFile}.\nRun:  npm run sb -- login\n` +
      `(Keychain password, headless; --manual to log in by hand in a window).\n` +
      `Or attach to an already-signed-in Chrome started with --remote-debugging-port=9222:\n` +
      `  npm run sb -- <cmd> --cdp http://127.0.0.1:9222`
    );
  }
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const ctx = await browser.newContext({
    storageState: stateFile,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  return { browser, ctx, page, close: async () => { await ctx.close(); await browser.close(); } };
}

/** Keychain item the unattended login reads. The account owner stores it once,
 *  by hand, so the password never passes through a transcript or this repo:
 *    security add-generic-password -s cloud.smartbill.ro -a you@example.com -w
 *  The account (email) is read back from the item itself, so nothing personal
 *  is hardcoded here; SMARTBILL_ACCOUNT picks one when several are stored. */
export const KEYCHAIN_SERVICE = 'cloud.smartbill.ro';

function keychainCredentials(): { user: string; pass: string } | undefined {
  const acct = process.env.SMARTBILL_ACCOUNT;
  const args = ['find-generic-password', '-s', KEYCHAIN_SERVICE, ...(acct ? ['-a', acct] : [])];
  const run = (extra: string[]) => execFileSync('security', [...args, ...extra],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const user = acct ?? run([]).match(/"acct"<blob>="([^"]*)"/)?.[1];
    const pass = run(['-w']).trim();
    return user && pass ? { user, pass } : undefined;
  } catch { return undefined; }
}

/** Unattended login with the Keychain credentials; headless, so it works while
 *  the account owner is away. Throws with the page text when the form does not
 *  let us through (wrong password, captcha, a 2FA step not handled yet), so the
 *  next step gets written from what the site actually asked. */
export async function autoLogin(opts: { headless?: boolean } = {}): Promise<void> {
  const cred = keychainCredentials();
  if (!cred) throw new Error(`no Keychain item "${KEYCHAIN_SERVICE}" - run:\n` +
    `  security add-generic-password -s ${KEYCHAIN_SERVICE} -a <email> -w\nor log in by hand: npm run sb -- login --manual`);
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/auth/login/`, { waitUntil: 'domcontentloaded' });
    // A fresh context has no OneTrust consent cookie, and its overlay would
    // intercept every click of every later run that reuses this session.
    const consent = page.locator('#onetrust-accept-btn-handler');
    await consent.click({ timeout: 10_000 }).catch(() => {});
    await page.fill('#id_username', cred.user);
    await page.fill('#id_password', cred.pass);
    await page.click('#cloud_login_btn');
    await page.waitForURL(u => !u.pathname.startsWith('/auth/'), { timeout: 30_000 }).catch(() => {});
    if (new URL(page.url()).pathname.startsWith('/auth/')) {
      const text = (await page.innerText('body')).slice(0, 600);
      throw new Error(`still on ${page.url()} after the password:\n${text}`);
    }
    await page.waitForSelector('a[href="/"]', { timeout: 30_000 });
    await ctx.storageState({ path: STATE });
    console.log(`Logged in as ${cred.user}; session saved to ${STATE}`);
  } finally { await browser.close(); }
}

/** Interactive login; persists cookies so every later run is headless. Nothing
 *  is typed by us, so no credential passes through here. */
export async function login(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  console.log('Log into SmartBill in the browser window. Waiting for the dashboard...');
  await page.waitForURL(u => !u.pathname.startsWith('/auth/'), { timeout: 5 * 60_000 });
  await page.waitForSelector('a[href="/"]', { timeout: 30_000 });
  await ctx.storageState({ path: STATE });
  console.log(`Session saved to ${STATE}`);
  await browser.close();
}
