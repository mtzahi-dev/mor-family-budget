/* Budget math shared by the page (window.BudgetCore) and the server (require).
 *
 * Dates are wall-clock dates: `now` is a Date whose local fields read as the
 * family's clock. In the browser that is just new Date(). On the server, pass
 * wall(new Date(), 'Asia/Jerusalem').
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  var nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  /* ---------- small helpers ---------- */
  function keyOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function parts(k) { var p = k.split('-'); return { y: +p[0], m: +p[1] }; }
  function shift(k, n) { var p = parts(k); return keyOf(new Date(p.y, p.m - 1 + n, 1)); }
  function mName(k) { return HE_MONTHS[parts(k).m - 1]; }
  function mLabel(k) { return mName(k) + ' ' + parts(k).y; }
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dm(d) { return d.getDate() + '.' + (d.getMonth() + 1); }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += Number(a[i]) || 0; return s; }
  function arr(a) { return Array.isArray(a) ? a.filter(function (x) { return x && typeof x === 'object'; }) : []; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // A real instant -> a Date whose local fields show the wall clock in `tz`.
  // Without tz the date is returned as is (the browser already runs on the family's clock).
  function wall(d, tz) {
    if (!tz) return d;
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(d).forEach(function (x) { p[x.type] = +x.value; });
    return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }

  /* ---------- credit cycle ---------- */
  // Charges reset on day D. Budget month k carries the cycle that ends on day D-1
  // of k (it is charged in k): D of (k-1) through D-1 of k. D = 1 is the calendar month.
  function cycleDay(plan) {
    var d = plan ? Math.floor(Number(plan.cycleDay)) : NaN;
    return (d >= 2 && d <= 28) ? d : 1;
  }
  function cycleOf(plan, k) {
    var D = cycleDay(plan), p = parts(k), start, end;
    if (D === 1) { start = new Date(p.y, p.m - 1, 1); end = new Date(p.y, p.m, 0); }
    else { start = new Date(p.y, p.m - 2, D); end = new Date(p.y, p.m - 1, D - 1); }
    return { start: start, end: end, len: Math.round((end - start) / 864e5) + 1 };
  }
  function cycleText(plan, k) { var c = cycleOf(plan, k); return dm(c.start) + '–' + dm(c.end); }
  // the budget month whose credit cycle is running on `now`
  function curKey(plan, now) {
    var D = cycleDay(plan);
    return (D > 1 && now.getDate() >= D) ? shift(keyOf(now), 1) : keyOf(now);
  }

  /* ---------- plan versions ---------- */
  function versionKeys(plan) {
    var v = plan && plan.versions;
    if (!v || typeof v !== 'object') return [];
    return Object.keys(v).filter(function (k) { return v[k] && typeof v[k] === 'object'; }).sort();
  }
  function firstKey(plan, now) { var ks = versionKeys(plan); return ks.length ? ks[0] : curKey(plan, now); }
  function planFor(plan, k) {
    var ks = versionKeys(plan); if (!ks.length) return null;
    var from = ks[0];
    for (var i = 0; i < ks.length; i++) if (ks[i] <= k) from = ks[i];
    var p = plan.versions[from];
    return { from: from, income: arr(p.income), fixed: arr(p.fixed), cards: arr(p.cards) };
  }

  /* ---------- the month ---------- */
  function sortedLog(md, id) {
    var c = md && md.cards && md.cards[id];
    var log = c && Array.isArray(c.log) ? c.log.filter(function (e) { return e && isNum(e.a) && typeof e.t === 'string'; }) : [];
    return log.map(function (e) { return { t: e.t, a: e.a }; }).sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
  }
  function compute(plan, months, k, now) {
    var p = planFor(plan, k); if (!p) return null;
    var md = (months && months[k]) || {};
    var nk = curKey(plan, now);
    var phase = k < nk ? 'past' : (k > nk ? 'future' : 'current');
    var cyc = cycleOf(plan, k);
    var dim = cyc.len;
    var day = phase === 'current' ? Math.min(dim, Math.max(1, Math.round((day0(now) - cyc.start) / 864e5) + 1)) : (phase === 'past' ? dim : 0);
    var dayFrac = day / dim;
    var ov = (md.income && typeof md.income === 'object') ? md.income : {};

    var income = p.income.map(function (it) {
      var base = Number(it.amount) || 0, o = ov[it.id], has = isNum(o);
      return { id: it.id, name: it.name, base: base, value: has ? o : base, changed: has && o !== base };
    });
    var extras = arr(md.extras).filter(function (x) { return isNum(x.amount); });
    var incomeTotal = sum(income.map(function (i) { return i.value; })) + sum(extras.map(function (x) { return x.amount; }));
    var fixed = p.fixed.map(function (f) { return { id: f.id, name: f.name, amount: Number(f.amount) || 0 }; });
    var fixedTotal = sum(fixed.map(function (f) { return f.amount; }));

    var cards = p.cards.map(function (c) {
      var budget = Number(c.budget) || 0;
      var log = sortedLog(md, c.id);
      var last = log.length ? log[log.length - 1] : null;
      var actual = last ? last.a : null;
      var spent = actual == null ? 0 : actual;
      var counted = phase === 'past' ? (actual == null ? budget : actual) : Math.max(spent, budget);
      var expected = budget * dayFrac;
      var st = 'ok';
      if (actual == null) st = 'none';
      else if (spent > budget) st = 'over';
      else if (phase === 'current' && spent > expected + budget * 0.05) st = 'ahead';
      return { id: c.id, name: c.name, budget: budget, log: log, last: last, actual: actual, spent: spent,
               counted: counted, expected: expected, st: st,
               over: Math.max(0, spent - budget), remaining: Math.max(0, budget - spent) };
    });

    var creditSpent = sum(cards.map(function (c) { return c.spent; }));
    var creditBudget = sum(cards.map(function (c) { return c.budget; }));
    var creditCounted = sum(cards.map(function (c) { return c.counted; }));
    var expenses = fixedTotal + creditCounted;
    return {
      k: k, phase: phase, dim: dim, day: day, dayFrac: dayFrac, cyc: cyc,
      income: income, extras: extras, incomeTotal: incomeTotal,
      fixed: fixed, fixedTotal: fixedTotal, cards: cards,
      creditSpent: creditSpent, creditBudget: creditBudget, creditCounted: creditCounted,
      creditPlanned: Math.max(0, creditCounted - creditSpent),
      expenses: expenses, gap: incomeTotal - expenses,
      overTotal: sum(cards.map(function (c) { return c.over; })),
      unknown: cards.filter(function (c) { return c.actual == null; })
    };
  }

  /* ---------- the status notification ---------- */
  function about(n) { return 'כ-' + nf.format(Math.round(Math.abs(n) / 10) * 10) + ' ש״ח'; }
  function joinNames(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' ו' + list[list.length - 1];
  }
  // What the every-few-days notification says about the running month, or null without a plan.
  // `realNow` is a real instant; `tz` turns it and the update times into the family's clock.
  function statusMessage(plan, months, realNow, tz) {
    var now = wall(realNow, tz);
    var c = compute(plan, months, curKey(plan, now), now);
    if (!c) return null;
    var lines = [];

    var updated = c.cards.filter(function (x) { return x.last; });
    var last = updated.length ? updated.map(function (x) { return x.last.t; }).sort().pop() : null;
    var stale = 0;
    if (last) stale = Math.round((day0(now) - day0(wall(new Date(last), tz))) / 864e5);

    if (!updated.length) {
      if (c.day >= 3) lines.push('עוד לא עודכנו נתוני אשראי במחזור הזה. נא לעדכן.');
    } else if (c.creditSpent > c.creditBudget) {
      lines.push('אתם כרגע בחריגת אשראי של ' + about(c.creditSpent - c.creditBudget) + ' החודש.');
    } else {
      var line = 'נותרו ' + about(c.creditBudget - c.creditSpent) + ' עד תקרת האשראי.';
      var overs = c.cards.filter(function (x) { return x.over > 0; });
      if (overs.length) line += ' ' + joinNames(overs.map(function (x) { return x.name; })) + (overs.length > 1 ? ' כבר חרגו' : ' כבר חרג') + ' ב' + about(c.overTotal) + '.';
      lines.push(line);
    }

    lines.push('צפי לסוף ' + mName(c.k) + ': ' + (c.gap >= 0 ? 'עודף של ' : 'מינוס של ') + about(c.gap) + '.');

    if (updated.length && stale >= 3) lines.push('לא עודכנו נתוני אשראי כבר ' + stale + ' ימים. נא לעדכן.');

    return { title: 'התקציב של ' + mName(c.k), body: lines.join('\n'), month: c.k };
  }

  return {
    HE_MONTHS: HE_MONTHS,
    keyOf: keyOf, parts: parts, shift: shift, mName: mName, mLabel: mLabel, day0: day0, dm: dm,
    sum: sum, arr: arr, isNum: isNum, wall: wall,
    cycleDay: cycleDay, cycleOf: cycleOf, cycleText: cycleText, curKey: curKey,
    versionKeys: versionKeys, firstKey: firstKey, planFor: planFor,
    sortedLog: sortedLog, compute: compute, statusMessage: statusMessage
  };
});
