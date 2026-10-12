import { Router } from 'express';
import { getSettings, saveSettings } from '../db.js';
import { body } from '../validate.js';

// Settings are a free-form object (daily goal, read texts, podcast speed …).
export default function settingsRouter(db) {
  const router = Router();

  router.get('/settings', (req, res) => {
    res.json(getSettings(db, req.user.id));
  });

  // Merges the given fields into the settings and returns all of them.
  router.patch('/settings', (req, res) => {
    saveSettings(db, req.user.id, body(req));
    res.json(getSettings(db, req.user.id));
  });

  return router;
}
