// Test setup: each test gets its own server (in-process, in-memory store) and a browser page
// with a frozen clock. Every amount and address here is made up.
import { test as base, expect } from '@playwright/test';
import { member, startServer } from '../dev/server.mjs';
import { local } from '../dev/demo.mjs';
import { memoryKV } from '../lib/kv.mjs';

export { expect };
export const OWNER = { email: 'owner@example.test', password: 'owner-password-1' };
export const PARTNER = { email: 'partner@example.test', password: 'partner-password-1' };
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

export async function login(server, who) {
  const r = await fetch(server.url + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who)
  });
  return (await r.json()).token;
}

// A server with the plan docs, the owner and any extra members.
export async function serve(docs = {}, { partner = false, now } = {}) {
  const members = [await member(OWNER.email, OWNER.password, 'owner')];
  if (partner) members.push(await member(PARTNER.email, PARTNER.password, 'member'));
  return startServer({ kv: memoryKV({ ...docs, 'family/members': { members } }), now });
}

export class App {
  constructor(page, server, errors) { this.page = page; this.server = server; this.errors = errors; }

  text(selector) { return this.page.innerText(selector).then((t) => t.trim()); }
  get gap() { return this.text('.hero-num'); }
  get heroLabel() { return this.text('.hero-label'); }
  get heroSub() { return this.text('.hero-sub'); }
  get toast() { return this.text('#toast'); }
  async month() { return (await this.text('.hero-month')).split('\n')[0].trim(); }
  card(id) { return this.page.locator('.cr', { has: this.page.locator(`[data-id="${id}"]`) }).innerText(); }

  dump() { return this.server.kv.dump(); }
  writes() { return this.server.writes; }
  cardLog(month, id) {
    const doc = this.dump()['months/' + month] || {};
    return ((doc.cards || {})[id] || { log: [] }).log.map((e) => e.a);
  }

  settle(ms = 150) { return this.page.waitForTimeout(ms); }
  async synced() { await this.page.waitForSelector('#sync[data-s="live"]'); await this.settle(30); }
  async go(act) { await this.page.click(`[data-act="${act}"]`); await this.settle(60); }
  async tab(name) { await this.page.click(`.tab[data-tab="${name}"]`); await this.settle(80); }

  async updateCard(id, amount, add = false) {
    await this.page.click(`[data-act="card"][data-id="${id}"]`);
    if (add) await this.page.click('#sheet [data-mode="add"]');
    await this.page.fill('#sheet [data-amt]', String(amount));
    await this.page.click('#sheet [data-save]');
    await this.settle(); await this.synced();
  }
  async setIncome(id, amount) {
    await this.page.click(`[data-act="income"][data-id="${id}"]`);
    await this.page.fill('#sheet [data-amt]', String(amount));
    await this.page.click('#sheet [data-save]');
    await this.settle(); await this.synced();
  }
  async addExtra(name, amount) {
    await this.page.click('button[data-act="extra"]:not([data-id])');
    await this.page.fill('#sheet [data-name]', name);
    await this.page.fill('#sheet [data-amt]', String(amount));
    await this.page.click('#sheet [data-save]');
    await this.settle(); await this.synced();
  }
  async signIn(who) {
    await this.page.fill('[data-auth-form] [name="email"]', who.email);
    await this.page.fill('[data-auth-form] [name="password"]', who.password);
    await this.page.click('[data-auth-form] [type="submit"]');
  }
}

export const test = base.extend({
  // openApp(docs, { now, as, partner, signedIn, width, height, dark, scale, blockFonts }) -> App
  // Fails the test on any page error.
  openApp: async ({ browser }, use) => {
    const opened = [];
    const open = async (docs = {}, opts = {}) => {
      const { now = '2026-10-07 12:30', as = OWNER, partner = false, signedIn = true, server: given,
        width = 390, height = 844, dark = false, scale = 1, blockFonts = true } = opts;
      const server = given || await serve(docs, { partner });
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale,
        colorScheme: dark ? 'dark' : 'light', locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
      if (blockFonts) await context.route(FONT_HOSTS, (r) => r.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.clock.setFixedTime(local(now));
      if (signedIn) {
        const token = await login(server, as);
        await page.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mor-budget-token', t); sessionStorage.setItem('seeded', '1'); } }, token);
      }
      await page.goto(server.url);
      const app = new App(page, server, errors);
      if (signedIn) await app.synced(); else await page.waitForSelector('[data-auth-form]');
      opened.push({ context, server, app, own: !given });
      return app;
    };
    await use(open);
    for (const o of opened) await o.context.close();
    for (const o of opened) if (o.own) await o.server.close();
    expect(opened.flatMap((o) => o.app.errors), 'page errors').toEqual([]);
  }
});
