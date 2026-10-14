import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config/env.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

const SESSION_KEY = sha256(`pgp-session:${config.sessionSecret || `${config.db.password}:${config.adminEmail}:${config.adminPassword}`}`);

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !stored) return false;
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

/** Changes whenever the password hash changes, so a new password logs out every old session. */
export function passwordVersion(passwordHash) {
  return sha256(passwordHash || '').toString('base64url').slice(0, 12);
}

const sign = (payload) => crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('base64url');

function encode(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function decode(token) {
  if (typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

/** Session token: signed {uid, pv, exp}. */
export function createSessionToken(user) {
  const exp = Date.now() + SESSION_TTL_MS;
  return { token: encode({ t: 's', uid: user.id, pv: passwordVersion(user.password_hash), exp }), expiresAt: new Date(exp).toISOString() };
}

export function readSessionToken(token) {
  const data = decode(token);
  return data && data.t === 's' ? data : null;
}

/** Short-lived signed state for the Facebook OAuth round trip (prevents CSRF). */
export function createOAuthState(data) {
  return encode({ t: 'o', ...data, exp: Date.now() + STATE_TTL_MS, n: crypto.randomBytes(8).toString('hex') });
}

export function readOAuthState(token) {
  const data = decode(token);
  return data && data.t === 'o' ? data : null;
}
