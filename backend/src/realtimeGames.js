// Real-time head-to-head games. The server runs the clock (and, for Pong, the whole physics
// simulation), so neither player can cheat by changing their own browser. Clients only send
// small inputs ({dir}, {tap}, {press}, {car}) over 'game:input' and render 'game:frame' updates.
//
// ctx = { emitFrame(roomId, payload, volatile), finish(roomId, winnerId|'draw', patch) }
import { randomInt } from 'node:crypto';

export const REALTIME_GAMES = new Set(['pong', 'drag-race', 'launch-control', 'circuit-race']);
const runtimes = new Map(); // roomId -> { input(userId, payload), stop() }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function realtimeInit(players) {
  return { realtime: true, order: players.map((p) => p.user_id), turn: null, winner: null };
}
export function stopRealtime(roomId) { runtimes.get(roomId)?.stop(); runtimes.delete(roomId); }
export function realtimeInput(roomId, userId, payload) { runtimes.get(roomId)?.input(userId, payload || {}); }
export function startRealtime(ctx, roomId, gameId, players) {
  stopRealtime(roomId);
  const ids = players.map((p) => p.user_id);
  const make = { pong, 'drag-race': dragRace, 'launch-control': launchControl, 'circuit-race': circuitRace }[gameId];
  if (make) runtimes.set(roomId, make(ctx, roomId, ids));
}

/* ───────── Pong: authoritative 60 Hz simulation, 30 Hz frames, first to 7 ───────── */
export function pong(ctx, roomId, ids, opts = {}) {
  const W = 400, H = 260, PH = 56, PW = 8, M = 14, WIN = 7, dt = 1 / 60;
  const s = { y: [H / 2, H / 2], dir: [0, 0], b: { x: W / 2, y: H / 2, vx: 0, vy: 0 }, serve: 0.9, sdir: randomInt(2) ? 1 : -1, score: [0, 0] };
  let n = 0, over = false;
  const frame = () => ({ t: 'pong', y: s.y, ball: { x: s.b.x, y: s.b.y }, score: s.score, serving: s.serve > 0 });
  const tick = () => {
    if (over) return;
    for (let i = 0; i < 2; i++) s.y[i] = clamp(s.y[i] + s.dir[i] * 260 * dt, PH / 2, H - PH / 2);
    const b = s.b;
    if (s.serve > 0) {
      s.serve -= dt;
      if (s.serve <= 0) { b.vx = 190 * s.sdir; b.vy = (randomInt(2001) / 1000 - 1) * 110; }
    } else {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y < 5) { b.y = 5; b.vy = Math.abs(b.vy); }
      if (b.y > H - 5) { b.y = H - 5; b.vy = -Math.abs(b.vy); }
      for (let i = 0; i < 2; i++) {
        const px = i === 0 ? M + PW : W - M - PW;
        const near = i === 0 ? (b.vx < 0 && b.x - 5 <= px && b.x >= M) : (b.vx > 0 && b.x + 5 >= px && b.x <= W - M);
        if (near && Math.abs(b.y - s.y[i]) <= PH / 2 + 5) {
          const off = clamp((b.y - s.y[i]) / (PH / 2), -1, 1);
          const sp = Math.min(430, Math.hypot(b.vx, b.vy) * 1.06);
          b.vx = (i === 0 ? 1 : -1) * Math.cos(off * 0.9) * sp; b.vy = Math.sin(off * 0.9) * sp;
          b.x = i === 0 ? px + 5 : px - 5;
        }
      }
      if (b.x < -10 || b.x > W + 10) {
        const scorer = b.x < 0 ? 1 : 0;
        s.score[scorer] += 1;
        Object.assign(b, { x: W / 2, y: H / 2, vx: 0, vy: 0 }); s.serve = 0.9; s.sdir = scorer === 0 ? 1 : -1;
        if (s.score[scorer] >= WIN) { over = true; ctx.emitFrame(roomId, frame()); ctx.finish(roomId, ids[scorer], { score: s.score }); return; }
        ctx.emitFrame(roomId, frame());
      }
    }
    if (++n % 2 === 0) ctx.emitFrame(roomId, frame(), true);
  };
  const timer = setInterval(tick, 1000 / 60); timer.unref?.();
  return {
    input(uid, p) { const i = ids.indexOf(uid); if (i >= 0) s.dir[i] = clamp(Math.round(num(p.dir)), -1, 1); },
    stop() { over = true; clearInterval(timer); },
    _state: s, _tick: tick, // exposed for tests
  };
}

/* ───────── Drag Race: server-timed countdown, server-counted taps (rate limited) ───────── */
export function dragRace(ctx, roomId, ids, opts = {}) {
  const LEN = 60, t = opts.timing || { step: 700, goMin: 2100, goJitter: 900 };
  const pos = [0, 0], last = [0, 0];
  let phase = 'count', msg = '3…', t0 = 0, over = false;
  const timers = [];
  const later = (fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); timers.push(h); };
  const emit = () => ctx.emitFrame(roomId, { t: 'drag', phase, msg, pos, len: LEN });
  emit();
  later(() => { msg = '2…'; emit(); }, t.step);
  later(() => { msg = '1…'; emit(); }, t.step * 2);
  later(() => { phase = 'go'; msg = 'GO!'; t0 = Date.now(); emit(); }, t.goMin + randomInt(t.goJitter + 1));
  return {
    input(uid, p) {
      const i = ids.indexOf(uid);
      if (i < 0 || !p.tap || over) return;
      if (phase === 'go') {
        const now = Date.now();
        if (now - last[i] < 45) return;             // ~22 taps/s cap: blocks macro/autoclickers
        last[i] = now; pos[i] += 1;
        if (pos[i] >= LEN) { over = true; phase = 'done'; emit(); ctx.finish(roomId, ids[i], { time: (now - t0) / 1000, pos }); return; }
        emit();
      } else if (phase === 'count') { pos[i] = Math.max(0, pos[i] - 3); msg = `Player ${i + 1}: false start! −3`; emit(); }
    },
    stop() { over = true; timers.forEach(clearTimeout); },
  };
}

/* ───────── Launch Control: best of 3 reaction rounds, timed on the server ───────── */
export function launchControl(ctx, roomId, ids, opts = {}) {
  const t = opts.timing || { light: 800, minGap: 500, gapJitter: 2200, between: 2500 };
  const wins = [0, 0];
  let phase = 'idle', lit = 0, t0 = 0, msg = 'Get ready…', over = false, round = 0;
  const timers = [];
  const later = (fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); timers.push(h); };
  const clear = () => { timers.splice(0).forEach(clearTimeout); };
  const emit = () => ctx.emitFrame(roomId, { t: 'launch', phase, lit, msg, wins, round });
  const endRound = (winnerIdx, why) => {
    clear(); phase = 'result'; lit = 0; wins[winnerIdx] += 1; msg = why;
    emit();
    if (wins[winnerIdx] >= 2) { over = true; ctx.finish(roomId, ids[winnerIdx], { wins }); return; }
    later(startRound, t.between);
  };
  function startRound() {
    round += 1; phase = 'lights'; lit = 0; msg = 'Wait for it…'; emit();
    for (let i = 1; i <= 5; i++) later(() => { lit = i; emit(); }, i * t.light);
    later(() => { lit = 0; phase = 'go'; msg = 'GO!'; t0 = Date.now(); emit(); }, 5 * t.light + t.minGap + randomInt(t.gapJitter + 1));
  }
  later(startRound, 1200);
  emit();
  return {
    input(uid, p) {
      const i = ids.indexOf(uid);
      if (i < 0 || !p.press || over) return;
      if (phase === 'lights') endRound(1 - i, `Player ${i + 1} jumped the start!`);
      else if (phase === 'go') endRound(i, `Player ${i + 1} reacted in ${Date.now() - t0} ms!`);
    },
    stop() { over = true; clear(); },
  };
}

/* ───────── Circuit Race: each browser drives its own car; the server relays positions,
   runs the countdown and decides the winner (first plausible finish). ───────── */
export function circuitRace(ctx, roomId, ids, opts = {}) {
  const LAPS = 3, TAU = Math.PI * 2, minTime = opts.minTime ?? 8;
  const cars = {}; let phase = 'count', cd = 3, t0 = 0, over = false, dirty = false;
  const timers = [];
  const later = (fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); timers.push(h); };
  const emit = () => ctx.emitFrame(roomId, { t: 'circuit', phase, cd, cars });
  emit();
  later(() => { cd = 2; emit(); }, 1000); later(() => { cd = 1; emit(); }, 2000);
  later(() => { cd = 0; phase = 'go'; t0 = Date.now(); emit(); }, 3000);
  const relay = setInterval(() => { if (dirty && !over) { dirty = false; ctx.emitFrame(roomId, { t: 'circuit', phase, cd, cars }, true); } }, 50);
  relay.unref?.();
  return {
    input(uid, p) {
      if (!ids.includes(uid) || over) return;
      if (p.car && typeof p.car === 'object') {
        cars[uid] = { x: clamp(num(p.car.x), -50, 500), y: clamp(num(p.car.y), -50, 400), h: num(p.car.h), progress: clamp(num(p.car.progress), -10, 100) };
        dirty = true;
      }
      if (p.finish && phase === 'go') {
        const elapsed = (Date.now() - t0) / 1000, prog = cars[uid]?.progress ?? 0;
        if (prog >= TAU * LAPS - 0.6 && elapsed >= minTime) { over = true; phase = 'done'; emit(); ctx.finish(roomId, uid, { time: elapsed }); }
      }
    },
    stop() { over = true; clearInterval(relay); timers.forEach(clearTimeout); },
  };
}
