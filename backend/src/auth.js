// Password hashing, sessions, and the middleware that requires a logged-in user.
// A session is a random token in an HttpOnly cookie; the database keeps only
// its SHA-256 hash.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { toUser } from './db.js';
import { HttpError } from './validate.js';

const scryptAsync = promisify(scrypt);

const SESSION_COOKIE = 'wordcards_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Stored as "scrypt$<salt>$<hash>" in hex.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'hex');
  const actual = await scryptAsync(password, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function readToken(req) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === SESSION_COOKIE && value) return value;
  }
  return null;
}

// Logs the user in on this response. Expired sessions are cleared here too.
export function startSession(db, res, userId) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, now + SESSION_MS);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: res.req.secure, path: '/', maxAge: SESSION_MS,
  });
}

export function endSession(db, req, res) {
  const token = readToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Logs the user out everywhere except on this request's session.
export function endOtherSessions(db, req) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
    .run(req.user.id, hashToken(readToken(req)));
}

// Sets req.user ({ id, email, createdAt }), or answers 401.
export function requireUser(db) {
  const find = db.prepare(`
    SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`);
  return (req, res, next) => {
    const token = readToken(req);
    const row = token && find.get(hashToken(token), Date.now());
    if (!row) throw new HttpError(401, 'Lütfen giriş yapın.');
    req.user = toUser(row);
    next();
  };
}
