// The status notification: what it says, and when it goes out.
import core from '../public/core.js';
import { PLAN, TZ, cardLog, local, seed } from '../dev/demo.mjs';
import { OWNER, PARTNER, expect, login, serve, test } from './fixtures.mjs';

function message(months, now, cycleDay = 1) {
  const docs = seed({ cycleDay, months });
  const m = {};
  for (const [k, v] of Object.entries(docs)) if (k.startsWith('months/')) m[k.slice(7)] = v;
  return core.statusMessage(docs['budget/plan'], m, local(now), TZ);
}

test('room left under the credit ceiling', () => {
  const msg = message({ '2026-10': { cards: { cc_a: cardLog(['2026-10-06 10:00', 3000]), cc_b: cardLog(['2026-10-06 10:00', 1234]) } } }, '2026-10-07 19:00');
  expect(msg.title).toBe('התקציב של אוקטובר');
  expect(msg.body).toBe('נותרו כ-8,770 ש״ח עד תקרת האשראי.\nצפי לסוף אוקטובר: עודף של כ-5,000 ש״ח.');
});

test('over the credit ceiling', () => {
  const msg = message({ '2026-10': { cards: { cc_a: cardLog(['2026-10-20 10:00', 9000]), cc_b: cardLog(['2026-10-20 10:00', 5600]) } } }, '2026-10-21 19:00');
  expect(msg.body.split('\n')[0]).toBe('אתם כרגע בחריגת אשראי של כ-1,600 ש״ח החודש.');
  expect(msg.body.split('\n')[1]).toBe('צפי לסוף אוקטובר: עודף של כ-3,400 ש״ח.');
});

test('one card over while the total is still under', () => {
  const msg = message({ '2026-10': { cards: { cc_a: cardLog(['2026-10-20 10:00', 2000]), cc_b: cardLog(['2026-10-20 10:00', 5500]) } } }, '2026-10-21 19:00');
  expect(msg.body.split('\n')[0]).toBe('נותרו כ-5,500 ש״ח עד תקרת האשראי. אשראי ב כבר חרג בכ-500 ש״ח.');
});

test('a reminder when the cards were not updated for a few days', () => {
  const msg = message({ '2026-10': { cards: { cc_a: cardLog(['2026-10-03 22:00', 2000]) } } }, '2026-10-07 19:00');
  expect(msg.body.split('\n')[2]).toBe('לא עודכנו נתוני אשראי כבר 4 ימים. נא לעדכן.');
});

test('no update at all in the cycle yet', () => {
  const msg = message({}, '2026-10-05 19:00');
  expect(msg.body).toBe('עוד לא עודכנו נתוני אשראי במחזור הזה. נא לעדכן.\nצפי לסוף אוקטובר: עודף של כ-5,000 ש״ח.');
});

test('the message follows the credit cycle', () => {
  const msg = message({ '2026-11': { cards: { cc_a: cardLog(['2026-10-14 10:00', 500]) } } }, '2026-10-15 19:00', 13);
  expect(msg.title).toBe('התקציב של נובמבר');
});

// ---- the schedule ----
async function subscribed(server, who, endpoint) {
  const token = await login(server, who);
  const r = await fetch(server.url + '/api/push/subscribe', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } }) });
  expect(r.status).toBe(200);
  return token;
}

test('it goes out at 19:00 Israel time, every third day, to every device', async () => {
  let now = local('2026-10-07 18:00');
  const server = await serve(seed({ months: { '2026-10': { cards: { cc_a: cardLog(['2026-10-06 10:00', 1000]) } } } }), { partner: true, now: () => now });
  await subscribed(server, OWNER, 'https://push.example.test/a');
  await subscribed(server, PARTNER, 'https://push.example.test/b');
  await subscribed(server, PARTNER, 'https://push.example.test/gone/c');

  expect((await server.api.notify()).reason).toBe('not_hour');
  now = local('2026-10-07 19:00');
  const first = await server.api.notify();
  expect(first.sent).toBe(2);
  expect(first.removed).toBe(1);   // the push service said that device is gone
  expect(server.push.sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example.test/a', 'https://push.example.test/b']);
  expect(server.push.sent[0].payload.title).toBe('התקציב של אוקטובר');

  now = local('2026-10-09 19:00');
  expect((await server.api.notify()).reason).toBe('not_due');
  now = local('2026-10-10 19:00');
  expect((await server.api.notify()).sent).toBe(2);
  await server.close();
});

test('the test button reaches only your own devices and keeps the schedule', async () => {
  const server = await serve(seed(), { partner: true, now: () => local('2026-10-07 11:00') });
  const token = await subscribed(server, OWNER, 'https://push.example.test/mine');
  await subscribed(server, PARTNER, 'https://push.example.test/theirs');
  const r = await fetch(server.url + '/api/push/test', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
  expect((await r.json()).sent).toBe(1);
  expect(server.push.sent.map((s) => s.endpoint)).toEqual(['https://push.example.test/mine']);
  expect(server.kv.dump()['notify/state']).toBeUndefined();
  await server.close();
});

test('without a plan nothing is sent', async () => {
  const server = await serve({}, { now: () => local('2026-10-07 19:00') });
  await subscribed(server, OWNER, 'https://push.example.test/a');
  expect((await server.api.notify()).reason).toBe('no_plan');
  expect(server.push.sent).toEqual([]);
  await server.close();
});

test('the settings tab previews the message', async ({ openApp }) => {
  const app = await openApp(seed({ versions: { '2026-10': PLAN } }));
  await app.tab('settings');
  await expect(app.page.locator('.notice')).toContainText('צפי לסוף אוקטובר: עודף של כ-5,000 ש״ח.');
});
