import { Router } from 'express';
import db, { toPublicUser, USER_MEDIA_COLUMNS_SQL } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Message-ish notifications feed the Messages badge; everything else feeds the Notifications badge.
const MSG_TYPES = ['message', 'message_request'];
const MSG_SQL = MSG_TYPES.map(t => `'${t}'`).join(',');

function notificationDTO(r) {
  return {
    id: r.id,
    type: r.type,
    targetId: r.target_id,
    read: !!r.read,
    createdAt: r.created_at,
    actor: toPublicUser({ ...r, id: r.actor_id }),
  };
}

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, u.username, u.display_name, u.avatar_color, ${USER_MEDIA_COLUMNS_SQL} FROM notifications n
    JOIN users u ON u.id = n.actor_id
    WHERE n.recipient_id = ? ORDER BY n.created_at DESC LIMIT 100
  `).all(req.userId);
  const unreadCount = db.prepare('SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND read = 0').get(req.userId).c;
  const unreadMessages = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND read = 0 AND type IN (${MSG_SQL})`).get(req.userId).c;
  res.json({ notifications: rows.map(notificationDTO), unreadCount, unreadMessages, unreadOther: unreadCount - unreadMessages });
});

router.post('/:id/read', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!row || row.recipient_id !== req.userId) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found.' } });
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// scope=other marks everything except message / message-request notifications (used by the
// Notifications page); no scope marks all.
router.post('/read-all', requireAuth, (req, res) => {
  const other = req.query.scope === 'other';
  db.prepare(`UPDATE notifications SET read = 1 WHERE recipient_id = ? AND read = 0 ${other ? `AND type NOT IN (${MSG_SQL})` : ''}`).run(req.userId);
  res.json({ ok: true });
});

// Used by the Messages page: opening chats / requests clears their badge.
router.post('/read-messages', requireAuth, (req, res) => {
  const wanted = Array.isArray(req.body?.types) ? req.body.types.filter(t => MSG_TYPES.includes(t)) : MSG_TYPES;
  if (wanted.length) {
    db.prepare(`UPDATE notifications SET read = 1 WHERE recipient_id = ? AND read = 0 AND type IN (${wanted.map(() => '?').join(',')})`).run(req.userId, ...wanted);
  }
  res.json({ ok: true });
});

export default router;
