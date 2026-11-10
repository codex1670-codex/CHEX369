// "My life" alerts: every planner task, class, assignment, habit, alarm and focus session that has a time gets a
// linked sticky reminder (source "life:<kind>:<id>"), so it is spoken aloud, shown as a ringing card and sent
// as a phone notification by the same scheduler that handles sticky-note reminders.
import { v4 as uuid } from 'uuid';
import db from './db.js';
import { partsIn, zonedToUtc, validTz } from './reminders.js';

export const CLASS_LEAD_MIN = 10;     // class alert comes this long before it starts
export const ONCE_GRACE_MS = 3 * 60000;   // a one-time alarm is switched off this long after its notification
export const DUE_ALERT_HOUR = 8;      // assignment alert: 08:00 on the due date
const COLORS = { planner: 'yellow', timetable: 'blue', assignment: 'orange', habit: 'mint', focus: 'lilac', alarm: 'pink' };

const ymd = (s) => s.split('-').map(Number);
const clock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
const at = (dateStr, hhmm, tz) => { const [y, mo, d] = ymd(dateStr); const [h, mi] = hhmm.split(':').map(Number); return zonedToUtc(y, mo, d, h, mi, tz); };
const dayOf = (now, tz, plus = 0) => { const p = partsIn(now, tz); const d = new Date(Date.UTC(p.y, p.mo - 1, p.d + plus)); return d.toISOString().slice(0, 10); };

// The alert a stored item should have right now: { text, remindAt (ISO), repeat } or null for "none".
export function computeAlert(kind, data, { tz = 'UTC', now = new Date() } = {}) {
  tz = validTz(tz);
  if (kind === 'planner') {
    if (data.done || !data.time) return null;
    const when = at(data.date, data.time, tz);
    return when > now ? { text: `Planner: ${data.title}${data.time ? ` at ${clock(data.time)}` : ''}`, remindAt: when.toISOString(), repeat: 'none' } : null;
  }
  if (kind === 'timetable') {
    for (let i = 0; i < 8; i++) {                                   // first upcoming start on that weekday
      const date = dayOf(now, tz, i);
      const [y, mo, d] = ymd(date);
      if ((new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7 !== data.day) continue;
      const when = new Date(at(date, data.start, tz).getTime() - CLASS_LEAD_MIN * 60000);
      if (when > now) return { text: `${data.subject} starts at ${clock(data.start)}${data.room ? ` · ${data.room}` : ''}`, remindAt: when.toISOString(), repeat: 'weekly' };
    }
    return null;
  }
  if (kind === 'assignment') {
    if (data.status === 'done' || !data.due) return null;
    const when = at(data.due, `${String(DUE_ALERT_HOUR).padStart(2, '0')}:00`, tz);
    return when > now ? { text: `Assignment due today: ${data.title}${data.subject ? ` (${data.subject})` : ''}`, remindAt: when.toISOString(), repeat: 'none' } : null;
  }
  if (kind === 'habit') {
    if (!data.remindTime) return null;
    const today = dayOf(now, tz);
    let date = today;
    let when = at(date, data.remindTime, tz);
    if (when <= now || (data.days || []).includes(today)) {      // passed, or already ticked today → tomorrow
      date = dayOf(now, tz, 1); when = at(date, data.remindTime, tz); }
    return { text: `Habit time: ${data.emoji || '✅'} ${data.name}`, remindAt: when.toISOString(), repeat: 'daily' };
  }
  if (kind === 'alarm') {
    // The next time the alarm should go off. Always a one-off sticky; rearmAlarms() sets up the next one after it rings,
    // so any mix of weekdays works (the sticky scheduler itself only knows once / daily / weekly).
    if (!data.enabled || !data.time) return null;
    const days = data.days || [];
    for (let i = 0; i < 8; i++) {
      const date = dayOf(now, tz, i);
      const [y, mo, d] = ymd(date);
      if (days.length && !days.includes((new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7)) continue;
      const when = at(date, data.time, tz);
      if (when > now) return { text: `${data.label || 'Alarm'} · ${clock(data.time)}`, remindAt: when.toISOString(), repeat: 'none' };
    }
    return null;
  }
  return null;
}

const srcOf = (kind, id) => `life:${kind}:${id}`;

// Bring the linked reminder in line with the item (create / move / remove). Never throws into the request.
export function syncAlert(userId, row, tz = 'UTC', now = new Date()) {
  try {
    const source = srcOf(row.kind, row.id);
    const alert = computeAlert(row.kind, JSON.parse(row.data || '{}'), { tz, now });
    const old = db.prepare('SELECT id FROM sticky_notes WHERE user_id = ? AND source = ?').get(userId, source);
    if (!alert) { if (old) db.prepare('DELETE FROM sticky_notes WHERE id = ?').run(old.id); return null; }
    if (old) {
      db.prepare('UPDATE sticky_notes SET text = ?, remind_at = ?, repeat = ?, tz = ?, fired = 0, ringing = 0, snooze_until = NULL, done = 0 WHERE id = ?')
        .run(alert.text.slice(0, 200), alert.remindAt, alert.repeat, validTz(tz), old.id);
      return old.id;
    }
    const id = uuid();
    db.prepare('INSERT INTO sticky_notes (id, user_id, text, color, remind_at, repeat, tz, source) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, userId, alert.text.slice(0, 200), COLORS[row.kind] || 'yellow', alert.remindAt, alert.repeat, validTz(tz), source);
    return id;
  } catch (e) { console.error('life alert sync failed', e); return null; }
}

export function removeAlert(userId, kind, id) {
  db.prepare('DELETE FROM sticky_notes WHERE user_id = ? AND source = ?').run(userId, srcOf(kind, id));
}

// One running focus timer per person: a one-off alert for the moment it ends (works with the app closed).
export function setFocusAlert(userId, { minutes, label, tz = 'UTC' }, now = new Date()) {
  clearFocusAlert(userId);
  const id = uuid();
  const text = `Focus session complete${label ? ` — ${String(label).slice(0, 80)}` : ''}. Take a break.`;
  db.prepare('INSERT INTO sticky_notes (id, user_id, text, color, remind_at, repeat, tz, source) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, userId, text, COLORS.focus, new Date(now.getTime() + minutes * 60000).toISOString(), 'none', validTz(tz), 'life:focus:timer');
  return id;
}
export function clearFocusAlert(userId) {
  db.prepare("DELETE FROM sticky_notes WHERE user_id = ? AND source = 'life:focus:timer'").run(userId);
}

// After an alarm's phone notification has gone out: a repeating alarm is armed for its next day; a one-time alarm is switched off.
export function rearmAlarms(now = new Date()) {
  try {
    const rows = db.prepare("SELECT * FROM sticky_notes WHERE source LIKE 'life:alarm:%' AND fired = 1").all();
    for (const n of rows) {
      const item = db.prepare("SELECT * FROM life_items WHERE id = ? AND user_id = ? AND kind = 'alarm'").get(n.source.split(':')[2], n.user_id);
      const drop = () => db.prepare('DELETE FROM sticky_notes WHERE id = ?').run(n.id);
      if (!item) { drop(); continue; }
      const data = JSON.parse(item.data || '{}');
      if (!(data.days || []).length) {
        if (n.last_fired_at && now - new Date(n.last_fired_at) < ONCE_GRACE_MS) continue;   // keep it on a few minutes so the open app can still show it
        db.prepare("UPDATE life_items SET data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(JSON.stringify({ ...data, enabled: false }), item.id);
        drop(); continue;
      }
      const next = computeAlert('alarm', data, { tz: n.tz, now });
      if (!next) { drop(); continue; }
      db.prepare('UPDATE sticky_notes SET text = ?, remind_at = ?, fired = 0, ringing = 0, snooze_until = NULL, done = 0 WHERE id = ?').run(next.text.slice(0, 200), next.remindAt, n.id);
    }
  } catch (e) { console.error('alarm re-arm failed', e); }
}
