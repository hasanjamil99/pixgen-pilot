import express from 'express';
import * as repo from '../db/repository.js';
import { createSessionToken, hashPassword, passwordVersion, readSessionToken, verifyPassword } from '../services/authService.js';
import { asyncRoute } from './validation.js';

const MAX_LOGIN_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFailures = new Map(); // ip -> { count, resetAt }
// Checked when the email is unknown, so a wrong email takes as long as a wrong password.
const dummyHash = hashPassword('pgp-dummy-password');

function isLockedOut(ip) {
  const entry = loginFailures.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginFailures.delete(ip);
    return false;
  }
  return entry.count >= MAX_LOGIN_FAILURES;
}

function recordFailure(ip) {
  const entry = loginFailures.get(ip);
  if (!entry || Date.now() > entry.resetAt) loginFailures.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  else entry.count += 1;
}

/** Resolves the bearer token to an active user (req.user). Old sessions die when the password changes. */
export async function authenticate(req) {
  const header = req.get('authorization') || '';
  const session = readSessionToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!session) return null;
  const user = await repo.getUserById(session.uid);
  if (!user || user.status !== 'active' || passwordVersion(user.password_hash) !== session.pv) return null;
  return user;
}

export const requireAuth = asyncRoute(async (req, res, next) => {
  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  req.user = user;
  return next();
});

export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') return res.status(403).json({ error: 'Only the super admin can do this.' });
  return next();
}

export function authRouter() {
  const router = express.Router();

  router.post('/login', asyncRoute(async (req, res) => {
    if (isLockedOut(req.ip)) return res.status(429).json({ error: 'Too many failed sign-in attempts. Try again in 15 minutes.' });
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = email ? await repo.getUserByEmail(email) : null;
    const valid = await verifyPassword(password, user ? user.password_hash : await dummyHash) && Boolean(user);
    if (!valid) {
      recordFailure(req.ip);
      return res.status(401).json({ error: 'Wrong email or password.' });
    }
    if (user.status !== 'active') return res.status(403).json({ error: 'This account is disabled. Contact the administrator.' });
    loginFailures.delete(req.ip);
    await repo.touchLogin(user.id);
    const { token, expiresAt } = createSessionToken(user);
    return res.json({ token, expiresAt, user: repo.publicUser(user) });
  }));

  return router;
}
