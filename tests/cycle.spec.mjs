// Card charges reset on cycleDay: spending from that day on belongs to the next month.
import { cardLog, seed } from '../dev/demo.mjs';
import { expect, test } from './fixtures.mjs';

test('the day before the reset is the last day of the cycle', async ({ openApp }) => {
  const app = await openApp(seed({ cycleDay: 13 }), { now: '2026-10-12 21:00' });
  expect(await app.month()).toBe('אוקטובר 2026');
  expect(await app.text('.hero-month')).toContain('חיובי אשראי 13.9–12.10');
  expect(await app.text('.sec-note')).toContain('יום 30 מתוך 30');
});

test('the reset day moves to the next month', async ({ openApp }) => {
  const app = await openApp(seed({ cycleDay: 13 }), { now: '2026-10-13 07:00' });
  expect(await app.month()).toBe('נובמבר 2026');
  expect(await app.text('.hero-month')).toContain('חיובי אשראי 13.10–12.11');
  expect(await app.text('.sec-note')).toContain('יום 1 מתוך 31');
  await app.go('prev');
  expect(await app.heroLabel).toBe('סיכום אוקטובר');
});

test('spending after the reset is saved to the next month', async ({ openApp }) => {
  const docs = seed({ cycleDay: 13, months: { '2026-10': { cards: { cc_b: cardLog(['2026-10-11 10:00', 4800]) } } } });
  const app = await openApp(docs, { now: '2026-10-20 10:00' });
  await app.updateCard('cc_b', 1200);
  expect(app.cardLog('2026-11', 'cc_b')).toEqual([1200]);
  expect(app.cardLog('2026-10', 'cc_b')).toEqual([4800]);
});

test('cycle day 1 is the calendar month', async ({ openApp }) => {
  const app = await openApp(seed({ cycleDay: 1 }), { now: '2026-10-07 12:00' });
  expect(await app.text('.hero-month')).not.toContain('חיובי אשראי');
  expect(await app.text('.sec-note')).toContain('יום 7 מתוך 31');
});
