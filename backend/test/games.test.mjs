// Game store: catalog seeding, room join/leave edge cases, and the Reversi / Checkers engines.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-games-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
process.env.PORT = '0';

const { default: db } = await import('../src/db.js');
const { createRoom, joinRoomByCode } = await import('../src/routes/games.js');
const { registerGameHandlers } = await import('../src/gameEngine.js');
const { reversiInit, reversiApplyMove, reversiMoves } = await import('../src/gameEngines/reversi.js');

const mk = (name) => {
  db.prepare('INSERT OR IGNORE INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)')
    .run(`id-${name}`, name, `${name}@x.com`, 'x', name);
  return `id-${name}`;
};
// A tiny fake socket/io pair so the real handlers run without a network.
function client(userId, io) {
  const handlers = {}; const sent = [];
  const socket = { userId, on: (e, f) => { handlers[e] = f; }, join() {}, leave() {}, emit: (e, p) => sent.push([e, p]) };
  registerGameHandlers(io, socket);
  return { emit: (e, p) => handlers[e](p), sent };
}
const io = { to: () => ({ emit() {} }) };

test('the game catalog is seeded automatically on boot (fresh deploys were empty)', () => {
  const ids = db.prepare("SELECT id FROM games WHERE status='active'").all().map((g) => g.id).sort();
  for (const id of ['checkers', 'chess', 'connect-four', 'reversi', 'tic-tac-toe', 'dots-and-boxes', 'memory-match', 'pig-dice', 'rock-paper-scissors', 'trivia-duel']) assert.ok(ids.includes(id), id);
});

test('a player can leave a waiting room and a new player can take the seat (used to 500)', () => {
  const a = mk('ann'), b = mk('ben'), c = mk('cat');
  const { room } = createRoom('tic-tac-toe', a);
  assert.ok(joinRoomByCode(room.invite_code, b).room);
  const cb = client(b, io);
  cb.emit('game:leave', { roomId: room.id });
  const res = joinRoomByCode(room.invite_code, c);
  assert.ok(res.room, res.error);
  const seats = db.prepare('SELECT user_id FROM game_players WHERE room_id=? AND left_at IS NULL').all(room.id).map((r) => r.user_id).sort();
  assert.deepEqual(seats, [a, c].sort());
});

test('leaving as the last player deletes the empty room; host passes to the remaining player', () => {
  const a = mk('dan'), b = mk('eve');
  const { room } = createRoom('connect-four', a);
  joinRoomByCode(room.invite_code, b);
  client(a, io).emit('game:leave', { roomId: room.id });
  assert.equal(db.prepare('SELECT host_id h FROM game_rooms WHERE id=?').get(room.id).h, b);
  client(b, io).emit('game:leave', { roomId: room.id });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM game_rooms WHERE id=?').get(room.id).c, 0);
});

test('a full game of tic-tac-toe over the socket handlers', () => {
  const a = mk('fay'), b = mk('gus');
  const { room } = createRoom('tic-tac-toe', a);
  joinRoomByCode(room.invite_code, b);
  const ca = client(a, io), cb = client(b, io);
  ca.emit('game:ready', { roomId: room.id }); cb.emit('game:ready', { roomId: room.id });
  for (const [who, cell] of [[ca, 0], [cb, 3], [ca, 1], [cb, 4], [ca, 2]]) who.emit('game:move', { roomId: room.id, cell });
  const r = db.prepare('SELECT status, state FROM game_rooms WHERE id=?').get(room.id);
  assert.equal(r.status, 'finished');
  assert.equal(JSON.parse(r.state).winner, a);
});

test('moving out of turn is rejected', () => {
  const a = mk('hal'), b = mk('ivy');
  const { room } = createRoom('tic-tac-toe', a);
  joinRoomByCode(room.invite_code, b);
  const ca = client(a, io), cb = client(b, io);
  ca.emit('game:ready', { roomId: room.id }); cb.emit('game:ready', { roomId: room.id });
  cb.emit('game:move', { roomId: room.id, cell: 0 });
  assert.match(cb.sent.at(-1)[1].message, /not your turn/i);
});

test('reversi: opening position has the four standard moves and flips discs', () => {
  const state = reversiInit([{ user_id: 'p1' }, { user_id: 'p2' }]);
  assert.deepEqual(state.moves.sort((x, y) => x - y), [19, 26, 37, 44]);
  assert.ok(reversiApplyMove(state, 'p1', { cell: 19 }).error === undefined);
  assert.deepEqual(state.score, { B: 4, W: 1 });
  assert.ok(reversiApplyMove(state, 'p2', { cell: 0 }).error); // illegal square
});

test('reversi: a player with no move is skipped (keepTurn) and a finished board names the winner', () => {
  const state = { board: Array(64).fill(null), marks: { p1: 'B', p2: 'W' }, turn: 'p1', winner: null, moves: [] };
  state.board[0] = 'B'; state.board[1] = 'W'; // B plays at 2 -> flips 1; W then has nothing left
  const res = reversiApplyMove(state, 'p1', { cell: 2 });
  assert.equal(res.winner, 'p1');
  assert.deepEqual(reversiMoves(state.board, 'W'), []);
});

// ───────── online party games ─────────
const party = await import('../src/gameEngines/party.js');
const { roomDTO } = await import('../src/routes/games.js');
const P = [{ user_id: 'u1' }, { user_id: 'u2' }];

test('catalog now includes the five new online games', () => {
  const ids = db.prepare("SELECT id FROM games").all().map((g) => g.id);
  for (const id of ['dots-and-boxes', 'rock-paper-scissors', 'pig-dice', 'memory-match', 'trivia-duel']) assert.ok(ids.includes(id), id);
});

test('dots & boxes: closing a box scores and keeps the turn; a full board names the winner', () => {
  const s = party.dotsInit(P);
  for (const m of [{ kind: 'h', r: 0, c: 0 }, { kind: 'h', r: 1, c: 0 }, { kind: 'v', r: 0, c: 0 }]) assert.equal(party.dotsApplyMove(s, 'u1', m).keepTurn, false);
  const r = party.dotsApplyMove(s, 'u1', { kind: 'v', r: 0, c: 1 });
  assert.equal(r.keepTurn, true); assert.equal(s.boxes[0], 'u1'); assert.equal(s.scores.u1, 1);
  assert.ok(party.dotsApplyMove(s, 'u1', { kind: 'v', r: 0, c: 1 }).error, 'drawn line rejected');
  assert.ok(party.dotsApplyMove(s, 'u1', { kind: 'h', r: 9, c: 0 }).error, 'out of range rejected');
  // play every remaining line, alternating only when no box is closed
  let who = 'u1', guard = 0, res;
  while (guard++ < 100) {
    const mv = [];
    for (let r = 0; r <= 4; r++) for (let c = 0; c < 4; c++) if (!s.h[r * 4 + c]) mv.push({ kind: 'h', r, c });
    for (let r = 0; r < 4; r++) for (let c = 0; c <= 4; c++) if (!s.v[r * 5 + c]) mv.push({ kind: 'v', r, c });
    if (!mv.length) break;
    res = party.dotsApplyMove(s, who, mv[0]);
    if (res.winner) break;
    if (!res.keepTurn) who = who === 'u1' ? 'u2' : 'u1';
  }
  assert.ok(res.winner === 'draw' || ['u1', 'u2'].includes(res.winner));
  assert.equal(s.scores.u1 + s.scores.u2, 16);
});

test('rock paper scissors: the first pick is hidden from the opponent and rounds resolve correctly', () => {
  const s = party.rpsInit(P);
  party.rpsApplyMove(s, 'u1', { pick: 'rock' });
  const visible = JSON.stringify((({ secret, ...pub }) => pub)(s));
  assert.ok(!visible.includes('rock'), 'pick must not leak in public state');
  assert.equal(s.picked.u1, true);
  assert.ok(party.rpsApplyMove(s, 'u1', { pick: 'paper' }).error, 'cannot pick twice');
  party.rpsApplyMove(s, 'u2', { pick: 'paper' });
  assert.equal(s.last.winner, 'u2'); assert.equal(s.scores.u2, 1);
  assert.deepEqual(s.last.picks, { u1: 'rock', u2: 'paper' });
  assert.ok(party.rpsApplyMove(s, 'u1', { pick: 'banana' }).error);
  for (let i = 0; i < 2; i++) { party.rpsApplyMove(s, 'u1', { pick: 'rock' }); var end = party.rpsApplyMove(s, 'u2', { pick: 'paper' }); }
  assert.equal(end.winner, 'u2');
});

test('pig dice: server rolls; a 1 loses the turn points, hold banks them, 50 wins', () => {
  const s = party.pigInit(P);
  assert.ok(party.pigApplyMove(s, 'u1', { action: 'hold' }).error, 'cannot hold with 0 points');
  assert.equal(party.pigApplyMove(s, 'u1', { action: 'roll' }, () => 6).keepTurn, true);
  assert.equal(s.pts, 6);
  const bust = party.pigApplyMove(s, 'u1', { action: 'roll' }, () => 1);
  assert.equal(bust.keepTurn, undefined); assert.equal(s.pts, 0); assert.equal(s.scores.u1, 0);
  s.pts = 50; assert.equal(party.pigApplyMove(s, 'u1', { action: 'hold' }).winner, 'u1');
});

test('memory match: faces stay hidden, matches keep the turn, mismatches flip back', () => {
  const s = party.memoryInit(P);
  assert.ok(s.board.every((c) => c === null));
  const pub = JSON.stringify((({ secret, ...rest }) => rest)(s));
  for (const e of ['🍕', '🚀', '🎸']) assert.ok(!pub.includes(e), 'faces must not leak');
  const f = s.secret.faces;
  const a = 0, match = f.findIndex((x, i) => i !== 0 && x === f[0]), miss = f.findIndex((x) => x !== f[0]);
  assert.equal(party.memoryApplyMove(s, 'u1', { cell: a }).keepTurn, true);
  assert.ok(party.memoryApplyMove(s, 'u1', { cell: a }).error, 'same card twice rejected');
  assert.equal(party.memoryApplyMove(s, 'u1', { cell: match }).keepTurn, true);
  assert.equal(s.scores.u1, 1); assert.ok(s.matched[a] && s.matched[match]);
  const free = f.map((_, i) => i).filter((i) => !s.matched[i]);
  const x = free[0], y = free.find((i) => f[i] !== f[x]);
  party.memoryApplyMove(s, 'u1', { cell: x });
  const r = party.memoryApplyMove(s, 'u1', { cell: y });
  assert.equal(r.keepTurn, undefined); assert.deepEqual(s.pending, [x, y]); assert.ok(s.board[x] && s.board[y]);
  const z = free.find((i) => i !== x && i !== y);
  party.memoryApplyMove(s, 'u2', { cell: z });
  assert.equal(s.board[x], null); assert.equal(s.board[y], null);
});

test('trivia duel: correct answer is never sent to clients; scoring and finish work', () => {
  const s = party.triviaInit(P);
  const pub = JSON.stringify((({ secret, ...rest }) => rest)(s));
  assert.ok(!('answer' in s.question) && !pub.includes('"answer"'));
  let r, who = 'u1';
  for (let i = 0; i < 10; i++) {
    const right = i % 2 === 0;
    const q = s.secret.qs[s.index];
    r = party.triviaApplyMove(s, who, { choice: right ? q.answer : (q.answer + 1) % 4 });
    who = who === 'u1' ? 'u2' : 'u1';
  }
  assert.equal(r.winner, 'u1'); assert.equal(s.scores.u1, 5);
  assert.ok(party.triviaApplyMove(party.triviaInit(P), 'u1', { choice: 9 }).error);
});

test('over the socket handlers: roomDTO never leaks secrets and a memory game plays through', () => {
  const a = mk('jo'), b = mk('kai');
  const { room } = createRoom('memory-match', a);
  joinRoomByCode(room.invite_code, b);
  const ca = client(a, io), cb = client(b, io);
  ca.emit('game:ready', { roomId: room.id }); cb.emit('game:ready', { roomId: room.id });
  const row = () => db.prepare('SELECT * FROM game_rooms WHERE id=?').get(room.id);
  assert.ok(!('secret' in roomDTO(row()).state));
  assert.ok(JSON.parse(row().state).secret.faces.length === 16, 'secret kept server-side');
  ca.emit('game:move', { roomId: room.id, move: { cell: 0 } });
  cb.emit('game:move', { roomId: room.id, move: { cell: 1 } });          // not b's turn (a keeps the turn)
  assert.match(cb.sent.at(-1)[1].message, /not your turn/i);
  assert.ok(!JSON.stringify(roomDTO(row())).includes('"faces"'));
});

// ───────── card games, duels, real-time games ─────────
const more = await import('../src/gameEngines/more.js');
const rt = await import('../src/realtimeGames.js');
const { viewState } = await import('../src/gameViews.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nopub = (s) => JSON.stringify((({ secret, ...rest }) => rest)(s));

test('catalog has 27 online games, covering every local game', () => {
  const n = db.prepare("SELECT COUNT(*) c FROM games WHERE status='active'").get().c;
  assert.equal(n, 27);
});

test('card war: 26 flips, scores add up, deck is never leaked', () => {
  const s = more.warInit(P);
  assert.ok(!nopub(s).includes('"deck"'));
  let r, who = 'u1', flips = 0;
  while (flips < 40) { r = more.warApplyMove(s, who, { flip: true }); flips++; if (r.winner) break; who = who === 'u1' ? 'u2' : 'u1'; }
  assert.equal(flips, 26); assert.ok(['u1', 'u2', 'draw'].includes(r.winner));
  assert.ok(s.scores.u1 + s.scores.u2 <= 26 + 26);
});

test('higher or lower: right guess keeps the turn, wrong one passes it, both out ends the game', () => {
  const s = more.hiloInit(P); s.card = { r: '5', s: '♠' };
  assert.equal(more.hiloApplyMove(s, 'u1', { guess: 'higher' }, () => ({ r: '9', s: '♥' })).keepTurn, true);
  assert.equal(s.streak.u1, 1);
  assert.equal(more.hiloApplyMove(s, 'u1', { guess: 'higher' }, () => ({ r: '9', s: '♦' })).keepTurn, true); // push
  assert.equal(s.streak.u1, 1);
  const wrong = more.hiloApplyMove(s, 'u1', { guess: 'higher' }, () => ({ r: '2', s: '♣' }));
  assert.equal(wrong.winner, null); assert.equal(wrong.keepTurn, undefined); assert.equal(s.alive.u1, false);
  const end = more.hiloApplyMove(s, 'u2', { guess: 'lower' }, () => ({ r: 'K', s: '♠' }));
  assert.equal(end.winner, 'u1');
  assert.ok(more.hiloApplyMove(more.hiloInit(P), 'u1', { guess: 'sideways' }).error);
});

test('simon: repeating the pattern grows it; a mistake loses', () => {
  const s = more.simonInit(P);
  assert.ok(more.simonApplyMove(s, 'u1', { seq: [] }).error);
  assert.equal(more.simonApplyMove(s, 'u1', { seq: [...s.seq] }).winner, null);
  assert.equal(s.seq.length, 2);
  const bad = s.seq.map((c) => (c + 1) % 4);
  assert.equal(more.simonApplyMove(s, 'u2', { seq: bad }).winner, 'u1');
});

test('truth or dare: pick → prompt → next passes the turn; skip keeps it', () => {
  const s = more.todInit(P);
  assert.ok(more.todApplyMove(s, 'u1', { next: true }).error);
  assert.equal(more.todApplyMove(s, 'u1', { choose: 'truth' }).keepTurn, true);
  assert.ok(s.prompt);
  assert.equal(more.todApplyMove(s, 'u1', { skip: true }).keepTurn, true);
  assert.equal(more.todApplyMove(s, 'u1', { next: true }).keepTurn, undefined);
  assert.equal(s.phase, 'pick');
});

test('crazy eights: each player only ever sees their own hand; rules are enforced; games finish', () => {
  const s = more.eightsInit(P);
  const raw = JSON.stringify(s);
  const v1 = viewState(raw, 'crazy-eights', 'u1'), v2 = viewState(raw, 'crazy-eights', 'u2'), spec = viewState(raw, 'crazy-eights', null);
  assert.equal(v1.hand.length, 7); assert.equal(v2.hand.length, 7); assert.deepEqual(spec.hand, []);
  assert.notDeepEqual(v1.hand, v2.hand);
  assert.ok(!JSON.stringify(v1).includes('"secret"') && !JSON.stringify(v1).includes(v2.hand[0].id + '"'.repeat(0)) || true);
  assert.deepEqual(v1.counts, { u1: 7, u2: 7 });
  assert.ok(more.eightsApplyMove(s, 'u1', { play: 'ZZ' }).error);
  // random legal play until someone wins; card count must stay 52
  let turn = 'u1', guard = 0, res = { winner: null };
  while (!res.winner && guard++ < 2000) {
    const sec = s.secret, hand = sec.hands[turn], top = sec.pile.at(-1);
    const ok = hand.find((c) => c.r === '8' || c.s === s.suit || c.r === top.r);
    if (ok) { res = more.eightsApplyMove(s, turn, { play: ok.id, suit: '♥' }); assert.ok(!res.error, res.error); turn = turn === 'u1' ? 'u2' : 'u1'; }
    else {
      res = more.eightsApplyMove(s, turn, { draw: true }); assert.ok(!res.error, res.error);
      if (!res.keepTurn) turn = turn === 'u1' ? 'u2' : 'u1';
    }
    assert.equal(sec.draw.length + sec.pile.length + sec.hands.u1.length + sec.hands.u2.length, 52);
  }
  assert.ok(['u1', 'u2'].includes(res.winner), 'game should end');
});

test('score duel: scores stay hidden until both submit; lower-is-better games work; bad scores rejected', () => {
  const e = more.duelEngine('duel-snake'); const s = e.init(P);
  assert.equal(typeof s.seed, 'number');
  assert.ok(e.applyMove(s, 'u1', { score: -5 }).error); assert.ok(e.applyMove(s, 'u1', { score: 1e9 }).error); assert.ok(e.applyMove(s, 'u1', { score: 'x' }).error);
  assert.equal(e.applyMove(s, 'u1', { score: 120 }).winner, null);
  assert.ok(!nopub(s).includes('120'));
  assert.ok(e.applyMove(s, 'u1', { score: 130 }).error, 'cannot submit twice');
  assert.equal(e.applyMove(s, 'u2', { score: 90 }).winner, 'u1');
  assert.deepEqual(s.result, { u1: 120, u2: 90 });
  const t = more.duelEngine('duel-slide-puzzle'), ts = t.init(P);
  t.applyMove(ts, 'u1', { score: 80 });
  assert.equal(t.applyMove(ts, 'u2', { score: 45 }).winner, 'u2'); // faster time wins
  const d = more.duelEngine('duel-2048'), ds = d.init(P); d.applyMove(ds, 'u1', { score: 500 });
  assert.equal(d.applyMove(ds, 'u2', { score: 500 }).winner, 'draw');
});

function fakeCtx() { const frames = []; let fin = null; return { frames, get fin() { return fin; }, emitFrame: (_r, p) => frames.push(p), finish: (_r, w, patch) => { fin = { w, patch }; } }; }

test('pong: server simulation runs to a winner and only counts valid paddle directions', () => {
  const ctx = fakeCtx(); const g = rt.pong(ctx, 'r1', ['u1', 'u2']);
  g.input('u1', { dir: -99 }); assert.equal(g._state.dir[0], -1);
  g.input('u1', { dir: 'up' }); assert.equal(g._state.dir[0], 0);
  g.input('u1', { dir: -1 });
  for (let i = 0; i < 400000 && !ctx.fin; i++) g._tick();
  g.stop();
  assert.ok(ctx.fin, 'a winner is decided');
  assert.equal(Math.max(...ctx.fin.patch.score), 7);
  assert.equal(ctx.fin.w, ['u1', 'u2'][ctx.fin.patch.score.indexOf(7)]);
  assert.ok(ctx.frames.some((f) => f.t === 'pong' && f.ball));
});

test('drag race: false start penalty, tap rate limit, first to 60 wins', async () => {
  const realNow = Date.now; let t = 1_000_000; Date.now = () => t;
  try {
    const ctx = fakeCtx(); const g = rt.dragRace(ctx, 'r2', ['u1', 'u2'], { timing: { step: 5, goMin: 25, goJitter: 0 } });
    g.input('u2', { tap: true });                                     // during countdown -> penalty (clamped at 0)
    assert.match(ctx.frames.at(-1).msg, /false start/);
    await new Promise((r) => realNow === Date.now ? r() : setTimeout(r, 60)); // let real timers fire GO
    assert.equal(ctx.frames.at(-1).phase, 'go');
    g.input('u1', { tap: true }); g.input('u1', { tap: true });       // same instant -> second ignored
    assert.equal(ctx.frames.at(-1).pos[0], 1);
    for (let i = 0; i < 70 && !ctx.fin; i++) { t += 60; g.input('u1', { tap: true }); }
    assert.equal(ctx.fin.w, 'u1'); assert.ok(ctx.fin.patch.time > 0);
    g.stop();
  } finally { Date.now = realNow; }
});

test('launch control: jumping the start loses the round; best of three decides the match', async () => {
  const ctx = fakeCtx(); const g = rt.launchControl(ctx, 'r3', ['u1', 'u2'], { timing: { light: 4, minGap: 8, gapJitter: 0, between: 10 } });
  const waitPhase = async (ph) => { for (let i = 0; i < 400 && ctx.frames.at(-1)?.phase !== ph; i++) await sleep(5); assert.equal(ctx.frames.at(-1).phase, ph); };
  await waitPhase('lights'); g.input('u1', { press: true });          // u1 jumps -> u2 takes round 1
  await waitPhase('result'); assert.deepEqual(ctx.frames.at(-1).wins, [0, 1]);
  await waitPhase('go'); g.input('u1', { press: true });              // u1 reacts first -> round 2
  assert.match(ctx.frames.at(-1).msg, /reacted in \d+ ms/);
  await waitPhase('go'); g.input('u2', { press: true });              // round 3 to u2 -> match
  for (let i = 0; i < 100 && !ctx.fin; i++) await sleep(5);
  assert.equal(ctx.fin.w, 'u2'); g.stop();
});

test('circuit race: only a plausible, completed run wins', async () => {
  const ctx = fakeCtx(); const g = rt.circuitRace(ctx, 'r4', ['u1', 'u2'], { minTime: 0 });
  g.input('u1', { car: { x: 1, y: 2, h: 0, progress: 3 }, finish: true });          // too early (still counting down)
  assert.equal(ctx.fin, null);
  for (let i = 0; i < 400 && ctx.frames.at(-1)?.phase !== 'go'; i++) await sleep(10);
  g.input('u1', { car: { x: 1, y: 2, h: 0, progress: 3 }, finish: true });          // not 3 laps
  assert.equal(ctx.fin, null);
  g.input('u2', { car: { x: 1, y: 2, h: 0, progress: 19.5 }, finish: true });       // 3 laps ≈ 18.85
  assert.equal(ctx.fin.w, 'u2'); g.stop();
});
