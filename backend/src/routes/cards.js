import { Router } from 'express';
import { review } from '../../../frontend/js/srs.js';
import { dateKey } from '../../../frontend/js/stats.js';
import { toCard, addActivity } from '../db.js';
import { HttpError, notFound, text, body } from '../validate.js';

export default function cardsRouter(db) {
  const router = Router();

  // Only the user's own cards are found; anyone else's answer 404.
  const findCard = (id, userId) => {
    const row = db.prepare(`
      SELECT cards.* FROM cards JOIN decks ON decks.id = cards.deck_id
      WHERE cards.id = ? AND decks.user_id = ?`).get(id, userId);
    if (!row) throw notFound('Kart');
    return toCard(row);
  };

  router.get('/cards', (req, res) => {
    const rows = db.prepare(`
      SELECT cards.* FROM cards JOIN decks ON decks.id = cards.deck_id
      WHERE decks.user_id = ? ORDER BY cards.rowid`).all(req.user.id);
    res.json(rows.map(toCard));
  });

  router.patch('/cards/:id', (req, res) => {
    const fields = body(req);
    const card = findCard(req.params.id, req.user.id);
    if ('front' in fields) card.front = text(fields.front, 'Kelime');
    if ('back' in fields) card.back = text(fields.back, 'Anlam');
    db.prepare('UPDATE cards SET front = ?, back = ? WHERE id = ?').run(card.front, card.back, card.id);
    res.json(card);
  });

  router.delete('/cards/:id', (req, res) => {
    const { changes } = db.prepare(`
      DELETE FROM cards WHERE id = ? AND deck_id IN (SELECT id FROM decks WHERE user_id = ?)`)
      .run(req.params.id, req.user.id);
    if (!changes) throw notFound('Kart');
    res.status(204).end();
  });

  // Saves a study answer: moves the card between Leitner boxes (srs.js) and
  // counts one review towards today's activity. Body: { knew: true | false }
  router.post('/cards/:id/review', (req, res) => {
    const { knew } = body(req);
    if (typeof knew !== 'boolean') throw new HttpError(400, '"knew" true ya da false olmalı.');
    const now = Date.now();
    const card = review(findCard(req.params.id, req.user.id), knew, now);
    db.transaction(() => {
      db.prepare(`
        UPDATE cards SET box = ?, due = ?, reviews = ?, lapses = ?, last_reviewed = ? WHERE id = ?`)
        .run(card.box, card.due, card.reviews, card.lapses, card.lastReviewed, card.id);
      addActivity(db, req.user.id, dateKey(now), 1);
    })();
    res.json(card);
  });

  return router;
}
