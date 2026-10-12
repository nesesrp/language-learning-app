import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { newCardFields } from '../../../frontend/js/srs.js';
import { toDeck, toCard, deckParams, cardParams, INSERT_DECK, INSERT_CARD } from '../db.js';
import { HttpError, notFound, text, level, body, isObject } from '../validate.js';

export default function decksRouter(db) {
  const router = Router();

  // Only the user's own decks are found; anyone else's answer 404.
  const findDeck = (id, userId) => {
    const row = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) throw notFound('Deste');
    return row;
  };

  router.get('/decks', (req, res) => {
    const rows = db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json(rows.map(toDeck));
  });

  router.post('/decks', (req, res) => {
    const { name, level: lvl } = body(req);
    const deck = { id: randomUUID(), name: text(name, 'Deste adı'), level: level(lvl), createdAt: Date.now() };
    db.prepare(INSERT_DECK).run(deckParams(deck, req.user.id));
    res.status(201).json(deck);
  });

  router.get('/decks/:id', (req, res) => {
    res.json(toDeck(findDeck(req.params.id, req.user.id)));
  });

  // Rename a deck or change its level.
  router.patch('/decks/:id', (req, res) => {
    const fields = body(req);
    const deck = toDeck(findDeck(req.params.id, req.user.id));
    if ('name' in fields) deck.name = text(fields.name, 'Deste adı');
    if ('level' in fields) deck.level = level(fields.level);
    db.prepare('UPDATE decks SET name = ?, level = ? WHERE id = ?').run(deck.name, deck.level, deck.id);
    res.json(deck);
  });

  // The deck's cards are deleted with it (ON DELETE CASCADE).
  router.delete('/decks/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!changes) throw notFound('Deste');
    res.status(204).end();
  });

  router.get('/decks/:id/cards', (req, res) => {
    findDeck(req.params.id, req.user.id);
    const rows = db.prepare('SELECT * FROM cards WHERE deck_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json(rows.map(toCard));
  });

  router.post('/decks/:id/cards', (req, res) => {
    const { front, back } = body(req);
    findDeck(req.params.id, req.user.id);
    const now = Date.now();
    const card = {
      id: randomUUID(), deckId: req.params.id,
      front: text(front, 'Kelime'), back: text(back, 'Anlam'),
      createdAt: now, ...newCardFields(now),
    };
    db.prepare(INSERT_CARD).run(cardParams(card));
    res.status(201).json(card);
  });

  // Copies ready-made decks (frontend/data/wordlist.json) into the user's decks
  // with fresh cards, all in one transaction.
  // Body: { presets: [{ id, name, level, words: [[front, back], ...] }] }
  router.post('/presets/import', (req, res) => {
    const { presets } = body(req);
    const valid = Array.isArray(presets) && presets.length && presets.every((p) =>
      isObject(p) && typeof p.id === 'string' && Array.isArray(p.words)
      && p.words.every((w) => Array.isArray(w) && typeof w[0] === 'string' && typeof w[1] === 'string'));
    if (!valid) throw new HttpError(400, 'Geçersiz hazır deste listesi.');

    const insertDeck = db.prepare(INSERT_DECK);
    const insertCard = db.prepare(INSERT_CARD);
    const now = Date.now();
    const decks = db.transaction(() => presets.map((preset) => {
      const deck = {
        id: randomUUID(), name: text(preset.name, 'Deste adı'), level: level(preset.level),
        presetId: preset.id, createdAt: now,
      };
      insertDeck.run(deckParams(deck, req.user.id));
      // Cards are listed newest first, so count down to keep the preset's order.
      preset.words.forEach(([front, back], i) => {
        insertCard.run(cardParams({
          id: randomUUID(), deckId: deck.id, front, back, createdAt: now - i, ...newCardFields(now),
        }));
      });
      return deck;
    }))();
    res.status(201).json(decks);
  });

  return router;
}
