// Local server: the same API as Netlify, over an in-memory store, plus the files in public/.
//   npm run dev            -> http://localhost:5230, signed in as the dev user below
// Tests start it in-process through startServer().
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../lib/api.mjs';
import { hashPassword, randomId } from '../lib/auth.mjs';
import { memoryKV } from '../lib/kv.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

// Fictional sign-in for local runs only. The real app has no such user.
export const DEV_USER = { email: 'dev@example.test', password: 'dev-password' };

export async function member(email, password, role = 'member', extra = {}) {
  return { email, role, pw: password ? await hashPassword(password) : null, sid: randomId(16), invite: null, passkeys: [], addedAt: '2026-01-01T00:00:00Z', ...extra };
}

// A push sender that records instead of sending.
export function fakePush() {
  const sent = [];
  return {
    sent,
    generateKeys: () => ({ publicKey: 'BFakeVapidPublicKeyForLocalRunsOnly', privateKey: 'fake' }),
    send: async (sub, payload) => {
      if (sub.endpoint.includes('/gone/')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    }
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export function startServer({ kv = memoryKV(), push = fakePush(), now, port = 0, onWrite } = {}) {
  const writes = [];
  const api = createApi({ kv, push, now, pushHosts: /^push\.example\.test$/, onWrite: (w) => { writes.push(w); if (onWrite) onWrite(w); }, log: () => {} });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://' + req.headers.host);
      if (url.pathname.startsWith('/api/')) {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        const r = await api.handle(new Request(url, { method: req.method, headers: req.headers, body }));
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      let file = decodeURIComponent(url.pathname);
      if (file.endsWith('/')) file += 'index.html';
      const full = normalize(join(PUBLIC, file));
      if (!full.startsWith(normalize(PUBLIC))) { res.writeHead(403).end(); return; }
      const data = await readFile(full);
      res.writeHead(200, { 'content-type': TYPES[extname(full)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch (e) {
      res.writeHead(e && e.code === 'ENOENT' ? 404 : 500).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const url = 'http://localhost:' + server.address().port;
      resolve({ url, kv, push, api, writes, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const { DEMO_DOCS } = await import('./demo.mjs');
  const kv = memoryKV({ ...DEMO_DOCS, 'family/members': { members: [await member(DEV_USER.email, DEV_USER.password, 'owner')] } });
  const port = Number(process.env.PORT) || 5230;
  const s = await startServer({ kv, port });
  console.log('Mor budget running at ' + s.url + '  (sign in: ' + DEV_USER.email + ' / ' + DEV_USER.password + ')');
}
