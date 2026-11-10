import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import db from '../db.js';
import { coinsSummary, unlockItem, startStreak, setFrame, sendGift, GIFT_RULES, LEARN_LANGUAGES } from '../coins.js';
import { isBlocked } from './users.js';

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

// What can be gifted (for the Send-a-gift screen).
router.get('/gift-options', requireAuth, (_req, res) => res.json({ rules: GIFT_RULES, languages: LEARN_LANGUAGES }));

// Send a gift to one person, paid from your own wallet: { username, type: 'coins'|'premium-themes'|'premium-frames'|'language', amount?, lang? }
router.post('/gift', requireAuth, (req, res) => {
  const b = req.body || {};
  const to = db.prepare("SELECT * FROM users WHERE lower(username) = ? AND account_status = 'active' AND role = 'user'").get(String(b.username || '').trim().replace(/^@/, '').toLowerCase());
  const fail = (status, code, message) => res.status(status).json({ error: { code, message } });
  if (!to) return fail(404, 'NOT_FOUND', 'User not found.');
  if (to.id === req.userId) return fail(400, 'INVALID_INPUT', 'You can’t send a gift to yourself.');
  if (isBlocked(req.userId, to.id)) return fail(403, 'BLOCKED', 'You can’t send a gift to this user.');
  const me = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
  const out = sendGift(req.userId, to, { type: b.type, amount: Number(b.amount), lang: b.lang, fromName: me.username });
  if (out.error) return fail(out.error.status, out.error.code, out.error.message);
  req.app.get('io')?.to(`user:${to.id}`).emit('coins:earned', { amount: out.amount || 0, reason: `Gift from @${me.username}`, text: out.text });
  res.json({ ok: true, to: to.username, gift: out.label, wallet: coinsSummary(req.userId) });
});

export default router;
