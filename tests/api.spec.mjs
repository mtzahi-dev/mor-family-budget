// The api on its own: validation, merging, two people saving at once, and the security fixes.
import { seed } from '../dev/demo.mjs';
import { fakePush, member } from '../dev/server.mjs';
import { createApi } from '../lib/api.mjs';
import { memoryKV } from '../lib/kv.mjs';
import { OWNER, PARTNER, expect, login, serve, test } from './fixtures.mjs';

async function client(server, who = OWNER) {
  const token = await login(server, who);
  return async (method, path, body) => {
    const r = await fetch(server.url + '/api/' + path, { method,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
}
const T = '2026-10-07T09:00:00.000Z';

test('only the plan and month documents can be written, in the expected shape', async () => {
  const server = await serve(seed());
  const call = await client(server);
  for (const path of ['family/members', 'months/2026-13', 'months/../family/secret', 'budget/other']) {
    expect((await call('POST', 'doc', { path, patch: { income: {} } })).status, path).toBe(400);
  }
  const month = 'months/2026-10';
  for (const body of [
    { patch: { secret: 1 } },
    { patch: { income: { in_a: 'lots' } } },
    { card: { id: 'cc_a', op: 'set', t: 'yesterday', a: 5, n: 'u1' } },
    { card: { id: 'cc_a', op: 'set', t: T, a: '5', n: 'u1' } },
    { card: { id: 'cc a', op: 'set', t: T, a: 5, n: 'u1' } },
    { extra: { op: 'put', id: 'ex_1', name: '', amount: 5 } }
  ]) expect((await call('POST', 'doc', { path: month, ...body })).status, JSON.stringify(body)).toBe(400);
  expect((await call('POST', 'doc', { path: 'budget/plan', patch: { cycleDay: 5 } })).status).toBe(400);   // a plan needs versions
  expect((await call('POST', 'doc', { path: 'budget/plan', patch: { cycleDay: 40, versions: {} } })).status).toBe(400);
  await server.close();
});

test('no request can reach an object prototype', async () => {
  const server = await serve(seed());
  const call = await client(server);
  const r = await fetch(server.url + '/api/doc', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await login(server, OWNER) },
    body: '{"path":"months/2026-10","patch":{"income":{"__proto__":{"lockUntil":9000000000000}}}}' });
  expect(r.status).toBe(400);
  expect(({}).lockUntil).toBeUndefined();
  expect((await call('GET', 'me')).status).toBe(200);
  await server.close();
});

test('cards saved at the same moment all stay, and charges added at once add up', async () => {
  const server = await serve(seed());
  const call = await client(server);
  await call('POST', 'doc', { path: 'months/2026-10', card: { id: 'cc_a', op: 'set', t: T, a: 1000, n: 'u0' } });
  await Promise.all([
    call('POST', 'doc', { path: 'months/2026-10', card: { id: 'cc_a', op: 'add', t: '2026-10-07T10:00:00.000Z', a: 100, n: 'u1' } }),
    call('POST', 'doc', { path: 'months/2026-10', card: { id: 'cc_a', op: 'add', t: '2026-10-07T10:00:00.001Z', a: 250, n: 'u2' } }),
    call('POST', 'doc', { path: 'months/2026-10', card: { id: 'cc_b', op: 'set', t: T, a: 200, n: 'u3' } }),
    call('POST', 'doc', { path: 'months/2026-10', patch: { income: { in_a: 9000 } } }),
    call('POST', 'doc', { path: 'months/2026-10', extra: { op: 'put', id: 'ex_1', name: 'בונוס', amount: 300 } })
  ]);
  const doc = server.kv.dump()['months/2026-10'];
  expect(doc.month).toBe('2026-10');
  expect(doc.cards.cc_a.log.map((e) => e.a)).toEqual([1000, 1100, 1350]);
  expect(doc.cards.cc_b.log[0].a).toBe(200);
  expect(doc.income.in_a).toBe(9000);
  expect(doc.extras).toEqual([{ id: 'ex_1', name: 'בונוס', amount: 300 }]);
  await server.close();
});

test('a retried charge is added once', async () => {
  const server = await serve(seed());
  const call = await client(server);
  const once = { path: 'months/2026-10', card: { id: 'cc_a', op: 'add', t: T, a: 120, n: 'u_same' } };
  await call('POST', 'doc', once);
  await call('POST', 'doc', once);
  expect(server.kv.dump()['months/2026-10'].cards.cc_a.log.map((e) => e.a)).toEqual([120]);
  await server.close();
});

test('polling with an unchanged version is cheap', async () => {
  const server = await serve(seed());
  const call = await client(server);
  const first = await call('GET', 'data');
  expect(first.body.plan.cycleDay).toBe(1);
  const again = await call('GET', 'data?rev=' + encodeURIComponent(first.body.rev));
  expect(again.body).toEqual({ rev: first.body.rev, unchanged: true });
  await call('POST', 'doc', { path: 'months/2026-10', extra: { op: 'put', id: 'ex_1', name: 'החזר', amount: 50 } });
  const changed = await call('GET', 'data?rev=' + encodeURIComponent(first.body.rev));
  expect(changed.body.unchanged).toBeUndefined();
  expect(Object.keys(changed.body.months)).toEqual(['2026-10']);
  await server.close();
});

test('parallel password guesses still stop at the lock', async () => {
  const server = await serve(seed());
  const guess = (password) => fetch(server.url + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER.email, password }) }).then((r) => r.status);
  const statuses = await Promise.all([...Array(20).keys()].map((i) => guess('wrong-' + i)).concat([guess(OWNER.password)]));
  expect(statuses.filter((s) => s !== 429).length).toBeLessThanOrEqual(5);
  await server.close();
});

test('someone removed and invited again cannot use their old session', async () => {
  const server = await serve(seed(), { partner: true });
  const oldToken = await login(server, PARTNER);
  const owner = await client(server);
  await owner('POST', 'members/remove', { email: PARTNER.email });
  const { body: inv } = await owner('POST', 'members', { email: PARTNER.email });
  await fetch(server.url + '/api/join', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: PARTNER.email, code: inv.code, password: 'a-new-password-2' }) });
  const r = await fetch(server.url + '/api/me', { headers: { authorization: 'Bearer ' + oldToken } });
  expect(r.status).toBe(401);
  await server.close();
});

test('sign out everywhere else keeps only this device', async () => {
  const server = await serve(seed());
  const other = await login(server, OWNER);
  const call = await client(server);
  const r = await call('POST', 'signout-others');
  expect(r.status).toBe(200);
  expect((await fetch(server.url + '/api/me', { headers: { authorization: 'Bearer ' + other } })).status).toBe(401);
  expect((await fetch(server.url + '/api/me', { headers: { authorization: 'Bearer ' + r.body.token } })).status).toBe(200);
  await server.close();
});

test('push subscriptions only go to real push services', async () => {
  const kv = memoryKV({ ...seed(), 'family/members': { members: [await member(OWNER.email, OWNER.password, 'owner')] } });
  const api = createApi({ kv, push: fakePush() });   // the production allow-list
  const req = (path, body, token) => new Request('https://site.example/api/' + path, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const { token } = await (await api.handle(req('login', OWNER))).json();
  const sub = (endpoint) => api.handle(req('push/subscribe', { subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } }, token)).then((r) => r.status);
  expect(await sub('https://169.254.169.254/latest/meta-data')).toBe(400);
  expect(await sub('https://evil.example/fcm.googleapis.com')).toBe(400);
  expect(await sub('http://fcm.googleapis.com/fcm/send/x')).toBe(400);
  expect(await sub('https://fcm.googleapis.com/fcm/send/abc')).toBe(200);
  expect(await sub('https://web.push.apple.com/abc')).toBe(200);
});

test('with the site address pinned, other hosts get nothing', async () => {
  const kv = memoryKV(seed());
  const api = createApi({ kv, push: fakePush(), origin: 'https://mor.example' });
  expect((await api.handle(new Request('https://draft--mor.example/api/push/key'))).status).toBe(404);
  expect((await api.handle(new Request('https://mor.example/api/push/key'))).status).toBe(200);
});
