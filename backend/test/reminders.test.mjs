// Sticky-note reminders: phrase parsing (time zones included), the scheduler, repeat/snooze, and Codex hand-off.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-reminders-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
process.env.PORT = '0';

const { default: db } = await import('../src/db.js');
const R = await import('../src/reminders.js');
const { parseCommand } = await import('../src/nlu.js');

// 2026-10-31 10:00 in Asia/Kolkata (UTC+5:30) = 04:30Z
const NOW = new Date('2026-10-31T04:30:00Z');
const IST = 'Asia/Kolkata';
const p = (t, tz = IST, now = NOW) => R.parseReminder(t, { now, tz });
const local = (iso, tz = IST) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

test('"remind me to call mom at 5pm" → today 17:00 local, text cleaned', () => {
  const r = p('remind me to call mom at 5pm');
  assert.equal(r.text, 'Call mom');
  assert.equal(local(r.remindAt), '31/10/2026, 17:00');
  assert.equal(r.repeat, 'none');
});

test('a time that already passed today rolls to tomorrow; "tomorrow 9am" and relative times work', () => {
  assert.equal(local(p('remind me to stretch at 9am').remindAt), '01/11/2026, 09:00');
  assert.equal(local(p('Remind me tomorrow 9am to submit the report').remindAt), '01/11/2026, 09:00');
  assert.equal(p('Remind me tomorrow 9am to submit the report').text, 'Submit the report');
  assert.equal(p('sticky note: buy milk in 30 minutes').remindAt, new Date(NOW.getTime() + 30 * 60000).toISOString());
  assert.equal(p('remind me to drink water in an hour').remindAt, new Date(NOW.getTime() + 3600000).toISOString());
  assert.equal(p('remind me to rest in half an hour').remindAt, new Date(NOW.getTime() + 1800000).toISOString());
});

test('"at 5" with no am/pm picks the next 5 o\'clock; 24-hour and words like noon / tonight work', () => {
  assert.equal(local(p('remind me to eat at 5').remindAt), '31/10/2026, 17:00');
  assert.equal(local(p('remind me to run at 17:30').remindAt), '31/10/2026, 17:30');
  assert.equal(local(p('remind me to lunch at noon').remindAt), '31/10/2026, 12:00');
  assert.equal(local(p('remind me to sleep tonight').remindAt), '31/10/2026, 20:00');
  assert.equal(local(p('remind me to read tonight at 9').remindAt), '31/10/2026, 21:00');
});

test('weekdays, dates and repeats', () => {
  const fri = p('remind me to go to the gym on friday at 7pm');          // 31 Oct 2026 is a Saturday
  assert.equal(local(fri.remindAt), '06/11/2026, 19:00');
  assert.equal(local(p('remind me to pay rent on 5 nov at 10am').remindAt), '05/11/2026, 10:00');
  const daily = p('remind me every day at 8am to take medicine');
  assert.equal(daily.repeat, 'daily'); assert.equal(daily.text, 'Take medicine'); assert.equal(local(daily.remindAt), '01/11/2026, 08:00');
  const wk = p('remind me every monday at 7am to water the plants');
  assert.equal(wk.repeat, 'weekly'); assert.equal(local(wk.remindAt), '02/11/2026, 07:00');
});

test('time zones: the same words mean different instants in different zones', () => {
  const ny = p('remind me to call mom at 5pm', 'America/New_York');
  assert.equal(local(ny.remindAt, 'America/New_York'), '31/10/2026, 17:00');
  assert.notEqual(ny.remindAt, p('remind me to call mom at 5pm').remindAt);
});

test('no time → a plain sticky note; missing text and bad input give a helpful error', () => {
  const r = p('sticky note: buy milk');
  assert.equal(r.scheduled, false); assert.equal(r.remindAt, null); assert.equal(r.text, 'Buy milk');
  assert.match(p('remind me at 5pm').error, /What should I remind you about/);
  assert.ok(p('remind me to x at 25pm').error);
  assert.match(p('remind me to call at 8am today').error, /already passed/);
});

test('friendlyWhen reads naturally', () => {
  assert.equal(R.friendlyWhen(p('remind me to a at 5pm').remindAt, { now: NOW, tz: IST }), 'today at 5:00 PM');
  assert.equal(R.friendlyWhen(p('remind me to a tomorrow 9am').remindAt, { now: NOW, tz: IST }), 'tomorrow at 9:00 AM');
});

test('Codex hands reminder phrases over whole; "open my sticky notes" navigates', () => {
  const a = parseCommand('remind me to call rahul and buy milk at 5pm');
  assert.deepEqual(a, { kind: 'actions', actions: [{ name: 'create_reminder', input: { text: 'remind me to call rahul and buy milk at 5pm' } }] });
  assert.equal(parseCommand('sticky note: pay bill tomorrow 10am').actions[0].name, 'create_reminder');
  assert.equal(parseCommand('set a reminder for 6pm to stretch').actions[0].name, 'create_reminder');
  assert.deepEqual(parseCommand('open my sticky notes').actions[0], { name: 'navigate', input: { screen: 'stickies' } });
  assert.deepEqual(parseCommand('reminders').actions[0], { name: 'navigate', input: { screen: 'stickies' } });
});

// ── storage + scheduler ───────────────────────────────────────────────────────────────────────────
const mk = (name) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${name}`, name, `${name}@x.com`, 'x', name); return `id-${name}`; };
const emitted = [];
const io = { to: (room) => ({ emit: (ev, dto) => emitted.push({ room, ev, dto }) }) };
const pushed = [];
const push = (uid, dto) => pushed.push({ uid, dto });
const get = (id) => db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(id);

test('a due note rings once (socket + push), then waits for Done; a future note stays quiet', () => {
  const u = mk('rita');
  const soon = R.createSticky(u, { text: 'Call mom', remindAt: new Date(Date.now() + 60000).toISOString(), tz: IST }).note;
  const later = R.createSticky(u, { text: 'Later', remindAt: new Date(Date.now() + 3600e3).toISOString() }).note;
  const plain = R.createSticky(u, { text: 'Just a note' }).note;
  assert.equal(R.processDueReminders({ io, push, now: new Date() }), 0);
  const at = new Date(Date.now() + 61000);
  assert.equal(R.processDueReminders({ io, push, now: at }), 1);
  assert.equal(emitted.at(-1).room, `user:${u}`); assert.equal(emitted.at(-1).ev, 'sticky:due'); assert.equal(emitted.at(-1).dto.text, 'Call mom');
  assert.equal(pushed.at(-1).dto.id, soon.id);
  assert.equal(get(soon.id).ringing, 1);
  assert.equal(R.processDueReminders({ io, push, now: new Date(at.getTime() + 60000) }), 0);   // never rings twice
  assert.equal(get(later.id).ringing, 0); assert.equal(get(plain.id).ringing, 0);
});

test('snooze rings again later; repeating notes keep their schedule and advance a day', () => {
  const u = mk('sam');
  const t0 = new Date(Date.now() + 60000);
  const one = R.createSticky(u, { text: 'Snoozy', remindAt: t0.toISOString() }).note;
  R.processDueReminders({ io, push, now: new Date(t0.getTime() + 1000) });
  db.prepare('UPDATE sticky_notes SET ringing = 0, snooze_until = ? WHERE id = ?').run(new Date(t0.getTime() + 600e3).toISOString(), one.id);   // = POST /snooze
  assert.equal(R.processDueReminders({ io, push, now: new Date(t0.getTime() + 300e3) }), 0);
  assert.equal(R.processDueReminders({ io, push, now: new Date(t0.getTime() + 601e3) }), 1);
  assert.equal(get(one.id).ringing, 1);

  const rep = R.createSticky(u, { text: 'Medicine', remindAt: t0.toISOString(), repeat: 'daily', tz: IST }).note;
  R.processDueReminders({ io, push, now: new Date(t0.getTime() + 1000) });
  const row = get(rep.id);
  assert.equal(row.ringing, 1);
  assert.equal(Date.parse(row.remind_at) - t0.getTime(), 86400000);       // tomorrow, same time
  assert.equal(row.done, 0);
});

test('validation: empty text, repeat without a time, bad time, and the 100-note cap', () => {
  const u = mk('tess');
  assert.equal(R.createSticky(u, { text: '   ' }).error.code, 'EMPTY');
  assert.equal(R.createSticky(u, { text: 'x', repeat: 'daily' }).error.code, 'NEEDS_TIME');
  assert.equal(R.createSticky(u, { text: 'x', remindAt: 'not a date' }).error.code, 'BAD_TIME');
  for (let i = 0; i < 100; i++) assert.ok(R.createSticky(u, { text: `n${i}` }).ok);
  assert.equal(R.createSticky(u, { text: 'one too many' }).error.code, 'TOO_MANY');
});
