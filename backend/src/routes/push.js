import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { vapidPublicKey } from '../push.js';

const router = Router();

router.get('/key', (_req, res) => res.json({ publicKey: vapidPublicKey }));

router.post('/subscribe', requireAuth, (req, res) => {
  const sub = req.body?.subscription;
  const endpoint = sub?.endpoint, p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid push subscription.' } });
  }
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(endpoint, req.userId, p256dh, auth);
  res.json({ ok: true });
});

router.post('/unsubscribe', requireAuth, (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint === 'string') db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.userId);
  res.json({ ok: true });
});

export default router;
