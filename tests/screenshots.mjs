// Renders the main screens to tests/__screenshots__/ for a visual check:  npm run screenshots
// Uses the fictional demo data. Fonts load from Google Fonts when the network allows it.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEMO_DOCS, local } from '../dev/demo.mjs';
import { OWNER, login, serve } from './fixtures.mjs';

const OUT = fileURLToPath(new URL('./__screenshots__/', import.meta.url));

async function shoot(browser, server, name, prepare, { width = 390, height = 844, dark = false, signedIn = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2,
    colorScheme: dark ? 'dark' : 'light', locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.clock.setFixedTime(local('2026-10-07 12:30'));
  if (signedIn) {
    const token = await login(server, OWNER);
    await page.addInitScript((t) => localStorage.setItem('mor-budget-token', t), token);
  }
  await page.goto(server.url);
  await page.waitForSelector(signedIn ? '#sync[data-s="live"]' : '[data-auth-form]');
  await page.waitForTimeout(600);   // web fonts
  if (prepare) await prepare(page);
  await page.screenshot({ path: OUT + name + '.png', fullPage: true });
  await context.close();
  if (errors.length) throw new Error(name + ': page errors ' + errors.join('; '));
  console.log('wrote', OUT + name + '.png');
}

const tab = (name) => async (page) => { await page.click(`.tab[data-tab="${name}"]`); await page.waitForTimeout(400); };

await mkdir(OUT, { recursive: true });
const server = await serve(DEMO_DOCS, { partner: true });
const browser = await chromium.launch();
await shoot(browser, server, 'sign-in', null, { signedIn: false });
await shoot(browser, server, 'month-light');
await shoot(browser, server, 'month-dark', null, { dark: true });
await shoot(browser, server, 'month-360', null, { width: 360, height: 760 });
await shoot(browser, server, 'card-sheet', async (page) => {
  await page.click('[data-act="card"][data-id="cc_a"]');
  await page.fill('#sheet [data-amt]', '7300');
  await page.waitForTimeout(250);
});
await shoot(browser, server, 'history', tab('history'));
await shoot(browser, server, 'plan', tab('plan'));
await shoot(browser, server, 'settings', async (page) => {
  await tab('settings')(page);
  await page.fill('[data-add-member] [name="email"]', 'grandma@example.test');
  await page.click('[data-add-member] [type="submit"]');
  await page.waitForTimeout(300);
});
await shoot(browser, server, 'settings-dark', tab('settings'), { dark: true });
await browser.close();
await server.close();
