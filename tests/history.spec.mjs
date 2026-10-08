// Closed months, future months and the history list.
import { PLAN, cardLog, seed } from '../dev/demo.mjs';
import { expect, test } from './fixtures.mjs';

test('a closed month uses the last value, and the budget for cards never updated', async ({ openApp }) => {
  const app = await openApp(seed({ versions: { '2026-09': PLAN }, months: { '2026-09': { cards: {
    cc_a: cardLog(['2026-09-20 10:00', 6000], ['2026-09-29 10:00', 9000])
  } } } }), { now: '2026-10-07 12:00' });
  await app.go('prev');
  expect(await app.heroLabel).toBe('סיכום ספטמבר');
  expect(await app.gap).toBe('+₪4,000');   // 25,500 − 7,500 − (9,000 + 5,000 counted at budget)
  expect(await app.heroSub).toContain('אין עדכון לאשראי ב');
});

test('a future month shows the plan only', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.go('next');
  expect(await app.heroLabel).toBe('תכנון לנובמבר');
  expect(await app.gap).toBe('+₪5,000');
  await expect(app.page.locator('[data-act="card"]')).toHaveCount(0);
});

test('history lists the months and averages the closed ones', async ({ openApp }) => {
  const app = await openApp(seed({ versions: { '2026-08': PLAN }, months: {
    '2026-08': { cards: { cc_a: cardLog(['2026-08-30 10:00', 9000]), cc_b: cardLog(['2026-08-30 10:00', 5500]) } },
    '2026-09': { cards: { cc_a: cardLog(['2026-09-29 10:00', 7000]), cc_b: cardLog(['2026-09-29 10:00', 4000]) } }
  } }), { now: '2026-10-07 12:00' });
  await app.tab('history');
  const months = await app.page.locator('.h-month').allInnerTexts();
  expect(months.map((m) => m.split('\n')[0].trim())).toEqual(['אוקטובר 2026', 'ספטמבר 2026', 'אוגוסט 2026']);
  const summary = await app.text('.summary');
  expect(summary).toContain('ב-2 החודשים שנסגרו');
  expect(summary).toContain('פער ממוצע +₪5,250');   // August +3,500, September +7,000
  expect(summary).toContain('ב-1 מהם');   // only August went over the card budget

  await app.page.click('[data-act="goto"][data-k="2026-08"]');
  await app.settle(60);
  expect(await app.heroLabel).toBe('סיכום אוגוסט');
  expect(await app.gap).toBe('+₪3,500');
});
