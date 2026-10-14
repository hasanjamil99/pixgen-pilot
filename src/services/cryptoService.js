import crypto from 'node:crypto';
import { config } from '../config/env.js';

/*
 * Encrypts API keys and tokens before they are stored in MySQL (AES-256-GCM).
 * The key comes from SECRETS_KEY, falling back to SESSION_SECRET, then to the database
 * credentials. Changing it makes stored keys unreadable, so set SECRETS_KEY once and keep it.
 */
const KEY = crypto
  .createHash('sha256')
  .update(`pgp-secrets:${config.secretsKey || config.sessionSecret || `${config.db.user}:${config.db.password}:${config.db.name}`}`)
  .digest();

const PREFIX = 'v1';

export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

/** Returns the plain value, or null when empty or unreadable (e.g. the encryption key changed). */
export function decryptSecret(stored) {
  if (!stored) return null;
  const [prefix, iv, tag, data] = String(stored).split(':');
  if (prefix !== PREFIX || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    console.error('[crypto] Could not decrypt a stored secret. Was SECRETS_KEY changed?');
    return null;
  }
}

/** "AQ.Ab8R…mvCQ" style preview that never reveals the whole value. */
export function maskSecret(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 10) return '••••';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}
