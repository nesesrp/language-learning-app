// SQLite connection, schema and row mapping.
// Rows use snake_case columns; the API returns the same camelCase objects the
// frontend keeps in localStorage, so storage.js can switch to fetch() as is.

import Database from 'better-sqlite3';

// Each migration upgrades the schema by one version (PRAGMA user_version).
// Databases made before versioning are at 0 with the first schema already in
// place, which is why the first migration uses IF NOT EXISTS.
const MIGRATIONS = [
  // 1: a single user's decks, cards, activity and settings
  `
  CREATE TABLE IF NOT EXISTS decks (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    level      TEXT,
    preset_id  TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id            TEXT PRIMARY KEY,
    deck_id       TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    front         TEXT NOT NULL,
    back          TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    box           INTEGER NOT NULL DEFAULT 0,
    due           INTEGER NOT NULL,
    reviews       INTEGER NOT NULL DEFAULT 0,
    lapses        INTEGER NOT NULL DEFAULT 0,
    last_reviewed INTEGER
  );
  CREATE INDEX IF NOT EXISTS cards_deck_id ON cards(deck_id);

  -- Number of reviews done on each day ("2026-10-02").
  CREATE TABLE IF NOT EXISTS activity (
    day   TEXT PRIMARY KEY,
    count INTEGER NOT NULL
  );

  -- Free-form settings; each value is stored as JSON.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // 2: user accounts. Decks, activity and settings belong to a user; cards
  // belong to a user through their deck. Rows from before accounts keep
  // user_id NULL until the first account to register claims them.
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  -- Only a hash of each session token is stored, so a copy of the database
  -- can't be used to log in.
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user_id ON sessions(user_id);

  ALTER TABLE decks ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
  CREATE INDEX decks_user_id ON decks(user_id);

  CREATE TABLE activity_new (
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    day     TEXT NOT NULL,
    count   INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  INSERT INTO activity_new (day, count) SELECT day, count FROM activity;
  DROP TABLE activity;
  ALTER TABLE activity_new RENAME TO activity;

  CREATE TABLE settings_new (
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  INSERT INTO settings_new (key, value) SELECT key, value FROM settings;
  DROP TABLE settings;
  ALTER TABLE settings_new RENAME TO settings;
  `,
];

// path: a file path, or ':memory:' for tests.
export function openDb(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true });
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

// Gives data from before accounts (user_id NULL) to the user.
export function claimUnownedData(db, userId) {
  for (const table of ['decks', 'activity', 'settings']) {
    db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(userId);
  }
}

export const toUser = (row) => ({
  id: row.id,
  email: row.email,
  createdAt: row.created_at,
});

export const toDeck = (row) => ({
  id: row.id,
  name: row.name,
  level: row.level,
  ...(row.preset_id ? { presetId: row.preset_id } : {}),
  createdAt: row.created_at,
});

export const toCard = (row) => ({
  id: row.id,
  deckId: row.deck_id,
  front: row.front,
  back: row.back,
  createdAt: row.created_at,
  box: row.box,
  due: row.due,
  reviews: row.reviews,
  lapses: row.lapses,
  lastReviewed: row.last_reviewed,
});

// Named parameters for the INSERT statements below.
export const deckParams = (deck, userId) => ({
  id: deck.id,
  user_id: userId,
  name: deck.name,
  level: deck.level ?? null,
  preset_id: deck.presetId ?? null,
  created_at: deck.createdAt,
});

export const cardParams = (card) => ({
  id: card.id,
  deck_id: card.deckId,
  front: card.front,
  back: card.back,
  created_at: card.createdAt,
  box: card.box,
  due: card.due,
  reviews: card.reviews,
  lapses: card.lapses,
  last_reviewed: card.lastReviewed ?? null,
});

export const INSERT_DECK = `
  INSERT INTO decks (id, user_id, name, level, preset_id, created_at)
  VALUES (@id, @user_id, @name, @level, @preset_id, @created_at)`;

export const INSERT_CARD = `
  INSERT INTO cards (id, deck_id, front, back, created_at, box, due, reviews, lapses, last_reviewed)
  VALUES (@id, @deck_id, @front, @back, @created_at, @box, @due, @reviews, @lapses, @last_reviewed)`;

// Adds `count` reviews to a day's activity.
export function addActivity(db, userId, day, count) {
  db.prepare(`
    INSERT INTO activity (user_id, day, count) VALUES (?, ?, ?)
    ON CONFLICT (user_id, day) DO UPDATE SET count = count + excluded.count`).run(userId, day, count);
}

export function getActivity(db, userId) {
  return Object.fromEntries(
    db.prepare('SELECT day, count FROM activity WHERE user_id = ? ORDER BY day').all(userId)
      .map((r) => [r.day, r.count]));
}

export function getSettings(db, userId) {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId)
      .map((r) => [r.key, JSON.parse(r.value)]));
}

// Merges fields into the user's settings.
export function saveSettings(db, userId, fields) {
  const upsert = db.prepare(`
    INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`);
  db.transaction(() => {
    for (const [key, value] of Object.entries(fields)) upsert.run(userId, key, JSON.stringify(value ?? null));
  })();
}
