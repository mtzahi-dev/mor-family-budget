// Maintenance against the live Blobs store, using the Netlify CLI's sign-in on this computer.
//   node dev/live.mjs code <email>      new join code for that email (creates the owner when the list is empty)
//   node dev/live.mjs import <dir>      copy plan.json and months/*.json from <dir> into an empty store
// Prints only what the person needs (the code); never secrets or amounts.
import { getStore } from '@netlify/blobs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createApi } from '../lib/api.mjs';
import { randomId } from '../lib/auth.mjs';
import { blobsKV } from '../lib/kv.mjs';

async function store() {
  const site = JSON.parse(await readFile(new URL('../.netlify/state.json', import.meta.url), 'utf8')).siteId;
  const cfg = JSON.parse(await readFile(join(process.env.APPDATA || join(process.env.HOME, '.config'), 'netlify', 'Config', 'config.json'), 'utf8'));
  const token = cfg.users[cfg.userId].auth.token;
  return blobsKV(getStore({ name: 'budget', siteID: site, token, consistency: 'strong' }));
}

const [cmd, arg] = process.argv.slice(2);
const kv = await store();

if (cmd === 'code') {
  const email = String(arg || '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('usage: node dev/live.mjs code <email>');
  const api = createApi({ kv, push: null });
  const { code, inv } = api.invite();
  await api.editMembers((list) => {
    let m = list.find((x) => x.email === email);
    if (!m) {
      m = { email, role: list.length ? 'member' : 'owner', pw: null, sid: randomId(16), passkeys: [], addedAt: new Date().toISOString() };
      list.push(m);
    }
    m.invite = inv;
  });
  console.log(email + ' join code: ' + code + ' (valid 7 days)');
} else if (cmd === 'import') {
  if (await kv.get('budget/plan')) throw new Error('the live store already has a plan; not overwriting');
  const plan = JSON.parse(await readFile(join(arg, 'budget', 'plan.json'), 'utf8'));
  if (!plan.versions) throw new Error('plan.json has no versions');
  const files = (await readdir(join(arg, 'months'))).filter((f) => /^\d{4}-\d{2}\.json$/.test(f));
  for (const f of files) {
    const doc = JSON.parse(await readFile(join(arg, 'months', f), 'utf8'));
    const key = 'months/' + f.slice(0, 7);
    if (!(await kv.set(key, { ...doc, month: f.slice(0, 7) }, { etag: null }))) throw new Error(key + ' already exists');
  }
  await kv.set('budget/plan', plan, { etag: null });
  console.log('imported the plan and ' + files.length + ' month(s)');
} else {
  console.log('usage: node dev/live.mjs code <email> | import <dir>');
}
