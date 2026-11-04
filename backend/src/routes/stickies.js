import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { STICKY_COLORS, STICKY_LIMITS, stickyDTO, createSticky, validTz } from '../reminders.js';

const router = Router();
const fail = (res, e) => res.status(e.status).json({ error: { code: e.code, message: e.message } });
const own = (id, userId) => db.prepare('SELECT * FROM sticky_notes WHERE id = ? AND user_id = ?').get(String(id), userId);
const list = (userId) => db.prepare(`SELECT * FROM sticky_notes WHERE user_id = ? AND source NOT LIKE 'life:%' AND (done = 0 OR created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'))
  ORDER BY done ASC, ringing DESC, CASE WHEN remind_at IS NULL THEN 1 ELSE 0 END, remind_at ASC, created_at DESC LIMIT 200`).all(userId).map(stickyDTO);

router.get('/', requireAuth, (req, res) => res.json({ notes: list(req.userId), colors: STICKY_COLORS }));

// Notes that are ringing right now and still waiting for Done / Snooze (the app polls this as a safety net).
router.get('/ringing', requireAuth, (req, res) =>
  res.json({ notes: db.prepare('SELECT * FROM sticky_notes WHERE user_id = ? AND ringing = 1 AND done = 0 ORDER BY last_fired_at').all(req.userId).map(stickyDTO) }));

router.post('/', requireAuth, (req, res) => {
  const b = req.body || {};
  const out = createSticky(req.userId, { text: b.text, remindAt: b.remindAt || null, repeat: b.repeat || 'none', color: b.color, tz: typeof b.timezone === 'string' ? b.timezone : 'UTC' });
  if (out.error) return fail(res, out.error);
  res.status(201).json({ note: out.note });
});

router.patch('/:id', requireAuth, (req, res) => {
  const n = own(req.params.id, req.userId);
  if (!n) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } });
  const b = req.body || {};
  const set = {};
  if (typeof b.text === 'string') {
    const t = b.text.replace(/\s+/g, ' ').trim().slice(0, STICKY_LIMITS.text);
    if (!t) return res.status(400).json({ error: { code: 'EMPTY', message: 'Write something on the note first.' } });
    set.text = t;
  }
  if (b.color !== undefined) { if (!STICKY_COLORS.includes(b.color)) return res.status(400).json({ error: { code: 'BAD_COLOR', message: 'Unknown colour.' } }); set.color = b.color; }
  if (b.repeat !== undefined) { if (!['none', 'daily', 'weekly'].includes(b.repeat)) return res.status(400).json({ error: { code: 'BAD_REPEAT', message: 'Repeat must be none, daily or weekly.' } }); set.repeat = b.repeat; }
  if (b.remindAt !== undefined) {
    if (b.remindAt === null || b.remindAt === '') { set.remind_at = null; set.fired = 0; set.ringing = 0; set.snooze_until = null; if (!set.repeat && n.repeat !== 'none') set.repeat = 'none'; }
    else if (Number.isNaN(Date.parse(b.remindAt))) return res.status(400).json({ error: { code: 'BAD_TIME', message: 'That date and time is not valid.' } });
    else { set.remind_at = new Date(b.remindAt).toISOString(); set.fired = 0; set.ringing = 0; set.snooze_until = null; set.done = 0; }
  }
  if (typeof b.timezone === 'string') set.tz = validTz(b.timezone);
  if (typeof b.done === 'boolean') {
    // "Done" on a repeating reminder only silences this ring; the series carries on until it is deleted.
    if (b.done && n.repeat !== 'none' && n.remind_at) { set.ringing = 0; set.snooze_until = null; }
    else { set.done = b.done ? 1 : 0; if (b.done) { set.ringing = 0; set.snooze_until = null; } }
  }
  const cols = Object.keys(set);
  if (cols.length) db.prepare(`UPDATE sticky_notes SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map(c => set[c]), n.id);
  res.json({ note: stickyDTO(own(n.id, req.userId)) });
});

// Ask again later. Repeating notes keep their normal schedule.
router.post('/:id/snooze', requireAuth, (req, res) => {
  const n = own(req.params.id, req.userId);
  if (!n) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } });
  const minutes = Math.min(Math.max(Math.round(Number(req.body?.minutes) || 10), 1), STICKY_LIMITS.snoozeMaxMinutes);
  db.prepare('UPDATE sticky_notes SET ringing = 0, snooze_until = ? WHERE id = ?').run(new Date(Date.now() + minutes * 60000).toISOString(), n.id);
  res.json({ note: stickyDTO(own(n.id, req.userId)) });
});

// Stop ringing without finishing the note.
router.post('/:id/dismiss', requireAuth, (req, res) => {
  const n = own(req.params.id, req.userId);
  if (!n) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } });
  db.prepare('UPDATE sticky_notes SET ringing = 0 WHERE id = ?').run(n.id);
  res.json({ note: stickyDTO(own(n.id, req.userId)) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const n = own(req.params.id, req.userId);
  if (!n) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } });
  db.prepare('DELETE FROM sticky_notes WHERE id = ?').run(n.id);
  res.json({ ok: true });
});

export default router;
