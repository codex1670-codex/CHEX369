// CHEX Coins: 30 public posts in a month earn 100 coins once; the 1,000-coin store unlock is atomic.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-coins-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
process.env.PORT = '0';

const { default: db } = await import('../src/db.js');
const coins = await import('../src/coins.js');

const mk = (name) => {
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${name}`, name, `${name}@x.com`, 'x', name);
  return `id-${name}`;
};
const post = (uid, n, audience = 'public') => {
  for (let i = 0; i < n; i++) db.prepare('INSERT INTO posts (id, user_id, caption, audience) VALUES (?,?,?,?)').run(`${uid}-${audience}-${Math.random()}`, uid, 'hi', audience);
};

test('29 public posts earn nothing, the 30th earns 100 once per month', () => {
  const u = mk('amy');
  post(u, 29);
  assert.equal(coins.awardMonthlyIfEarned(u), 0);
  post(u, 1);
  assert.equal(coins.awardMonthlyIfEarned(u), 100);
  assert.equal(coins.awardMonthlyIfEarned(u), 0);   // already claimed this month
  post(u, 5);
  assert.equal(coins.awardMonthlyIfEarned(u), 0);
  assert.equal(coins.getBalance(u), 100);
});

test('follower-only posts do not count toward the goal', () => {
  const u = mk('ben');
  post(u, 40, 'followers');
  assert.equal(coins.awardMonthlyIfEarned(u), 0);
  assert.equal(coins.getBalance(u), 0);
});

test('unlock needs 1,000 coins, charges once and is not repeatable', () => {
  const u = mk('cat');
  assert.equal(coins.unlockItem(u, 'premium-themes').error.code, 'NOT_ENOUGH_COINS');
  db.prepare("INSERT INTO coin_ledger (user_id, amount, reason) VALUES (?, 1050, 'test')").run(u);
  assert.equal(coins.unlockItem(u, 'premium-themes').ok, true);
  assert.equal(coins.getBalance(u), 50);
  assert.deepEqual(coins.ownedItems(u), ['premium-themes']);
  assert.equal(coins.unlockItem(u, 'premium-themes').error.code, 'ALREADY_OWNED');
  assert.equal(coins.getBalance(u), 50);
  assert.equal(coins.unlockItem(u, 'nope').error.code, 'UNKNOWN_ITEM');
});

test('summary shows progress and store state', () => {
  const u = mk('dan');
  post(u, 12);
  const s = coins.coinsSummary(u);
  assert.equal(s.monthly.count, 12);
  assert.equal(s.monthly.goal, 30);
  assert.equal(s.items[0].owned, false);
  assert.equal(s.items[0].price, 1000);
});

// ── repeated / copied posts ───────────────────────────────────────────────────────────────────
const mkPost = (uid, caption, image = null, audience = 'public') => {
  const id = `p-${Math.random().toString(36).slice(2)}`;
  db.prepare('INSERT INTO posts (id, user_id, caption, image_url, audience) VALUES (?,?,?,?,?)').run(id, uid, caption, image, audience);
  return coins.checkPostContent(id);
};

test('your own repeated text post (any case/spacing/emoji) is flagged "repeat"', () => {
  const u = mk('eve');
  assert.deepEqual(mkPost(u, 'Good morning everyone'), { counted: true, reason: null });
  assert.deepEqual(mkPost(u, '  good MORNING, everyone!! 🌞'), { counted: false, reason: 'repeat' });
  assert.deepEqual(mkPost(u, 'A different post'), { counted: true, reason: null });
});

test('the same picture twice is a repeat; someone else posting it later is a copy', () => {
  const a = mk('fay'), b = mk('gus');
  assert.equal(mkPost(a, 'sunset', 'https://img.example/sunset.jpg').counted, true);
  assert.equal(mkPost(a, 'sunset again, new words', 'https://img.example/sunset.jpg').reason, 'repeat');
  assert.equal(mkPost(b, 'mine!', 'https://img.example/sunset.jpg').reason, 'copy');
  assert.equal(mkPost(b, 'sunset', 'https://img.example/other.jpg').counted, true);   // same caption, different picture = different post
});

test('long identical text from someone else is a copy; short common text is not', () => {
  const a = mk('hal'), b = mk('ivy');
  const long = 'Believe in yourself and every door will open for you';
  assert.equal(mkPost(a, long).counted, true);
  assert.equal(mkPost(b, long).reason, 'copy');
  assert.equal(mkPost(a, 'Hello world').counted, true);
  assert.equal(mkPost(b, 'Hello world').counted, true);
});

test('only counted posts add up to the 30-post goal', () => {
  const u = mk('jon');
  for (let i = 0; i < 25; i++) mkPost(u, `unique post number ${i}`);
  for (let i = 0; i < 10; i++) mkPost(u, 'same thing again');            // 1 counts, 9 are repeats
  assert.equal(coins.publicPostsInMonth(u), 26);
  assert.equal(coins.awardMonthlyIfEarned(u), 0);
  for (let i = 25; i < 29; i++) mkPost(u, `unique post number ${i}`);
  assert.equal(coins.publicPostsInMonth(u), 30);
  assert.equal(coins.awardMonthlyIfEarned(u), 100);
});

// ── game wins ─────────────────────────────────────────────────────────────────────────────────
const room = (a, b) => {
  const gameId = db.prepare('SELECT id FROM games LIMIT 1').get().id;
  const id = `room-${Math.random().toString(36).slice(2)}`;
  db.prepare("INSERT INTO game_rooms (id, game_id, host_id, invite_code, capacity, status) VALUES (?,?,?,?,2,'finished')").run(id, gameId, a, id.slice(-8));
  db.prepare('INSERT INTO game_players (room_id, user_id, slot) VALUES (?,?,0)').run(id, a);
  if (b) db.prepare('INSERT INTO game_players (room_id, user_id, slot) VALUES (?,?,1)').run(id, b);
  return id;
};

test('a game win pays 1 coin, once per game; draws and solo rooms pay nothing', () => {
  const a = mk('kim'), b = mk('lou');
  const r = room(a, b);
  assert.equal(coins.awardGameWin(r, a), 1);
  assert.equal(coins.awardGameWin(r, a), 0);          // same game twice
  assert.equal(coins.awardGameWin(room(a, b), 'draw'), 0);
  assert.equal(coins.awardGameWin(room(a, null), a), 0);
  assert.equal(coins.awardGameWin(room(a, b), 'someone-else'), 0);
  assert.equal(coins.getBalance(a), 1);
  assert.equal(coins.getBalance(b), 0);
});

test('game-win coins stop at the daily cap', () => {
  const a = mk('max'), b = mk('nia');
  for (let i = 0; i < coins.COIN_RULES.gameWinDailyCap + 5; i++) coins.awardGameWin(room(a, b), a);
  assert.equal(coins.getBalance(a), coins.COIN_RULES.gameWinDailyCap);
});

test('finishing a real game room pays the winner and notifies them live', async () => {
  const { finishRoom } = await import('../src/gameEngine.js');
  const a = mk('oli'), b = mk('pam');
  const id = room(a, b);
  db.prepare("UPDATE game_rooms SET status = 'active' WHERE id = ?").run(id);
  const sent = [];
  const io = { to: (target) => ({ emit: (ev, payload) => sent.push({ target, ev, payload }) }) };
  finishRoom(io, id, a);
  assert.equal(coins.getBalance(a), 1);
  assert.equal(coins.getBalance(b), 0);
  assert.deepEqual(sent.find(s => s.ev === 'coins:earned'), { target: `user:${a}`, ev: 'coins:earned', payload: { amount: 1, reason: 'Game win' } });
  finishRoom(io, id, a);                                   // already finished: no second coin
  assert.equal(coins.getBalance(a), 1);
});

// ── 30-day posting streak ─────────────────────────────────────────────────────────────────────
const at = (day, time = '12:00:00') => `${day}T${time}.000Z`;
const share = (uid, day, kind = 'posts', time) => {
  const id = `s-${Math.random().toString(36).slice(2)}`;
  if (kind === 'posts') db.prepare("INSERT INTO posts (id, user_id, caption, audience, created_at) VALUES (?,?,?,?,?)").run(id, uid, `c ${id}`, 'public', at(day, time));
  else db.prepare('INSERT INTO reels (id, user_id, video_url, caption, created_at) VALUES (?,?,?,?,?)').run(id, uid, `https://v.example/${id}.mp4`, 'r', at(day, time));
  return id;
};
const noon = (day) => new Date(at(day));
const addD = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

test('streak: Start → Day 1 today; posts and reels both count; summary shows progress', () => {
  const u = mk('streak1');
  assert.equal(coins.streakSummary(u).status, 'idle');
  assert.equal(coins.startStreak(u, 'UTC', noon('2026-03-01')).ok, true);
  assert.equal(coins.startStreak(u, 'UTC', noon('2026-03-01')).error.code, 'ALREADY_ACTIVE');
  let s = coins.streakSummary(u, noon('2026-03-01'));
  assert.deepEqual([s.status, s.dayNumber, s.done, s.todayDone], ['active', 1, 0, false]);
  share(u, '2026-03-01', 'posts');
  share(u, '2026-03-02', 'reels');
  s = coins.streakSummary(u, noon('2026-03-02'));
  assert.deepEqual([s.dayNumber, s.done, s.todayDone, s.marks.slice(0, 3)], [2, 2, true, ['done', 'done', 'future']]);
});

test('streak: one missed day ends it, and Start begins again from Day 1', () => {
  const u = mk('streak2');
  coins.startStreak(u, 'UTC', noon('2026-04-01'));
  share(u, '2026-04-01'); share(u, '2026-04-02');
  // nothing on 04-03, so by 04-04 it is over
  let s = coins.streakSummary(u, noon('2026-04-03'));
  assert.equal(s.status, 'active');                   // today (04-03) isn't over yet
  s = coins.streakSummary(u, noon('2026-04-04'));
  assert.deepEqual([s.status, s.brokenOn, s.best], ['broken', '2026-04-03', 2]);
  assert.equal(coins.startStreak(u, 'UTC', noon('2026-04-04')).ok, true);
  s = coins.streakSummary(u, noon('2026-04-04'));
  assert.deepEqual([s.status, s.dayNumber, s.done], ['active', 1, 0]);   // back to Day 1
  assert.equal(coins.getBalance(u), 0);
});

test('streak: 30 days in a row pays 100 coins once, then can be run again', () => {
  const u = mk('streak3');
  const start = '2026-05-01';
  coins.startStreak(u, 'UTC', noon(start));
  for (let i = 0; i < 29; i++) share(u, addD(start, i), i % 2 ? 'reels' : 'posts');
  assert.equal(coins.streakSummary(u, noon(addD(start, 28))).done, 29);
  assert.equal(coins.getBalance(u), 0);
  share(u, addD(start, 29));
  assert.equal(coins.evaluateStreak(u, noon(addD(start, 29))).justCompleted, true);
  assert.equal(coins.getBalance(u), 100);
  assert.equal(coins.evaluateStreak(u, noon(addD(start, 30))).justCompleted, false);   // never paid twice
  assert.equal(coins.getBalance(u), 100);
  assert.deepEqual([coins.streakSummary(u).status, coins.streakSummary(u).completedRuns], ['completed', 1]);
  // second run: the post that finished run 1 can't also be Day 1 of run 2
  const finishDay = addD(start, 29);
  const later = new Date(at(finishDay, '18:00:00'));
  assert.equal(coins.startStreak(u, 'UTC', later).ok, true);
  assert.equal(coins.streakSummary(u, later).done, 0);
});

test('streak: repeated posts and deleted posts do not keep it alive', () => {
  const u = mk('streak4');
  coins.startStreak(u, 'UTC', noon('2026-06-01'));
  const a = share(u, '2026-06-01');
  share(u, '2026-06-02');
  db.prepare('UPDATE posts SET coin_eligible = 0 WHERE id = ?').run(share(u, '2026-06-03'));   // a repeat
  assert.equal(coins.streakSummary(u, noon('2026-06-04')).status, 'broken');
  const v = mk('streak5');
  coins.startStreak(v, 'UTC', noon('2026-06-01'));
  const p = share(v, '2026-06-01'); share(v, '2026-06-02');
  db.prepare("UPDATE posts SET deleted_at = '2026-06-02T13:00:00.000Z' WHERE id = ?").run(p);
  assert.equal(coins.streakSummary(v, noon('2026-06-03')).status, 'broken');
  assert.ok(a);
});

test('streak: days follow the time zone chosen at Start (IST midnight is 18:30 UTC)', () => {
  const u = mk('streak6');
  const start = new Date('2026-07-01T19:00:00.000Z');          // 2026-07-02 00:30 in Kolkata
  coins.startStreak(u, 'Asia/Kolkata', start);
  assert.equal(coins.streakSummary(u, start).today, '2026-07-02');
  db.prepare("INSERT INTO posts (id, user_id, caption, audience, created_at) VALUES ('tz1',?,'x','public','2026-07-01T20:00:00.000Z')").run(u);
  assert.equal(coins.streakSummary(u, new Date('2026-07-02T06:00:00.000Z')).todayDone, true);
  assert.equal(coins.startStreak(mk('streak7'), 'Not/AZone', start).ok, true);                // bad zone falls back to UTC
});

test('same reel video twice is a repeat; a post reusing someone else’s reel is a copy', () => {
  const a = mk('reelA'), b = mk('reelB');
  const mkReel = (uid, url, t) => { const id = `r-${Math.random().toString(36).slice(2)}`; db.prepare('INSERT INTO reels (id, user_id, video_url, caption, created_at) VALUES (?,?,?,?,?)').run(id, uid, url, '', t); return coins.checkReelContent(id); };
  assert.equal(mkReel(a, 'https://v.example/one.mp4', '2026-08-01T10:00:00.000Z').counted, true);
  assert.equal(mkReel(a, 'https://v.example/one.mp4', '2026-08-02T10:00:00.000Z').reason, 'repeat');
  assert.equal(mkReel(b, 'https://v.example/one.mp4', '2026-08-03T10:00:00.000Z').reason, 'copy');
  const pid = 'post-of-reel'; db.prepare("INSERT INTO posts (id, user_id, caption, image_url, audience, created_at) VALUES (?,?,?,?, 'public', ?)").run(pid, b, 'again', 'https://v.example/one.mp4', '2026-08-04T10:00:00.000Z');
  assert.equal(coins.checkPostContent(pid).counted, false);
});

test('premium frames cost 2,000 coins, need the unlock to be equipped, and show on the public user', () => {
  const u = mk('frida');
  const item = coins.STORE_ITEMS.find(i => i.id === 'premium-frames');
  assert.equal(item.price, 2000);
  assert.equal(coins.PROFILE_FRAMES.length >= 10, true);
  assert.equal(coins.STORE_ITEMS.find(i => i.id === 'premium-themes').price, 1000);
  assert.equal(coins.setFrame(u, 'golden').error.code, 'FRAMES_LOCKED');
  db.prepare("INSERT INTO coin_ledger (user_id, amount, reason) VALUES (?, 2100, 'test')").run(u);
  assert.equal(coins.unlockItem(u, 'premium-frames').ok, true);
  assert.equal(coins.getBalance(u), 100);
  assert.equal(coins.unlockItem(u, 'premium-frames').error.code, 'ALREADY_OWNED');
  assert.equal(coins.setFrame(u, 'nope').error.code, 'UNKNOWN_FRAME');
  assert.equal(coins.setFrame(u, 'galaxy').ok, true);
  assert.equal(coins.coinsSummary(u).frame, 'galaxy');
  const row = db.prepare('SELECT id, username, display_name, avatar_color, avatar_photo_url, profile_frame FROM users WHERE id = ?').get(u);
  return import('../src/db.js').then(m => {
    assert.equal(m.toPublicUser(row).frame, 'galaxy');
    assert.equal(coins.setFrame(u, null).ok, true);
    assert.equal(coins.coinsSummary(u).frame, null);
  });
});
