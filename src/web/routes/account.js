import express from 'express';
import * as repo from '../../db/repository.js';
import { createSessionToken, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../../services/authService.js';
import { asyncRoute, httpError } from '../validation.js';

export function accountRouter() {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ user: repo.publicUser(req.user) });
  });

  router.put('/', asyncRoute(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name || name.length > 100) throw httpError('Enter your name (up to 100 characters).');
    const user = await repo.updateUser(req.user.id, { name });
    res.json({ user: repo.publicUser(user) });
  }));

  /** Changing the password ends every other session; the response carries a fresh token for this one. */
  router.put('/password', asyncRoute(async (req, res) => {
    const current = String(req.body?.currentPassword ?? '');
    const next = String(req.body?.newPassword ?? '');
    if (!(await verifyPassword(current, req.user.password_hash))) throw httpError('Your current password is wrong.');
    if (next.length < MIN_PASSWORD_LENGTH) throw httpError(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next.length > 200) throw httpError('The new password is too long.');
    const user = await repo.updateUser(req.user.id, { password_hash: await hashPassword(next) });
    res.json({ ...createSessionToken(user), user: repo.publicUser(user) });
  }));

  return router;
}
