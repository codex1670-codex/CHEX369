import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { coinsSummary, unlockItem, startStreak, setFrame } from '../coins.js';

const router = Router();

// Balance, this month's progress, store items and recent activity.
router.get('/me', requireAuth, (req, res) => res.json(coinsSummary(req.userId)));

// Spend coins to unlock a store item (checked and charged atomically).
router.post('/unlock', requireAuth, (req, res) => {
  const out = unlockItem(req.userId, String(req.body?.itemId || ''));
  if (out.error) return res.status(out.error.status).json({ error: { code: out.error.code, message: out.error.message } });
  res.json(coinsSummary(req.userId));
});

// Choose the animated frame around your avatar (`frame: null` removes it). Needs the frames unlock.
router.post('/frame', requireAuth, (req, res) => {
  const f = req.body?.frame;
  const out = setFrame(req.userId, f === null || f === undefined || f === '' ? null : String(f));
  if (out.error) return res.status(out.error.status).json({ error: { code: out.error.code, message: out.error.message } });
  res.json(coinsSummary(req.userId));
});

// Start (or restart) the 30-day posting streak from today. `timezone` = the device's IANA zone.
router.post('/streak/start', requireAuth, (req, res) => {
  const out = startStreak(req.userId, typeof req.body?.timezone === 'string' ? req.body.timezone : 'UTC');
  if (out.error) return res.status(out.error.status).json({ error: { code: out.error.code, message: out.error.message } });
  res.json(coinsSummary(req.userId));
});

export default router;
