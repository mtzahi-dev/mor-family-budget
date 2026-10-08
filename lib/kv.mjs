// Key-value storage behind the API: Netlify Blobs in production, a Map in tests and local runs.
// Every value is JSON. Writes can be conditional on the version (etag) that was read.

export class Conflict extends Error {}

// kv.get(key) -> { data, etag } | null
// kv.set(key, data, { etag }) -> true, or false when the key changed since `etag` was read
//   (etag null means "only if the key does not exist yet").
// kv.list(prefix) -> [{ key, etag }]
// kv.delete(key)

export function blobsKV(store) {
  return {
    async get(key) {
      const r = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      return r ? { data: r.data, etag: r.etag } : null;
    },
    async set(key, data, opts) {
      let cond = {};
      if (opts && 'etag' in opts) cond = opts.etag ? { onlyIfMatch: opts.etag } : { onlyIfNew: true };
      const r = await store.setJSON(key, data, cond);
      return r.modified !== false;
    },
    async list(prefix) {
      const r = await store.list({ prefix });
      return r.blobs.map((b) => ({ key: b.key, etag: b.etag }));
    },
    async delete(key) { await store.delete(key); }
  };
}

export function memoryKV(seed = {}) {
  const map = new Map();
  let n = 0;
  const put = (key, data) => map.set(key, { data: JSON.parse(JSON.stringify(data)), etag: 'e' + (++n) });
  for (const [k, v] of Object.entries(seed)) put(k, v);
  return {
    map,
    async get(key) {
      const r = map.get(key);
      return r ? { data: JSON.parse(JSON.stringify(r.data)), etag: r.etag } : null;
    },
    async set(key, data, opts) {
      if (opts && 'etag' in opts) {
        const cur = map.get(key);
        if (opts.etag ? !cur || cur.etag !== opts.etag : cur) return false;
      }
      put(key, data);
      return true;
    },
    async list(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key, etag: map.get(key).etag }));
    },
    async delete(key) { map.delete(key); },
    dump() {
      const out = {};
      for (const [k, v] of map) out[k] = JSON.parse(JSON.stringify(v.data));
      return out;
    }
  };
}

// Read-modify-write that survives a concurrent writer: fn(current | undefined) returns the new
// value (or undefined to leave the key alone). Retries when someone else wrote in between.
export async function mutate(kv, key, fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const cur = await kv.get(key);
    const next = await fn(cur ? cur.data : undefined);
    if (next === undefined) return cur ? cur.data : undefined;
    if (await kv.set(key, next, { etag: cur ? cur.etag : null })) return next;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
  }
  throw new Conflict('busy: ' + key);
}
