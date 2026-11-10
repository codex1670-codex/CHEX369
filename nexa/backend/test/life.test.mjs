// "My life" hub API: validation, per-user privacy, merge-on-patch and per-kind limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-life-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
process.env.PORT = '0';

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');
const { default: life } = await import('../src/routes/life.js');

const mk = (name) => {
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${name}`, name, `${name}@x.com`, 'x', name);
  return jwt.sign({ sub: `id-${name}` }, ACCESS_SECRET);
};
const app = express(); app.use(express.json()); app.use('/api/life', life);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/life`;
const call = async (tok, method, url = '', body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
test.after(() => server.close());

test('needs sign-in and rejects unknown kinds', async () => {
  assert.equal((await fetch(base)).status, 401);
  const a = mk('lia');
  assert.equal((await call(a, 'POST', '', { kind: 'nope', data: {} })).status, 400);
  assert.equal((await call(a, 'GET', '?kind=nope')).status, 400);
});

test('planner task: create, tick off (merge), delete', async () => {
  const a = mk('lib');
  const bad = await call(a, 'POST', '', { kind: 'planner', data: { title: '', date: '2026-11-01' } });
  assert.equal(bad.status, 400);
  const ok = await call(a, 'POST', '', { kind: 'planner', data: { title: 'Revise maths', date: '2026-11-01', time: '09:30', priority: 'high' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.item.done, false);
  const done = await call(a, 'PATCH', `/${ok.body.item.id}`, { data: { done: true } });
  assert.equal(done.body.item.done, true);
  assert.equal(done.body.item.title, 'Revise maths');           // untouched fields survive
  assert.equal((await call(a, 'DELETE', `/${ok.body.item.id}`)).status, 200);
  assert.equal((await call(a, 'GET', '?kind=planner')).body.items.length, 0);
});

test('timetable end must be after start; assignment due date is checked; habits keep unique sorted days', async () => {
  const a = mk('lic');
  assert.equal((await call(a, 'POST', '', { kind: 'timetable', data: { subject: 'Physics', day: 1, start: '10:00', end: '09:00' } })).status, 400);
  assert.equal((await call(a, 'POST', '', { kind: 'timetable', data: { subject: 'Physics', day: 1, start: '09:00', end: '10:00' } })).status, 201);
  assert.equal((await call(a, 'POST', '', { kind: 'assignment', data: { title: 'Essay', due: 'tomorrow' } })).status, 400);
  assert.equal((await call(a, 'POST', '', { kind: 'assignment', data: { title: 'Essay', due: '2026-11-05', status: 'weird' } })).body.item.status, 'todo');
  const h = await call(a, 'POST', '', { kind: 'habit', data: { name: 'Read', days: ['2026-10-31', '2026-10-30', '2026-10-31', 'junk'] } });
  assert.deepEqual(h.body.item.days, ['2026-10-30', '2026-10-31']);
});

test('focus sessions are 1–240 minutes', async () => {
  const a = mk('lid');
  assert.equal((await call(a, 'POST', '', { kind: 'focus', data: { minutes: 0 } })).status, 400);
  assert.equal((await call(a, 'POST', '', { kind: 'focus', data: { minutes: 999 } })).status, 400);
  assert.equal((await call(a, 'POST', '', { kind: 'focus', data: { minutes: 25, label: 'Maths' } })).status, 201);
});

test('items are private to their owner', async () => {
  const a = mk('lie'), b = mk('lif');
  const it = (await call(a, 'POST', '', { kind: 'habit', data: { name: 'Walk' } })).body.item;
  assert.equal((await call(b, 'GET')).body.items.length, 0);
  assert.equal((await call(b, 'PATCH', `/${it.id}`, { data: { name: 'x' } })).status, 404);
  assert.equal((await call(b, 'DELETE', `/${it.id}`)).status, 404);
});

test('per-kind limit stops runaway growth', async () => {
  const a = mk('lig');
  for (let i = 0; i < 30; i++) assert.equal((await call(a, 'POST', '', { kind: 'habit', data: { name: `h${i}` } })).status, 201);
  assert.equal((await call(a, 'POST', '', { kind: 'habit', data: { name: 'one too many' } })).status, 400);
});

test('Codex: "open my life" / "planner" / "habit tracker" navigate to My life; sticky notes still go to stickies', async () => {
  const { parseCommand } = await import('../src/nlu.js');
  for (const phrase of ['open my life', 'my life', 'show planner', 'open habit tracker', 'go to my timetable', 'focus timer']) {
    assert.deepEqual(parseCommand(phrase).actions?.[0], { name: 'navigate', input: { screen: 'mylife' } }, phrase);
  }
  assert.equal(parseCommand('open my sticky notes').actions[0].input.screen, 'stickies');
});

// ── alerts: every tab with a time rings through the sticky-reminder scheduler (voice + push) ──
const { computeAlert } = await import('../src/lifeAlerts.js');
const { processDueReminders, stickyDTO } = await import('../src/reminders.js');
const NOW = new Date('2026-10-31T04:30:00Z');             // Sat 10:00 in Asia/Kolkata
const ctx = { tz: 'Asia/Kolkata', now: NOW };

test('alert times: planner task, class (10 min before, weekly), assignment (8:00 on due date), habit (daily)', () => {
  const p = computeAlert('planner', { title: 'Revise', date: '2026-10-31', time: '17:00', done: false }, ctx);
  assert.equal(p.remindAt, '2026-10-31T11:30:00.000Z'); assert.equal(p.repeat, 'none'); assert.match(p.text, /Planner: Revise at 5:00 PM/);
  assert.equal(computeAlert('planner', { title: 'x', date: '2026-10-31', time: '09:00' }, ctx), null);        // already passed
  assert.equal(computeAlert('planner', { title: 'x', date: '2026-11-01', time: '09:00', done: true }, ctx), null);
  assert.equal(computeAlert('planner', { title: 'x', date: '2026-11-01', time: '' }, ctx), null);              // no time, no alert

  const mon = computeAlert('timetable', { subject: 'Physics', day: 0, start: '09:00', end: '10:00', room: 'B2' }, ctx);
  assert.equal(mon.remindAt, '2026-11-02T03:20:00.000Z'); assert.equal(mon.repeat, 'weekly'); assert.match(mon.text, /Physics starts at 9:00 AM · B2/);
  const sat = computeAlert('timetable', { subject: 'Art', day: 5, start: '10:05', end: '11:00' }, ctx);          // today's 09:55 alert has passed
  assert.equal(sat.remindAt, '2026-11-07T04:25:00.000Z');

  const a = computeAlert('assignment', { title: 'Essay', subject: 'English', due: '2026-11-02', status: 'todo' }, ctx);
  assert.equal(a.remindAt, '2026-11-02T02:30:00.000Z'); assert.match(a.text, /Assignment due today: Essay \(English\)/);
  assert.equal(computeAlert('assignment', { title: 'Essay', due: '2026-11-02', status: 'done' }, ctx), null);
  assert.equal(computeAlert('assignment', { title: 'Essay', due: '', status: 'todo' }, ctx), null);

  const h = computeAlert('habit', { name: 'Read', emoji: '📖', remindTime: '20:00', days: [] }, ctx);
  assert.equal(h.remindAt, '2026-10-31T14:30:00.000Z'); assert.equal(h.repeat, 'daily');
  assert.equal(computeAlert('habit', { name: 'Read', remindTime: '20:00', days: ['2026-10-31'] }, ctx).remindAt, '2026-11-01T14:30:00.000Z'); // done today → tomorrow
  assert.equal(computeAlert('habit', { name: 'Read', remindTime: '' }, ctx), null);
});

test('saving an item creates a linked reminder that rings with its tab label; done / delete / edit keep it in step', async () => {
  const a = mk('lih'); const uid = 'id-lih';
  const stickies = () => db.prepare("SELECT * FROM sticky_notes WHERE user_id = ? AND source LIKE 'life:%'").all(uid);
  const it = (await call(a, 'POST', '', { kind: 'planner', timezone: 'Asia/Kolkata', data: { title: 'Mock test', date: '2030-01-01', time: '10:00' } })).body.item;
  assert.equal(stickies().length, 1);
  assert.equal(stickies()[0].source, `life:planner:${it.id}`);

  processDueReminders({ now: new Date('2029-12-31T00:00:00Z') });                              // not yet
  assert.equal(stickies()[0].ringing, 0);
  processDueReminders({ now: new Date('2030-01-01T05:00:00Z') });                              // 10:00 IST
  const rung = stickyDTO(stickies()[0]);
  assert.equal(rung.ringing, true); assert.equal(rung.label, 'Planner'); assert.match(rung.text, /Mock test/);

  await call(a, 'PATCH', `/${it.id}`, { timezone: 'Asia/Kolkata', data: { time: '11:30' } });   // edit → rings again at the new time
  assert.equal(stickies()[0].remind_at, '2030-01-01T06:00:00.000Z'); assert.equal(stickies()[0].ringing, 0);
  await call(a, 'PATCH', `/${it.id}`, { timezone: 'Asia/Kolkata', data: { done: true } });     // done → no more alerts
  assert.equal(stickies().length, 0);
  await call(a, 'PATCH', `/${it.id}`, { timezone: 'Asia/Kolkata', data: { done: false } });
  assert.equal(stickies().length, 1);
  await call(a, 'DELETE', `/${it.id}`);
  assert.equal(stickies().length, 0);
});

test('life alerts stay off the sticky-notes board and do not use up the 100-note limit', async () => {
  const a = mk('lii'); const uid = 'id-lii';
  await call(a, 'POST', '', { kind: 'habit', timezone: 'UTC', data: { name: 'Water', remindTime: '09:00' } });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sticky_notes WHERE user_id = ? AND source LIKE 'life:habit:%'").get(uid).c, 1);
  const { default: sticky } = await import('../src/routes/stickies.js');
  const app2 = express(); app2.use(express.json()); app2.use('/api/stickies', sticky);
  const s2 = app2.listen(0);
  const r = await (await fetch(`http://127.0.0.1:${s2.address().port}/api/stickies`, { headers: { authorization: `Bearer ${a}` } })).json();
  s2.close();
  assert.equal(r.notes.length, 0);
});

test('focus timer: start sets one alert for the end, a new start replaces it, stop clears it', async () => {
  const a = mk('lij'); const uid = 'id-lij';
  const n = () => db.prepare("SELECT * FROM sticky_notes WHERE user_id = ? AND source = 'life:focus:timer'").all(uid);
  assert.equal((await call(a, 'POST', '/focus-alert', { minutes: 0 })).status, 400);
  assert.equal((await call(a, 'POST', '/focus-alert', { minutes: 25, label: 'Maths', timezone: 'UTC' })).status, 201);
  assert.equal(n().length, 1); assert.match(n()[0].text, /Focus session complete — Maths/);
  const due = Date.parse(n()[0].remind_at) - Date.now();
  assert.ok(due > 24.9 * 60000 && due <= 25 * 60000);
  await call(a, 'POST', '/focus-alert', { minutes: 5 });
  assert.equal(n().length, 1);
  assert.equal((await call(a, 'DELETE', '/focus-alert')).status, 200);
  assert.equal(n().length, 0);
});

test('habit reminder time is validated', async () => {
  const a = mk('lik');
  const ok = await call(a, 'POST', '', { kind: 'habit', data: { name: 'Walk', remindTime: '07:30' } });
  assert.equal(ok.body.item.remindTime, '07:30');
  assert.equal((await call(a, 'POST', '', { kind: 'habit', data: { name: 'Walk2', remindTime: '25:99' } })).body.item.remindTime, '');
});

test('alarm: time is required, days are cleaned, on/off survives edits, and it is private', async () => {
  const a = mk('lialarm');
  assert.equal((await call(a, 'POST', '', { kind: 'alarm', data: { label: 'Wake' } })).status, 400);
  const ok = await call(a, 'POST', '', { kind: 'alarm', data: { time: '06:30', label: 'Wake up', days: [4, 0, 0, 9, 'x'] } });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.item.days, [0, 4]);
  assert.equal(ok.body.item.enabled, true);
  assert.equal('song' in ok.body.item, false);                         // alarms no longer carry a song
  const off = await call(a, 'PATCH', `/${ok.body.item.id}`, { data: { enabled: false } });
  assert.equal(off.body.item.enabled, false);
  assert.equal(off.body.item.label, 'Wake up');
  assert.equal((await call(mk('lialarm2'), 'GET', '?kind=alarm')).body.items.length, 0);
});

// ── alarms: a phone notification goes out at the alarm time even when the app is closed ──
const { rearmAlarms } = await import('../src/lifeAlerts.js');

test('alarm alert time: next matching day, off alarms and past times', () => {
  // NOW is Saturday 10:00 in Asia/Kolkata.
  const once = computeAlert('alarm', { label: 'Wake up', time: '06:30', days: [], enabled: true }, ctx);
  assert.equal(once.remindAt, '2026-11-01T01:00:00.000Z');                 // 06:30 has passed today → tomorrow
  assert.equal(once.repeat, 'none'); assert.equal(once.text, 'Wake up · 6:30 AM');
  assert.equal(computeAlert('alarm', { time: '11:00', days: [], enabled: true }, ctx).remindAt, '2026-10-31T05:30:00.000Z');   // still to come today
  assert.equal(computeAlert('alarm', { time: '06:30', days: [0, 1, 2, 3, 4], enabled: true }, ctx).remindAt, '2026-11-02T01:00:00.000Z'); // weekdays → Monday
  assert.equal(computeAlert('alarm', { time: '06:30', days: [], enabled: false }, ctx), null);
});

test('alarm: saving creates a server alert; it rings once, re-arms for the next day, and one-time alarms switch off', async () => {
  const a = mk('lial'); const uid = 'id-lial';
  const stickies = () => db.prepare("SELECT * FROM sticky_notes WHERE user_id = ? AND source LIKE 'life:alarm:%'").all(uid);
  const pushed = [];
  const rep = (await call(a, 'POST', '', { kind: 'alarm', timezone: 'Asia/Kolkata', data: { time: '06:30', label: 'Gym', days: [0, 1, 2, 3, 4] } })).body.item;
  const one = (await call(a, 'POST', '', { kind: 'alarm', timezone: 'Asia/Kolkata', data: { time: '07:00', label: 'Once' } })).body.item;
  assert.equal(stickies().length, 2);
  const sticky = (id) => stickies().find(s => s.source.endsWith(id));

  const t1 = new Date(sticky(one.id).remind_at);
  processDueReminders({ now: new Date(t1.getTime() + 3000), push: () => {} });
  rearmAlarms(new Date(t1.getTime() + 3000));
  assert.ok(sticky(one.id));                                                  // still on for a few minutes
  rearmAlarms(new Date(t1.getTime() + 4 * 60000));
  assert.equal(sticky(one.id), undefined);                                    // done: no more alerts
  assert.equal((await call(a, 'GET', '?kind=alarm')).body.items.find(i => i.id === one.id).enabled, false);   // and the alarm shows as off

  const first = new Date(sticky(rep.id).remind_at);                          // the next weekday 06:30 IST
  processDueReminders({ now: new Date(first.getTime() + 3000), push: (u, n) => pushed.push(n) });
  assert.ok(pushed.some(n => n.source === `life:alarm:${rep.id}` && n.label === 'Alarm' && /Gym/.test(n.text)));   // the phone notification
  rearmAlarms(new Date(first.getTime() + 3000));
  const next = new Date(sticky(rep.id).remind_at);
  assert.ok(next > first); assert.equal(next.getTime() - first.getTime() >= 86400000, true);          // armed for a later day
  assert.equal(sticky(rep.id).fired, 0); assert.equal(sticky(rep.id).ringing, 0);
  assert.equal([1, 2, 3, 4, 5].includes(new Date(next.getTime() + 5.5 * 3600000).getUTCDay()), true); // never a weekend

  await call(a, 'PATCH', `/${rep.id}`, { timezone: 'Asia/Kolkata', data: { enabled: false } });
  assert.equal(stickies().length, 0);                                         // switched off → no phone alert
  await call(a, 'DELETE', `/${rep.id}`);
});

/* ───────── CHEX learn: progress kept per account + leaderboard ───────── */
const prog = (over = {}) => ({ lang: 'es', lvl: 3, xp: 45, gems: 70, hearts: 4, streak: 2, goal: 20, last: 'Sun Nov 01 2026', ...over });

test('learn: one progress record per person, clamped, merged on save, and it never creates a reminder', async () => {
  const a = mk('lea');
  const bad = await call(a, 'POST', '', { kind: 'learn', data: prog({ lang: 'klingon', lvl: 9999, hearts: -5, xp: 'lots', goal: 3, gems: 999, boost: 1, q: { xp: 5 }, pr: { fr: 4, zz: 9 } }) });
  assert.equal(bad.status, 201);
  const it = bad.body.item;
  assert.equal(it.lang, 'es');                       // unknown language code → default
  assert.equal(it.lvl, 108);                         // clamped to the 108-level course
  assert.equal(it.hearts, 0);
  assert.equal(it.xp, 0);                            // junk number → 0
  assert.equal(it.goal, 20);                         // only 10 / 20 / 50 allowed
  assert.equal(it.gems, undefined);                  // the gem economy is gone: unknown fields are never stored
  assert.equal(it.boost, undefined);
  assert.deepEqual(it.pr, { fr: 4 });                // unknown languages are dropped
  assert.equal((await call(a, 'POST', '', { kind: 'learn', data: prog() })).status, 400);   // only one record each
  const up = await call(a, 'PATCH', `/${it.id}`, { data: { xp: 60, lvl: 4 } });
  assert.equal(up.body.item.xp, 60);
  assert.equal(up.body.item.lvl, 4);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sticky_notes WHERE source LIKE 'life:learn:%'").get().n, 0);
});

test('learn: progress is private to its owner', async () => {
  const a = mk('leb'), b = mk('lec');
  const made = await call(a, 'POST', '', { kind: 'learn', data: prog() });
  assert.equal((await call(b, 'GET', '?kind=learn')).body.items.length, 0);
  assert.equal((await call(b, 'PATCH', `/${made.body.item.id}`, { data: { xp: 9999 } })).status, 404);
  assert.equal((await call(b, 'DELETE', `/${made.body.item.id}`)).status, 404);
});

test('learn leaderboard: only you and people you follow, highest XP first, no deactivated accounts', async () => {
  const [me, pal, stranger, gone] = ['lme', 'lpal', 'lstr', 'lgone'].map(mk);
  for (const [tok, xp] of [[me, 30], [pal, 200], [stranger, 999], [gone, 500]]) await call(tok, 'POST', '', { kind: 'learn', data: prog({ xp }) });
  db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)').run('id-lme', 'id-lpal');
  db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)').run('id-lme', 'id-lgone');
  db.prepare("UPDATE users SET account_status = 'deactivated' WHERE id = 'id-lgone'").run();
  const r = await call(me, 'GET', '/learn-board');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.board.map(x => [x.user.username, x.xp, x.me]), [['lpal', 200, false], ['lme', 30, true]]);
  assert.equal((await fetch(`${base}/learn-board`)).status, 401);
});

test('existing databases are upgraded in place: old life_items (no learn kind) keeps its rows and accepts learn', async () => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const file = path.join(os.tmpdir(), `nexa-life-migrate-${process.pid}.db`);
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  const env = { ...process.env, NEXA_DB_PATH: file, PORT: '0' };
  const run = (code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { env, cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' }).trim();
  // 1. make a database the way the previous release did: life_items without 'learn' in its CHECK, with one alarm in it
  run(`
    const { default: db } = await import('./src/db.js');
    db.pragma('foreign_keys = OFF');
    db.exec("DROP TABLE life_items");
    db.exec("CREATE TABLE life_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('planner','timetable','assignment','habit','focus','alarm')), data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))");
    db.prepare("INSERT INTO users (id, username, email, password_hash, display_name) VALUES ('m1','mig','mig@x.com','x','Mig')").run();
    db.prepare("INSERT INTO life_items (id, user_id, kind, data) VALUES ('a1','m1','alarm','{\\"time\\":\\"07:00\\"}')").run();
    let blocked = false; try { db.prepare("INSERT INTO life_items (id, user_id, kind) VALUES ('x','m1','learn')").run(); } catch { blocked = true; }
    if (!blocked) throw new Error('old schema should reject learn');
  `);
  // 2. boot the new code against it
  const out = run(`
    const { default: db } = await import('./src/db.js');
    const old = db.prepare("SELECT kind, data FROM life_items WHERE id = 'a1'").get();
    db.prepare("INSERT INTO life_items (id, user_id, kind, data) VALUES ('l1','m1','learn','{}')").run();
    console.log(JSON.stringify({ old, learnOk: db.prepare("SELECT COUNT(*) n FROM life_items WHERE kind = 'learn'").get().n }));
  `);
  const got = JSON.parse(out.split('\n').pop());
  assert.deepEqual(got.old, { kind: 'alarm', data: '{"time":"07:00"}' });   // nothing lost
  assert.equal(got.learnOk, 1);
});

/* ───────── CHEX learn: 1 CHEX coin per finished section ───────── */
test('learn coins: the server records levels in order, with a speed limit, and pays 1 coin per section', async () => {
  const coins = await import('../src/coins.js');
  const a = mk('coa'); const uid = 'id-coa';
  for (const [l, k] of [['es', 'first'], ['fr', 'unlocked']]) db.prepare('INSERT INTO learn_langs (user_id, lang, kind) VALUES (?,?,?)').run(uid, l, k);
  const t0 = Date.now() - 3_600_000;
  const play = (lang, level, i) => coins.recordLearnLevel(uid, lang, level, t0 + i * 11_000);
  let i = 0;
  // 9 levels in order: the 9th closes Section 1 and pays exactly 1 coin
  const results = Array.from({ length: 9 }, (_, n) => play('es', n, i++));
  assert.deepEqual(results.map(r => r.coins), [0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(coins.getBalance(uid), 1);
  assert.match(db.prepare("SELECT reason FROM coin_ledger WHERE user_id = ? AND ref = 'learn-section:es:1'").get(uid).reason, /Spanish section 1/);
  // replaying a level never pays again
  const again = play('es', 8, i++); assert.deepEqual([again.recorded, again.coins, again.reason], [false, 0, 'already']);
  assert.equal(coins.getBalance(uid), 1);
  // skipping ahead is refused
  const skip = play('es', 20, i++); assert.deepEqual([skip.recorded, skip.coins, skip.reason], [false, 0, 'order']);
  // the next section pays one more; a different language starts its own sections
  const r2 = Array.from({ length: 9 }, (_, n) => play('es', 9 + n, i++));
  assert.equal(r2[8].coins, 1); assert.equal(coins.getBalance(uid), 2);
  const fr = Array.from({ length: 9 }, (_, n) => play('fr', n, i++));
  assert.equal(fr[8].coins, 1); assert.equal(coins.getBalance(uid), 3);
  // you can't finish levels faster than 10 seconds apart
  const fast = coins.recordLearnLevel(uid, 'fr', 9, t0 + (i - 1) * 11_000 + 2_000);
  assert.deepEqual([fast.recorded, fast.reason], [false, 'too-fast']);
});

test('learn coins: HTTP endpoint needs sign-in, validates input, and shows up in the wallet', async () => {
  const a = mk('cob');
  assert.equal((await fetch(`${base}/learn/level`, { method: 'POST' })).status, 401);
  assert.equal((await call(a, 'POST', '/learn/level', { lang: 'klingon', level: 0 })).status, 400);
  assert.equal((await call(a, 'POST', '/learn/level', { lang: 'es', level: 108 })).status, 400);
  assert.equal((await call(a, 'POST', '/learn/level', { lang: 'es', level: 1.5 })).status, 400);
  assert.equal((await call(a, 'POST', '/learn/level', { lang: 'es', level: 0 })).body.reason, 'locked');   // no language chosen yet
  assert.equal((await call(a, 'POST', '/learn/language', { lang: 'es' })).status, 200);
  const ok = await call(a, 'POST', '/learn/level', { lang: 'es', level: 0 });
  assert.deepEqual([ok.status, ok.body.recorded, ok.body.coins, ok.body.balance], [200, true, 0, 0]);
  const dup = await call(a, 'POST', '/learn/level', { lang: 'es', level: 0 });
  assert.equal(dup.body.reason, 'already');
  const skip = await call(a, 'POST', '/learn/level', { lang: 'es', level: 5 });
  assert.equal(skip.body.reason, 'order');
});

test('learn coins: deleting progress or editing the saved level cannot mint coins', async () => {
  const coins = await import('../src/coins.js');
  const a = mk('coc');
  await call(a, 'POST', '/learn/language', { lang: 'es' });
  const made = await call(a, 'POST', '', { kind: 'learn', data: prog({ lvl: 8 }) });
  await call(a, 'PATCH', `/${made.body.item.id}`, { data: { lvl: 108, pr: { es: 108 } } });
  assert.equal(coins.getBalance('id-coc'), 0);                                   // saving progress never pays
  const r = await call(a, 'POST', '/learn/level', { lang: 'es', level: 107 });   // claiming a late level needs the earlier ones
  assert.deepEqual([r.body.recorded, r.body.coins, r.body.reason], [false, 0, 'order']);
  assert.equal(coins.getBalance('id-coc'), 0);
});

/* ───────── CHEX learn: first language free, the rest premium (100 levels + 100 CHEX coins) ───────── */
test('learn languages: pick one free first language; others stay locked until 100 levels are done and 100 coins are paid', async () => {
  const coins = await import('../src/coins.js');
  const a = mk('lga'); const uid = 'id-lga';
  const start = await call(a, 'GET', '/learn/languages');
  assert.deepEqual([start.body.chosen, start.body.owned, start.body.canUnlock, start.body.price, start.body.unlockLevels], [false, [], false, 100, 100]);
  assert.equal((await call(a, 'POST', '/learn/language', { lang: 'klingon' })).status, 400);
  assert.equal((await call(a, 'POST', '/learn/unlock', { lang: 'fr' })).body.error.code, 'CHOOSE_FIRST');
  const first = await call(a, 'POST', '/learn/language', { lang: 'de' });
  assert.deepEqual([first.status, first.body.owned], [200, ['de']]);
  assert.equal((await call(a, 'POST', '/learn/language', { lang: 'fr' })).status, 409);          // the free pick is only once
  // every other language is locked: no levels, no coins
  const locked = await call(a, 'POST', '/learn/level', { lang: 'fr', level: 0 });
  assert.deepEqual([locked.body.recorded, locked.body.reason], [false, 'locked']);
  // play 99 German levels: still not enough
  const t0 = Date.now() - 86_400_000;
  for (let n = 0; n < 99; n++) coins.recordLearnLevel(uid, 'de', n, t0 + n * 11_000);
  assert.equal((await call(a, 'GET', '/learn/languages')).body.canUnlock, false);
  const early = await call(a, 'POST', '/learn/unlock', { lang: 'fr' });
  assert.deepEqual([early.status, early.body.error.code], [403, 'FINISH_LEVELS']);
  // the 100th level opens the door, but it still costs 100 coins (11 sections of 1 coin = 11 so far)
  coins.recordLearnLevel(uid, 'de', 99, t0 + 99 * 11_000);
  assert.equal((await call(a, 'GET', '/learn/languages')).body.canUnlock, true);
  const poor = await call(a, 'POST', '/learn/unlock', { lang: 'fr' });
  assert.deepEqual([poor.status, poor.body.error.code], [402, 'NOT_ENOUGH_COINS']);
  assert.equal(coins.getBalance(uid), 11);
  db.prepare('INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES (?,?,?,?)').run(uid, 100, 'test top-up', 'test:topup');
  const ok = await call(a, 'POST', '/learn/unlock', { lang: 'fr' });
  assert.deepEqual([ok.status, ok.body.owned, ok.body.balance, ok.body.canUnlock], [200, ['de', 'fr'], 11, false]);
  assert.equal((await call(a, 'POST', '/learn/unlock', { lang: 'fr' })).body.error.code, 'OWNED');
  // French works now; a third language needs 100 French levels too
  assert.equal((await call(a, 'POST', '/learn/level', { lang: 'fr', level: 0 })).body.recorded, true);
  assert.equal((await call(a, 'POST', '/learn/unlock', { lang: 'it' })).body.error.code, 'FINISH_LEVELS');
  assert.equal((await fetch(`${base}/learn/languages`)).status, 401);
});

test('learn languages: people who already studied keep the languages they started', async () => {
  const coins = await import('../src/coins.js');
  const a = mk('lgb'); const uid = 'id-lgb';
  const t0 = Date.now() - 86_400_000;
  db.prepare('INSERT INTO learn_levels (user_id, lang, level, completed_at) VALUES (?,?,?,?)').run(uid, 'es', 0, new Date(t0).toISOString());
  db.prepare('INSERT INTO learn_levels (user_id, lang, level, completed_at) VALUES (?,?,?,?)').run(uid, 'ja', 0, new Date(t0 + 5).toISOString());
  const r = await call(a, 'GET', '/learn/languages');
  assert.deepEqual([r.body.chosen, r.body.owned], [true, ['es', 'ja']]);
  assert.equal((await call(a, 'POST', '/learn/language', { lang: 'fr' })).status, 409);
  assert.equal(coins.recordLearnLevel(uid, 'ja', 1, t0 + 20_000).recorded, true);
});
