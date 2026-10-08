// The whole server: sign-in, family members, passkeys, budget data and push notifications.
// createApi(deps).handle(Request) -> Response, used by the Netlify function and the local server.
import { createHash } from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse
} from '@simplewebauthn/server';
import { checkPassword, hashCode, hashPassword, newCode, randomId, safeEqual, sign, unsign } from './auth.mjs';
import { Conflict, mutate } from './kv.mjs';
import core from '../public/core.js';

const DAY = 864e5;
const TOKEN_DAYS = 60;
const CODE_DAYS = 7;
const CODE_TRIES = 5;
const LOGIN_TRIES = 5;
const LOCK_MIN = 15;
const NOTIFY_EVERY = 3 * DAY - 3 * 36e5;   // every third evening, with slack for the hourly run
const NOTIFY_HOUR = 19;                     // Israel time
const MAX_BODY = 300 * 1024;
const MIN_PASSWORD = 8;
const LOG_CAP = 80;
const SUBS_PER_MEMBER = 6;

const K = {
  plan: 'budget/plan',
  members: 'family/members',
  secret: 'family/secret',
  used: 'family/used',
  vapid: 'family/vapid',
  subs: 'push/subs',
  notify: 'notify/state'
};
const MONTH_KEY = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const MONTH_PATH = /^months\/(\d{4}-(?:0[1-9]|1[0-2]))$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,200}\.[^\s@]{2,}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
// The push services browsers actually use. Anything else could make the server call arbitrary hosts.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/;

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || 'error'; }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
const bad = () => fail(400, 'בקשה לא תקינה.', 'bad_request');

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
const normEmail = (e) => String(e || '').trim().toLowerCase();
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e10;
const str = (v, max) => typeof v === 'string' && v.length <= max;
const round2 = (n) => Math.round(n * 100) / 100;
const isTime = (t) => str(t, 40) && !Number.isNaN(Date.parse(t));

// No key anywhere in a request may reach an object's prototype.
function safeKeys(x, depth = 0) {
  if (depth > 12) bad();
  if (Array.isArray(x)) { x.forEach((v) => safeKeys(v, depth + 1)); return; }
  if (!x || typeof x !== 'object') return;
  for (const k of Object.keys(x)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') bad();
    safeKeys(x[k], depth + 1);
  }
}

function checkPlan(p) {
  if (!isObj(p) || Object.keys(p).some((k) => !['versions', 'cycleDay', 'updatedAt'].includes(k))) bad();
  if (!Number.isInteger(p.cycleDay) || p.cycleDay < 1 || p.cycleDay > 28) bad();
  if (p.updatedAt !== undefined && !str(p.updatedAt, 40)) bad();
  if (!isObj(p.versions) || Object.keys(p.versions).length > 240) bad();
  for (const [k, v] of Object.entries(p.versions)) {
    if (!MONTH_KEY.test(k) || !isObj(v)) bad();
    for (const g of ['income', 'fixed', 'cards']) {
      const list = v[g], amt = g === 'cards' ? 'budget' : 'amount';
      if (!Array.isArray(list) || list.length > 100) bad();
      for (const it of list) if (!isObj(it) || !ID.test(it.id) || !str(it.name, 100) || !num(it[amt])) bad();
    }
  }
}

export function createApi(deps) {
  const kv = deps.kv;
  const now = deps.now || (() => new Date());
  const tz = deps.tz || 'Asia/Jerusalem';
  const onWrite = deps.onWrite || (() => {});
  const pusher = deps.push;   // { generateKeys(), send(sub, payloadString, vapid) } -> rejects with { statusCode }
  const pushHosts = deps.pushHosts || PUSH_HOSTS;
  // In production the site's own address: passkeys are bound to it, and other hosts (old draft deploys) are refused.
  const origin = deps.origin ? new URL(deps.origin) : null;

  /* ---------- shared state in kv ---------- */
  let secretKey = null;
  async function secret() {
    if (!secretKey) secretKey = (await mutate(kv, K.secret, (cur) => (cur ? undefined : { key: randomId(32) }))).key;
    return secretKey;
  }
  async function members() {
    const r = await kv.get(K.members);
    return (r && Array.isArray(r.data.members)) ? r.data.members : [];
  }
  // fn(list) edits the members in place; return false from fn to skip the write
  async function editMembers(fn) {
    let out;
    await mutate(kv, K.members, (cur) => {
      const doc = cur && Array.isArray(cur.members) ? cur : { members: [] };
      out = fn(doc.members);
      return out === false ? undefined : doc;
    });
    return out;
  }
  const find = (list, email) => list.find((m) => m.email === email);

  /* ---------- tokens ---------- */
  // A token names the member and their session id (sid). A new sid signs out every device at once:
  // joining again, changing the password, "sign out everywhere", or being removed and re-added.
  async function issue(m, kind) {
    const exp = now().getTime() + TOKEN_DAYS * DAY;
    return { token: sign(await secret(), { e: m.email, s: m.sid || '', x: exp, k: kind }), user: me(m) };
  }
  async function session(req) {
    const h = req.headers.get('authorization') || '';
    const p = unsign(await secret(), h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!p || typeof p.x !== 'number' || p.x < now().getTime()) fail(401, 'צריך להיכנס שוב.', 'auth');
    const m = find(await members(), p.e);
    if (!m || !m.pw || !m.sid || !safeEqual(m.sid, String(p.s || ''))) fail(401, 'צריך להיכנס שוב.', 'auth');
    return m;
  }
  function me(m) {
    return { email: m.email, role: m.role, passkeys: (m.passkeys || []).map((k) => ({ id: k.id, at: k.at, used: k.used || null })) };
  }

  /* ---------- body ---------- */
  async function body(req) {
    const text = await req.text();
    if (text.length > MAX_BODY) fail(413, 'הנתונים גדולים מדי.', 'too_big');
    if (!text) return {};
    let b;
    try { b = JSON.parse(text); } catch { bad(); }
    if (!isObj(b)) bad();
    safeKeys(b);
    return b;
  }

  /* ---------- sign-in ---------- */
  const LOCKED = 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.';
  async function login(req) {
    const b = await body(req);
    const email = normEmail(b.email), pw = String(b.password || '');
    const t = now().getTime();
    // Count the attempt before checking the password, so parallel guesses can't slip past the lock.
    let state = 'unknown';
    try {
      await editMembers((list) => {
        const x = find(list, email);
        if (!x || !x.pw) { state = 'unknown'; return false; }
        if (x.lockUntil && x.lockUntil > t) { state = 'locked'; return false; }
        x.fails = (x.fails || 0) + 1;
        if (x.fails >= LOGIN_TRIES) { x.fails = 0; x.lockUntil = t + LOCK_MIN * 60e3; }
        state = 'try';
      });
    } catch (e) { if (e instanceof Conflict) fail(429, LOCKED, 'locked'); throw e; }
    if (state === 'locked') fail(429, LOCKED, 'locked');
    const m = find(await members(), email);
    if (!(await checkPassword(pw, state === 'try' && m ? m.pw : null)) || !m) fail(401, 'האימייל או הסיסמה לא נכונים.', 'bad_login');
    await editMembers((list) => { const x = find(list, email); if (!x) return false; x.fails = 0; x.lockUntil = null; });
    return json(await issue(m, 'pw'));
  }

  // Joining with a code sets a new password, drops old passkeys and signs out every other device.
  async function join(req) {
    const b = await body(req);
    const email = normEmail(b.email), code = String(b.code || '').trim(), pw = String(b.password || '');
    if (pw.length < MIN_PASSWORD) fail(400, 'הסיסמה צריכה להיות באורך ' + MIN_PASSWORD + ' תווים לפחות.', 'weak_password');
    const t = now().getTime();
    const hashed = await hashPassword(pw);
    let result = 'bad';
    const m = await editMembers((list) => {
      const x = find(list, email);
      const inv = x && x.invite;
      if (!inv || inv.exp < t || inv.tries >= CODE_TRIES) { result = 'bad'; return false; }
      if (!safeEqual(hashCode(code, inv.salt), inv.hash)) { inv.tries = (inv.tries || 0) + 1; result = 'wrong'; return x; }
      Object.assign(x, { pw: hashed, invite: null, sid: randomId(16), passkeys: [], fails: 0, lockUntil: null, joinedAt: new Date(t).toISOString() });
      result = 'ok';
      return x;
    });
    if (result !== 'ok') fail(401, 'הקוד לא נכון או שפג תוקפו. אפשר לבקש קוד חדש ממי שהזמין אותך.', 'bad_code');
    return json(await issue(m, 'pw'));
  }

  async function changePassword(req, m) {
    const b = await body(req);
    const next = String(b.next || '');
    if (next.length < MIN_PASSWORD) fail(400, 'הסיסמה החדשה צריכה להיות באורך ' + MIN_PASSWORD + ' תווים לפחות.', 'weak_password');
    if (!(await checkPassword(String(b.current || ''), m.pw))) fail(401, 'הסיסמה הנוכחית לא נכונה.', 'bad_login');
    const hashed = await hashPassword(next);
    const x = await editMembers((list) => { const y = find(list, m.email); y.pw = hashed; y.sid = randomId(16); return y; });
    return json(await issue(x, 'pw'));   // other devices sign in again
  }

  async function signOutOthers(m) {
    const x = await editMembers((list) => { const y = find(list, m.email); y.sid = randomId(16); return y; });
    return json(await issue(x, 'pw'));
  }

  /* ---------- family members (owner only) ---------- */
  function owner(m) { if (m.role !== 'owner') fail(403, 'רק מי שמנהל את האפליקציה יכול לעשות את זה.', 'forbidden'); }
  function invite() {
    const code = newCode(), salt = randomId(8);
    const inv = { salt, hash: hashCode(code, salt), exp: now().getTime() + CODE_DAYS * DAY, tries: 0 };
    return { code, inv };
  }
  async function listMembers(m) {
    owner(m);
    const t = now().getTime();
    return json({ members: (await members()).map((x) => ({
      email: x.email, role: x.role, joined: !!x.pw,
      invite: x.invite && x.invite.exp > t && x.invite.tries < CODE_TRIES ? { exp: new Date(x.invite.exp).toISOString() } : null,
      passkeys: (x.passkeys || []).length
    })) });
  }
  async function addMember(req, m) {
    owner(m);
    const email = normEmail((await body(req)).email);
    if (!EMAIL.test(email)) fail(400, 'כתובת האימייל לא תקינה.', 'bad_email');
    const { code, inv } = invite();
    const added = await editMembers((list) => {
      if (find(list, email) || list.length >= 12) return false;
      list.push({ email, role: 'member', pw: null, sid: randomId(16), invite: inv, passkeys: [], addedAt: now().toISOString() });
      return true;
    });
    if (!added) fail(409, 'האימייל הזה כבר ברשימה.', 'exists');
    return json({ email, code, exp: new Date(inv.exp).toISOString() });
  }
  async function newMemberCode(req, m) {
    owner(m);
    const email = normEmail((await body(req)).email);
    const { code, inv } = invite();
    const ok = await editMembers((list) => { const x = find(list, email); if (!x) return false; x.invite = inv; return true; });
    if (!ok) fail(404, 'האימייל הזה לא ברשימה.', 'not_found');
    return json({ email, code, exp: new Date(inv.exp).toISOString() });
  }
  async function removeMember(req, m) {
    owner(m);
    const email = normEmail((await body(req)).email);
    if (email === m.email) fail(400, 'אי אפשר להסיר את עצמך.', 'self');
    const ok = await editMembers((list) => {
      const i = list.findIndex((x) => x.email === email);
      if (i < 0) return false;
      list.splice(i, 1); return true;
    });
    if (!ok) fail(404, 'האימייל הזה לא ברשימה.', 'not_found');
    await mutate(kv, K.subs, (cur) => (cur ? { subs: (cur.subs || []).filter((s) => s.email !== email) } : undefined));
    return json({ ok: true });
  }

  /* ---------- passkeys (fingerprint / face) ---------- */
  function rp(req) {
    const u = origin || new URL(req.url);
    return { id: u.hostname, origin: u.origin };
  }
  async function ticket(payload) { return sign(await secret(), { ...payload, n: randomId(9), x: now().getTime() + 5 * 60e3 }); }
  async function readTicket(t, kind) {
    const p = unsign(await secret(), t);
    if (!p || p.p !== kind || p.x < now().getTime()) fail(400, 'הזמן לאישור עבר. נסו שוב.', 'expired');
    return p;
  }
  // Each challenge works once, so a captured sign-in can't be replayed.
  async function spend(challenge) {
    const h = createHash('sha256').update(challenge).digest('base64url'), t = now().getTime();
    let fresh = false;
    await mutate(kv, K.used, (cur) => {
      const list = ((cur && cur.list) || []).filter((x) => x.x > t);
      fresh = !list.some((x) => x.h === h);
      if (!fresh) return undefined;
      return { list: list.concat([{ h, x: t + 10 * 60e3 }]).slice(-500) };
    });
    if (!fresh) fail(400, 'הזמן לאישור עבר. נסו שוב.', 'expired');
  }

  async function passkeyOptions(req) {
    const b = await body(req), r = rp(req);
    if (b.kind === 'register') {
      const m = await session(req);
      let uid = m.uid;
      if (!uid) { uid = randomId(16); await editMembers((list) => { find(list, m.email).uid = uid; }); }
      const options = await generateRegistrationOptions({
        rpName: 'התקציב של משפחת מור', rpID: r.id, userName: m.email, userDisplayName: m.email,
        userID: Buffer.from(uid, 'base64url'), attestationType: 'none',
        excludeCredentials: (m.passkeys || []).map((k) => ({ id: k.id, transports: k.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' }
      });
      return json({ options, ticket: await ticket({ p: 'reg', c: options.challenge, e: m.email }) });
    }
    const allow = typeof b.credId === 'string' && b.credId.length < 600 ? [{ id: b.credId }] : [];
    const options = await generateAuthenticationOptions({ rpID: r.id, userVerification: 'required', allowCredentials: allow });
    return json({ options, ticket: await ticket({ p: 'auth', c: options.challenge }) });
  }

  async function passkeyRegister(req) {
    const m = await session(req);
    const b = await body(req), r = rp(req);
    const t = await readTicket(b.ticket, 'reg');
    if (t.e !== m.email) bad();
    let v;
    try {
      v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: t.c, expectedOrigin: r.origin, expectedRPID: r.id, requireUserVerification: true });
    } catch { v = null; }
    if (!v || !v.verified) fail(400, 'לא הצלחנו לאמת את טביעת האצבע. נסו שוב.', 'passkey_failed');
    await spend(t.c);
    const cred = v.registrationInfo.credential;
    const rec = { id: cred.id, publicKey: Buffer.from(cred.publicKey).toString('base64url'), counter: cred.counter,
      transports: cred.transports || [], at: now().toISOString() };
    const x = await editMembers((list) => {
      const y = find(list, m.email);
      y.passkeys = (y.passkeys || []).filter((k) => k.id !== rec.id).concat([rec]).slice(-10);
      return y;
    });
    return json({ id: rec.id, user: me(x) });
  }

  async function passkeyLogin(req) {
    const b = await body(req), r = rp(req);
    const t = await readTicket(b.ticket, 'auth');
    const id = b.response && typeof b.response.id === 'string' ? b.response.id : '';
    const list = await members();
    const m = list.find((x) => x.pw && (x.passkeys || []).some((k) => k.id === id));
    const key = m && m.passkeys.find((k) => k.id === id);
    if (!key) fail(401, 'טביעת האצבע הזו לא רשומה. היכנסו עם סיסמה והפעילו אותה מחדש.', 'unknown_passkey');
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response: b.response, expectedChallenge: t.c, expectedOrigin: r.origin, expectedRPID: r.id, requireUserVerification: true,
        credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')), counter: key.counter, transports: key.transports }
      });
    } catch { v = null; }
    if (!v || !v.verified) fail(401, 'לא הצלחנו לאמת את טביעת האצבע. נסו שוב או היכנסו עם סיסמה.', 'passkey_failed');
    await spend(t.c);
    const fresh = await editMembers((l) => {
      const y = find(l, m.email); const k = y && (y.passkeys || []).find((z) => z.id === id);
      if (!k) return false;
      k.counter = v.authenticationInfo.newCounter; k.used = now().toISOString();
      return y;
    });
    if (!fresh) fail(401, 'טביעת האצבע הזו לא רשומה. היכנסו עם סיסמה והפעילו אותה מחדש.', 'unknown_passkey');
    return json(await issue(fresh, 'pk'));
  }

  async function passkeyRemove(req, m) {
    const id = String((await body(req)).id || '');
    const x = await editMembers((list) => { const y = find(list, m.email); y.passkeys = (y.passkeys || []).filter((k) => k.id !== id); return y; });
    return json({ user: me(x) });
  }

  /* ---------- budget data ---------- */
  async function loadBudget() {
    const [plan, list] = await Promise.all([kv.get(K.plan), kv.list('months/')]);
    const docs = await Promise.all(list.map((b) => kv.get(b.key)));
    const months = {};
    list.forEach((b, i) => { if (docs[i]) months[b.key.slice('months/'.length)] = docs[i].data; });
    return { plan, list, months };
  }
  async function getData(req) {
    const url = new URL(req.url);
    const [plan, list] = await Promise.all([kv.get(K.plan), kv.list('months/')]);
    const rev = createHash('sha1').update((plan ? plan.etag : '-') + '|' + list.map((b) => b.key + ':' + b.etag).join(',')).digest('base64url');
    if (url.searchParams.get('rev') === rev) return json({ rev, unchanged: true });
    const docs = await Promise.all(list.map((b) => kv.get(b.key)));
    const months = {};
    list.forEach((b, i) => { if (docs[i]) months[b.key.slice('months/'.length)] = docs[i].data; });
    return json({ rev, plan: plan ? plan.data : null, months });
  }

  // One change to a month doc, applied to the stored doc so two people saving at once both land:
  //   card:  { id, op: 'set' (running total) | 'add' (a charge on top of the latest total) | 'remove', t, a, n }
  //          n names the update, so a retried request is applied once
  //   extra: { op: 'put' | 'remove', id, name, amount }
  //   patch: { income: { id: amount | null } }
  function monthChange(b) {
    if (b.card !== undefined) {
      const c = b.card;
      if (!isObj(c) || !ID.test(c.id) || !['set', 'add', 'remove'].includes(c.op) || !isTime(c.t) || !num(c.a)) bad();
      if (c.op !== 'remove' && !(typeof c.n === 'string' && ID.test(c.n))) bad();
      return (doc) => {
        doc.cards = isObj(doc.cards) ? doc.cards : {};
        const cur = isObj(doc.cards[c.id]) && Array.isArray(doc.cards[c.id].log) ? doc.cards[c.id].log.filter((e) => isObj(e) && num(e.a) && str(e.t, 40)) : [];
        cur.sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
        let log = cur;
        if (c.op === 'remove') {
          const i = cur.findIndex((e) => e.t === c.t && e.a === c.a);
          if (i >= 0) log = cur.slice(0, i).concat(cur.slice(i + 1));
        } else if (!cur.some((e) => e.n === c.n)) {
          const base = c.op === 'add' && cur.length ? cur[cur.length - 1].a : 0;
          log = cur.concat([{ t: c.t, a: round2(base + c.a), n: c.n }]).slice(-LOG_CAP);
        }
        doc.cards[c.id] = { log };
      };
    }
    if (b.extra !== undefined) {
      const x = b.extra;
      if (!isObj(x) || !['put', 'remove'].includes(x.op) || !ID.test(x.id)) bad();
      if (x.op === 'put' && (!str(x.name, 100) || !x.name.trim() || !num(x.amount))) bad();
      return (doc) => {
        let list = Array.isArray(doc.extras) ? doc.extras.filter(isObj) : [];
        if (x.op === 'remove') list = list.filter((e) => e.id !== x.id);
        else {
          const item = { id: x.id, name: x.name.trim(), amount: round2(x.amount) };
          list = list.some((e) => e.id === x.id) ? list.map((e) => (e.id === x.id ? item : e)) : list.concat([item]);
          if (list.length > 100) bad();
        }
        doc.extras = list;
      };
    }
    const p = b.patch;
    if (!isObj(p) || Object.keys(p).length !== 1 || !isObj(p.income)) bad();
    for (const [id, v] of Object.entries(p.income)) if (!ID.test(id) || !(v === null || num(v))) bad();
    return (doc) => {
      doc.income = isObj(doc.income) ? doc.income : {};
      for (const [id, v] of Object.entries(p.income)) doc.income[id] = v === null ? null : round2(v);
    };
  }

  async function writeDoc(req) {
    const b = await body(req);
    const path = String(b.path || '');
    if (path === K.plan) {
      checkPlan(b.patch);
      await kv.set(K.plan, b.patch);
      onWrite({ op: 'set', path });
      return json({ doc: b.patch });
    }
    const mm = MONTH_PATH.exec(path);
    if (!mm) bad();
    const apply = monthChange(b);
    let op;
    const doc = await mutate(kv, path, (cur) => {
      op = cur ? 'update' : 'set';
      const d = cur ? cur : { month: mm[1] };
      apply(d);
      if (JSON.stringify(d).length > MAX_BODY) fail(413, 'הנתונים גדולים מדי.', 'too_big');
      return d;
    });
    onWrite({ op, path });
    return json({ doc });
  }

  /* ---------- push notifications ---------- */
  async function vapid() {
    return mutate(kv, K.vapid, (cur) => (cur ? undefined : pusher.generateKeys()));
  }
  async function subscribe(req, m) {
    const s = (await body(req)).subscription;
    let host = '';
    try { const u = new URL(s.endpoint); if (u.protocol === 'https:' && !u.port) host = u.hostname; } catch {}
    if (!host || !pushHosts.test(host) || !str(s.endpoint, 1000) || !isObj(s.keys) || !str(s.keys.p256dh, 200) || !str(s.keys.auth, 100) || !s.keys.p256dh || !s.keys.auth) bad();
    const rec = { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, email: m.email, at: now().toISOString() };
    await mutate(kv, K.subs, (cur) => {
      const others = ((cur && cur.subs) || []).filter((x) => x.endpoint !== rec.endpoint);
      const mine = others.filter((x) => x.email === m.email).concat([rec]).slice(-SUBS_PER_MEMBER);
      return { subs: others.filter((x) => x.email !== m.email).concat(mine) };
    });
    return json({ ok: true });
  }
  async function unsubscribe(req, m) {
    const endpoint = String((await body(req)).endpoint || '');
    await mutate(kv, K.subs, (cur) => (cur ? { subs: (cur.subs || []).filter((x) => !(x.endpoint === endpoint && x.email === m.email)) } : undefined));
    return json({ ok: true });
  }
  // The status notification. force: send now, to `email`'s devices only, and leave the schedule alone.
  async function notify({ force = false, email = null } = {}) {
    const t = now();
    if (!force) {
      if (core.wall(t, tz).getHours() !== NOTIFY_HOUR) return { sent: 0, reason: 'not_hour' };
      const st = await kv.get(K.notify);
      if (st && st.data.lastSent && t - new Date(st.data.lastSent) < NOTIFY_EVERY) return { sent: 0, reason: 'not_due' };
    }
    const { plan, months } = await loadBudget();
    const msg = core.statusMessage(plan ? plan.data : null, months, t, tz);
    if (!msg) return { sent: 0, reason: 'no_plan' };
    const subsDoc = await kv.get(K.subs);
    const subs = ((subsDoc && subsDoc.data.subs) || []).filter((s) => !email || s.email === email);
    const keys = await vapid();
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: '/' });
    const dead = [];
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try { await pusher.send({ endpoint: s.endpoint, keys: s.keys }, payload, keys); sent++; }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(s.endpoint); }
    }));
    if (dead.length) await mutate(kv, K.subs, (cur) => (cur ? { subs: (cur.subs || []).filter((x) => !dead.includes(x.endpoint)) } : undefined));
    if (!force) await kv.set(K.notify, { lastSent: t.toISOString(), sent });
    return { sent, removed: dead.length, message: msg };
  }

  /* ---------- router ---------- */
  const routes = {
    'POST login': login,
    'POST join': join,
    'POST passkey/options': passkeyOptions,
    'POST passkey/register': passkeyRegister,
    'POST passkey/login': passkeyLogin,
    'GET push/key': async () => json({ key: (await vapid()).publicKey }),
    'GET me': async (req) => json({ user: me(await session(req)) }),
    'POST password': async (req) => changePassword(req, await session(req)),
    'POST signout-others': async (req) => signOutOthers(await session(req)),
    'POST passkey/remove': async (req) => passkeyRemove(req, await session(req)),
    'GET members': async (req) => listMembers(await session(req)),
    'POST members': async (req) => addMember(req, await session(req)),
    'POST members/code': async (req) => newMemberCode(req, await session(req)),
    'POST members/remove': async (req) => removeMember(req, await session(req)),
    'GET data': async (req) => { await session(req); return getData(req); },
    'POST doc': async (req) => { await session(req); return writeDoc(req); },
    'POST push/subscribe': async (req) => subscribe(req, await session(req)),
    'POST push/unsubscribe': async (req) => unsubscribe(req, await session(req)),
    'POST push/test': async (req) => { const m = await session(req); return json(await notify({ force: true, email: m.email })); }
  };

  async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
    const fn = routes[req.method + ' ' + path];
    try {
      if (!fn || (origin && url.host !== origin.host)) fail(404, 'לא נמצא.', 'not_found');
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      if (e instanceof Conflict) return json({ error: 'busy', message: 'השרת עמוס כרגע. נסו שוב בעוד רגע.' }, 503);
      (deps.log || console.error)(e);
      return json({ error: 'server', message: 'משהו השתבש בשרת. נסו שוב בעוד רגע.' }, 500);
    }
  }

  return { handle, notify, members, editMembers, invite };
}
