// Signing in, joining with a code, family members, and what happens without a connection.
import { seed } from '../dev/demo.mjs';
import { OWNER, PARTNER, expect, login, serve, test } from './fixtures.mjs';

test('signed out shows only the sign-in form', async ({ openApp }) => {
  const app = await openApp(seed(), { signedIn: false });
  await expect(app.page.locator('.tabbar')).toBeHidden();
  expect(await app.text('#app')).not.toContain('₪');
  await app.signIn({ email: OWNER.email, password: 'wrong-password' });
  await expect(app.page.locator('[data-auth-form] [data-err]')).toHaveText('האימייל או הסיסמה לא נכונים.');
  await app.signIn(OWNER);
  await app.synced();
  expect(await app.gap).toBe('+₪5,000');
  await expect(app.page.locator('.tabbar')).toBeVisible();
});

test('the owner adds a family member, who joins with the code', async ({ openApp }) => {
  const owner = await openApp(seed());
  await owner.tab('settings');
  await owner.page.fill('[data-add-member] [name="email"]', ' Partner@Example.test ');
  await owner.page.click('[data-add-member] [type="submit"]');
  const code = (await owner.text('.code-box .code')).replace(/\s/g, '');
  expect(code).toMatch(/^\d{6}$/);
  expect(await owner.text('.mem:has-text("partner@example.test") .mem-meta')).toBe('ממתין להצטרפות');

  const partner = await openApp(null, { server: owner.server, signedIn: false });
  await partner.page.click('[data-act="auth-view"][data-view="join"]');
  const f = '[data-auth-form][data-kind="join"] ';
  await partner.page.fill(f + '[name="email"]', PARTNER.email);
  await partner.page.fill(f + '[name="code"]', code === '000000' ? '111111' : '000000');
  await partner.page.fill(f + '[name="password"]', PARTNER.password);
  await partner.page.click(f + '[type="submit"]');
  await expect(partner.page.locator(f + '[data-err]')).toContainText('הקוד לא נכון');
  await partner.page.fill(f + '[name="code"]', code);
  await partner.page.click(f + '[type="submit"]');
  await partner.synced();
  expect(await partner.gap).toBe('+₪5,000');
  await partner.updateCard('cc_a', 1000);
  expect(partner.cardLog('2026-10', 'cc_a')).toEqual([1000]);

  // the code works once
  const again = await fetch(owner.server.url + '/api/join', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: PARTNER.email, code, password: 'another-password' }) });
  expect(again.status).toBe(401);
});

test('a family member sees no family list and cannot manage it', async ({ openApp }) => {
  const app = await openApp(seed(), { partner: true, as: PARTNER });
  await app.tab('settings');
  await expect(app.page.locator('#h-fam')).toHaveCount(0);
  const token = await login(app.server, PARTNER);
  const r = await fetch(app.server.url + '/api/members', { headers: { authorization: 'Bearer ' + token } });
  expect(r.status).toBe(403);
});

test('the owner removes a member, whose session stops working', async ({ openApp }) => {
  const owner = await openApp(seed(), { partner: true });
  const partner = await openApp(null, { server: owner.server, as: PARTNER });
  await owner.tab('settings');
  const remove = owner.page.locator('.mem:has-text("partner@example.test") [data-act="mem-remove"]');
  await remove.click();
  await remove.click();
  await expect(owner.page.locator('.mem')).toHaveCount(1);

  await partner.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await partner.page.waitForSelector('[data-auth-form]');
  expect(await partner.toast).toBe('צריך להיכנס שוב.');
});

test('sign out returns to the sign-in form and leaves no data on the device', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.tab('settings');
  await app.page.click('[data-act="logout"]');
  await app.page.waitForSelector('[data-auth-form]');
  const stored = await app.page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => k.startsWith('mor-budget')));
  expect(stored).toEqual([]);
  await app.page.reload();
  await app.page.waitForSelector('[data-auth-form]');
});

test('changing the password signs other devices out', async ({ openApp }) => {
  const app = await openApp(seed());
  const old = await login(app.server, OWNER);
  await app.tab('settings');
  await app.page.click('[data-act="password"]');
  await app.page.fill('#sheet [name="current"]', OWNER.password);
  await app.page.fill('#sheet [name="next"]', 'a-brand-new-password');
  await app.page.click('#sheet [type="submit"]');
  await expect(app.page.locator('#toast')).toHaveText('הסיסמה עודכנה');
  const r = await fetch(app.server.url + '/api/data', { headers: { authorization: 'Bearer ' + old } });
  expect(r.status).toBe(401);
  await app.tab('month');
  await app.updateCard('cc_a', 700);   // this device keeps working
  expect(app.cardLog('2026-10', 'cc_a')).toEqual([700]);
});

test('five wrong passwords lock the account for a while', async () => {
  const server = await serve(seed());
  const tryLogin = (password) => fetch(server.url + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER.email, password }) });
  for (let i = 0; i < 5; i++) expect((await tryLogin('nope-' + i)).status).toBe(401);
  const locked = await tryLogin(OWNER.password);
  expect(locked.status).toBe(429);
  await server.close();
});

test('a failed save keeps the sheet open', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.page.route('**/api/doc', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server"}' }));
  await app.page.click('[data-act="card"][data-id="cc_a"]');
  await app.page.fill('#sheet [data-amt]', '1000');
  await app.page.click('#sheet [data-save]');
  await expect(app.page.locator('#toast')).toHaveText('השמירה לא הצליחה. נסו שוב בעוד רגע.', { timeout: 4000 });
  await expect(app.page.locator('#sheet[open]')).toHaveCount(1);
  expect(app.cardLog('2026-10', 'cc_a')).toEqual([]);
});

test('without a connection the last copy shows, read only', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.page.route('**/api/**', (r) => r.abort());
  await app.page.reload();
  await expect(app.page.locator('.banner')).toContainText('אין חיבור לשרת');
  expect(await app.gap).toBe('+₪5,000');
  await expect(app.page.locator('[data-act="card"]')).toHaveCount(0);
});

test('the api refuses requests without a valid session', async () => {
  const server = await serve(seed());
  for (const [method, path] of [['GET', 'data'], ['POST', 'doc'], ['GET', 'members'], ['POST', 'push/subscribe'], ['POST', 'push/test']]) {
    const r = await fetch(server.url + '/api/' + path, { method, headers: { authorization: 'Bearer forged.token' } });
    expect(r.status, path).toBe(401);
  }
  await server.close();
});
