// Pure date/streak helpers for the "My life" hub (kept free of React so they are easy to test).
const pad = (n) => String(n).padStart(2, '0');
export const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); };
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);

// Day numbers in the timetable: 0 = Monday … 6 = Sunday.
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const todayDayIndex = (d = new Date()) => (d.getDay() + 6) % 7;

export const prettyDate = (s, today = dateStr()) => {
  const n = daysBetween(today, s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return parseDate(s).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

export const fmtTime = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

// Current streak = consecutive days ending today (or yesterday, so the streak survives until the day is over).
export function habitStreak(days, today = dateStr()) {
  const set = new Set(days || []);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cursor)) { n += 1; cursor = addDays(cursor, -1); }
  return n;
}
export function bestStreak(days) {
  const sorted = [...new Set(days || [])].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}

// Assignment urgency from its due date.
export function dueState(due, status, today = dateStr()) {
  if (!due || status === 'done') return { tone: 'none', label: due ? prettyDate(due, today) : 'No due date' };
  const n = daysBetween(today, due);
  if (n < 0) return { tone: 'late', label: `Overdue by ${-n} day${n === -1 ? '' : 's'}` };
  if (n === 0) return { tone: 'soon', label: 'Due today' };
  if (n <= 2) return { tone: 'soon', label: n === 1 ? 'Due tomorrow' : `Due in ${n} days` };
  return { tone: 'ok', label: `Due ${prettyDate(due, today)}` };
}

export const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

// ── Alarms ──
// An alarm rings at its time on the chosen days (none chosen = just once, the next time that clock time comes).
const ALARM_GRACE_MS = 120000;   // a throttled background tab may notice up to 2 minutes late — still ring
export function alarmDue(alarm, now = new Date()) {
  if (!alarm?.enabled || !/^\d{2}:\d{2}$/.test(alarm.time || '')) return false;
  const days = alarm.days || [];
  if (days.length && !days.includes(todayDayIndex(now))) return false;
  const [h, m] = alarm.time.split(':').map(Number);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  const late = now - at;
  return late >= 0 && late < ALARM_GRACE_MS;
}
export const alarmKey = (alarm, now = new Date()) => `${alarm.id}:${dateStr(now)}:${alarm.time}`;
export const repeatLabel = (days) => {
  const d = days || [];
  if (!d.length) return 'Once';
  if (d.length === 7) return 'Every day';
  if (d.join() === '0,1,2,3,4') return 'Weekdays';
  if (d.join() === '5,6') return 'Weekends';
  return d.map(i => DAY_NAMES[i].slice(0, 3)).join(', ');
};
