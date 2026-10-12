import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { dateKey } from '../../frontend/js/stats.js';

// Each test gets a fresh in-memory database, its own server on a free port,
// and a registered user whose session `api()` sends by default.
let db;
let server;
let base;
let session;

async function start(database) {
  db = database;
  server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}/api`;
}

beforeEach(async () => {
  await start(openDb(':memory:'));
  session = await register('ayse@example.com');
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

// cookie: the session cookie to send (the default user's), or null for none.
async function api(method, path, body, cookie = session) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('wordcards_session='));
  return { status: res.status, data, cookie: setCookie?.split(';')[0] };
}

// Registers a user and returns their session cookie.
async function register(email, password = 'gizli-sifre') {
  const res = await api('POST', '/auth/register', { email, password }, null);
  assert.equal(res.status, 201);
  return res.cookie;
}

const createDeck = async (name = 'Verbs', level) => (await api('POST', '/decks', { name, level })).data;
const createCard = async (deckId, front = 'go', back = 'gitmek') =>
  (await api('POST', `/decks/${deckId}/cards`, { front, back })).data;

test('creates, lists, updates and deletes a deck', async () => {
  const created = await api('POST', '/decks', { name: '  English Verbs ', level: 'A1' });
  assert.equal(created.status, 201);
  assert.equal(created.data.name, 'English Verbs');
  assert.equal(created.data.level, 'A1');

  const { data: list } = await api('GET', '/decks');
  assert.deepEqual(list, [created.data]);

  const updated = await api('PATCH', `/decks/${created.data.id}`, { name: 'Fiiller', level: null });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.name, 'Fiiller');
  assert.equal(updated.data.level, null);

  assert.equal((await api('DELETE', `/decks/${created.data.id}`)).status, 204);
  assert.equal((await api('GET', `/decks/${created.data.id}`)).status, 404);
});

test('rejects an empty deck name and an unknown level', async () => {
  const empty = await api('POST', '/decks', { name: '   ' });
  assert.equal(empty.status, 400);
  assert.match(empty.data.error, /boş olamaz/);

  assert.equal((await api('POST', '/decks', { name: 'X', level: 'Z9' })).status, 400);
});

test('lists decks newest first', async () => {
  const first = await createDeck('First');
  await new Promise((r) => setTimeout(r, 5));
  const second = await createDeck('Second');
  const { data } = await api('GET', '/decks');
  assert.deepEqual(data.map((d) => d.id), [second.id, first.id]);
});

test('adds, edits and deletes cards', async () => {
  const deck = await createDeck();
  const card = await createCard(deck.id);
  assert.equal(card.deckId, deck.id);
  assert.equal(card.box, 0);
  assert.equal(card.lastReviewed, null);

  const edited = await api('PATCH', `/cards/${card.id}`, { back: 'gitmek, ilerlemek' });
  assert.equal(edited.data.back, 'gitmek, ilerlemek');
  assert.equal(edited.data.front, 'go');

  const { data: cards } = await api('GET', `/decks/${deck.id}/cards`);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].back, 'gitmek, ilerlemek');

  assert.equal((await api('DELETE', `/cards/${card.id}`)).status, 204);
  assert.equal((await api('DELETE', `/cards/${card.id}`)).status, 404);
});

test('adding a card to a missing deck returns 404', async () => {
  const res = await api('POST', '/decks/nope/cards', { front: 'a', back: 'b' });
  assert.equal(res.status, 404);
});

test('deleting a deck deletes its cards', async () => {
  const deck = await createDeck();
  await createCard(deck.id);
  await createCard(deck.id, 'eat', 'yemek');
  await api('DELETE', `/decks/${deck.id}`);
  assert.deepEqual((await api('GET', '/cards')).data, []);
});

test('a review moves the card between boxes and counts as activity', async () => {
  const deck = await createDeck();
  const card = await createCard(deck.id);

  const knew = await api('POST', `/cards/${card.id}/review`, { knew: true });
  assert.equal(knew.data.box, 1);
  assert.equal(knew.data.reviews, 1);
  assert.ok(knew.data.due > Date.now());

  const missed = await api('POST', `/cards/${card.id}/review`, { knew: false });
  assert.equal(missed.data.box, 0);
  assert.equal(missed.data.lapses, 1);

  const { data: stats } = await api('GET', '/stats');
  assert.equal(stats.today, 2);
  assert.equal(stats.currentStreak, 1);
  assert.deepEqual(stats.activity, { [dateKey()]: 2 });

  assert.equal((await api('POST', `/cards/${card.id}/review`, { knew: 'yes' })).status, 400);
});

test('practice activity is added to today', async () => {
  await api('POST', '/activity', {});
  const res = await api('POST', '/activity', { count: 4 });
  assert.equal(res.data.count, 5);
  assert.equal((await api('POST', '/activity', { count: 0 })).status, 400);
});

test('settings are merged', async () => {
  await api('PATCH', '/settings', { dailyGoal: 30, readTexts: ['a'] });
  const { data } = await api('PATCH', '/settings', { podcastSpeed: 1.25 });
  assert.deepEqual(data, { dailyGoal: 30, readTexts: ['a'], podcastSpeed: 1.25 });
});

test('imports ready-made decks in their original order', async () => {
  const res = await api('POST', '/presets/import', {
    presets: [{ id: 'a1-food', name: 'Yiyecek', level: 'A1', words: [['apple', 'elma'], ['bread', 'ekmek']] }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.data[0].presetId, 'a1-food');

  const { data: cards } = await api('GET', `/decks/${res.data[0].id}/cards`);
  assert.deepEqual(cards.map((c) => c.front), ['apple', 'bread']);
});

test('a bad preset rolls back the whole import', async () => {
  const res = await api('POST', '/presets/import', {
    presets: [
      { id: 'ok', name: 'OK', level: 'A1', words: [['a', 'b']] },
      { id: 'bad', name: 'Bad', level: 'Z9', words: [] },
    ],
  });
  assert.equal(res.status, 400);
  assert.deepEqual((await api('GET', '/decks')).data, []);
});

test('a backup can be restored', async () => {
  const deck = await createDeck('Verbs', 'B1');
  const card = await createCard(deck.id);
  await api('POST', `/cards/${card.id}/review`, { knew: true });
  await api('PATCH', '/settings', { dailyGoal: 50 });

  const { data: backup } = await api('GET', '/backup');
  assert.equal(backup.app, 'wordcards');
  assert.ok(backup.data.settings.lastBackup);

  // Wipe everything, then restore.
  await api('DELETE', `/decks/${deck.id}`);
  const restored = await api('POST', '/backup', backup);
  assert.deepEqual(restored.data, { decks: 1, cards: 1 });

  const { data: again } = await api('GET', '/backup');
  assert.deepEqual(again.data.decks, backup.data.decks);
  assert.deepEqual(again.data.cards, backup.data.cards);
  assert.deepEqual(again.data.activity, backup.data.activity);
  assert.equal(again.data.settings.dailyGoal, 50);
});

test('a backup made in the browser can be restored', async () => {
  // Shape written by frontend/js/storage.js exportBackup(); cards of a deleted
  // deck are skipped.
  const backup = {
    app: 'wordcards', version: 1, exportedAt: '2026-10-01T10:00:00.000Z',
    data: {
      decks: [{ id: 'd1', name: 'Food', level: 'A1', presetId: 'a1-food', createdAt: 1 }],
      cards: [
        { id: 'c1', deckId: 'd1', front: 'apple', back: 'elma', createdAt: 1, box: 2, due: 5, reviews: 3, lapses: 0, lastReviewed: 4 },
        { id: 'c2', deckId: 'gone', front: 'x', back: 'y', createdAt: 1, box: 0, due: 1, reviews: 0, lapses: 0, lastReviewed: null },
      ],
      activity: { '2026-09-30': 12 },
      settings: { posLabelsEn: true },
    },
  };
  const res = await api('POST', '/backup', backup);
  assert.deepEqual(res.data, { decks: 1, cards: 1 });
  assert.equal((await api('GET', '/cards')).data[0].box, 2);
  assert.deepEqual((await api('GET', '/stats')).data.activity, { '2026-09-30': 12 });
});

test('rejects files that are not backups and keeps the data', async () => {
  await createDeck();
  const res = await api('POST', '/backup', { app: 'other', data: {} });
  assert.equal(res.status, 400);
  assert.equal((await api('GET', '/decks')).data.length, 1);
});

test('returns JSON errors for bad JSON and unknown routes', async () => {
  const bad = await fetch(`${base}/decks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope',
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'Geçersiz JSON.');

  const missing = await api('GET', '/nothing');
  assert.equal(missing.status, 404);
  assert.ok(missing.data.error);
});

// --- Accounts ---

test('registers, reads the current user and logs out', async () => {
  const res = await api('POST', '/auth/register', { email: ' Mehmet@Example.com ', password: '12345678' }, null);
  assert.equal(res.status, 201);
  assert.equal(res.data.email, 'mehmet@example.com');
  assert.equal(res.data.password_hash, undefined);
  assert.match(res.cookie, /^wordcards_session=/);

  const me = await api('GET', '/auth/me', undefined, res.cookie);
  assert.deepEqual(me.data, res.data);

  assert.equal((await api('POST', '/auth/logout', undefined, res.cookie)).status, 204);
  assert.equal((await api('GET', '/auth/me', undefined, res.cookie)).status, 401);
});

test('data routes need a login', async () => {
  for (const [method, path] of [['GET', '/decks'], ['GET', '/cards'], ['GET', '/stats'], ['GET', '/backup']]) {
    const res = await api(method, path, undefined, null);
    assert.equal(res.status, 401, path);
    assert.equal(res.data.error, 'Lütfen giriş yapın.');
  }
  assert.equal((await api('GET', '/decks', undefined, 'wordcards_session=made-up')).status, 401);
});

test('rejects a taken email, a bad email and a short password', async () => {
  const taken = await api('POST', '/auth/register', { email: 'AYSE@example.com', password: '12345678' }, null);
  assert.equal(taken.status, 409);
  assert.equal((await api('POST', '/auth/register', { email: 'ayse', password: '12345678' }, null)).status, 400);
  const short = await api('POST', '/auth/register', { email: 'x@example.com', password: '1234567' }, null);
  assert.equal(short.status, 400);
  assert.match(short.data.error, /en az 8/);
});

test('logs in with the right password only', async () => {
  const wrong = await api('POST', '/auth/login', { email: 'ayse@example.com', password: 'yanlis-sifre' }, null);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.cookie, undefined);
  const unknown = await api('POST', '/auth/login', { email: 'kimse@example.com', password: 'gizli-sifre' }, null);
  assert.equal(unknown.data.error, wrong.data.error);

  const ok = await api('POST', '/auth/login', { email: 'Ayse@Example.com', password: 'gizli-sifre' }, null);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.email, 'ayse@example.com');
  assert.equal((await api('GET', '/decks', undefined, ok.cookie)).status, 200);
});

test('users only see their own data', async () => {
  const deck = await createDeck('Ayşe');
  const card = await createCard(deck.id);
  await api('PATCH', '/settings', { dailyGoal: 30 });
  await api('POST', '/activity', { count: 3 });

  const other = await register('ali@example.com');
  assert.deepEqual((await api('GET', '/decks', undefined, other)).data, []);
  assert.deepEqual((await api('GET', '/cards', undefined, other)).data, []);
  assert.deepEqual((await api('GET', '/settings', undefined, other)).data, {});
  assert.equal((await api('GET', '/stats', undefined, other)).data.today, 0);

  // Someone else's deck and card look the same as missing ones.
  assert.equal((await api('GET', `/decks/${deck.id}`, undefined, other)).status, 404);
  assert.equal((await api('PATCH', `/decks/${deck.id}`, { name: 'X' }, other)).status, 404);
  assert.equal((await api('DELETE', `/decks/${deck.id}`, undefined, other)).status, 404);
  assert.equal((await api('POST', `/decks/${deck.id}/cards`, { front: 'a', back: 'b' }, other)).status, 404);
  assert.equal((await api('PATCH', `/cards/${card.id}`, { back: 'X' }, other)).status, 404);
  assert.equal((await api('POST', `/cards/${card.id}/review`, { knew: true }, other)).status, 404);
  assert.equal((await api('DELETE', `/cards/${card.id}`, undefined, other)).status, 404);

  // A restore only replaces the restoring user's data.
  const { data: empty } = await api('GET', '/backup', undefined, other);
  await api('POST', '/backup', empty, other);
  assert.equal((await api('GET', '/cards')).data[0].back, 'gitmek');
  assert.equal((await api('GET', '/stats')).data.today, 3);
});

test('two users can restore the same backup', async () => {
  const deck = await createDeck();
  await createCard(deck.id);
  const { data: backup } = await api('GET', '/backup');

  const other = await register('ali@example.com');
  assert.deepEqual((await api('POST', '/backup', backup, other)).data, { decks: 1, cards: 1 });
  const [otherDeck] = (await api('GET', '/decks', undefined, other)).data;
  const [otherCard] = (await api('GET', '/cards', undefined, other)).data;
  assert.notEqual(otherDeck.id, deck.id);
  assert.equal(otherCard.deckId, otherDeck.id);

  // The first user's data is untouched.
  assert.deepEqual((await api('GET', '/decks')).data, [deck]);
});

test('changing the password logs out other sessions', async () => {
  const phone = (await api('POST', '/auth/login', { email: 'ayse@example.com', password: 'gizli-sifre' }, null)).cookie;

  const wrong = await api('POST', '/auth/password', { currentPassword: 'yanlis-sifre', newPassword: 'yeni-sifre' });
  assert.equal(wrong.status, 401);
  const ok = await api('POST', '/auth/password', { currentPassword: 'gizli-sifre', newPassword: 'yeni-sifre' });
  assert.equal(ok.status, 204);

  assert.equal((await api('GET', '/auth/me')).status, 200);
  assert.equal((await api('GET', '/auth/me', undefined, phone)).status, 401);
  const old = await api('POST', '/auth/login', { email: 'ayse@example.com', password: 'gizli-sifre' }, null);
  assert.equal(old.status, 401);
  const fresh = await api('POST', '/auth/login', { email: 'ayse@example.com', password: 'yeni-sifre' }, null);
  assert.equal(fresh.status, 200);
});

test('deleting an account deletes its data', async () => {
  const deck = await createDeck();
  await createCard(deck.id);
  await api('POST', '/activity', {});

  assert.equal((await api('DELETE', '/auth/me', { password: 'yanlis-sifre' })).status, 401);
  assert.equal((await api('DELETE', '/auth/me', { password: 'gizli-sifre' })).status, 204);
  assert.equal((await api('GET', '/auth/me')).status, 401);
  for (const table of ['users', 'sessions', 'decks', 'cards', 'activity', 'settings']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
});

test('the first account gets the data saved before accounts', async () => {
  // A database file in the schema used before accounts existed.
  const dir = mkdtempSync(join(tmpdir(), 'wordcards-'));
  const path = join(dir, 'old.db');
  const old = new Database(path);
  old.exec(`
    CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT NOT NULL, level TEXT, preset_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE cards (
      id TEXT PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      front TEXT NOT NULL, back TEXT NOT NULL, created_at INTEGER NOT NULL, box INTEGER NOT NULL DEFAULT 0,
      due INTEGER NOT NULL, reviews INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0, last_reviewed INTEGER);
    CREATE INDEX cards_deck_id ON cards(deck_id);
    CREATE TABLE activity (day TEXT PRIMARY KEY, count INTEGER NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO decks VALUES ('d1', 'Eski', 'A1', NULL, 1);
    INSERT INTO cards VALUES ('c1', 'd1', 'go', 'gitmek', 1, 0, 1, 0, 0, NULL);
    INSERT INTO activity VALUES ('2026-09-30', 7);
    INSERT INTO settings VALUES ('dailyGoal', '20');
  `);
  old.close();

  await new Promise((resolve) => server.close(resolve));
  db.close();
  try {
    await start(openDb(path));
    session = await register('ilk@example.com');
    assert.deepEqual((await api('GET', '/decks')).data.map((d) => d.id), ['d1']);
    assert.equal((await api('GET', '/cards')).data[0].front, 'go');
    assert.deepEqual((await api('GET', '/stats')).data.activity, { '2026-09-30': 7 });
    assert.deepEqual((await api('GET', '/settings')).data, { dailyGoal: 20 });

    const second = await register('ikinci@example.com');
    assert.deepEqual((await api('GET', '/decks', undefined, second)).data, []);

    // Opening the file again doesn't run the migrations twice.
    assert.equal(db.pragma('user_version', { simple: true }), 2);
    openDb(path).close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
