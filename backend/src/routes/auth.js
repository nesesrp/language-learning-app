import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { toUser, claimUnownedData } from '../db.js';
import {
  hashPassword, verifyPassword, startSession, endSession, endOtherSessions, requireUser,
} from '../auth.js';
import { HttpError, body } from '../validate.js';

const MIN_PASSWORD = 8;
// scrypt hashes the whole password, so very long ones are refused.
const MAX_PASSWORD = 1000;

function email(value) {
  const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new HttpError(400, 'Geçerli bir e-posta adresi girin.');
  }
  return address;
}

function newPassword(value) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD) {
    throw new HttpError(400, `Şifre en az ${MIN_PASSWORD} karakter olmalı.`);
  }
  if (value.length > MAX_PASSWORD) throw new HttpError(400, 'Şifre çok uzun.');
  return value;
}

export default function authRouter(db) {
  const router = Router();
  const auth = requireUser(db);

  // Checks a password against the stored hash; a wrong one answers 401.
  async function checkPassword(userId, password, message) {
    const { password_hash: hash } = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (typeof password !== 'string' || !(await verifyPassword(password, hash))) {
      throw new HttpError(401, message);
    }
  }

  // Body: { email, password }. Logs the new user in.
  router.post('/auth/register', async (req, res) => {
    const fields = body(req);
    const user = { id: randomUUID(), email: email(fields.email), createdAt: Date.now() };
    const hash = await hashPassword(newPassword(fields.password));
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(user.email)) {
        throw new HttpError(409, 'Bu e-posta adresiyle zaten bir hesap var.');
      }
      // The first account gets the data saved before accounts existed.
      const first = !db.prepare('SELECT 1 FROM users').get();
      db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(user.id, user.email, hash, user.createdAt);
      if (first) claimUnownedData(db, user.id);
    })();
    startSession(db, res, user.id);
    res.status(201).json(user);
  });

  // Body: { email, password }
  router.post('/auth/login', async (req, res) => {
    const fields = body(req);
    const address = typeof fields.email === 'string' ? fields.email.trim().toLowerCase() : '';
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(address);
    const ok = row && typeof fields.password === 'string'
      && await verifyPassword(fields.password, row.password_hash);
    if (!ok) throw new HttpError(401, 'E-posta ya da şifre yanlış.');
    startSession(db, res, row.id);
    res.json(toUser(row));
  });

  router.post('/auth/logout', (req, res) => {
    endSession(db, req, res);
    res.status(204).end();
  });

  router.get('/auth/me', auth, (req, res) => {
    res.json(req.user);
  });

  // Body: { currentPassword, newPassword }. Other devices are logged out.
  router.post('/auth/password', auth, async (req, res) => {
    const fields = body(req);
    const password = newPassword(fields.newPassword);
    await checkPassword(req.user.id, fields.currentPassword, 'Mevcut şifre yanlış.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), req.user.id);
    endOtherSessions(db, req);
    res.status(204).end();
  });

  // Body: { password }. Deletes the account with all its decks, cards,
  // activity and settings (ON DELETE CASCADE).
  router.delete('/auth/me', auth, async (req, res) => {
    await checkPassword(req.user.id, body(req).password, 'Şifre yanlış.');
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    endSession(db, req, res);
    res.status(204).end();
  });

  return router;
}
