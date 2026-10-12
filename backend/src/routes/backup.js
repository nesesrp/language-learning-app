import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { newCardFields } from '../../../frontend/js/srs.js';
import {
  toDeck, toCard, deckParams, cardParams, INSERT_DECK, INSERT_CARD, getActivity, getSettings, saveSettings,
} from '../db.js';
import { HttpError, body, isObject } from '../validate.js';

// Same file format as the frontend's backup (storage.js), so a backup made in
// the browser can be restored on the server and the other way round.
const BACKUP_APP = 'wordcards';
const BACKUP_VERSION = 1;

const isText = (v) => typeof v === 'string';
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

export default function backupRouter(db) {
  const router = Router();

  router.get('/backup', (req, res) => {
    const userId = req.user.id;
    saveSettings(db, userId, { lastBackup: Date.now() });
    res.json({
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        decks: db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY created_at DESC')
          .all(userId).map(toDeck),
        cards: db.prepare(`
          SELECT cards.* FROM cards JOIN decks ON decks.id = cards.deck_id
          WHERE decks.user_id = ? ORDER BY cards.rowid`).all(userId).map(toCard),
        activity: getActivity(db, userId),
        settings: getSettings(db, userId),
      },
    });
  });

  // Replaces all of the user's data with a backup.
  router.post('/backup', (req, res) => {
    const backup = body(req);
    const data = backup.app === BACKUP_APP ? backup.data : null;
    const valid = isObject(data)
      && Array.isArray(data.decks) && data.decks.every((d) => isObject(d) && isText(d.id) && isText(d.name))
      && Array.isArray(data.cards) && data.cards.every((c) =>
        isObject(c) && isText(c.id) && isText(c.deckId) && isText(c.front) && isText(c.back))
      && (data.activity === undefined || isObject(data.activity))
      && (data.settings === undefined || isObject(data.settings));
    if (!valid) throw new HttpError(400, 'Bu dosya bir WordCards yedeği değil ya da bozuk.');
    if (backup.version > BACKUP_VERSION) {
      throw new HttpError(400, 'Bu yedek uygulamanın daha yeni bir sürümüyle alınmış.');
    }
    const unique = (items) => new Set(items.map((x) => x.id)).size === items.length;
    if (!unique(data.decks) || !unique(data.cards)) {
      throw new HttpError(400, 'Veri geçersiz ya da tekrar eden kayıt içeriyor.');
    }

    // Cards whose deck is missing can't be shown anywhere, so they are skipped.
    const deckIds = new Set(data.decks.map((d) => d.id));
    const cards = data.cards.filter((c) => deckIds.has(c.deckId));
    const now = Date.now();
    const userId = req.user.id;

    db.transaction(() => {
      // The deck's cards go with it (ON DELETE CASCADE).
      for (const table of ['decks', 'activity', 'settings']) {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      }
      // Ids are unique across all users, so an id that is already taken (e.g.
      // someone else restored the same file) gets a new one.
      const deckTaken = db.prepare('SELECT 1 FROM decks WHERE id = ?');
      const cardTaken = db.prepare('SELECT 1 FROM cards WHERE id = ?');
      const deckIdFor = new Map();
      const insertDeck = db.prepare(INSERT_DECK);
      for (const d of data.decks) {
        const id = deckTaken.get(d.id) ? randomUUID() : d.id;
        deckIdFor.set(d.id, id);
        insertDeck.run(deckParams({ ...d, id, createdAt: isNumber(d.createdAt) ? d.createdAt : now }, userId));
      }
      const insertCard = db.prepare(INSERT_CARD);
      for (const c of cards) {
        // Fill in scheduling fields that are missing or broken with a new card's.
        const fresh = { createdAt: now, ...newCardFields(now) };
        for (const key of Object.keys(fresh)) {
          if (isNumber(c[key]) || (key === 'lastReviewed' && c[key] === null)) fresh[key] = c[key];
        }
        const id = cardTaken.get(c.id) ? randomUUID() : c.id;
        insertCard.run(cardParams({ ...c, ...fresh, id, deckId: deckIdFor.get(c.deckId) }));
      }
      const insertDay = db.prepare('INSERT INTO activity (user_id, day, count) VALUES (?, ?, ?)');
      for (const [day, count] of Object.entries(data.activity ?? {})) {
        if (isNumber(count) && count > 0) insertDay.run(userId, day, count);
      }
      saveSettings(db, userId, data.settings ?? {});
    })();

    res.json({ decks: data.decks.length, cards: cards.length });
  });

  return router;
}
