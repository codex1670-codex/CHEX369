// Master-account tools: moderation queue, deleting anything, deleting users, gifting coins / frames / themes.
// EVERY route here goes through requireMaster, which re-checks the database (a token alone is never enough).
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { STORE_ITEMS, PROFILE_FRAMES, getBalance } from '../coins.js';
import { deleteUserPermanently, disconnectUserSockets } from '../accountService.js';
import { describeTarget, removeContent, isMaster } from '../admin.js';
import persistence from '../persistence.js';

const router = Router();

const requireMaster = (req, res, next) => {
  if (!isMaster(req.userId)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This area is only for the master account.' } });
  next();
};
router.use(requireAuth, requireMaster);

const err = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const CONTENT_TYPES = ['post', 'reel', 'comment', 'reel_comment', 'story', 'note', 'message'];
const MAX_GIFT = 1_000_000_000;

const findUser = (ref) => {
  const v = String(ref || '').trim().replace(/^@/, '').toLowerCase();
  if (!v) return null;
  return db.prepare("SELECT * FROM users WHERE (id = ? OR lower(username) = ?) AND role != 'system' AND account_status != 'deleted'").get(ref, v);
};
const userBrief = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarColor: u.avatar_color, avatarPhotoUrl: u.avatar_photo_url || null, status: u.account_status, role: u.role, createdAt: u.created_at });

router.get('/overview', (_req, res) => {
  const c = (sql) => db.prepare(sql).get().c;
  res.json({
    openReports: c("SELECT COUNT(*) c FROM reports WHERE status = 'open'"),
    users: c("SELECT COUNT(*) c FROM users WHERE role = 'user' AND account_status != 'deleted'"),
    posts: c('SELECT COUNT(*) c FROM posts WHERE deleted_at IS NULL'),
    reels: c('SELECT COUNT(*) c FROM reels WHERE deleted_at IS NULL'),
    items: STORE_ITEMS.map(i => ({ id: i.id, name: i.name })),
    frames: PROFILE_FRAMES,
  });
});

// ---- Reports ----
router.get('/reports', (req, res) => {
  const status = ['open', 'reviewing', 'actioned', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
  const rows = db.prepare(`SELECT r.*, u.username AS reporter FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
    WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100`).all(status);
  res.json({ reports: rows.map(r => ({
    id: r.id, status: r.status, reason: r.reason, createdAt: r.created_at, resolvedAt: r.resolved_at,
    reporter: r.reporter, target: describeTarget(r.target_type, r.target_id),
  })) });
});

// Close a report; optionally remove the reported content and/or the user who wrote it in the same step.
router.post('/reports/:id/resolve', (req, res) => {
  const { status, removeContent: doRemove, deleteUser } = req.body || {};
  if (!['actioned', 'dismissed', 'reviewing'].includes(status)) return err(res, 400, 'INVALID_INPUT', 'status must be actioned, dismissed or reviewing.');
  const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!rep) return err(res, 404, 'NOT_FOUND', 'Report not found.');
  const done = [];
  if (doRemove && rep.target_type !== 'user') { if (removeContent(rep.target_type, rep.target_id)) done.push('content removed'); }
  if (deleteUser) {
    const t = describeTarget(rep.target_type, rep.target_id);
    const owner = t.owner && db.prepare('SELECT id, role FROM users WHERE id = ?').get(t.owner.id);
    if (owner && owner.role === 'user') {
      deleteUserPermanently(owner.id); disconnectUserSockets(req.app.get('io'), owner.id); done.push('user deleted');
    }
  }
  db.prepare("UPDATE reports SET status = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, rep.id);
  res.json({ ok: true, done });
});

// ---- Delete anything ----
router.delete('/content/:type/:id', (req, res) => {
  const { type, id } = req.params;
  if (!CONTENT_TYPES.includes(type)) return err(res, 400, 'INVALID_INPUT', `type must be one of: ${CONTENT_TYPES.join(', ')}.`);
  if (!removeContent(type, id)) return err(res, 404, 'NOT_FOUND', 'Nothing to delete — it is already gone or the id is wrong.');
  db.prepare("UPDATE reports SET status = 'actioned', resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE target_type = ? AND target_id = ? AND status IN ('open','reviewing')").run(type, id);
  res.json({ ok: true });
});

// ---- Users ----
router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
  const like = `%${q}%`;
  const rows = db.prepare(`SELECT * FROM users WHERE role != 'system' AND account_status != 'deleted'
    AND (? = '' OR lower(username) LIKE ? OR lower(display_name) LIKE ?) ORDER BY created_at DESC LIMIT 30`).all(q, like, like);
  res.json({ users: rows.map(u => ({
    ...userBrief(u),
    coins: u.role === 'master' ? null : getBalance(u.id),
    unlocked: u.role === 'master' ? STORE_ITEMS.map(i => i.id) : db.prepare('SELECT item_id FROM coin_unlocks WHERE user_id = ?').all(u.id).map(r => r.item_id),
    frame: u.profile_frame || null,
    posts: db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id = ? AND deleted_at IS NULL').get(u.id).c,
    reels: db.prepare('SELECT COUNT(*) c FROM reels WHERE user_id = ? AND deleted_at IS NULL').get(u.id).c,
  })) });
});

router.delete('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u || u.account_status === 'deleted') return err(res, 404, 'NOT_FOUND', 'User not found.');
  if (u.role !== 'user') return err(res, 403, 'MASTER_PROTECTED', 'This account is permanent and cannot be deleted.');
  deleteUserPermanently(u.id);
  disconnectUserSockets(req.app.get('io'), u.id);
  res.json({ ok: true, username: u.username });
});

// ---- Gifts ----
router.post('/gift/coins', (req, res) => {
  const u = findUser(req.body?.username ?? req.body?.userId);
  if (!u) return err(res, 404, 'NOT_FOUND', 'User not found.');
  if (u.role !== 'user') return err(res, 400, 'INVALID_INPUT', u.role === 'master' ? 'You already have unlimited CHEX coins.' : 'Cannot gift to this account.');
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_GIFT) return err(res, 400, 'INVALID_INPUT', `Amount must be a whole number from 1 to ${MAX_GIFT.toLocaleString()}.`);
  db.prepare('INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)').run(u.id, amount, 'Gift from sanjiv 🎁', `admin-gift:${uuid()}`);
  req.app.get('io')?.to(`user:${u.id}`).emit('coins:earned', { amount, reason: 'Gift from sanjiv 🎁' });
  res.json({ ok: true, username: u.username, balance: getBalance(u.id) });
});

// itemId: 'premium-themes' | 'premium-frames'. For frames you may also pre-select one with `frame`.
router.post('/gift/item', (req, res) => {
  const u = findUser(req.body?.username ?? req.body?.userId);
  if (!u) return err(res, 404, 'NOT_FOUND', 'User not found.');
  if (u.role !== 'user') return err(res, 400, 'INVALID_INPUT', 'That account already has everything.');
  const item = STORE_ITEMS.find(i => i.id === req.body?.itemId);
  if (!item) return err(res, 400, 'UNKNOWN_ITEM', `itemId must be one of: ${STORE_ITEMS.map(i => i.id).join(', ')}.`);
  const frame = req.body?.frame;
  if (frame !== undefined && frame !== null && frame !== '' && (item.id !== 'premium-frames' || !PROFILE_FRAMES.includes(frame))) {
    return err(res, 400, 'UNKNOWN_FRAME', 'That frame does not exist (or the item is not the frames pack).');
  }
  const r = db.prepare('INSERT OR IGNORE INTO coin_unlocks (user_id, item_id, price) VALUES (?, ?, 0)').run(u.id, item.id);
  if (frame) db.prepare('UPDATE users SET profile_frame = ? WHERE id = ?').run(frame, u.id);
  persistence.syncUsersSoon();
  const io = req.app.get('io');
  io?.to(`user:${u.id}`).emit('coins:earned', { amount: 0, reason: `sanjiv gifted you ${item.name} 🎁`, text: `🎁 sanjiv gifted you ${item.name}!` });
  res.json({ ok: true, username: u.username, alreadyOwned: r.changes === 0 });
});

export default router;
