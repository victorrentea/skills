import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync } from 'node:fs';
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
      `and log into SmartBill in the window that opens.\n` +
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

/** One-time interactive login; persists cookies so every later run is headless. */
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
