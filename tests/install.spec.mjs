// The "save Mor to your phone" card: phones in the browser only, gone once the app runs from its icon.
import { devices } from '@playwright/test';
import { seed } from '../dev/demo.mjs';
import { OWNER, expect, login, serve, test } from './fixtures.mjs';

const ANDROID = (({ userAgent, viewport, deviceScaleFactor, isMobile, hasTouch }) => ({ userAgent, viewport, deviceScaleFactor, isMobile, hasTouch }))(devices['Pixel 7']);
const IPHONE = (({ userAgent, viewport, deviceScaleFactor, isMobile, hasTouch }) => ({ userAgent, viewport, deviceScaleFactor, isMobile, hasTouch }))(devices['iPhone 13']);

async function phone(browser, server, device, { standalone = false, signedIn = true } = {}) {
  const context = await browser.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await context.route(/^https:\/\/fonts\./, (r) => r.abort());
  if (standalone) {
    await context.addInitScript(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q.includes('display-mode: standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
    });
  }
  if (signedIn) {
    const token = await login(server, OWNER);
    await context.addInitScript((t) => localStorage.setItem('mor-budget-token', t), token);
  }
  const page = await context.newPage();
  await page.goto(server.url);
  await page.waitForSelector(signedIn ? '#sync[data-s="live"]' : '[data-auth-form]');
  return { context, page };
}

test('android in the browser: the card offers to install, and stays away once installed', async ({ browser }) => {
  const server = await serve(seed());
  const { context, page } = await phone(browser, server, ANDROID);
  const card = page.locator('#install');
  await expect(card).toBeVisible();
  await expect(card).toContainText('שמירת Mor בטלפון');
  await expect(card).toContainText('הוספה למסך הבית');   // before Chrome offers its own install

  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await page.click('#install [data-act="install"]');
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => window.__prompted)).toBe(true);
  await page.reload();
  await page.waitForSelector('#sync[data-s="live"]');
  await expect(card).toBeHidden();
  await context.close(); await server.close();
});

test('iphone in safari: the card explains the share button, and can be put away', async ({ browser }) => {
  const server = await serve(seed());
  const { context, page } = await phone(browser, server, IPHONE, { signedIn: false });
  const card = page.locator('#install');
  await expect(card).toContainText('(שיתוף) ובוחרים "הוספה למסך הבית"');   // already on the sign-in screen
  await page.click('#install [data-act="install-hide"]');
  await expect(card).toBeHidden();
  await page.reload();
  await expect(card).toBeHidden();
  await context.close(); await server.close();
});

test('opened from the home-screen icon there is no card', async ({ browser }) => {
  const server = await serve(seed());
  for (const device of [ANDROID, IPHONE]) {
    const { context, page } = await phone(browser, server, device, { standalone: true });
    await expect(page.locator('#install')).toBeHidden();
    await context.close();
  }
  await server.close();
});

test('a computer gets no card', async ({ openApp }) => {
  const app = await openApp(seed());
  await expect(app.page.locator('#install')).toBeHidden();
});
