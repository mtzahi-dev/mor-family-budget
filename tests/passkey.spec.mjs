// Fingerprint / face sign-in through a passkey, with Chromium's virtual authenticator.
import { seed } from '../dev/demo.mjs';
import { expect, test } from './fixtures.mjs';

async function fingerprint(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true
  } });
  return cdp;
}

test('turn on fingerprint sign-in, close the app, and come back with it', async ({ openApp }) => {
  const app = await openApp(seed(), { signedIn: false });
  await fingerprint(app.page);
  await app.page.reload();
  await app.page.waitForSelector('[data-auth-form]');
  await expect(app.page.locator('[data-act="bio-login"]')).toHaveCount(0);   // nothing registered yet

  await app.signIn({ email: 'owner@example.test', password: 'owner-password-1' });
  await app.synced();
  await expect(app.page.locator('#sheet')).toContainText('כניסה מהירה');   // offered after a password sign-in
  await app.page.click('#sheet [data-yes]');
  await expect(app.page.locator('#toast')).toHaveText('הכניסה הביומטרית הופעלה במכשיר הזה');
  expect(app.dump()['family/members'].members[0].passkeys).toHaveLength(1);

  // the token now lives only for this session of the app
  const where = await app.page.evaluate(() => [!!sessionStorage.getItem('mor-budget-token'), !!localStorage.getItem('mor-budget-token')]);
  expect(where).toEqual([true, false]);

  // "close" the app: a new session has no token, so it asks again
  await app.page.evaluate(() => sessionStorage.removeItem('mor-budget-token'));
  await app.page.reload();
  await app.page.click('[data-act="bio-login"]');
  await app.synced();
  expect(await app.gap).toBe('+₪5,000');
});

test('turning it off removes the passkey from the server', async ({ openApp }) => {
  const app = await openApp(seed());
  await fingerprint(app.page);
  await app.page.reload();
  await app.synced();
  await app.tab('settings');
  await app.page.click('[data-act="bio-on"]');
  await expect(app.page.locator('[data-act="bio-off"]')).toBeVisible();
  await app.page.click('[data-act="bio-off"]');
  await expect(app.page.locator('[data-act="bio-on"]')).toBeVisible();
  expect(app.dump()['family/members'].members[0].passkeys).toEqual([]);
  expect(await app.page.evaluate(() => !!localStorage.getItem('mor-budget-token'))).toBe(true);
});

test('a passkey the server no longer knows falls back to the password', async ({ openApp }) => {
  const app = await openApp(seed());
  await fingerprint(app.page);
  await app.page.reload();
  await app.synced();
  await app.tab('settings');
  await app.page.click('[data-act="bio-on"]');
  await expect(app.page.locator('[data-act="bio-off"]')).toBeVisible();
  app.server.kv.map.get('family/members').data.members[0].passkeys = [];   // e.g. removed on another device

  await app.page.evaluate(() => sessionStorage.removeItem('mor-budget-token'));   // close the app
  await app.page.reload();
  await app.page.click('[data-act="bio-login"]');
  await expect(app.page.locator('#toast')).toContainText('טביעת האצבע הזו לא רשומה');
  await expect(app.page.locator('[data-act="bio-login"]')).toHaveCount(0);
});

test('a captured fingerprint sign-in cannot be used again', async ({ openApp }) => {
  const app = await openApp(seed());
  await fingerprint(app.page);
  await app.page.reload();
  await app.synced();
  await app.tab('settings');
  await app.page.click('[data-act="bio-on"]');
  await expect(app.page.locator('[data-act="bio-off"]')).toBeVisible();

  await app.page.evaluate(() => sessionStorage.removeItem('mor-budget-token'));   // close the app
  await app.page.reload();
  const sent = app.page.waitForRequest('**/api/passkey/login');
  await app.page.click('[data-act="bio-login"]');
  const captured = (await sent).postData();
  await app.synced();
  // synced passkeys (iCloud, Google) report counter 0, which turns off the counter check: only the one-time challenge stops a replay
  app.server.kv.map.get('family/members').data.members[0].passkeys[0].counter = 0;
  const replay = await fetch(app.server.url + '/api/passkey/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: captured });
  expect(replay.status).toBe(400);
});

test('signing out removes this device from fingerprint sign-in', async ({ openApp }) => {
  const app = await openApp(seed());
  await fingerprint(app.page);
  await app.page.reload();
  await app.synced();
  await app.tab('settings');
  await app.page.click('[data-act="bio-on"]');
  await expect(app.page.locator('.mem-mail', { hasText: 'המכשיר הזה' })).toBeVisible();
  await app.page.click('[data-act="logout"]');
  await app.page.waitForSelector('[data-auth-form]');
  await expect(app.page.locator('[data-act="bio-login"]')).toHaveCount(0);
  expect(app.dump()['family/members'].members[0].passkeys).toEqual([]);
});
