// The current month: forecast, card updates, income changes.
import { cardLog, seed } from '../dev/demo.mjs';
import { expect, test } from './fixtures.mjs';

test('planned gap before any card update', async ({ openApp }) => {
  const app = await openApp(seed());
  expect(await app.month()).toBe('אוקטובר 2026');
  expect(await app.heroLabel).toBe('צפי לסוף אוקטובר');
  expect(await app.gap).toBe('+₪5,000');
  expect(await app.card('cc_a')).toContain('עוד לא עודכן החודש');
});

test('card running total and added charge', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.updateCard('cc_a', 3000);
  await app.updateCard('cc_a', 500, true);
  expect(app.cardLog('2026-10', 'cc_a')).toEqual([3000, 3500]);
  expect(app.writes().map((w) => w.op)).toEqual(['set', 'update']);   // month doc created once, then merged
  expect(await app.gap).toBe('+₪5,000');   // still within budget, so the forecast holds
  expect(await app.card('cc_a')).toContain('נותר ₪4,500');
});

test('overspending counts in full', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.updateCard('cc_b', 6200);
  expect(await app.gap).toBe('+₪3,800');
  expect(await app.heroSub).toContain('חריגה של ₪1,200');
  expect(await app.card('cc_b')).toContain('חריגה של ₪1,200');
});

test('pace warning when spending runs ahead', async ({ openApp }) => {
  // 7 of 31 days gone: an even pace would be about ₪1,806 of ₪8,000
  const app = await openApp(seed(), { now: '2026-10-07 12:00' });
  await app.updateCard('cc_a', 4000);
  expect(await app.card('cc_a')).toContain('מעל הקצב השווה');
  await app.updateCard('cc_a', 1500);
  expect(await app.card('cc_a')).not.toContain('מעל הקצב השווה');
});

test('income override, extra payment and reset', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.setIncome('in_b', 16000);
  expect(await app.gap).toBe('+₪6,000');
  expect(await app.text('[data-act="income"][data-id="in_b"]')).toContain('שונה החודש');

  await app.addExtra('בונוס', 2000);
  expect(await app.gap).toBe('+₪8,000');

  await app.page.click('[data-act="income"][data-id="in_b"]');
  await app.page.click('#sheet [data-reset]');
  await app.settle(); await app.synced();
  expect(await app.gap).toBe('+₪7,000');
  const month = app.dump()['months/2026-10'];
  expect(month.income.in_b).toBeNull();
  expect(month.extras.map((x) => [x.name, x.amount])).toEqual([['בונוס', 2000]]);
});

test('delete a wrong update', async ({ openApp }) => {
  const app = await openApp(seed({ months: { '2026-10': { cards: {
    cc_a: cardLog(['2026-10-02 09:00', 1500], ['2026-10-05 09:00', 15000])
  } } } }));
  await app.page.click('[data-act="card"][data-id="cc_a"]');
  const newest = app.page.locator('#sheet [data-del]').first();
  await newest.click();   // first tap asks
  await newest.click();   // second tap deletes
  await app.settle(); await app.synced();
  expect(app.cardLog('2026-10', 'cc_a')).toEqual([1500]);
  expect(await app.toast).toBe('העדכון נמחק');
});

test('an update from another family member shows up without reloading', async ({ openApp }) => {
  const app = await openApp(seed(), { partner: true });
  const other = await openApp(null, { server: app.server, as: { email: 'partner@example.test', password: 'partner-password-1' } });
  await other.updateCard('cc_b', 2000);
  await app.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // what returning to the app does
  await expect(app.page.locator('.cr', { has: app.page.locator('[data-id="cc_b"]') })).toContainText('₪2,000');
});
