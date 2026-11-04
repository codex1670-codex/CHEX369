import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db, { toPublicUser, USER_MEDIA_COLUMNS_SQL } from '../db.js';
import { recordLearnLevel } from '../coins.js';
import { requireAuth } from '../middleware/auth.js';
import { syncAlert, removeAlert, setFocusAlert, clearFocusAlert } from '../lifeAlerts.js';

// "My life": planner, study timetable, assignment tracker, habit tracker, focus sessions, alarms, CHEX learn progress.
const router = Router();
const err = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const MAX_PER_KIND = { planner: 300, timetable: 120, assignment: 200, habit: 30, focus: 400, alarm: 30, learn: 1 };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LEARN_LANGS = ['es', 'fr', 'it', 'pt', 'de', 'ru', 'hi', 'el', 'zh', 'ja', 'ko', 'ar'];
const LEARN_LEVELS = 108;
const int = (v, min, max, dflt = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Each cleaner returns a tidy object, or { error } with a message for the user.
const CLEAN = {
  planner(d) {
    const title = str(d.title, 120);
    if (!title) return { error: 'Write the task first.' };
    if (!DATE.test(d.date || '')) return { error: 'Pick a date.' };
    return { title, date: d.date, time: TIME.test(d.time || '') ? d.time : '', priority: ['low', 'med', 'high'].includes(d.priority) ? d.priority : 'med', done: !!d.done };
  },
  timetable(d) {
    const subject = str(d.subject, 60);
    if (!subject) return { error: 'Enter the subject.' };
    const day = Number(d.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) return { error: 'Pick a day.' };
    if (!TIME.test(d.start || '') || !TIME.test(d.end || '')) return { error: 'Set a start and end time.' };
    if (d.end <= d.start) return { error: 'End time must be after the start time.' };
    return { subject, day, start: d.start, end: d.end, room: str(d.room, 40), color: ['yellow', 'pink', 'mint', 'blue', 'lilac', 'orange'].includes(d.color) ? d.color : 'blue' };
  },
  assignment(d) {
    const title = str(d.title, 120);
    if (!title) return { error: 'Enter the assignment name.' };
    if (d.due && !DATE.test(d.due)) return { error: 'That due date is not valid.' };
    const status = ['todo', 'doing', 'done'].includes(d.status) ? d.status : 'todo';
    return { title, subject: str(d.subject, 60), due: d.due || '', status, notes: str(d.notes, 300) };
  },
  habit(d) {
    const name = str(d.name, 60);
    if (!name) return { error: 'Name the habit.' };
    const days = [...new Set((Array.isArray(d.days) ? d.days : []).filter(x => DATE.test(x)))].sort().slice(-400);
    return { name, emoji: str(d.emoji, 8) || '✅', days, remindTime: TIME.test(d.remindTime || '') ? d.remindTime : '' };
  },
  focus(d) {
    const minutes = Math.round(Number(d.minutes));
    if (!(minutes >= 1 && minutes <= 240)) return { error: 'A focus session is 1 to 240 minutes.' };
    return { minutes, label: str(d.label, 80), date: DATE.test(d.date || '') ? d.date : new Date().toISOString().slice(0, 10) };
  },
  // CHEX learn: one record per person holding all their course progress. Every field is clamped, so a
  // tampered request can't store anything but small numbers and known language codes.
  learn(d) {
    const pr = {}; const want = {};
    for (const l of LEARN_LANGS) {
      if (d.pr && d.pr[l] !== undefined) pr[l] = int(d.pr[l], 0, LEARN_LEVELS);
      if (d.want && d.want[l]) want[l] = true;
    }
    const q = d.q && typeof d.q === 'object' ? d.q : {};
    return {
      lang: LEARN_LANGS.includes(d.lang) ? d.lang : 'es', pr, want,
      lvl: int(d.lvl, 0, LEARN_LEVELS), xp: int(d.xp, 0, 10_000_000),
      hearts: int(d.hearts, 0, 5, 5), ht: int(d.ht, 0, 8.64e15, Date.now()), min: Math.min(1_000_000, Math.max(0, Number(d.min) || 0)),
      streak: int(d.streak, 0, 100_000), last: str(d.last, 40), goal: [10, 20, 50].includes(Number(d.goal)) ? Number(d.goal) : 20,
      q: { xp: int(q.xp, 0, 100_000), les: int(q.les, 0, 10_000), perf: int(q.perf, 0, 10_000), d: str(q.d, 40) },
      onb: d.onb ? 1 : 0,
    };
  },
  alarm(d) {
    if (!TIME.test(d.time || '')) return { error: 'Set the alarm time.' };
    const days = [...new Set((Array.isArray(d.days) ? d.days : []).map(Number).filter(x => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
    return { label: str(d.label, 60), time: d.time, days, enabled: d.enabled === undefined ? true : !!d.enabled };
  },
};

const dto = (r) => ({ id: r.id, kind: r.kind, ...JSON.parse(r.data || '{}'), createdAt: r.created_at, updatedAt: r.updated_at });
const own = (id, userId) => db.prepare('SELECT * FROM life_items WHERE id = ? AND user_id = ?').get(String(id), userId);
const tzOf = (req) => (typeof req.body?.timezone === 'string' ? req.body.timezone : 'UTC');
const kindOf = (v) => (Object.hasOwn(CLEAN, v) ? v : null);

// Focus timer: start → one alert for when it ends; stop / finished in the app → remove it.
router.post('/focus-alert', requireAuth, (req, res) => {
  const minutes = Math.round(Number(req.body?.minutes));
  if (!(minutes >= 1 && minutes <= 240)) return err(res, 400, 'INVALID', 'A focus session is 1 to 240 minutes.');
  setFocusAlert(req.userId, { minutes, label: str(req.body?.label, 80), tz: tzOf(req) });
  res.status(201).json({ ok: true });
});
router.delete('/focus-alert', requireAuth, (req, res) => { clearFocusAlert(req.userId); res.json({ ok: true }); });

// CHEX learn leaderboard: you plus the people you follow, ranked by total XP. Nobody else's progress is exposed.
router.get('/learn-board', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, ${USER_MEDIA_COLUMNS_SQL}, l.data
    FROM life_items l JOIN users u ON u.id = l.user_id
    WHERE l.kind = 'learn' AND u.account_status = 'active' AND (u.id = ? OR u.id IN (SELECT followed_id FROM follows WHERE follower_id = ?))
  `).all(req.userId, req.userId);
  const board = rows.map(r => { const d = JSON.parse(r.data || '{}'); return { user: toPublicUser(r), xp: d.xp || 0, streak: d.streak || 0, me: r.id === req.userId }; })
    .sort((a, b) => b.xp - a.xp).slice(0, 50);
  res.json({ board });
});

// CHEX learn: the browser reports a finished level; the server records it and pays 1 CHEX coin when it closes a section.
router.post('/learn/level', requireAuth, (req, res) => {
  const r = recordLearnLevel(req.userId, String(req.body?.lang || ''), Number(req.body?.level));
  if (r.error) return res.status(r.error.status).json({ error: r.error });
  res.json(r);
});

router.get('/', requireAuth, (req, res) => {
  const kind = req.query.kind ? kindOf(req.query.kind) : null;
  if (req.query.kind && !kind) return err(res, 400, 'BAD_KIND', 'Unknown kind.');
  const rows = kind
    ? db.prepare('SELECT * FROM life_items WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 500').all(req.userId, kind)
    : db.prepare('SELECT * FROM life_items WHERE user_id = ? ORDER BY created_at DESC LIMIT 1500').all(req.userId);
  res.json({ items: rows.map(dto) });
});

router.post('/', requireAuth, (req, res) => {
  const kind = kindOf(req.body?.kind);
  if (!kind) return err(res, 400, 'BAD_KIND', 'Unknown kind.');
  const data = CLEAN[kind](req.body?.data || {});
  if (data.error) return err(res, 400, 'INVALID', data.error);
  const { n } = db.prepare('SELECT COUNT(*) n FROM life_items WHERE user_id = ? AND kind = ?').get(req.userId, kind);
  if (n >= MAX_PER_KIND[kind]) return err(res, 400, 'LIMIT', `You have reached the limit of ${MAX_PER_KIND[kind]}. Delete some old ones first.`);
  const id = uuid();
  db.prepare('INSERT INTO life_items (id, user_id, kind, data) VALUES (?, ?, ?, ?)').run(id, req.userId, kind, JSON.stringify(data));
  const created = own(id, req.userId);
  if (kind !== 'learn') syncAlert(req.userId, created, tzOf(req));
  res.status(201).json({ item: dto(created) });
});

// PATCH merges the given fields into the stored data, then re-validates the result.
router.patch('/:id', requireAuth, (req, res) => {
  const row = own(req.params.id, req.userId);
  if (!row) return err(res, 404, 'NOT_FOUND', 'Not found.');
  const data = CLEAN[row.kind]({ ...JSON.parse(row.data || '{}'), ...(req.body?.data || {}) });
  if (data.error) return err(res, 400, 'INVALID', data.error);
  db.prepare("UPDATE life_items SET data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(JSON.stringify(data), row.id);
  const updated = own(row.id, req.userId);
  if (row.kind !== 'learn') syncAlert(req.userId, updated, tzOf(req));
  res.json({ item: dto(updated) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = own(req.params.id, req.userId);
  if (!row) return err(res, 404, 'NOT_FOUND', 'Not found.');
  db.prepare('DELETE FROM life_items WHERE id = ?').run(row.id);
  removeAlert(req.userId, row.kind, row.id);
  res.json({ ok: true });
});

export default router;
