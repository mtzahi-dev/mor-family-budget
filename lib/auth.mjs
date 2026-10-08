// Passwords, join codes and signed tokens. Node's crypto only.
import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptKey(pw, salt) {
  return new Promise((resolve, reject) => {
    scrypt(String(pw).normalize('NFC'), salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key.toString('base64url'))));
  });
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function hashPassword(pw) {
  const salt = randomBytes(16).toString('base64url');
  return { salt, hash: await scryptKey(pw, salt) };
}

// Always runs scrypt, so a wrong email takes as long as a wrong password.
export async function checkPassword(pw, rec) {
  const hash = await scryptKey(pw, rec && rec.salt ? rec.salt : 'no-such-user');
  return !!(rec && rec.hash) && safeEqual(hash, rec.hash);
}

// Six digits, read aloud or sent in a message. Stored only as a salted hash.
export function newCode() { return String(randomInt(0, 1000000)).padStart(6, '0'); }
export function hashCode(code, salt) { return createHash('sha256').update(salt + ':' + String(code).trim()).digest('base64url'); }
export function randomId(bytes = 16) { return randomBytes(bytes).toString('base64url'); }

export function sign(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}

export function unsign(secret, token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  if (!safeEqual(mac, createHmac('sha256', secret).update(body).digest('base64url'))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}
