// The page logic. The budget math lives in core.js (window.BudgetCore), shared with the server.
(function () {
  'use strict';

  /* ---------- constants & state ---------- */
  var C = window.BudgetCore;   // the budget math, shared with the server (core.js)
  var keyOf = C.keyOf, parts = C.parts, shift = C.shift, mName = C.mName, mLabel = C.mLabel;
  var sum = C.sum, arr = C.arr, isNum = C.isNum, sortedLog = C.sortedLog;
  var CACHE_KEY = 'mor-budget-cache-v2';
  var TOKEN_KEY = 'mor-budget-token';
  var BIO_KEY = 'mor-budget-bio';          // { email, id } once this device signs in with a passkey
  var BIO_SKIP_KEY = 'mor-budget-bio-skip';
  var INSTALL_KEY = 'mor-budget-install';   // 'installed', or the time until which the card stays hidden
  var POLL_MS = 15000;
  var IDLE_MS = 5 * 60000;                  // stop polling after 5 minutes without a touch
  var nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

  var S = {
    status: 'connecting',   // auth (signed out) | connecting | live | offline (cached copy, read only)
    token: null,
    user: null,             // { email, role, passkeys }
    rev: null,              // server version of the data, for cheap polling
    plan: null,
    months: {},
    tab: 'month',
    monthKey: keyOf(new Date()),
    followCur: true,        // the month view tracks the active credit cycle
    draft: null,
    pending: 0,
    authView: 'login',      // login | join
    bioAvail: false,        // this device has a fingerprint / face sensor for passkeys
    push: null,             // unsupported | ios-home | denied | on | off
    members: null,          // owner only: the family list
    newCode: null           // owner only: { email, code, exp } just issued
  };

  var ICON = {
    prev: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6l6 6-6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6l-6 6 6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="17" height="17" aria-label="שיתוף" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v9h14v-9h-1"/></svg>'
  };

  /* ---------- small helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function cycleDay() { return C.cycleDay(S.plan); }
  function cycleOf(k) { return C.cycleOf(S.plan, k); }
  function cycleText(k) { return C.cycleText(S.plan, k); }
  // the budget month whose credit cycle is running today
  function curKey() { return C.curKey(S.plan, new Date()); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n, sign) {
    var r = Math.round(Number(n) || 0);
    var s = r < 0 ? '−' : (sign && r > 0 ? '+' : '');
    return s + '₪' + nf.format(Math.abs(r));
  }
  function M(n, sign) { return '<span class="num" dir="ltr">' + money(n, sign) + '</span>'; }
  function P(n) { var r = Math.round(Number(n) || 0); return '<span class="num" dir="ltr">' + (r < 0 ? '−' : '') + nf.format(Math.abs(r)) + '</span>'; }
  function parseAmt(v) {
    var s = String(v == null ? '' : v).replace(/[\s,₪]/g, '').replace(/[^\d.]/g, '');
    if (!s || s === '.') return NaN;
    var n = Number(s);
    return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  function joinNames(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' ו' + list[list.length - 1];
  }
  function relTime(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var now = new Date();
    var day0 = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day0(now) - day0(d)) / 86400000);
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (diff <= 0) return 'היום, ' + hm;
    if (diff === 1) return 'אתמול, ' + hm;
    if (diff < 7) return 'לפני ' + diff + ' ימים';
    return 'ב-' + d.getDate() + '.' + (d.getMonth() + 1);
  }
  function stamp(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.getDate() + '.' + (d.getMonth() + 1) + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ---------- access ---------- */
  function canAct() { return S.status === 'live'; }
  function ctl() { return canAct() ? 'edit' : (S.status === 'connecting' ? 'wait' : 'ro'); }

  /* ---------- plan & month math (core.js) ---------- */
  function versionKeys() { return C.versionKeys(S.plan); }
  function firstKey() { return C.firstKey(S.plan, new Date()); }
  function planFor(k) { return C.planFor(S.plan, k); }
  function compute(k) { return C.compute(S.plan, S.months, k, new Date()); }

  /* ---------- views ---------- */
  function banner() {
    if (S.status === 'offline') return '<div class="banner">אין חיבור לשרת. מוצגים הנתונים האחרונים שנשמרו במכשיר הזה, ואפשר יהיה לעדכן כשהחיבור יחזור.</div>';
    return '';
  }

  function viewEmpty() {
    if (S.status === 'connecting') return '<div class="empty"><h2>טוען את התקציב…</h2></div>';
    if (S.status === 'offline') return '<div class="empty"><h2>אין חיבור לשרת</h2><p>בודקים את החיבור לאינטרנט, והתקציב ייטען לבד כשהחיבור יחזור.</p></div>';
    return '<div class="empty"><h2>עוד לא הוגדר תכנון</h2><p>מתחילים מהכנסות, הוצאות קבועות וכרטיסי אשראי, ומשם מחושב הפער בכל חודש.</p>' +
      (canAct() ? '<button class="btn btn-primary" data-act="tab" data-tab="plan">הגדרת התכנון</button>' : '') + '</div>';
  }

  function viewHero(c) {
    var k = c.k, pos = c.gap >= 0, sub;
    var label = c.phase === 'current' ? 'צפי לסוף ' + mName(k) : (c.phase === 'past' ? 'סיכום ' + mName(k) : 'תכנון ל' + mName(k));
    if (c.phase === 'current') {
      sub = pos ? 'עודף צפוי, אם מכאן כל כרטיס יישאר בתקציב שלו.' : 'מינוס צפוי, גם אם מכאן כל כרטיס יישאר בתקציב שלו.';
      var overs = c.cards.filter(function (x) { return x.over > 0; });
      if (overs.length) sub += ' כולל חריגה של ' + M(c.overTotal) + ' ' + overs.map(function (x) { return 'ב' + esc(x.name); }).join(' ו') + '.';
    } else if (c.phase === 'past') {
      sub = pos ? 'החודש נסגר בעודף.' : 'החודש נסגר במינוס.';
      if (c.unknown.length) {
        sub += ' אין עדכון ' + c.unknown.map(function (x) { return 'ל' + esc(x.name); }).join(' ו') + ', ולכן החישוב לפי התקציב.';
      }
    } else {
      var changed = c.extras.length || c.income.some(function (i) { return i.changed; });
      sub = changed ? 'לפי התכנון, כולל השינויים בהכנסות של החודש.' : 'לפי התכנון.';
    }

    var minK = firstKey(), maxK = shift(curKey(), 12);
    var isNow = k === curKey();
    return '<section class="hero" aria-label="סיכום ' + esc(mLabel(k)) + '">' +
      '<div class="hero-nav">' +
        '<button class="navbtn" data-act="prev" aria-label="החודש הקודם"' + (k <= minK ? ' disabled' : '') + '>' + ICON.prev + '</button>' +
        '<div class="hero-month">' + esc(mLabel(k)) +
          (cycleDay() > 1 ? '<small>חיובי אשראי ' + cycleText(k) + '</small>' : '') +
          (isNow ? '' : '<button class="today-pill" data-act="today">לחודש הנוכחי</button>') + '</div>' +
        '<button class="navbtn" data-act="next" aria-label="החודש הבא"' + (k >= maxK ? ' disabled' : '') + '>' + ICON.next + '</button>' +
      '</div>' +
      '<p class="hero-label">' + label + '</p>' +
      '<div class="hero-num ' + (pos ? 'pos' : 'neg') + '">' + M(c.gap, true) + '</div>' +
      '<p class="hero-sub">' + sub + '</p>' +
      viewStrip(c) +
      '</section>';
  }

  function viewStrip(c) {
    var scale = Math.max(c.incomeTotal, c.expenses, 1);
    var pct = function (v) { return (Math.max(0, v) / scale * 100).toFixed(3) + '%'; };
    var surplus = Math.max(0, c.gap), deficit = Math.max(0, -c.gap);
    var segs = [['fixed', c.fixedTotal], ['credit', c.creditSpent], ['planned', c.creditPlanned], ['surplus', surplus]]
      .filter(function (s) { return s[1] > 0; });
    var creditLabel = c.phase === 'past' ? 'אשראי בפועל' : 'אשראי עד היום';
    var plannedLabel = c.phase === 'past' ? 'אשראי לפי תקציב' : (c.phase === 'future' ? 'תקציב אשראי' : 'נותר בתקציב האשראי');
    var legend = [['fixed', 'הוצאות קבועות', c.fixedTotal]];
    if (c.phase !== 'future') legend.push(['credit', creditLabel, c.creditSpent]);
    if (c.phase !== 'past' || c.creditPlanned > 0) legend.push(['planned', plannedLabel, c.creditPlanned]);
    legend.push(c.gap >= 0 ? ['surplus', 'עודף', surplus] : ['over', 'מינוס', deficit]);

    var aria = 'הכנסות ' + money(c.incomeTotal) + '. ' + legend.map(function (l) { return l[1] + ' ' + money(l[2]); }).join(', ');
    return '<div class="strip-cap"><span>לאן הולכות הכנסות החודש</span><b>' + M(c.incomeTotal) + '</b></div>' +
      '<div class="strip" role="img" aria-label="' + esc(aria) + '">' +
      segs.map(function (s) { return '<span class="seg seg-' + s[0] + '" style="flex-basis:' + pct(s[1]) + '"></span>'; }).join('') +
      (deficit > 0 ? '<span class="strip-over" style="inset-inline-start:' + pct(c.incomeTotal) + '"></span>' : '') +
      '</div>' +
      '<dl class="legend">' + legend.map(function (l) {
        return '<div><dt><i class="sw sw-' + l[0] + '"></i>' + l[1] + '</dt><dd>' + M(l[2]) + '</dd></div>';
      }).join('') + '</dl>';
  }

  function cardBar(x, c) {
    var scale = Math.max(x.budget, x.spent, 1);
    var inPct = Math.min(x.spent, x.budget) / scale * 100;
    var overPct = Math.max(0, x.spent - x.budget) / scale * 100;
    var tick = (c.phase === 'current' && x.budget > 0) ? Math.min(100, x.budget * c.dayFrac / scale * 100) : null;
    return '<div class="bar" aria-hidden="true">' +
      '<span class="bar-in" style="width:' + inPct.toFixed(2) + '%"></span>' +
      (overPct > 0 ? '<span class="bar-over" style="width:' + overPct.toFixed(2) + '%"></span>' : '') +
      (tick != null ? '<span class="bar-tick" style="inset-inline-start:' + tick.toFixed(2) + '%"></span>' : '') +
      '</div>';
  }

  function viewCredit(c) {
    var mode = ctl(), note;
    var range = cycleDay() > 1 ? 'מחזור החיוב ' + cycleText(c.k) + '. ' : '';
    if (c.phase === 'current') {
      var left = c.dim - c.day + 1;
      note = range + 'יום ' + c.day + ' מתוך ' + c.dim + ', ' + (left === 1 ? 'זה היום האחרון במחזור' : 'נותרו ' + left + ' ימים') +
        '. הקו האנכי מסמן כמה היה מצטבר עד היום בקצב שווה.';
    } else if (c.phase === 'past') note = range + 'הסכום האחרון שהוזן לכל כרטיס הוא הסכום שחויב.';
    else note = range + 'המחזור עוד לא התחיל, לכן מוצג התקציב בלבד.';

    var rows = c.cards.map(function (x) {
      var meta = [];
      if (x.st === 'none') {
        if (c.phase === 'past') meta.push('<span class="st-warn">אין עדכון, החישוב לפי התקציב</span>');
        else if (c.phase === 'current') meta.push(cycleDay() > 1 ? 'עוד לא עודכן במחזור הזה' : 'עוד לא עודכן החודש');
      } else if (x.st === 'over') {
        meta.push('<span class="st-over">חריגה של ' + M(x.over) + '</span>');
      } else if (c.phase === 'past') {
        meta.push('מתחת לתקציב ב-' + M(x.remaining));
      } else {
        if (x.st === 'ahead') meta.push('<span class="st-ahead">מעל הקצב השווה ב-' + M(x.spent - x.expected) + '</span>');
        meta.push('נותר ' + M(x.remaining));
        if (c.phase === 'current' && x.remaining > 0) meta.push('עד ' + M(x.remaining / (c.dim - c.day + 1)) + ' ליום');
      }
      if (x.last) meta.push('<span class="upd">עודכן ' + relTime(x.last.t) + '</span>');
      var showBtn = c.phase !== 'future' && mode !== 'ro';
      var amt = (c.phase === 'future' && x.actual == null) ? M(x.budget) + '<small>תקציב</small>'
        : (x.actual == null ? '<span class="num" dir="ltr">—</span><small>מתוך ' + P(x.budget) + '</small>'
        : M(x.spent) + '<small>מתוך ' + P(x.budget) + '</small>');
      return '<li class="cr" data-st="' + x.st + '">' +
        '<div class="cr-name">' + esc(x.name) + '</div>' +
        '<div class="cr-amt">' + amt + '</div>' +
        '<div class="cr-bar">' + cardBar(x, c) + '</div>' +
        '<div class="cr-meta">' + meta.map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</div>' +
        (showBtn ? '<div><button class="btn-amber" data-act="card" data-id="' + esc(x.id) + '"' + (mode === 'wait' ? ' disabled' : '') +
          ' aria-label="עדכון ' + esc(x.name) + '">עדכון</button></div>' : '<div></div>') +
        '</li>';
    }).join('');

    return '<section class="sec" aria-labelledby="h-credit">' +
      '<div class="sec-head"><h2 id="h-credit">אשראי</h2><div class="sec-total">' +
      (c.phase === 'future' ? '<small>תקציב </small>' + M(c.creditBudget) : M(c.phase === 'past' ? c.creditCounted : c.creditSpent) + ' <small>מתוך ' + P(c.creditBudget) + '</small>') +
      '</div></div>' +
      '<p class="sec-note">' + note + '</p>' +
      (rows ? '<ul class="cards">' + rows + '</ul>' : '<div class="empty-line">אין כרטיסים בתכנון.</div>') +
      '</section>';
  }

  function viewIncome(c) {
    var mode = ctl();
    var live = mode !== 'ro';
    var rowTag = function (attrs, inner) {
      return live ? '<button class="row" ' + attrs + (mode === 'wait' ? ' disabled' : '') + '>' + inner + '</button>' : '<div class="row">' + inner + '</div>';
    };
    var rows = c.income.map(function (i) {
      var inner = '<span class="row-name">' + esc(i.name) + (i.changed ? '<span class="tag">שונה החודש</span>' : '') + '</span>' +
        '<span class="row-amt">' + (i.changed ? '<s>' + P(i.base) + '</s>' : '') + P(i.value) + (live ? ICON.pen : '') + '</span>';
      return '<li>' + rowTag('data-act="income" data-id="' + esc(i.id) + '" aria-label="' + esc(i.name) + ', ' + money(i.value) + '. שינוי לחודש הזה"', inner) + '</li>';
    }).join('');
    var ex = c.extras.map(function (x) {
      var inner = '<span class="row-name">' + esc(x.name) + '</span><span class="row-amt">' + P(x.amount) + (live ? ICON.pen : '') + '</span>';
      return '<li>' + rowTag('data-act="extra" data-id="' + esc(x.id) + '" aria-label="' + esc(x.name) + ', ' + money(x.amount) + '. עריכה"', inner) + '</li>';
    }).join('');
    return '<section class="sec" aria-labelledby="h-income">' +
      '<div class="sec-head"><h2 id="h-income">הכנסות</h2><div class="sec-total">' + M(c.incomeTotal) + '</div></div>' +
      (rows ? '<ul class="ledger">' + rows + '</ul>' : '<div class="empty-line">אין הכנסות בתכנון.</div>') +
      (ex ? '<h3 class="sub">תוספות ב' + mName(c.k) + '</h3><ul class="ledger">' + ex + '</ul>' : '') +
      (live ? '<button class="btn-ghost" data-act="extra"' + (mode === 'wait' ? ' disabled' : '') + '>' + ICON.plus + 'הוספת תשלום נוסף</button>' : '') +
      '</section>';
  }

  function viewFixed(c) {
    var rows = c.fixed.map(function (f) {
      return '<li><div class="row"><span class="row-name">' + esc(f.name) + '</span><span class="row-amt">' + P(f.amount) + '</span></div></li>';
    }).join('');
    return '<section class="sec" aria-labelledby="h-fixed">' +
      '<div class="sec-head"><h2 id="h-fixed">הוצאות קבועות</h2><div class="sec-total">' + M(c.fixedTotal) + '</div></div>' +
      (rows ? '<ul class="ledger">' + rows + '</ul>' : '<div class="empty-line">אין הוצאות קבועות בתכנון.</div>') +
      (ctl() === 'edit' ? '<button class="btn-ghost" data-act="tab" data-tab="plan">שינוי ההוצאות הקבועות</button>' : '') +
      '</section>';
  }

  function viewMonth() {
    var c = compute(S.monthKey);
    if (!c) return viewEmpty();
    return banner() + viewHero(c) + viewCredit(c) + viewIncome(c) + viewFixed(c);
  }

  function viewHistory() {
    if (!versionKeys().length) return viewEmpty();
    var fk = firstKey(), nk = curKey(), last = nk;
    Object.keys(S.months).forEach(function (k) { if (/^\d{4}-\d{2}$/.test(k) && k > last && k <= shift(nk, 12)) last = k; });
    var keys = [];
    for (var k = last; k >= fk && keys.length < 120; k = shift(k, -1)) keys.push(k);
    var closed = [];
    var rows = keys.map(function (k) {
      var c = compute(k); if (!c) return '';
      if (c.phase === 'past') closed.push(c);
      var tag = c.phase === 'current' ? '<span class="tag">חודש נוכחי</span>' : (c.phase === 'future' ? '<span class="tag">תכנון</span>' : '');
      var gl = c.phase === 'current' ? 'צפי' : (c.phase === 'past' ? 'בפועל' : 'מתוכנן');
      var shown = c.phase === 'past' ? c.creditCounted : c.creditSpent;
      var scale = Math.max(c.creditBudget, shown, 1);
      var inPct = Math.min(shown, c.creditBudget) / scale * 100, overPct = Math.max(0, shown - c.creditBudget) / scale * 100;
      var credit = c.phase === 'past' ? 'אשראי ' + M(c.creditCounted) + ' מתוך ' + M(c.creditBudget) + (c.unknown.length ? ', חלק לפי התקציב' : '')
        : (c.phase === 'current' ? 'אשראי עד היום ' + M(c.creditSpent) + ' מתוך ' + M(c.creditBudget) : 'תקציב אשראי ' + M(c.creditBudget));
      return '<li><button class="hrow" data-act="goto" data-k="' + k + '">' +
        '<span class="h-month">' + esc(mLabel(k)) + tag + '</span>' +
        '<span class="h-gap ' + (c.gap >= 0 ? 'pos' : 'neg') + '">' + M(c.gap, true) + '<small>' + gl + '</small></span>' +
        '<span class="h-bar"><span class="bar"><span class="bar-in" style="width:' + inPct.toFixed(2) + '%"></span>' +
          (overPct > 0 ? '<span class="bar-over" style="width:' + overPct.toFixed(2) + '%"></span>' : '') + '</span></span>' +
        '<span class="h-meta">' + credit + '</span>' +
        '</button></li>';
    }).join('');
    var summary;
    if (closed.length >= 2) {
      var avgGap = sum(closed.map(function (c) { return c.gap; })) / closed.length;
      var avgCredit = sum(closed.map(function (c) { return c.creditCounted; })) / closed.length;
      var overMonths = closed.filter(function (c) { return c.creditCounted > c.creditBudget; }).length;
      summary = '<p class="summary">ב-' + closed.length + ' החודשים שנסגרו: פער ממוצע ' + M(avgGap, true) + ', אשראי ממוצע ' + M(avgCredit) +
        ', וחריגה מתקציב האשראי ב-' + overMonths + ' מהם.</p>';
    } else {
      summary = '<p class="summary">כל חודש שנגמר נשאר כאן, כך שאפשר להשוות בין חודשים ולראות איפה האשראי חורג.</p>';
    }
    return banner() + '<h1 class="page-title">היסטוריה</h1>' + summary + '<ul class="hist" style="margin-top:10px">' + rows + '</ul>';
  }

  /* ---------- plan editor ---------- */
  var GROUPS = [
    { key: 'income', title: 'הכנסות קבועות', desc: 'משכורות בלי תוספות. תשלום נוסף בחודש מסוים מוסיפים במסך החודש.', add: 'הוספת הכנסה', amt: 'סכום', pre: 'in' },
    { key: 'fixed', title: 'הוצאות קבועות', desc: '', add: 'הוספת הוצאה', amt: 'סכום', pre: 'fx' },
    { key: 'cards', title: 'כרטיסי אשראי', desc: 'מתעדכנים במהלך החודש. הסכום כאן הוא התקציב החודשי של כל כרטיס.', add: 'הוספת כרטיס', amt: 'תקציב', pre: 'cc' }
  ];
  function makeDraft() {
    var p = planFor(S.monthKey);
    var g = function (a, f) { return (a || []).map(function (x) { return { id: x.id, name: x.name || '', amount: nf2.format(Number(x[f]) || 0) }; }); };
    var d = { from: S.monthKey, dirty: false, cycleDay: String(p ? cycleDay() : 1),
      income: g(p && p.income, 'amount'), fixed: g(p && p.fixed, 'amount'), cards: g(p && p.cards, 'budget') };
    if (!p) GROUPS.forEach(function (gr) { d[gr.key].push({ id: '', name: '', amount: '' }); });
    return d;
  }
  function draftSum(key) {
    return sum((S.draft && S.draft[key] || []).map(function (it) { var n = parseAmt(it.amount); return isFinite(n) ? n : 0; }));
  }
  function draftGap() { return draftSum('income') - draftSum('fixed') - draftSum('cards'); }

  function viewPlan() {
    if (!S.plan && S.status !== 'live') return viewEmpty();
    if (!S.draft || (!S.draft.dirty && S.draft.from !== S.monthKey)) S.draft = makeDraft();
    var d = S.draft, edit = ctl() === 'edit';
    var groups = GROUPS.map(function (gr) {
      var rows = d[gr.key].map(function (it, i) {
        var dis = edit ? '' : ' disabled';
        return '<div class="prow">' +
          '<input class="input" data-g="' + gr.key + '" data-i="' + i + '" data-f="name" value="' + esc(it.name) + '" placeholder="שם" aria-label="שם"' + dis + '>' +
          '<input class="input amt" data-g="' + gr.key + '" data-i="' + i + '" data-f="amount" value="' + esc(it.amount) + '" inputmode="decimal" dir="ltr" placeholder="0" aria-label="' + gr.amt + (it.name ? ' של ' + esc(it.name) : '') + '"' + dis + '>' +
          (edit ? '<button class="icon-btn" data-act="plan-del" data-g="' + gr.key + '" data-i="' + i + '" aria-label="הסרת ' + esc(it.name || 'השורה') + '">' + ICON.trash + '</button>' : '<span></span>') +
          '</div>';
      }).join('');
      return '<div class="pg">' +
        '<div class="pg-head"><h2>' + gr.title + '</h2><span class="pg-total" data-total="' + gr.key + '">' + M(draftSum(gr.key)) + '</span></div>' +
        (gr.desc ? '<p class="pg-desc">' + gr.desc + '</p>' : '') +
        (gr.key === 'cards' ? '<div class="cycle-row"><label for="cycle-day">החיובים מתאפסים ב-</label>' +
          '<input id="cycle-day" class="input" data-cycle value="' + esc(d.cycleDay) + '" inputmode="numeric" dir="ltr" aria-describedby="cycle-hint"' + (edit ? '' : ' disabled') + '>' +
          '<span>לכל חודש</span></div>' +
          '<p class="pg-desc" id="cycle-hint">מהיום הזה האפליקציה עוברת לחודש הבא, כי מה שמוציאים ממנו והלאה יורד מהחשבון בחודש הבא. 1 פירושו חודש קלנדרי.</p>' : '') +
        rows +
        (edit ? '<button class="btn-ghost" data-act="plan-add" data-g="' + gr.key + '">' + ICON.plus + gr.add + '</button>' : '') +
        '</div>';
    }).join('');
    var lead = versionKeys().length
      ? 'הסכומים שחוזרים כל חודש. שינוי כאן יחול מ' + esc(mLabel(d.from)) + ' והלאה, וחודשים קודמים יישארו כמו שהיו.'
      : 'הסכומים שחוזרים כל חודש. אחרי השמירה, מסך החודש יחשב לבד את הפער.';
    return banner() + '<section data-plan-form>' +
      '<h1 class="page-title">תכנון חודשי</h1><p class="lead">' + lead + '</p>' + groups +
      '<div class="plan-bar"><div class="plan-gap">פער מתוכנן לחודש<b data-total="gap">' + M(draftGap(), true) + '</b></div>' +
      (edit ? '<div class="plan-actions"><button class="btn btn-quiet" data-act="plan-cancel"' + (d.dirty ? '' : ' disabled') + '>ביטול</button>' +
        '<button class="btn btn-primary" data-act="plan-save"' + (d.dirty ? '' : ' disabled') + '>שמירת התכנון</button></div>' : '') +
      '</div></section>';
  }
  function refreshPlanTotals() {
    GROUPS.forEach(function (gr) { var el = $('[data-total="' + gr.key + '"]'); if (el) el.innerHTML = M(draftSum(gr.key)); });
    var g = $('[data-total="gap"]'); if (g) g.innerHTML = M(draftGap(), true);
    var dirty = !!(S.draft && S.draft.dirty);
    ['plan-save', 'plan-cancel'].forEach(function (a) { var b = $('[data-act="' + a + '"]'); if (b) b.disabled = !dirty || S.pending > 0; });
    renderTabs();
  }
  async function savePlan() {
    var d = S.draft; if (!d || !canAct()) return;
    var out = {};
    for (var gi = 0; gi < GROUPS.length; gi++) {
      var gr = GROUPS[gi], items = [];
      for (var i = 0; i < d[gr.key].length; i++) {
        var it = d[gr.key][i], name = String(it.name).trim(), raw = String(it.amount).trim();
        if (!name && !raw) continue;
        if (!name) return planError(gr.key, i, 'name', 'חסר שם בשורה של ' + gr.title);
        var a = raw === '' ? 0 : parseAmt(raw);
        if (!isFinite(a) || a < 0) return planError(gr.key, i, 'amount', 'הסכום של ' + name + ' לא תקין');
        var id = it.id || uid(gr.pre);
        items.push(gr.key === 'cards' ? { id: id, name: name, budget: a } : { id: id, name: name, amount: a });
      }
      out[gr.key] = items;
    }
    var cd = Number(String(d.cycleDay).trim());
    if (!(cd >= 1 && cd <= 28 && Math.floor(cd) === cd)) {
      var ce = $('[data-cycle]'); if (ce) { ce.setAttribute('aria-invalid', 'true'); ce.focus(); }
      toast('יום האיפוס צריך להיות מספר בין 1 ל-28'); return;
    }
    var versions = clone((S.plan && S.plan.versions) || {}) || {};
    Object.keys(versions).forEach(function (k) { if (k > d.from) delete versions[k]; });
    versions[d.from] = out;
    var btn = $('[data-act="plan-save"]'); if (btn) btn.disabled = true;
    var ok = await writeDoc('budget/plan', null, { patch: { versions: versions, cycleDay: cd, updatedAt: new Date().toISOString() } });
    if (ok) { S.draft = null; toast('התכנון נשמר'); render(true); }
    else refreshPlanTotals();
  }
  function planError(g, i, f, msg) {
    var el = $('[data-plan-form] input[data-g="' + g + '"][data-i="' + i + '"][data-f="' + f + '"]');
    if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
    toast(msg);
  }

  /* ---------- sign-in ---------- */
  function viewAuth() {
    var bio = bioInfo();
    if (S.authView === 'join') {
      return '<form class="auth" data-auth-form data-kind="join" novalidate>' +
        '<h1 class="page-title">הצטרפות</h1>' +
        '<p class="lead">מכניסים את האימייל ואת הקוד שקיבלתם, ובוחרים סיסמה.</p>' +
        '<label class="field"><span class="field-label">אימייל</span><input class="input" type="email" name="email" autocomplete="username" dir="ltr" required></label>' +
        '<label class="field"><span class="field-label">קוד הצטרפות</span><input class="input input-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" required></label>' +
        '<label class="field"><span class="field-label">סיסמה חדשה (8 תווים לפחות)</span><input class="input" type="password" name="password" autocomplete="new-password" dir="ltr" required></label>' +
        '<p class="field-err" data-err role="alert"></p>' +
        '<button class="btn btn-primary btn-block" type="submit">הצטרפות</button>' +
        '<button class="btn-ghost" type="button" data-act="auth-view" data-view="login">כבר יש לי סיסמה</button>' +
        '</form>';
    }
    return '<form class="auth" data-auth-form data-kind="login" novalidate>' +
      '<h1 class="page-title">כניסה</h1>' +
      '<p class="lead">התקציב פתוח רק לבני המשפחה.</p>' +
      (bio && S.bioAvail ? '<button class="btn btn-primary btn-block" type="button" data-act="bio-login">כניסה עם טביעת אצבע או זיהוי פנים</button>' +
        '<div class="or">או עם סיסמה</div>' : '') +
      '<label class="field"><span class="field-label">אימייל</span><input class="input" type="email" name="email" autocomplete="username" dir="ltr" value="' + esc(bio ? bio.email : '') + '" required></label>' +
      '<label class="field"><span class="field-label">סיסמה</span><input class="input" type="password" name="password" autocomplete="current-password" dir="ltr" required></label>' +
      '<p class="field-err" data-err role="alert"></p>' +
      '<button class="btn ' + (bio && S.bioAvail ? 'btn-quiet' : 'btn-primary') + ' btn-block" type="submit">כניסה</button>' +
      '<button class="btn-ghost" type="button" data-act="auth-view" data-view="join">קיבלתי קוד הצטרפות</button>' +
      '<p class="fine">שכחתם את הסיסמה? מי שמנהל את האפליקציה יכול לתת לכם קוד חדש מלשונית ההגדרות.</p>' +
      '</form>';
  }

  /* ---------- settings ---------- */
  function viewSettings() {
    var u = S.user || {}, bio = bioInfo(), bioOn = !!(bio && bio.email === u.email);
    var html = '<div data-settings><h1 class="page-title">הגדרות</h1>' +
      (u.email ? '<p class="lead">מחוברים בתור <span dir="ltr">' + esc(u.email) + '</span></p>' : '');

    // biometrics
    html += '<section class="sec" aria-labelledby="h-bio"><div class="sec-head"><h2 id="h-bio">כניסה ביומטרית</h2></div>';
    if (!S.bioAvail) {
      html += '<p class="set-text">המכשיר הזה לא תומך בכניסה עם טביעת אצבע או זיהוי פנים.</p>';
    } else {
      html += '<div class="set-state" data-on="' + (bioOn ? 1 : 0) + '"><i></i>' + (bioOn ? 'פעילה במכשיר הזה' : 'כבויה במכשיר הזה') + '</div>' +
        '<p class="set-text">' + (bioOn ? 'בכל פתיחה של האפליקציה תתבקשו לאשר עם טביעת אצבע או זיהוי פנים.'
          : 'נכנסים בלי סיסמה, עם טביעת אצבע או זיהוי פנים. אחרי ההפעלה האפליקציה תבקש אותם בכל פתיחה במכשיר הזה.') + '</p>' +
        '<div class="set-actions">' + (bioOn ? '<button class="btn btn-quiet btn-small" data-act="bio-off">כיבוי</button>'
          : '<button class="btn btn-primary btn-small" data-act="bio-on">הפעלה במכשיר הזה</button>') + '</div>';
    }
    var keys = u.passkeys || [];
    if (keys.length) {
      html += '<h3 class="sub">מכשירים עם כניסה ביומטרית</h3><ul class="ledger">' + keys.map(function (k) {
        var here = bio && bio.id === k.id;
        return '<li class="mem"><span class="mem-mail">' + (here ? 'המכשיר הזה' : 'מכשיר אחר') + '</span>' +
          '<span class="mem-meta">נוסף ' + esc(relTime(k.at)) + (k.used ? ' · כניסה אחרונה ' + esc(relTime(k.used)) : '') + '</span>' +
          '<span class="mem-acts"><button class="link-danger" data-act="pk-remove" data-id="' + esc(k.id) + '">הסרה</button></span></li>';
      }).join('') + '</ul><p class="hint">טלפון שאבד? מסירים אותו מכאן, ואז אי אפשר להיכנס ממנו עם טביעת אצבע.</p>';
    }
    html += '</section>';

    // notifications
    var st = S.push, msg = S.plan ? C.statusMessage(S.plan, S.months, new Date()) : null;
    html += '<section class="sec" aria-labelledby="h-push"><div class="sec-head"><h2 id="h-push">התראות</h2></div>' +
      '<p class="set-text">כל 3 ימים ב-19:00 נשלחת התראה עם מצב החודש: כמה נשאר עד תקרת האשראי או כמה חרגתם, הצפי לסוף החודש, ותזכורת אם האשראי לא עודכן כמה ימים.</p>';
    if (st === 'unsupported') html += '<p class="set-text">הדפדפן הזה לא תומך בהתראות. בטלפון אנדרואיד פותחים ב-Chrome.</p>';
    else if (st === 'ios-home') html += '<p class="notice"><b>באייפון צריך קודם להוסיף את האפליקציה למסך הבית</b>בספארי לוחצים על כפתור השיתוף, בוחרים "הוספה למסך הבית", ופותחים את האפליקציה מהאייקון החדש. משם אפשר להפעיל התראות.</p>';
    else if (st === 'denied') html += '<p class="set-text">ההתראות חסומות בדפדפן. כדי להפעיל אותן צריך לאשר התראות לאתר הזה בהגדרות הדפדפן.</p>';
    else if (st === 'on' || st === 'off') {
      html += '<div class="set-state" data-on="' + (st === 'on' ? 1 : 0) + '"><i></i>' + (st === 'on' ? 'פעילות במכשיר הזה' : 'כבויות במכשיר הזה') + '</div>' +
        '<div class="set-actions">' + (st === 'on'
          ? '<button class="btn btn-quiet btn-small" data-act="push-test">שליחת התראת ניסיון</button><button class="btn btn-quiet btn-small" data-act="push-off">כיבוי</button>'
          : '<button class="btn btn-primary btn-small" data-act="push-on">הפעלת התראות במכשיר הזה</button>') + '</div>';
    }
    if (msg) html += '<div class="notice"><b>' + esc(msg.title) + '</b><p>' + esc(msg.body) + '</p></div><p class="hint">כך הייתה נראית ההתראה אם הייתה נשלחת עכשיו.</p>';
    html += '</section>';

    // family (owner)
    if (u.role === 'owner') {
      html += '<section class="sec" aria-labelledby="h-fam"><div class="sec-head"><h2 id="h-fam">בני המשפחה</h2></div>' +
        '<p class="set-text">מי שברשימה יכול לראות ולעדכן את התקציב. מוסיפים אימייל, ושולחים לאותו אדם את הקוד שמופיע ואת הכתובת של האפליקציה.</p>';
      if (!S.members) html += '<p class="set-text">טוען…</p>';
      else {
        html += '<ul class="ledger">' + S.members.map(function (m) {
          var meta = m.role === 'owner' ? 'מנהל' : (m.joined ? 'מחובר' : (m.invite ? 'ממתין להצטרפות' : 'הקוד פג, צריך קוד חדש'));
          if (m.passkeys) meta += ' · כניסה ביומטרית';
          var self = m.email === u.email;
          return '<li class="mem"><span class="mem-mail" dir="ltr">' + esc(m.email) + '</span><span class="mem-meta">' + meta + '</span>' +
            (self ? '' : '<span class="mem-acts"><button class="btn btn-quiet btn-small" data-act="mem-code" data-email="' + esc(m.email) + '">קוד חדש</button>' +
              '<button class="link-danger" data-act="mem-remove" data-email="' + esc(m.email) + '">הסרה</button></span>') + '</li>';
        }).join('') + '</ul>';
      }
      if (S.newCode) {
        html += '<div class="code-box" role="status">הקוד של <span dir="ltr">' + esc(S.newCode.email) + '</span>:' +
          '<span class="code" dir="ltr">' + esc(S.newCode.code) + '</span>' +
          'שלחו את הקוד ואת הכתובת <span dir="ltr">' + esc(location.origin) + '</span>. בכניסה בוחרים "קיבלתי קוד הצטרפות". הקוד תקף לשבוע ולשימוש אחד.</div>';
      }
      html += '<form class="add-row" data-add-member novalidate><input class="input" type="email" name="email" placeholder="אימייל" aria-label="אימייל של בן משפחה" dir="ltr" autocomplete="off">' +
        '<button class="btn btn-primary btn-small" type="submit">הוספה</button></form><p class="field-err" data-err role="alert"></p></section>';
    }

    // account
    html += '<section class="sec" aria-labelledby="h-acct"><div class="sec-head"><h2 id="h-acct">החשבון</h2></div>' +
      '<div class="set-actions"><button class="btn btn-quiet btn-small" data-act="password">שינוי סיסמה</button>' +
      '<button class="btn btn-quiet btn-small" data-act="signout-others">יציאה מכל המכשירים האחרים</button>' +
      '<button class="btn btn-danger btn-small" data-act="logout">יציאה</button></div></section></div>';
    return html;
  }

  /* ---------- rendering ---------- */
  function renderSync() {
    var el = $('#sync'), s, t;
    if (S.status === 'auth') { s = 'off'; t = 'לא מחובר'; }
    else if (S.status === 'connecting') { s = 'wait'; t = 'מתחבר…'; }
    else if (S.status !== 'live') { s = 'off'; t = 'אין חיבור'; }
    else if (S.pending > 0) { s = 'saving'; t = 'שומר…'; }
    else { s = 'live'; t = 'מסונכרן'; }
    el.dataset.s = s; el.lastChild.textContent = t;
  }
  function renderTabs() {
    document.querySelectorAll('.tab').forEach(function (b) {
      var on = b.dataset.tab === S.tab;
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      var dot = b.querySelector('.dot');
      var want = b.dataset.tab === 'plan' && S.draft && S.draft.dirty && S.tab !== 'plan';
      if (want && !dot) { dot = document.createElement('i'); dot.className = 'dot'; b.appendChild(dot); }
      if (!want && dot) dot.remove();
    });
  }
  function render(force) {
    if (S.followCur) S.monthKey = curKey();   // rolls over by itself on the reset day
    document.body.classList.toggle('locked', S.status === 'auth');
    renderSync(); renderTabs();
    if (S.status === 'auth') {
      if (!force && $('[data-auth-form]')) return;   // keep what the person is typing
      $('#app').innerHTML = viewAuth();
      return;
    }
    // never rebuild a form under the person's fingers
    if (!force && S.tab === 'plan' && $('[data-plan-form]') && S.draft && S.draft.dirty) return;
    if (!force && S.tab === 'settings' && $('[data-settings]')) return;
    var html = S.tab === 'history' ? viewHistory() : (S.tab === 'plan' ? viewPlan() : (S.tab === 'settings' ? viewSettings() : viewMonth()));
    $('#app').innerHTML = html;
  }
  function setTab(t) {
    S.tab = t; render(true);
    if (t === 'settings') loadSettings();
    try { window.scrollTo({ top: 0 }); } catch (e) { window.scrollTo(0, 0); }
  }

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  /* ---------- sheets ---------- */
  var dlg = $('#sheet');
  function openSheet(html, mount) {
    dlg.innerHTML = '<div class="sheet-body">' + html + '</div>';
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
    var x = dlg.querySelector('[data-close]'); if (x) x.addEventListener('click', closeSheet);
    if (mount) mount(dlg);
  }
  function closeSheet() { if (dlg.open) { try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); } } }
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeSheet(); });
  dlg.addEventListener('close', function () { dlg.innerHTML = ''; });
  function head(title, sub) {
    return '<div class="sheet-head"><div><h2 id="sheet-title">' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' +
      '<button class="x" data-close aria-label="סגירה">' + ICON.x + '</button></div>';
  }
  function onEnter(input, fn) { input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); fn(); } }); }
  function focusSoon(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }

  function openCardSheet(id) {
    var c = compute(S.monthKey); if (!c) return;
    var x = c.cards.filter(function (z) { return z.id === id; })[0]; if (!x) return;
    var k = c.k, mode = 'set';
    var logs = x.log.slice().reverse().map(function (e) {
      return '<li class="log-row"><span>' + stamp(e.t) + '</span>' + M(e.a) +
        '<button class="link-danger" data-del="' + esc(e.t) + '" data-a="' + e.a + '">מחיקה</button></li>';
    }).join('');
    openSheet(
      head(esc(x.name), 'החיוב של ' + esc(mLabel(k)) + (cycleDay() > 1 ? ' (' + cycleText(k) + ')' : '') + ', תקציב ' + M(x.budget)) +
      '<div class="segctl" aria-label="סוג העדכון">' +
        '<button type="button" data-mode="set" aria-pressed="true">סה״כ עד היום</button>' +
        '<button type="button" data-mode="add" aria-pressed="false">הוספת חיוב</button></div>' +
      '<label class="field"><span class="field-label" data-lbl>' + (c.phase === 'past' ? 'מה הסכום הסופי שחויב?' : 'כמה הצטבר בכרטיס עד היום?') + '</span>' +
        '<input class="input input-amt" data-amt inputmode="decimal" dir="ltr" autocomplete="off" enterkeyhint="done" placeholder="' +
        (x.actual == null ? '0' : nf.format(Math.round(x.spent))) + '"></label>' +
      '<p class="field-err" data-err role="alert"></p>' +
      '<p class="preview" data-prev></p>' +
      '<button class="btn btn-primary btn-block" data-save>שמירה</button>' +
      (logs ? '<h3 class="sheet-sub">עדכונים ב' + mName(k) + '</h3><ul class="log">' + logs + '</ul>' : ''),
      function (d) {
        var inp = d.querySelector('[data-amt]'), prev = d.querySelector('[data-prev]'), err = d.querySelector('[data-err]');
        var lbl = d.querySelector('[data-lbl]'), btn = d.querySelector('[data-save]');
        var base = function () { var l = sortedLog(S.months[k], x.id); return l.length ? l[l.length - 1].a : 0; };
        var total = function () { var v = parseAmt(inp.value); if (!isFinite(v)) return null; return mode === 'add' ? base() + v : v; };
        var paint = function () {
          var t = total();
          var shown = t == null ? base() : t;
          var pc = x.budget > 0 ? ' <span dir="ltr">(' + Math.round(shown / x.budget * 100) + '%)</span>' : '';
          var s = (t == null ? 'כרגע: ' : 'אחרי העדכון: ') + M(shown) + ' מתוך ' + M(x.budget) + pc;
          if (shown > x.budget) s += '<br><span class="st-over">חריגה של ' + M(shown - x.budget) + '</span>';
          if (c.phase === 'current' && c.day >= 10 && shown > 0 && c.day < c.dim)
            s += '<br>בקצב הזה: כ-' + M(shown / c.day * c.dim) + ' עד סוף המחזור';
          prev.innerHTML = s;
        };
        d.querySelectorAll('[data-mode]').forEach(function (b) {
          b.addEventListener('click', function () {
            mode = b.dataset.mode;
            d.querySelectorAll('[data-mode]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
            lbl.textContent = mode === 'add' ? 'כמה להוסיף לסכום הקיים?' : (c.phase === 'past' ? 'מה הסכום הסופי שחויב?' : 'כמה הצטבר בכרטיס עד היום?');
            inp.placeholder = mode === 'add' ? '0' : (x.actual == null ? '0' : nf.format(Math.round(base())));
            err.textContent = ''; paint(); focusSoon(inp);
          });
        });
        inp.addEventListener('input', function () { err.textContent = ''; paint(); });
        var save = async function () {
          var v = parseAmt(inp.value);
          if (!isFinite(v)) { err.textContent = 'יש להזין סכום במספרים.'; focusSoon(inp); return; }
          if (mode === 'add' && v === 0) { err.textContent = 'יש להזין סכום גדול מאפס.'; focusSoon(inp); return; }
          // "add" sends just the charge: the server adds it to the latest total, even one saved a moment ago on another phone
          btn.disabled = true;
          var ok = await writeDoc('months/' + k, k, { card: { id: x.id, op: mode === 'add' ? 'add' : 'set', t: new Date().toISOString(), a: v, n: uid('u') } });
          if (ok) { closeSheet(); toast(x.name + ' עודכן: ' + money(base())); } else btn.disabled = false;
        };
        btn.addEventListener('click', save); onEnter(inp, save);
        d.querySelectorAll('[data-del]').forEach(function (b) {
          b.addEventListener('click', async function () {
            if (b.dataset.armed !== '1') {
              b.dataset.armed = '1'; b.textContent = 'למחוק?';
              setTimeout(function () { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'מחיקה'; } }, 4000);
              return;
            }
            b.disabled = true;
            var ok = await writeDoc('months/' + k, k, { card: { id: x.id, op: 'remove', t: b.dataset.del, a: Number(b.dataset.a) } });
            if (ok) { closeSheet(); toast('העדכון נמחק'); } else b.disabled = false;
          });
        });
        paint(); focusSoon(inp);
      });
  }

  function openIncomeSheet(id) {
    var c = compute(S.monthKey); if (!c) return;
    var it = c.income.filter(function (z) { return z.id === id; })[0]; if (!it) return;
    var k = c.k;
    openSheet(
      head(esc(it.name), esc(mLabel(k)) + '. הסכום הקבוע: ' + M(it.base)) +
      '<label class="field"><span class="field-label">כמה נכנס ב' + mName(k) + '?</span>' +
        '<input class="input input-amt" data-amt inputmode="decimal" dir="ltr" autocomplete="off" enterkeyhint="done" value="' + Math.round(it.value * 100) / 100 + '"></label>' +
      '<p class="field-err" data-err role="alert"></p>' +
      '<button class="btn btn-primary btn-block" data-save>שמירה ל' + mName(k) + '</button>' +
      (it.changed ? '<button class="btn btn-quiet btn-block" data-reset>חזרה לסכום הקבוע</button>' : '') +
      '<p class="hint">שינוי כאן חל רק על ' + mName(k) + '. שינוי קבוע של הסכום נעשה בלשונית תכנון.</p>',
      function (d) {
        var inp = d.querySelector('[data-amt]'), err = d.querySelector('[data-err]'), btn = d.querySelector('[data-save]');
        var put = async function (val, msg) {
          var patch = { income: {} }; patch.income[it.id] = val;
          btn.disabled = true;
          var ok = await writeDoc('months/' + k, k, { patch: patch });
          if (ok) { closeSheet(); toast(msg); } else btn.disabled = false;
        };
        var save = function () {
          var v = parseAmt(inp.value);
          if (!isFinite(v)) { err.textContent = 'יש להזין סכום במספרים.'; focusSoon(inp); return; }
          put(v === it.base ? null : v, it.name + ' ב' + mName(k) + ': ' + money(v));
        };
        btn.addEventListener('click', save); onEnter(inp, save);
        inp.addEventListener('input', function () { err.textContent = ''; });
        var r = d.querySelector('[data-reset]');
        if (r) r.addEventListener('click', function () { put(null, it.name + ' חזר לסכום הקבוע'); });
        focusSoon(inp); try { inp.select(); } catch (e) {}
      });
  }

  function openExtraSheet(id) {
    var c = compute(S.monthKey); if (!c) return;
    var k = c.k;
    var ex = id ? c.extras.filter(function (z) { return z.id === id; })[0] : null;
    var chips = ['בונוס', 'שעות נוספות', 'החזר הוצאות', 'מענק'];
    openSheet(
      head(ex ? 'עריכת תשלום נוסף' : 'תשלום נוסף', esc(mLabel(k)) + '. נכנס להכנסות של החודש הזה בלבד.') +
      (ex ? '' : '<div class="chips">' + chips.map(function (ch) { return '<button type="button" class="chip" data-chip="' + ch + '">' + ch + '</button>'; }).join('') + '</div>') +
      '<label class="field"><span class="field-label">תיאור</span><input class="input" data-name autocomplete="off" enterkeyhint="next" value="' + esc(ex ? ex.name : '') + '" placeholder="למשל: בונוס של צחי"></label>' +
      '<label class="field"><span class="field-label">סכום</span><input class="input input-amt" data-amt inputmode="decimal" dir="ltr" autocomplete="off" enterkeyhint="done" value="' + (ex ? Math.round(ex.amount * 100) / 100 : '') + '" placeholder="0"></label>' +
      '<p class="field-err" data-err role="alert"></p>' +
      '<button class="btn btn-primary btn-block" data-save>' + (ex ? 'שמירה' : 'הוספה') + '</button>' +
      (ex ? '<button class="btn btn-danger btn-block" data-delete>מחיקה</button>' : ''),
      function (d) {
        var nm = d.querySelector('[data-name]'), amt = d.querySelector('[data-amt]'), err = d.querySelector('[data-err]'), btn = d.querySelector('[data-save]');
        d.querySelectorAll('[data-chip]').forEach(function (b) {
          b.addEventListener('click', function () { nm.value = b.dataset.chip; err.textContent = ''; focusSoon(amt); });
        });
        var write = async function (change, msg) {
          btn.disabled = true;
          var ok = await writeDoc('months/' + k, k, { extra: change });
          if (ok) { closeSheet(); toast(msg); } else btn.disabled = false;
        };
        var save = function () {
          var name = nm.value.trim(), v = parseAmt(amt.value);
          if (!name) { err.textContent = 'יש לכתוב תיאור.'; focusSoon(nm); return; }
          if (!isFinite(v) || v <= 0) { err.textContent = 'יש להזין סכום גדול מאפס.'; focusSoon(amt); return; }
          write({ op: 'put', id: ex ? ex.id : uid('ex'), name: name, amount: v }, ex ? 'נשמר' : 'התשלום נוסף להכנסות של ' + mName(k));
        };
        btn.addEventListener('click', save); onEnter(amt, save); onEnter(nm, function () { focusSoon(amt); });
        [nm, amt].forEach(function (i) { i.addEventListener('input', function () { err.textContent = ''; }); });
        var del = d.querySelector('[data-delete]');
        if (del) del.addEventListener('click', function () {
          if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'ללחוץ שוב כדי למחוק'; return; }
          write({ op: 'remove', id: ex.id }, 'התשלום נמחק');
        });
        focusSoon(ex ? amt : nm);
      });
  }

  /* ---------- device storage: sign-in token, passkey flag, read-only copy of the data ---------- */
  function lsGet(k, store) { try { return (store || localStorage).getItem(k); } catch (e) { return null; } }
  function lsSet(k, v, store) { try { (store || localStorage).setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} }
  function bioInfo() { try { var b = JSON.parse(lsGet(BIO_KEY)); return b && b.email && b.id ? b : null; } catch (e) { return null; } }
  // With a passkey on this device the token and the copy of the data live only until the app closes,
  // so every open asks for the fingerprint and nothing stays on the phone in between.
  function deviceStore() { try { return bioInfo() ? sessionStorage : localStorage; } catch (e) { return null; } }
  function saveToken() {
    lsDel(TOKEN_KEY);
    var store = deviceStore();
    if (S.token && store) lsSet(TOKEN_KEY, S.token, store);
    if (S.token) saveCache();
  }
  function loadToken() { var s = null; try { s = sessionStorage; } catch (e) {} return (s && lsGet(TOKEN_KEY, s)) || lsGet(TOKEN_KEY); }
  function saveCache() {
    var store = deviceStore(); if (!store) return;
    lsDel(CACHE_KEY);
    lsSet(CACHE_KEY, JSON.stringify({ email: S.user && S.user.email, plan: S.plan, months: S.months, at: new Date().toISOString() }), store);
  }
  function readCache() {
    var s = null; try { s = sessionStorage; } catch (e) {}
    try { return JSON.parse((s && lsGet(CACHE_KEY, s)) || lsGet(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }
  function loadCache() {
    var c = readCache();
    if (c && typeof c === 'object') { S.plan = c.plan || null; S.months = (c.months && typeof c.months === 'object') ? c.months : {}; }
  }

  /* ---------- server ---------- */
  async function call(method, path, data) {
    var opts = { method: method, headers: {} };
    if (S.token) opts.headers.authorization = 'Bearer ' + S.token;
    if (data !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(data); }
    var res, out = null;
    try { res = await fetch('/api/' + path, opts); } catch (e) { throw { code: 'network', message: 'אין חיבור לאינטרנט. נסו שוב בעוד רגע.' }; }
    try { out = await res.json(); } catch (e) {}
    if (!res.ok) {
      var err = { code: (out && out.error) || 'http', status: res.status, message: (out && out.message) || 'משהו השתבש. נסו שוב בעוד רגע.' };
      if (err.code === 'auth') signedOut('צריך להיכנס שוב.');
      throw err;
    }
    return out || {};
  }

  var pollTimer = null;
  async function refresh() {
    if (!S.token) return;
    try {
      var r = await call('GET', 'data' + (S.rev ? '?rev=' + encodeURIComponent(S.rev) : ''));
      if (!S.token) return;
      var was = S.status;
      if (!r.unchanged && !S.pending) { S.plan = r.plan || null; S.months = r.months || {}; S.rev = r.rev; saveCache(); }
      S.status = 'live';
      if (!r.unchanged || was !== 'live') render(was !== 'live' && S.tab !== 'plan');
    } catch (e) {
      if (e.code === 'auth' || !S.token) return;
      if (S.status !== 'offline') { S.status = 'offline'; closeSheet(); render(S.tab !== 'plan'); }
    }
  }
  var lastTouch = Date.now();
  function poll() {
    clearTimeout(pollTimer);
    if (!S.token || document.hidden || Date.now() - lastTouch > IDLE_MS) return;
    pollTimer = setTimeout(function () { refresh().then(poll); }, S.status === 'offline' ? 2 * POLL_MS : POLL_MS);
  }
  // a touch after a quiet spell fetches right away and resumes polling
  function touched() {
    var idle = Date.now() - lastTouch > IDLE_MS;
    lastTouch = Date.now();
    if (idle && S.token && !document.hidden) refresh().then(poll);
  }

  var queues = {};
  function enqueue(path, fn) {
    var prev = queues[path] || Promise.resolve();
    var run = prev.then(fn, fn);
    queues[path] = run.catch(function () {});
    return run;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // Every write sends whole values (a full card log, the full extras list), so one retry is safe.
  async function withRetry(fn) {
    try { return await fn(); }
    catch (e) {
      if (e && (e.code === 'network' || e.status >= 500)) { await sleep(300 + Math.random() * 700); return await fn(); }
      throw e;
    }
  }
  // change: { patch } for the plan (replaced whole) or a month's income overrides; { card } or { extra } for one
  // card update or one extra payment. The server applies it to the stored doc and sends the doc back.
  async function writeDoc(path, monthKey, change) {
    if (!canAct()) { toast('אי אפשר לשמור כרגע.'); return false; }
    S.pending++; renderSync();
    try {
      var r = await enqueue(path, function () {
        return withRetry(function () { return call('POST', 'doc', Object.assign({ path: path }, change)); });
      });
      if (monthKey) S.months[monthKey] = r.doc; else S.plan = r.doc;
      S.rev = null; saveCache();
      return true;
    } catch (e) {
      writeFailed(e);
      return false;
    } finally {
      S.pending--; render();
    }
  }
  function writeFailed(e) {
    if (e && e.code === 'auth') return;
    toast(e && e.status >= 400 && e.status < 500 && e.message ? e.message : 'השמירה לא הצליחה. נסו שוב בעוד רגע.');
  }

  /* ---------- signing in and out ---------- */
  async function signedIn(r, how) {
    S.token = r.token; S.user = r.user; saveToken();
    var c = readCache();
    if (c && c.email === S.user.email) loadCache(); else { S.plan = null; S.months = {}; lsDel(CACHE_KEY); }
    S.rev = null; S.status = 'connecting'; S.tab = 'month'; S.followCur = true; S.authView = 'login';
    render(true);
    await refresh(); poll();
    pushCheck(true);
    if (how === 'password') offerBio();
  }
  function signedOut(msg) {
    clearTimeout(pollTimer);
    S.token = null; S.user = null; S.plan = null; S.months = {}; S.rev = null; S.draft = null;
    S.members = null; S.newCode = null; S.status = 'auth'; S.tab = 'month';
    lsDel(TOKEN_KEY); lsDel(CACHE_KEY);
    closeSheet(); render(true);
    if (msg) toast(msg);
  }
  // Signing out forgets this device: its notifications and its fingerprint sign-in go too.
  async function logout() {
    try {
      var reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      var sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
      if (sub) { await call('POST', 'push/unsubscribe', { endpoint: sub.endpoint }).catch(function () {}); await sub.unsubscribe(); }
    } catch (e) {}
    var bio = bioInfo();
    if (bio) await call('POST', 'passkey/remove', { id: bio.id }).catch(function () {});
    lsDel(BIO_KEY);
    S.push = null;
    signedOut();
  }
  async function signOutOthers(btn) {
    btn.disabled = true;
    try {
      var r = await call('POST', 'signout-others');
      S.token = r.token; S.user = r.user; saveToken();
      toast('יצאת מכל המכשירים האחרים');
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  }
  async function removePasskey(id, btn) {
    btn.disabled = true;
    try {
      var r = await call('POST', 'passkey/remove', { id: id }); S.user = r.user;
      var bio = bioInfo(); if (bio && bio.id === id) { lsDel(BIO_KEY); saveToken(); }
      toast('הוסר'); render(true);
    } catch (e) { btn.disabled = false; toast(e.message); }
  }
  async function submitAuth(form) {
    var err = form.querySelector('[data-err]'), btn = form.querySelector('[type="submit"]');
    var f = function (n) { return form.elements[n] ? form.elements[n].value : ''; };
    var join = form.dataset.kind === 'join';
    if (!f('email').trim()) { err.textContent = 'יש לכתוב אימייל.'; focusSoon(form.elements.email); return; }
    if (join && !/^\d{6}$/.test(f('code').trim())) { err.textContent = 'הקוד הוא 6 ספרות.'; focusSoon(form.elements.code); return; }
    if (!f('password')) { err.textContent = 'יש לכתוב סיסמה.'; focusSoon(form.elements.password); return; }
    if (join && f('password').length < 8) { err.textContent = 'הסיסמה צריכה להיות באורך 8 תווים לפחות.'; focusSoon(form.elements.password); return; }
    err.textContent = ''; btn.disabled = true;
    try {
      var r = await call('POST', join ? 'join' : 'login', join
        ? { email: f('email'), code: f('code'), password: f('password') }
        : { email: f('email'), password: f('password') });
      await signedIn(r, 'password');
    } catch (e) {
      err.textContent = e.message; btn.disabled = false;
    }
  }

  /* ---------- passkeys: fingerprint or face ---------- */
  function b64u(buf) {
    var u = new Uint8Array(buf), s = '';
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function credList(list) { return (list || []).map(function (c) { return Object.assign({}, c, { id: unb64u(c.id) }); }); }
  function credJSON(c) {
    var r = c.response;
    var out = { id: c.id, rawId: b64u(c.rawId), type: c.type, response: { clientDataJSON: b64u(r.clientDataJSON) },
      clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {} };
    if (c.authenticatorAttachment) out.authenticatorAttachment = c.authenticatorAttachment;
    if (r.attestationObject) {
      out.response.attestationObject = b64u(r.attestationObject);
      if (r.getTransports) out.response.transports = r.getTransports();
    }
    if (r.authenticatorData) {
      out.response.authenticatorData = b64u(r.authenticatorData);
      out.response.signature = b64u(r.signature);
      if (r.userHandle) out.response.userHandle = b64u(r.userHandle);
    }
    return out;
  }
  async function bioCheck() {
    try {
      S.bioAvail = !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (e) { S.bioAvail = false; }
  }
  function bioCancelled(e) { return e && (e.name === 'NotAllowedError' || e.name === 'AbortError'); }
  async function bioLogin(btn) {
    var info = bioInfo(), err = $('[data-auth-form] [data-err]');
    if (btn) btn.disabled = true;
    try {
      var o = await call('POST', 'passkey/options', { kind: 'login', credId: info && info.id });
      var opt = Object.assign({}, o.options, { challenge: unb64u(o.options.challenge), allowCredentials: credList(o.options.allowCredentials) });
      var cred = await navigator.credentials.get({ publicKey: opt });
      var r = await call('POST', 'passkey/login', { ticket: o.ticket, response: credJSON(cred) });
      lsSet(BIO_KEY, JSON.stringify({ email: r.user.email, id: cred.id }));
      await signedIn(r, 'passkey');
    } catch (e) {
      if (e && e.code === 'unknown_passkey') { lsDel(BIO_KEY); render(true); toast(e.message); return; }
      if (err) err.textContent = bioCancelled(e) ? 'הכניסה בוטלה. אפשר לנסות שוב או להיכנס עם סיסמה.' : (e && e.message) || 'הכניסה לא הצליחה. נסו שוב או היכנסו עם סיסמה.';
      if (btn) btn.disabled = false;
    }
  }
  async function bioEnable() {
    try {
      var o = await call('POST', 'passkey/options', { kind: 'register' });
      var opt = Object.assign({}, o.options, {
        challenge: unb64u(o.options.challenge),
        user: Object.assign({}, o.options.user, { id: unb64u(o.options.user.id) }),
        excludeCredentials: credList(o.options.excludeCredentials)
      });
      var cred = await navigator.credentials.create({ publicKey: opt });
      var r = await call('POST', 'passkey/register', { ticket: o.ticket, response: credJSON(cred) });
      S.user = r.user;
      lsSet(BIO_KEY, JSON.stringify({ email: S.user.email, id: r.id }));
      saveToken();   // from now on the token lasts until the app closes
      toast('הכניסה הביומטרית הופעלה במכשיר הזה');
      return true;
    } catch (e) {
      if (e && e.name === 'InvalidStateError') toast('כבר יש כניסה ביומטרית רשומה במכשיר הזה. כבו אותה והפעילו שוב.');
      else toast(bioCancelled(e) ? 'ההפעלה בוטלה.' : (e && e.message) || 'ההפעלה לא הצליחה. נסו שוב.');
      return false;
    }
  }
  async function bioDisable() {
    var info = bioInfo();
    if (info) {
      try { var r = await call('POST', 'passkey/remove', { id: info.id }); S.user = r.user; }
      catch (e) { if (e.code === 'auth') return; }
    }
    lsDel(BIO_KEY); saveToken();
    toast('הכניסה הביומטרית כובתה במכשיר הזה');
  }
  function offerBio() {
    if (!S.bioAvail || bioInfo() || lsGet(BIO_SKIP_KEY)) return;
    openSheet(head('כניסה מהירה', 'בפעם הבאה אפשר להיכנס עם טביעת אצבע או זיהוי פנים, בלי סיסמה.') +
      '<p class="hint">האפליקציה תבקש אישור בכל פתיחה במכשיר הזה. אפשר לשנות את זה בכל רגע בלשונית ההגדרות.</p>' +
      '<button class="btn btn-primary btn-block" data-yes>להפעיל</button>' +
      '<button class="btn btn-quiet btn-block" data-no>לא עכשיו</button>',
      function (d) {
        d.querySelector('[data-yes]').addEventListener('click', async function (e) {
          e.target.disabled = true;
          if (await bioEnable()) closeSheet(); else e.target.disabled = false;
        });
        d.querySelector('[data-no]').addEventListener('click', function () { lsSet(BIO_SKIP_KEY, '1'); closeSheet(); });
      });
  }

  /* ---------- push notifications ---------- */
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function standalone() { return navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches); }
  // relink: tell the server this device's subscription belongs to whoever just signed in
  async function pushCheck(relink) {
    var st;
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) st = isIOS() && !standalone() ? 'ios-home' : 'unsupported';
      else if (Notification.permission === 'denied') st = 'denied';
      else {
        var reg = await navigator.serviceWorker.getRegistration();
        var sub = reg ? await reg.pushManager.getSubscription() : null;
        st = sub && Notification.permission === 'granted' ? 'on' : 'off';
        if (sub && relink && S.token) call('POST', 'push/subscribe', { subscription: sub.toJSON() }).catch(function () {});
      }
    } catch (e) { st = 'unsupported'; }
    S.push = st;
    if (S.tab === 'settings') render(true);
  }
  async function pushEnable() {
    try {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast(perm === 'denied' ? 'ההתראות נחסמו בדפדפן.' : 'ההתראות לא הופעלו.'); return pushCheck(); }
      var reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      var k = await call('GET', 'push/key');
      var sub = await reg.pushManager.getSubscription() ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(unb64u(k.key)) });
      await call('POST', 'push/subscribe', { subscription: sub.toJSON() });
      toast('ההתראות הופעלו במכשיר הזה');
    } catch (e) {
      toast((e && e.message && e.code) ? e.message : 'לא הצלחנו להפעיל התראות במכשיר הזה.');
    }
    return pushCheck();
  }
  async function pushDisable() {
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      var sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) { await call('POST', 'push/unsubscribe', { endpoint: sub.endpoint }).catch(function () {}); await sub.unsubscribe(); }
      toast('ההתראות כובו במכשיר הזה');
    } catch (e) { toast('לא הצלחנו לכבות את ההתראות.'); }
    return pushCheck();
  }
  async function pushTest(btn) {
    btn.disabled = true;
    try {
      var r = await call('POST', 'push/test');
      toast(r.sent ? 'נשלחה התראת ניסיון' : 'לא נמצא מכשיר פעיל להתראות. כבו והפעילו שוב.');
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  }

  /* ---------- install to the home screen ---------- */
  // A card on phones that opened the app in the browser. Opened from the home-screen icon (standalone), it never shows.
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; renderInstall(); });
  window.addEventListener('appinstalled', function () { installEvt = null; lsSet(INSTALL_KEY, 'installed'); renderInstall(); });
  function isPhone() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || isIOS(); }
  function wantInstall() {
    if (standalone() || !isPhone()) return false;
    var h = lsGet(INSTALL_KEY);
    return !(h === 'installed' || (h && Number(h) > Date.now()));
  }
  function renderInstall() {
    var el = $('#install');
    if (!wantInstall()) { el.hidden = true; el.innerHTML = ''; return; }
    var how = installEvt ? 'אייקון במסך הבית שנפתח ישר לתקציב, במסך מלא.'
      : (isIOS() ? 'לוחצים על ' + ICON.share + ' (שיתוף) ובוחרים "הוספה למסך הבית".'
        : 'בתפריט הדפדפן (⋮) בוחרים "הוספה למסך הבית" או "התקנת אפליקציה".');
    el.innerHTML = '<img src="/icon-192.png" alt="">' +
      '<div class="install-text"><b>שמירת Mor בטלפון</b>' + how + '</div>' +
      (installEvt ? '<button class="btn btn-primary btn-small" data-act="install">התקנה</button>' : '') +
      '<button class="x" data-act="install-hide" aria-label="הסתרה">' + ICON.x + '</button>';
    el.hidden = false;
  }
  async function install() {
    if (!installEvt) return;
    var e = installEvt; installEvt = null;
    try { e.prompt(); var r = await e.userChoice; if (r && r.outcome === 'accepted') lsSet(INSTALL_KEY, 'installed'); } catch (x) {}
    renderInstall();
  }

  /* ---------- settings actions ---------- */
  async function loadSettings() {
    pushCheck();
    if (S.user && S.user.role === 'owner') {
      try { S.members = (await call('GET', 'members')).members; } catch (e) { return; }
      if (S.tab === 'settings') render(true);
    }
  }
  async function memberAction(kind, email, btn) {
    if (btn) btn.disabled = true;
    try {
      if (kind === 'add') S.newCode = await call('POST', 'members', { email: email });
      else if (kind === 'code') S.newCode = await call('POST', 'members/code', { email: email });
      else { await call('POST', 'members/remove', { email: email }); if (S.newCode && S.newCode.email === email) S.newCode = null; toast('הוסר מהרשימה'); }
      S.members = (await call('GET', 'members')).members;
      render(true);
      return true;
    } catch (e) {
      if (btn) btn.disabled = false;
      var err = $('[data-add-member] + [data-err]');
      if (kind === 'add' && err) err.textContent = e.message; else toast(e.message);
      return false;
    }
  }
  function openPasswordSheet() {
    openSheet(head('שינוי סיסמה', 'אחרי השינוי, במכשירים אחרים צריך להיכנס שוב.') +
      '<form data-pw novalidate>' +
      '<label class="field"><span class="field-label">הסיסמה הנוכחית</span><input class="input" type="password" name="current" autocomplete="current-password" dir="ltr"></label>' +
      '<label class="field"><span class="field-label">סיסמה חדשה (8 תווים לפחות)</span><input class="input" type="password" name="next" autocomplete="new-password" dir="ltr"></label>' +
      '<p class="field-err" data-err role="alert"></p>' +
      '<button class="btn btn-primary btn-block" type="submit">שמירה</button></form>',
      function (d) {
        var form = d.querySelector('[data-pw]'), err = d.querySelector('[data-err]');
        form.addEventListener('submit', async function (e) {
          e.preventDefault();
          if (form.elements.next.value.length < 8) { err.textContent = 'הסיסמה החדשה צריכה להיות באורך 8 תווים לפחות.'; return; }
          var btn = form.querySelector('[type="submit"]'); btn.disabled = true;
          try {
            var r = await call('POST', 'password', { current: form.elements.current.value, next: form.elements.next.value });
            S.token = r.token; S.user = r.user; saveToken();
            closeSheet(); toast('הסיסמה עודכנה');
          } catch (x) { err.textContent = x.message; btn.disabled = false; }
        });
        focusSoon(form.elements.current);
      });
  }

  async function init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
    renderInstall();
    await bioCheck();
    S.token = loadToken();
    if (!S.token) { S.status = 'auth'; render(true); return; }
    loadCache();
    render(true);
    try { S.user = (await call('GET', 'me')).user; }
    catch (e) { if (e.code === 'auth') return; }
    await refresh(); poll();
    pushCheck(false);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t || t.disabled || dlg.contains(t)) return;
    var a = t.dataset.act;
    if (a === 'tab') return setTab(t.dataset.tab);
    if (a === 'prev' || a === 'next') {
      S.monthKey = shift(S.monthKey, a === 'prev' ? -1 : 1); S.followCur = S.monthKey === curKey(); return render(true);
    }
    if (a === 'today') { S.followCur = true; return render(true); }
    if (a === 'goto') { S.monthKey = t.dataset.k; S.followCur = S.monthKey === curKey(); return setTab('month'); }
    if (a === 'auth-view') { S.authView = t.dataset.view; return render(true); }
    if (a === 'bio-login') return bioLogin(t);
    if (a === 'install') return install();
    if (a === 'install-hide') { lsSet(INSTALL_KEY, String(Date.now() + 14 * 864e5)); return renderInstall(); }
    if (a === 'bio-on') { t.disabled = true; return bioEnable().then(function () { render(true); }); }
    if (a === 'bio-off') { t.disabled = true; return bioDisable().then(function () { render(true); }); }
    if (a === 'push-on') { t.disabled = true; return pushEnable(); }
    if (a === 'push-off') { t.disabled = true; return pushDisable(); }
    if (a === 'push-test') return pushTest(t);
    if (a === 'mem-code') return memberAction('code', t.dataset.email, t);
    if (a === 'mem-remove') {
      if (t.dataset.armed !== '1') { t.dataset.armed = '1'; t.textContent = 'להסיר?'; return; }
      return memberAction('remove', t.dataset.email, t);
    }
    if (a === 'password') return openPasswordSheet();
    if (a === 'signout-others') return signOutOthers(t);
    if (a === 'pk-remove') {
      if (t.dataset.armed !== '1') { t.dataset.armed = '1'; t.textContent = 'להסיר?'; return; }
      return removePasskey(t.dataset.id, t);
    }
    if (a === 'logout') return logout();
    if (!canAct()) return;
    if (a === 'card') return openCardSheet(t.dataset.id);
    if (a === 'income') return openIncomeSheet(t.dataset.id);
    if (a === 'extra') return openExtraSheet(t.dataset.id || null);
    if (a === 'plan-add' && S.draft) {
      var g = t.dataset.g; S.draft[g].push({ id: '', name: '', amount: '' }); S.draft.dirty = true;
      render(true);
      var rows = document.querySelectorAll('[data-plan-form] input[data-g="' + g + '"][data-f="name"]');
      if (rows.length) focusSoon(rows[rows.length - 1]);
      return;
    }
    if (a === 'plan-del' && S.draft) {
      S.draft[t.dataset.g].splice(+t.dataset.i, 1); S.draft.dirty = true; return render(true);
    }
    if (a === 'plan-cancel') { S.draft = null; return render(true); }
    if (a === 'plan-save') return savePlan();
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.matches && t.matches('[data-plan-form] input[data-cycle]') && S.draft) {
      S.draft.cycleDay = t.value; S.draft.dirty = true; t.removeAttribute('aria-invalid'); return refreshPlanTotals();
    }
    if (!t.matches || !t.matches('[data-plan-form] input[data-g]')) return;
    var row = S.draft && S.draft[t.dataset.g] && S.draft[t.dataset.g][+t.dataset.i];
    if (!row) return;
    row[t.dataset.f] = t.value; S.draft.dirty = true; t.removeAttribute('aria-invalid');
    refreshPlanTotals();
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.matches('[data-auth-form]')) { e.preventDefault(); return submitAuth(f); }
    if (f.matches('[data-add-member]')) {
      e.preventDefault();
      var email = f.elements.email.value.trim(), err = f.nextElementSibling;
      if (!email) { err.textContent = 'יש לכתוב אימייל.'; focusSoon(f.elements.email); return; }
      err.textContent = '';
      return memberAction('add', email, f.querySelector('[type="submit"]'));
    }
  });
  // poll only while the app is on screen; on return, fetch right away (and keep "today" honest after midnight)
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(pollTimer); return; }
    lastTouch = Date.now();
    if (S.tab !== 'plan') render();
    if (S.token) refresh().then(poll);
  });
  document.addEventListener('pointerdown', touched, true);
  document.addEventListener('keydown', touched, true);

  init();
})();
