// A fictional plan and seed builders, for tests, screenshots and local runs.
// Every amount here is made up. Never copy the family's real numbers into the repo.
import core from '../public/core.js';

export const TZ = 'Asia/Jerusalem';

// income 25,500 − fixed 7,500 − card budgets 13,000 = planned gap +5,000
export const PLAN = {
  income: [
    { id: 'in_a', name: 'משכורת א', amount: 10000 },
    { id: 'in_b', name: 'משכורת ב', amount: 15000 },
    { id: 'in_kids', name: 'קצבת ילדים', amount: 500 }
  ],
  fixed: [
    { id: 'fx_home', name: 'משכנתא', amount: 6000 },
    { id: 'fx_tax', name: 'ארנונה', amount: 1000 },
    { id: 'fx_kids', name: 'חוגים', amount: 500 }
  ],
  cards: [
    { id: 'cc_a', name: 'אשראי א', budget: 8000 },
    { id: 'cc_b', name: 'אשראי ב', budget: 5000 }
  ]
};

// '2026-10-07 12:30' on the family's clock -> the real instant (a Date)
export function local(when) {
  const [d, t = '00:00'] = when.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  for (const off of [3, 2]) {
    const cand = new Date(Date.UTC(y, mo - 1, da, h - off, mi));
    const w = core.wall(cand, TZ);
    if (w.getFullYear() === y && w.getMonth() === mo - 1 && w.getDate() === da && w.getHours() === h && w.getMinutes() === mi) return cand;
  }
  throw new Error('no such local time: ' + when);
}

// cardLog(['2026-10-03 09:00', 1500], ...) -> { log: [...] } with UTC ISO times
export function cardLog(...entries) {
  return { log: entries.map(([when, a]) => ({ t: local(when).toISOString(), a })) };
}

// Documents for the store: the plan plus any month docs ({ '2026-10': {...} })
export function seed({ versions, cycleDay = 1, months = {} } = {}) {
  const docs = { 'budget/plan': { cycleDay, updatedAt: '2026-01-01T00:00:00Z', versions: versions || { '2026-10': PLAN } } };
  for (const [key, body] of Object.entries(months)) docs['months/' + key] = { month: key, ...body };
  return docs;
}

export const DEMO_DOCS = seed({
  versions: { '2026-08': PLAN }, cycleDay: 13, months: {
    '2026-08': { cards: { cc_a: cardLog(['2026-08-11 20:00', 8700]), cc_b: cardLog(['2026-08-12 09:00', 5600]) } },
    '2026-09': { cards: { cc_a: cardLog(['2026-09-12 21:00', 7400]), cc_b: cardLog(['2026-09-12 21:00', 4100]) },
      extras: [{ id: 'ex_1', name: 'החזר הוצאות', amount: 650 }] },
    '2026-10': { cards: { cc_a: cardLog(['2026-10-02 08:30', 5200], ['2026-10-07 09:45', 6900]), cc_b: cardLog(['2026-10-05 17:20', 2300]) } }
  }
});
