// The plan editor: versions by month, validation, unsaved edits.
import { PLAN, seed } from '../dev/demo.mjs';
import { expect, test } from './fixtures.mjs';

const FIRST_FIXED_AMOUNT = '[data-g="fixed"][data-f="amount"] >> nth=0';

test('a plan change applies from this month on', async ({ openApp }) => {
  const app = await openApp(seed({ versions: { '2026-08': PLAN } }), { now: '2026-10-07 12:00' });
  await app.tab('plan');
  await app.page.fill(FIRST_FIXED_AMOUNT, '6500');
  await app.page.click('[data-act="plan-save"]');
  await app.settle(); await app.synced();

  const versions = app.dump()['budget/plan'].versions;
  expect(Object.keys(versions).sort()).toEqual(['2026-08', '2026-10']);
  expect(versions['2026-10'].fixed[0]).toEqual({ id: 'fx_home', name: 'משכנתא', amount: 6500 });
  expect(versions['2026-08'].fixed[0].amount).toBe(6000);

  await app.tab('month');
  expect(await app.gap).toBe('+₪4,500');
  await app.go('prev');   // September keeps the old plan
  expect(await app.gap).toBe('+₪5,000');
});

test('the plan saves the reset day', async ({ openApp }) => {
  const app = await openApp(seed({ cycleDay: 1 }));
  await app.tab('plan');
  await app.page.fill('[data-cycle]', '13');
  await app.page.click('[data-act="plan-save"]');
  await app.settle(); await app.synced();
  expect(app.dump()['budget/plan'].cycleDay).toBe(13);
});

test('the plan refuses a row without a name', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.tab('plan');
  await app.page.click('[data-act="plan-add"][data-g="fixed"]');
  await app.page.fill('[data-g="fixed"][data-f="amount"] >> nth=-1', '300');
  await app.page.click('[data-act="plan-save"]');
  await app.settle(60);
  expect(await app.toast).toBe('חסר שם בשורה של הוצאות קבועות');
  expect(await app.page.getAttribute('[data-g="fixed"][data-f="name"] >> nth=-1', 'aria-invalid')).toBe('true');
  expect(app.writes()).toEqual([]);
});

test('the plan refuses a bad reset day', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.tab('plan');
  await app.page.fill('[data-cycle]', '40');
  await app.page.click('[data-act="plan-save"]');
  await app.settle(60);
  expect(await app.toast).toBe('יום האיפוס צריך להיות מספר בין 1 ל-28');
  expect(app.writes()).toEqual([]);
});

test('unsaved plan edits survive a tab switch', async ({ openApp }) => {
  const app = await openApp(seed());
  await app.tab('plan');
  await app.page.fill('[data-g="income"][data-f="amount"] >> nth=0', '11000');
  await app.tab('month');
  await expect(app.page.locator('.tab[data-tab="plan"] .dot')).toHaveCount(1);
  await app.tab('plan');
  expect(await app.page.inputValue('[data-g="income"][data-f="amount"] >> nth=0')).toBe('11000');
});

test('an empty store offers setup', async ({ openApp }) => {
  const app = await openApp({});
  expect(await app.text('#app')).toContain('עוד לא הוגדר תכנון');
  await app.page.click('#app [data-act="tab"][data-tab="plan"]');
  await expect(app.page.locator('[data-plan-form]')).toHaveCount(1);
});
