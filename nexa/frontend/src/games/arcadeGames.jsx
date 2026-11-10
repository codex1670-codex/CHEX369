import { useRef, useState } from 'react';
import { GameCanvas, HoldBtn, Overlay, Stat, StatBar, canvasPoint, clamp, rnd, rr, useBest, useKeys, useLoop, useSwipe, rand } from './ui.jsx';

/* ───────────────────────── Snake ───────────────────────── */
const SN = { n: 20, cell: 16 };
const snInit = () => {
  const snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  return { snake, dir: { x: 1, y: 0 }, queue: [], food: snFood(snake), acc: 0, score: 0, over: false, started: false };
};
function snFood(snake) {
  let f; do { f = { x: rnd(SN.n), y: rnd(SN.n) }; } while (snake.some(s => s.x === f.x && s.y === f.y));
  return f;
}
export function Snake({ duel }) {
  const cv = useRef(null);
  const st = useRef(snInit());
  const [ui, setUi] = useState({ score: 0, over: false });
  const [best, submitBest] = useBest('snake');

  const turn = (name) => {
    const s = st.current; if (s.over) return;
    const d = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[name];
    const ref = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
    if (d.x === -ref.x && d.y === -ref.y) return; // can't reverse into yourself
    if (d.x === ref.x && d.y === ref.y) return;
    if (s.queue.length < 2) s.queue.push(d);
    s.started = true;
  };
  useKeys((k) => {
    const m = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' }[k];
    if (m) turn(m);
  });
  const swipe = useSwipe(turn);

  useLoop((dt) => {
    const s = st.current;
    if (!s.over && s.started) {
      s.acc += dt;
      const step = Math.max(0.05, 0.14 - s.score * 0.0005);
      while (s.acc >= step && !s.over) {
        s.acc -= step;
        if (s.queue.length) s.dir = s.queue.shift();
        const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };
        const ate = head.x === s.food.x && head.y === s.food.y;
        const body = ate ? s.snake : s.snake.slice(0, -1);
        if (head.x < 0 || head.y < 0 || head.x >= SN.n || head.y >= SN.n || body.some(p => p.x === head.x && p.y === head.y)) {
          s.over = true; submitBest(s.score); setUi({ score: s.score, over: true }); duel?.onEnd(s.score); break;
        }
        s.snake.unshift(head);
        if (ate) { s.score += 10; s.food = snFood(s.snake); setUi({ score: s.score, over: false }); } else s.snake.pop();
      }
    }
    const ctx = cv.current?.getContext('2d'); if (!ctx) return;
    const W = SN.n * SN.cell;
    ctx.fillStyle = '#0c1238'; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    for (let i = 0; i < SN.n; i++) for (let j = 0; j < SN.n; j++) if ((i + j) % 2) ctx.fillRect(i * SN.cell, j * SN.cell, SN.cell, SN.cell);
    ctx.fillStyle = '#ff5c93'; ctx.beginPath(); ctx.arc(s.food.x * SN.cell + 8, s.food.y * SN.cell + 8, 6, 0, Math.PI * 2); ctx.fill();
    s.snake.forEach((p, i) => { ctx.fillStyle = i === 0 ? '#26e0c9' : '#3f6fe0'; rr(ctx, p.x * SN.cell + 1, p.y * SN.cell + 1, SN.cell - 2, SN.cell - 2, 4); ctx.fill(); });
  });

  const restart = () => { st.current = snInit(); setUi({ score: 0, over: false }); };
  const W = SN.n * SN.cell;
  return (
    <div className="gm-table">
      <StatBar><Stat label="Score" value={ui.score} /><Stat label="Best" value={best ?? 0} /></StatBar>
      <div className="gm-stage" {...swipe}>
        <GameCanvas w={W} h={W} canvasRef={cv} label="Snake board" />
        {ui.over && <Overlay title="Game over" sub={`Score ${ui.score}`} actions={<button type="button" className="gm-btn primary" onClick={restart}>Play again</button>} />}
      </div>
      <div className="gm-dpad">
        <button type="button" className="gm-btn" style={{ gridArea: 'u' }} onClick={() => turn('up')} aria-label="Up">▲</button>
        <button type="button" className="gm-btn" style={{ gridArea: 'l' }} onClick={() => turn('left')} aria-label="Left">◀</button>
        <button type="button" className="gm-btn" style={{ gridArea: 'r' }} onClick={() => turn('right')} aria-label="Right">▶</button>
        <button type="button" className="gm-btn" style={{ gridArea: 'd' }} onClick={() => turn('down')} aria-label="Down">▼</button>
      </div>
      <p className="gm-hint">Arrow keys / WASD, swipe, or the pad. Press a direction to start.</p>
    </div>
  );
}

/* ───────────────────────── Breakout ───────────────────────── */
const BK = { w: 320, h: 420, pw: 64, ph: 10, py: 396, r: 6, cols: 8, bw: 34, bh: 14, gap: 4 };
function bkBricks(level) {
  const rows = Math.min(8, 4 + level), out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < BK.cols; c++) out.push({ x: 8 + c * (BK.bw + BK.gap) + 2, y: 40 + r * (BK.bh + BK.gap), alive: true, hue: (r * 38 + 250) % 360 });
  return out;
}
const bkInit = (level = 1, score = 0, lives = 3) => ({ px: BK.w / 2, ball: { x: BK.w / 2, y: BK.py - BK.r - 1, vx: 0, vy: 0 }, launched: false, bricks: bkBricks(level), level, score, lives, over: false });
export function Breakout({ duel }) {
  const cv = useRef(null);
  const st = useRef(bkInit());
  const [ui, setUi] = useState({ score: 0, lives: 3, level: 1, over: false });
  const [best, submitBest] = useBest('breakout');
  const keys = useKeys((k) => { if (k === ' ' || k === 'arrowup') launch(); });
  const push = () => { const s = st.current; setUi({ score: s.score, lives: s.lives, level: s.level, over: s.over }); };
  const launch = () => {
    const s = st.current; if (s.launched || s.over) return;
    const sp = 230 + s.level * 20; s.launched = true; s.ball.vx = sp * 0.35 * (rand() < 0.5 ? -1 : 1); s.ball.vy = -sp;
  };

  useLoop((dt) => {
    const s = st.current;
    if (!s.over) {
      const dir = (keys.current.arrowright || keys.current.d ? 1 : 0) - (keys.current.arrowleft || keys.current.a ? 1 : 0);
      if (dir) s.px = clamp(s.px + dir * 330 * dt, BK.pw / 2, BK.w - BK.pw / 2);
      const b = s.ball;
      if (!s.launched) { b.x = s.px; b.y = BK.py - BK.r - 1; }
      else {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < BK.r) { b.x = BK.r; b.vx = Math.abs(b.vx); }
        if (b.x > BK.w - BK.r) { b.x = BK.w - BK.r; b.vx = -Math.abs(b.vx); }
        if (b.y < BK.r) { b.y = BK.r; b.vy = Math.abs(b.vy); }
        if (b.vy > 0 && b.y + BK.r >= BK.py && b.y + BK.r <= BK.py + BK.ph + 8 && Math.abs(b.x - s.px) <= BK.pw / 2 + BK.r) {
          const off = clamp((b.x - s.px) / (BK.pw / 2), -1, 1);
          const sp = Math.min(520, Math.hypot(b.vx, b.vy) * 1.015);
          const ang = off * 1.05; // radians from vertical
          b.vx = Math.sin(ang) * sp; b.vy = -Math.cos(ang) * sp; b.y = BK.py - BK.r;
        }
        for (const br of s.bricks) {
          if (!br.alive) continue;
          if (b.x + BK.r > br.x && b.x - BK.r < br.x + BK.bw && b.y + BK.r > br.y && b.y - BK.r < br.y + BK.bh) {
            br.alive = false; s.score += 10;
            const ox = Math.min(b.x + BK.r - br.x, br.x + BK.bw - (b.x - BK.r)), oy = Math.min(b.y + BK.r - br.y, br.y + BK.bh - (b.y - BK.r));
            if (ox < oy) b.vx = -b.vx; else b.vy = -b.vy;
            push(); break;
          }
        }
        if (s.bricks.every(x => !x.alive)) { const n = bkInit(s.level + 1, s.score, s.lives); st.current = n; push(); return; }
        if (b.y > BK.h + 10) {
          s.lives -= 1; s.launched = false; b.vx = 0; b.vy = 0;
          if (s.lives <= 0) { s.over = true; submitBest(s.score); duel?.onEnd(s.score); }
          push();
        }
      }
    }
    const ctx = cv.current?.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#0c1238'; ctx.fillRect(0, 0, BK.w, BK.h);
    for (const br of s.bricks) if (br.alive) { ctx.fillStyle = `hsl(${br.hue} 75% 60%)`; rr(ctx, br.x, br.y, BK.bw, BK.bh, 3); ctx.fill(); }
    ctx.fillStyle = '#26e0c9'; rr(ctx, s.px - BK.pw / 2, BK.py, BK.pw, BK.ph, 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, BK.r, 0, Math.PI * 2); ctx.fill();
    if (!s.launched && !s.over) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Tap or press Space to launch', BK.w / 2, BK.h / 2 + 60); }
  });
  const move = (e) => { if (e.pointerType === 'mouse' || e.buttons || e.pointerType === 'touch') st.current.px = clamp(canvasPoint(e, cv.current).x, BK.pw / 2, BK.w - BK.pw / 2); };
  const restart = () => { st.current = bkInit(); push(); };
  return (
    <div className="gm-table">
      <StatBar><Stat label="Score" value={ui.score} /><Stat label="Lives" value={'♥'.repeat(Math.max(0, ui.lives)) || '—'} /><Stat label="Level" value={ui.level} /><Stat label="Best" value={best ?? 0} /></StatBar>
      <div className="gm-stage" style={{ touchAction: 'none' }}>
        <GameCanvas w={BK.w} h={BK.h} canvasRef={cv} label="Breakout board" onPointerMove={move} onPointerDown={(e) => { move(e); launch(); }} />
        {ui.over && <Overlay title="Game over" sub={`Score ${ui.score}`} actions={<button type="button" className="gm-btn primary" onClick={restart}>Play again</button>} />}
      </div>
      <div className="gm-row gm-pads"><HoldBtn k="arrowleft" keys={keys}>◀</HoldBtn><HoldBtn k="arrowright" keys={keys}>▶</HoldBtn></div>
      <p className="gm-hint">Drag / move the mouse or use ← →. Tap or Space launches the ball.</p>
    </div>
  );
}

/* ───────────────────────── Flappy Hop ───────────────────────── */
const FL = { w: 320, h: 440, bx: 80, br: 12, gap: 128, pw: 52, ground: 40 };
const flInit = () => ({ y: 200, vy: 0, pipes: [], t: 1.2, score: 0, over: false, started: false, tilt: 0 });
export function FlappyHop({ duel }) {
  const cv = useRef(null);
  const st = useRef(flInit());
  const [ui, setUi] = useState({ score: 0, over: false });
  const [best, submitBest] = useBest('flappy-hop');
  const flap = () => { const s = st.current; if (s.over) return; s.started = true; s.vy = -300; };
  useKeys((k) => { if (k === ' ' || k === 'arrowup' || k === 'w') flap(); });

  useLoop((dt) => {
    const s = st.current;
    if (!s.over) {
      if (s.started) {
        s.vy += 900 * dt; s.y += s.vy * dt; s.tilt = clamp(s.vy / 500, -0.5, 1);
        s.t -= dt;
        if (s.t <= 0) { s.pipes.push({ x: FL.w + 10, top: 60 + rnd(FL.h - FL.ground - FL.gap - 120), passed: false }); s.t = 1.55; }
        for (const p of s.pipes) {
          p.x -= 125 * dt;
          if (!p.passed && p.x + FL.pw < FL.bx - FL.br) { p.passed = true; s.score += 1; setUi({ score: s.score, over: false }); }
          const hitX = FL.bx + FL.br - 3 > p.x && FL.bx - FL.br + 3 < p.x + FL.pw;
          if (hitX && (s.y - FL.br + 3 < p.top || s.y + FL.br - 3 > p.top + FL.gap)) s.over = true;
        }
        s.pipes = s.pipes.filter(p => p.x > -FL.pw - 10);
        if (s.y + FL.br > FL.h - FL.ground || s.y - FL.br < 0) s.over = true;
        if (s.over) { submitBest(s.score); setUi({ score: s.score, over: true }); duel?.onEnd(s.score); }
      } else s.y = 200 + Math.sin(performance.now() / 250) * 8;
    }
    const ctx = cv.current?.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#1b1636'; ctx.fillRect(0, 0, FL.w, FL.h);
    ctx.fillStyle = '#2f9e7a';
    for (const p of s.pipes) { ctx.fillRect(p.x, 0, FL.pw, p.top); ctx.fillRect(p.x, p.top + FL.gap, FL.pw, FL.h); ctx.fillStyle = '#3fc79b'; ctx.fillRect(p.x - 3, p.top - 14, FL.pw + 6, 14); ctx.fillRect(p.x - 3, p.top + FL.gap, FL.pw + 6, 14); ctx.fillStyle = '#2f9e7a'; }
    ctx.fillStyle = '#3b3358'; ctx.fillRect(0, FL.h - FL.ground, FL.w, FL.ground);
    ctx.save(); ctx.translate(FL.bx, s.y); ctx.rotate(s.tilt);
    ctx.fillStyle = '#ffb84d'; ctx.beginPath(); ctx.arc(0, 0, FL.br, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5, -4, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(6, -4, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff5c93'; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(18, 3); ctx.lineTo(10, 6); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(s.score), FL.w / 2, 60);
    if (!s.started) { ctx.font = '14px sans-serif'; ctx.fillText('Tap or press Space to hop', FL.w / 2, FL.h / 2 + 70); }
  });
  const restart = () => { st.current = flInit(); setUi({ score: 0, over: false }); };
  return (
    <div className="gm-table">
      <StatBar><Stat label="Score" value={ui.score} /><Stat label="Best" value={best ?? 0} /></StatBar>
      <div className="gm-stage" style={{ touchAction: 'manipulation' }}>
        <GameCanvas w={FL.w} h={FL.h} canvasRef={cv} label="Flappy Hop" onPointerDown={flap} />
        {ui.over && <Overlay title="Splat! 🐤" sub={`Score ${ui.score}`} actions={<button type="button" className="gm-btn primary" onClick={restart}>Try again</button>} />}
      </div>
      <p className="gm-hint">Tap, click, Space or ↑ to hop through the gaps.</p>
    </div>
  );
}

/* ───────────────────────── Pong ───────────────────────── */
const PG = { w: 400, h: 260, pw: 8, ph: 56, win: 7, margin: 14 };
const pgInit = () => ({ y: [PG.h / 2, PG.h / 2], ball: { x: PG.w / 2, y: PG.h / 2, vx: 0, vy: 0 }, serve: 0.9, dir: rand() < 0.5 ? -1 : 1, score: [0, 0], over: null, rally: 0 });
export function Pong({ players = 1 }) {
  const cv = useRef(null);
  const st = useRef(pgInit());
  const [ui, setUi] = useState({ score: [0, 0], over: null });
  const keys = useKeys();

  useLoop((dt) => {
    const s = st.current;
    if (s.over === null) {
      const k = keys.current;
      const p1 = ((k.s || (players === 1 && k.arrowdown)) ? 1 : 0) - ((k.w || (players === 1 && k.arrowup)) ? 1 : 0);
      s.y[0] = clamp(s.y[0] + p1 * 260 * dt, PG.ph / 2, PG.h - PG.ph / 2);
      if (players === 2) s.y[1] = clamp(s.y[1] + ((k.arrowdown ? 1 : 0) - (k.arrowup ? 1 : 0)) * 260 * dt, PG.ph / 2, PG.h - PG.ph / 2);
      else {
        const b = s.ball; const target = b.vx > 0 ? b.y : PG.h / 2; const diff = target - s.y[1];
        s.y[1] = clamp(s.y[1] + clamp(diff, -150 * dt, 150 * dt) * (Math.abs(diff) > 6 ? 1 : 0), PG.ph / 2, PG.h - PG.ph / 2);
      }
      const b = s.ball;
      if (s.serve > 0) { s.serve -= dt; if (s.serve <= 0) { const sp = 190; b.vx = sp * s.dir; b.vy = (rand() * 2 - 1) * 110; } }
      else {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < 5) { b.y = 5; b.vy = Math.abs(b.vy); }
        if (b.y > PG.h - 5) { b.y = PG.h - 5; b.vy = -Math.abs(b.vy); }
        const hit = (i) => {
          const px = i === 0 ? PG.margin + PG.pw : PG.w - PG.margin - PG.pw;
          const near = i === 0 ? (b.vx < 0 && b.x - 5 <= px && b.x >= PG.margin) : (b.vx > 0 && b.x + 5 >= px && b.x <= PG.w - PG.margin);
          if (near && Math.abs(b.y - s.y[i]) <= PG.ph / 2 + 5) {
            const off = clamp((b.y - s.y[i]) / (PG.ph / 2), -1, 1);
            const sp = Math.min(430, Math.hypot(b.vx, b.vy) * 1.06);
            b.vx = (i === 0 ? 1 : -1) * Math.cos(off * 0.9) * sp; b.vy = Math.sin(off * 0.9) * sp;
            b.x = i === 0 ? px + 5 : px - 5;
          }
        };
        hit(0); hit(1);
        if (b.x < -10 || b.x > PG.w + 10) {
          const scorer = b.x < 0 ? 1 : 0;
          s.score[scorer] += 1;
          if (s.score[scorer] >= PG.win) s.over = scorer;
          setUi({ score: [...s.score], over: s.over });
          Object.assign(b, { x: PG.w / 2, y: PG.h / 2, vx: 0, vy: 0 }); s.serve = 0.9; s.dir = scorer === 0 ? 1 : -1;
        }
      }
    }
    const ctx = cv.current?.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#0c1238'; ctx.fillRect(0, 0, PG.w, PG.h);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; for (let y = 6; y < PG.h; y += 18) ctx.fillRect(PG.w / 2 - 1, y, 2, 10);
    ctx.fillStyle = '#6f95ff'; rr(ctx, PG.margin, s.y[0] - PG.ph / 2, PG.pw, PG.ph, 3); ctx.fill();
    ctx.fillStyle = '#ff5c93'; rr(ctx, PG.w - PG.margin - PG.pw, s.y[1] - PG.ph / 2, PG.pw, PG.ph, 3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, 5, 0, Math.PI * 2); ctx.fill();
  });
  const restart = () => { st.current = pgInit(); setUi({ score: [0, 0], over: null }); };
  const names = ['P1', players === 2 ? 'P2' : 'CPU'];
  const drag = (e) => { if (e.buttons || e.pointerType === 'touch') st.current.y[0] = clamp(canvasPoint(e, cv.current).y, PG.ph / 2, PG.h - PG.ph / 2); };
  return (
    <div className="gm-table">
      <StatBar><Stat label={names[0]} value={ui.score[0]} /><Stat label="First to" value={PG.win} /><Stat label={names[1]} value={ui.score[1]} /></StatBar>
      <div className="gm-stage" style={{ touchAction: 'none' }}>
        <GameCanvas w={PG.w} h={PG.h} canvasRef={cv} label="Pong court" onPointerMove={drag} onPointerDown={drag} />
        {ui.over !== null && <Overlay title={players === 2 ? `${names[ui.over]} wins! 🏓` : (ui.over === 0 ? 'You win! 🏓' : 'CPU wins')} sub={`${ui.score[0]} – ${ui.score[1]}`} actions={<button type="button" className="gm-btn primary" onClick={restart}>Rematch</button>} />}
      </div>
      <div className="gm-row gm-pads">
        <div className="gm-row"><HoldBtn k="w" keys={keys}>▲</HoldBtn><HoldBtn k="s" keys={keys}>▼</HoldBtn></div>
        {players === 2 && <div className="gm-row"><HoldBtn k="arrowup" keys={keys}>▲</HoldBtn><HoldBtn k="arrowdown" keys={keys}>▼</HoldBtn></div>}
      </div>
      <p className="gm-hint">{players === 2 ? 'P1 (left): W / S · P2 (right): ↑ / ↓' : 'Move with W / S or ↑ / ↓ — or drag on the court.'}</p>
    </div>
  );
}
