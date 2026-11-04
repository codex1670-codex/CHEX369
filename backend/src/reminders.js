// Sticky notes + reminders: parsing "remind me to … at 5pm", storage, and the scheduler that rings them.
import { v4 as uuid } from 'uuid';
import db from './db.js';

export const STICKY_COLORS = ['yellow', 'pink', 'mint', 'blue', 'lilac', 'orange'];
export const STICKY_LIMITS = { text: 200, active: 100, snoozeMaxMinutes: 24 * 60 };

// ── time-zone helpers (no libraries: Intl does the work) ─────────────────────────────────────────
export const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return 'UTC'; } };
export function partsIn(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(guess), tz);
    guess += want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return new Date(guess);
}
const weekdayOf = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

// "remind me to call mom at 5pm" → { text, remindAt, repeat, scheduled } | { error }
// Understands: in 10 minutes / in an hour / at 5pm / at 17:30 / tomorrow 9am / friday 7pm / tonight /
// every day at 8am / every monday / on 12 nov / noon / midnight / morning / evening. No time → plain sticky note.
export function parseReminder(input, { now = new Date(), tz = 'UTC' } = {}) {
  tz = validTz(tz);
  let s = ` ${String(input ?? '').replace(/\s+/g, ' ').trim()} `;
  s = s.replace(/^\s*(?:please\s+)?(?:(?:can|could|will)\s+you\s+)?(?:remind\s+me|set\s+(?:a\s+|an\s+)?(?:reminder|alarm)|(?:add|make|create|new|write)(?:\s+me)?(?:\s+a|\s+an)?\s+(?:sticky(?:\s*notes?)?|reminder|note)|sticky(?:\s*notes?)?|reminders?|note\s+to\s+self)\b\s*[:,\-–]?\s*/i, ' ');
  const cut = (re) => { const m = s.match(re); if (m) s = s.replace(re, ' '); return m; };

  // repeat
  let repeat = 'none', repeatDay = null;
  let m;
  if ((m = cut(/\bevery\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/i))) { repeat = 'weekly'; repeatDay = DAYS[m[1].slice(0, 3).toLowerCase()]; }
  else if (cut(/\b(?:every\s*day|everyday|daily|each\s+day)\b/i)) repeat = 'daily';
  else if (cut(/\b(?:every\s+week|weekly)\b/i)) repeat = 'weekly';

  // relative: in 10 minutes / in an hour / in half an hour / after 2 hrs
  let rel = null;
  if ((m = cut(/\b(?:in|after)\s+(half\s+an?|an?|\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b/i))) {
    const n = /half/i.test(m[1]) ? 0.5 : /^an?$/i.test(m[1]) ? 1 : parseFloat(m[1]);
    rel = n * UNIT_MS[m[2][0].toLowerCase()];
  }

  // day words
  let dayOffset = null, weekday = null, dateAbs = null, tonight = false;
  const nowP = partsIn(now, tz);
  if (cut(/\bday\s+after\s+tomorrow\b/i)) dayOffset = 2;
  else if (cut(/\b(?:tomorrow|tmrw|tmr)\b/i)) dayOffset = 1;
  else if (cut(/\btonight\b/i)) { dayOffset = 0; tonight = true; }
  else if (cut(/\btoday\b/i)) dayOffset = 0;
  else if ((m = cut(/\b(?:on\s+|next\s+|this\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/i))) weekday = DAYS[m[1].slice(0, 3).toLowerCase()];
  if (repeatDay !== null && weekday === null) weekday = repeatDay;
  if (dayOffset === null && weekday === null) {
    if ((m = cut(/\b(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b/))) dateAbs = { y: +m[1], mo: +m[2], d: +m[3] };
    else if ((m = cut(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i))) dateAbs = { mo: MONTHS[m[2].toLowerCase()], d: +m[1] };
    else if ((m = cut(/\b(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i))) dateAbs = { mo: MONTHS[m[1].toLowerCase()], d: +m[2] };
  }

  // clock time
  let hour = null, minute = 0, ambiguous = false, vagueTime = false;
  if ((m = cut(/\b(?:at\s+|@\s*|by\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?=\W|$)/i))) {
    hour = +m[1] % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0); minute = +(m[2] || 0);
    if (+m[1] > 12 || +m[1] < 1) return { error: "That time doesn't look right." };
  } else if ((m = cut(/\b(?:at\s+|@\s*|by\s+)?(\d{1,2}):(\d{2})\b/))) {
    hour = +m[1]; minute = +m[2]; ambiguous = hour >= 1 && hour <= 12;
  } else if ((m = cut(/\b(?:at|@|by)\s*(\d{1,2})(?!\d)(?:\s*o'?clock)?\b/i))) {
    hour = +m[1]; ambiguous = hour >= 1 && hour <= 12;
  } else if (cut(/\b(?:at\s+)?noon\b/i)) hour = 12;
  else if (cut(/\b(?:at\s+)?midnight\b/i)) hour = 0;
  else if (cut(/\b(?:in\s+the\s+)?morning\b/i)) { hour = 9; vagueTime = true; }
  else if (cut(/\b(?:in\s+the\s+)?afternoon\b/i)) { hour = 15; vagueTime = true; }
  else if (cut(/\b(?:in\s+the\s+)?evening\b/i)) { hour = 18; vagueTime = true; }
  else if (cut(/\b(?:at\s+)?night\b/i)) { hour = 21; vagueTime = true; }
  if (hour !== null && (hour > 23 || minute > 59)) return { error: "That time doesn't look right." };
  if (tonight && hour === null) hour = 20;
  if (tonight && hour !== null && hour < 12 && hour > 0) hour += 12;       // "tonight at 9" means 21:00

  // what to be reminded about
  let text = s.replace(/\b(?:remind\s+me|reminder|sticky\s*notes?)\b/ig, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/^(?:to|about|that|for)\s+/i, '').replace(/\s+(?:at|on|by|in|for|to)\s*$/i, '').replace(/^[\s,:;.\-–]+|[\s,:;\-–]+$/g, '').trim();
  if (text) text = text[0].toUpperCase() + text.slice(1);
  if (!text) return { error: 'What should I remind you about? e.g. "remind me to call mom at 5pm".' };
  text = text.slice(0, STICKY_LIMITS.text);

  const scheduled = rel !== null || hour !== null || dayOffset !== null || weekday !== null || dateAbs !== null || repeat !== 'none';
  if (!scheduled) return { text, remindAt: null, repeat: 'none', scheduled: false };

  let when;
  if (rel !== null) {
    when = new Date(now.getTime() + rel);
  } else {
    if (hour === null) { hour = 9; vagueTime = true; }
    const at = (offset, h) => { const d = new Date(Date.UTC(nowP.y, nowP.mo - 1, nowP.d + offset)); return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, minute, tz); };
    const hoursToTry = ambiguous && hour <= 12 ? [hour % 12, hour % 12 + 12] : [hour];    // "at 5" → next 5am or 5pm
    if (dateAbs) {
      let y = dateAbs.y ?? nowP.y;
      let cand = zonedToUtc(y, dateAbs.mo, dateAbs.d, hoursToTry[hoursToTry.length - 1], minute, tz);
      if (!dateAbs.y && cand <= now) cand = zonedToUtc(y + 1, dateAbs.mo, dateAbs.d, hoursToTry[hoursToTry.length - 1], minute, tz);
      if (cand <= now) return { error: 'That date has already passed.' };
      when = cand;
    } else if (dayOffset !== null) {
      when = hoursToTry.map(h => at(dayOffset, h)).find(d => d > now) || at(dayOffset, hoursToTry[hoursToTry.length - 1]);
      if (when <= now) return { error: dayOffset === 0 ? 'That time has already passed today — try a later time or "tomorrow".' : 'That time has already passed.' };
    } else if (weekday !== null) {
      const delta = (weekday - weekdayOf(nowP.y, nowP.mo, nowP.d) + 7) % 7;
      const todayHit = delta === 0 && hoursToTry.map(h => at(0, h)).find(d => d > now);
      when = todayHit || at(delta === 0 ? 7 : delta, hoursToTry[hoursToTry.length - 1]);
    } else {
      // time (or just "every day") without a day: the next time that clock reading happens
      when = hoursToTry.flatMap(h => [at(0, h), at(1, h)]).sort((a, b) => a - b).find(d => d > now);
    }
  }
  return { text, remindAt: when.toISOString(), repeat, scheduled: true, vagueTime };
}

// "Today, 5:00 PM" / "Tomorrow, 9:00 AM" / "Fri 14 Nov, 7:00 PM" — for messages, in the person's time zone.
export function friendlyWhen(iso, { now = new Date(), tz = 'UTC' } = {}) {
  tz = validTz(tz);
  const d = new Date(iso), a = partsIn(d, tz), n = partsIn(now, tz);
  const diff = Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(n.y, n.mo - 1, n.d)) / 86400000);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
  if (diff === 0) return `today at ${time}`;
  if (diff === 1) return `tomorrow at ${time}`;
  return `${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d)} at ${time}`;
}

export function nextOccurrence(iso, repeat, tz, now = new Date()) {
  tz = validTz(tz);
  const step = repeat === 'weekly' ? 7 : 1;
  const orig = new Date(iso), p = partsIn(orig, tz), sub = ((orig.getTime() % 60000) + 60000) % 60000;   // keep the seconds too
  let k = 1, d;
  do { d = new Date(zonedToUtc(p.y, p.mo, p.d + step * k, p.h, p.mi, tz).getTime() + sub); k++; } while (d <= now && k < 400);
  return d.toISOString();
}

// ── storage ──────────────────────────────────────────────────────────────────────────────────────
const LIFE_LABELS = { planner: 'Planner', timetable: 'Class', assignment: 'Assignment', habit: 'Habit', focus: 'Focus timer', alarm: 'Alarm' };
export const stickyDTO = (r) => ({
  source: r.source, label: String(r.source || '').startsWith('life:') ? LIFE_LABELS[r.source.split(':')[1]] || 'My life' : 'Reminder',
  id: r.id, text: r.text, color: r.color, remindAt: r.remind_at, repeat: r.repeat,
  done: !!r.done, ringing: !!r.ringing, snoozeUntil: r.snooze_until, lastFiredAt: r.last_fired_at, createdAt: r.created_at,
});
const activeCount = (userId) => db.prepare('SELECT COUNT(*) AS c FROM sticky_notes WHERE user_id = ? AND done = 0 AND source NOT LIKE \'life:%\'').get(userId).c;

export function createSticky(userId, { text, remindAt = null, repeat = 'none', color, tz = 'UTC', source = 'manual' }) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, STICKY_LIMITS.text);
  if (!clean) return { error: { status: 400, code: 'EMPTY', message: 'Write something on the note first.' } };
  if (!['none', 'daily', 'weekly'].includes(repeat)) return { error: { status: 400, code: 'BAD_REPEAT', message: 'Repeat must be none, daily or weekly.' } };
  if (repeat !== 'none' && !remindAt) return { error: { status: 400, code: 'NEEDS_TIME', message: 'Pick a time for a repeating reminder.' } };
  if (remindAt && Number.isNaN(Date.parse(remindAt))) return { error: { status: 400, code: 'BAD_TIME', message: 'That date and time is not valid.' } };
  if (activeCount(userId) >= STICKY_LIMITS.active) return { error: { status: 409, code: 'TOO_MANY', message: `You can keep up to ${STICKY_LIMITS.active} sticky notes. Finish or delete some first.` } };
  const id = uuid();
  const col = STICKY_COLORS.includes(color) ? color : STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)];
  db.prepare('INSERT INTO sticky_notes (id, user_id, text, color, remind_at, repeat, tz, source) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, userId, clean, col, remindAt ? new Date(remindAt).toISOString() : null, repeat, validTz(tz), source);
  return { ok: true, note: stickyDTO(db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(id)) };
}

// ── the scheduler: rings every due note once, pushes it, and tells open apps to speak it ──────────
export function processDueReminders({ io, now = new Date(), push } = {}) {
  const iso = now.toISOString();
  const due = db.prepare(`SELECT * FROM sticky_notes WHERE done = 0 AND (
      (snooze_until IS NOT NULL AND snooze_until <= @iso) OR
      (snooze_until IS NULL AND fired = 0 AND remind_at IS NOT NULL AND remind_at <= @iso)) LIMIT 200`).all({ iso });
  for (const n of due) {
    const fromSnooze = !!n.snooze_until;
    if (fromSnooze) {
      db.prepare('UPDATE sticky_notes SET ringing = 1, snooze_until = NULL, last_fired_at = ? WHERE id = ?').run(iso, n.id);
    } else if (n.repeat !== 'none') {
      db.prepare('UPDATE sticky_notes SET ringing = 1, last_fired_at = ?, remind_at = ?, fired = 0 WHERE id = ?').run(iso, nextOccurrence(n.remind_at, n.repeat, n.tz, now), n.id);
    } else {
      db.prepare('UPDATE sticky_notes SET ringing = 1, fired = 1, last_fired_at = ? WHERE id = ?').run(iso, n.id);
    }
    const dto = stickyDTO(db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(n.id));
    try { io?.to(`user:${n.user_id}`).emit('sticky:due', dto); } catch (e) { console.error('sticky emit failed', e); }
    try { push?.(n.user_id, dto); } catch (e) { console.error('sticky push failed', e); }
  }
  return due.length;
}

export function startReminderScheduler(io, push, after) {
  const tick = () => { try { processDueReminders({ io, push }); after?.(); } catch (e) { console.error('reminder tick failed', e); } };
  tick();                                    // catches anything that came due while the server was down
  return setInterval(tick, 10_000).unref();
}
