import { useEffect, useRef, useState } from 'react';
import { GameCanvas, HoldBtn, Overlay, Stat, StatBar, canvasPoint, clamp, rnd, rr, useBest, useKeys, useLoop, rand } from './ui.jsx';

/* ───────────────────────── Traffic Dodge ───────────────────────── */
const TD = { w: 300, h: 480, lanes: 3, carW: 42, carH: 70 };
const tdInit = () => ({ lane: 1, x: 150, cars: [], spawn: 0.4, score: 0, speed: 230, over: false, off: 0 });
export function TrafficDodge({ duel }) {
  const cv = useRef(null);
  const st = useRef(tdInit());
  const [ui, setUi] = useState({ score: 0, over: false });
  const [best, submitBest] = useBest('traffic-dodge');
  const shown = useRef(0);

  const move = (d) => { if (!st.current.over) st.current.lane = clamp(st.current.lane + d, 0, TD.lanes - 1); };
  useKeys((k) => { if (k === 'arrowleft' || k === 'a') move(-1); if (k === 'arrowright' || k === 'd') move(1); });

  useLoop((dt) => {
    const s = st.current;
    if (!s.over) {
      const laneW = TD.w / TD.lanes;
      s.x += ((s.lane + 0.5) * laneW - s.x) * Math.min(1, dt * 14);
      s.speed = 230 + Math.min(260, s.score * 0.9);
      s.off = (s.off + s.speed * dt) % 60;
      s.score += (s.speed * dt) / 14;
      s.spawn -= dt;
      if (s.spawn <= 0) {
        const lane = rnd(TD.lanes);
        if (!s.cars.some(c => c.y < 140 && c.lane === lane)) s.cars.push({ lane, y: -TD.carH, v: 0.45 + rand() * 0.35, hue: rnd(360) });
        s.spawn = Math.max(0.35, 1.0 - s.score / 900) + rand() * 0.3;
      }
      for (const c of s.cars) c.y += s.speed * c.v * dt + 60 * dt;
      s.cars = s.cars.filter(c => c.y < TD.h + 100);
      const py = TD.h - TD.carH - 24;
      for (const c of s.cars) {
        const cx = (c.lane + 0.5) * laneW;
        if (Math.abs(cx - s.x) < TD.carW - 6 && c.y + TD.carH > py + 6 && c.y < py + TD.carH - 6) {
          s.over = true; submitBest(Math.floor(s.score)); setUi({ score: Math.floor(s.score), over: true }); duel?.onEnd(Math.floor(s.score));
        }
      }
      const sc = Math.floor(s.score);
      // never overwrite the "crashed" state set just above in the same frame
      if (!s.over && sc !== shown.current) { shown.current = sc; setUi({ score: sc, over: false }); }
    }
    const ctx = cv.current?.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#23212f'; ctx.fillRect(0, 0, TD.w, TD.h);
    ctx.fillStyle = '#3b3750'; ctx.fillRect(0, 0, 6, TD.h); ctx.fillRect(TD.w - 6, 0, 6, TD.h);
    ctx.fillStyle = '#d9d4ee';
    for (let l = 1; l < TD.lanes; l++) for (let y = -60 + s.off; y < TD.h; y += 60) ctx.fillRect((TD.w / TD.lanes) * l - 2, y, 4, 30);
    const laneW = TD.w / TD.lanes;
    for (const c of s.cars) { ctx.fillStyle = `hsl(${c.hue} 70% 55%)`; rr(ctx, (c.lane + 0.5) * laneW - TD.carW / 2, c.y, TD.carW, TD.carH, 8); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect((c.lane + 0.5) * laneW - 14, c.y + TD.carH - 22, 28, 14); }
    const py = TD.h - TD.carH - 24;
    ctx.fillStyle = '#6f95ff'; rr(ctx, s.x - TD.carW / 2, py, TD.carW, TD.carH, 9); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(s.x - 14, py + 12, 28, 16);
    ctx.fillStyle = '#fff'; ctx.fillRect(s.x - 16, py + 2, 8, 4); ctx.fillRect(s.x + 8, py + 2, 8, 4);
  });

  const restart = () => { st.current = tdInit(); shown.current = 0; setUi({ score: 0, over: false }); };
  return (
    <div className="gm-table">
      <StatBar><Stat label="Score" value={ui.score} /><Stat label="Best" value={best ?? 0} /></StatBar>
      <div className="gm-stage">
        <GameCanvas w={TD.w} h={TD.h} canvasRef={cv} label="Traffic Dodge road"
          onPointerDown={(e) => { const p = canvasPoint(e, cv.current); move(p.x < TD.w / 2 ? -1 : 1); }} />
        {ui.over && <Overlay title="Crash! 💥" sub={`Score ${ui.score}`} actions={<button type="button" className="gm-btn primary" onClick={restart}>Race again</button>} />}
      </div>
      <p className="gm-hint">← → / A D to change lane, or tap the left/right side.</p>
    </div>
  );
}

/* ───────────────────────── Circuit Race ───────────────────────── */
const CR = { w: 420, h: 300, cx: 210, cy: 150, outer: [190, 130], inner: [108, 58], mid: [149, 94], laps: 3, max: 125 };
const TAU = Math.PI * 2;
const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const START_THETA = -Math.PI / 2 - 0.14;
function crCar(offset, color, name) {
  const th = START_THETA, rx = CR.mid[0] + offset, ry = CR.mid[1] + offset * 0.7;
  return { name, color, offset, x: CR.cx + rx * Math.cos(th), y: CR.cy + ry * Math.sin(th), h: Math.atan2(ry * Math.cos(th), -rx * Math.sin(th)), speed: 0, prevTheta: th, progress: START_THETA - (-Math.PI / 2), finished: null };
}
const crInit = (players) => ({ cars: [crCar(14, '#6f95ff', 'P1'), crCar(-14, '#ff5c93', players === 2 ? 'P2' : 'CPU')], t: 0, cd: 3.2, over: false });
const onTrack = (x, y) => {
  const o = ((x - CR.cx) / CR.outer[0]) ** 2 + ((y - CR.cy) / CR.outer[1]) ** 2;
  const i = ((x - CR.cx) / CR.inner[0]) ** 2 + ((y - CR.cy) / CR.inner[1]) ** 2;
  return o <= 1 && i >= 1;
};
// `net` (online mode): { slot, otherId, send(input), frameRef } — my car is driven locally and
// reported to the server; the rival's car is drawn from the server's frames; the server runs the
// countdown and decides the winner.
export function CircuitRace({ players = 1, net }) {
  if (net) players = 2;
  const cv = useRef(null);
  const st = useRef(crInit(players));
  const [ui, setUi] = useState({ lap: [1, 1], cd: 3, over: null, time: 0 });
  const [best, submitBest] = useBest('circuit-race', true);
  const keys = useKeys();
  const last = useRef('');
  const sendT = useRef(0);

  useLoop((dt) => {
    const s = st.current;
    const f = net?.frameRef.current;
    if (net) {
      if (f) { s.cd = f.phase === 'count' ? Math.max(0.01, f.cd) : 0; if (f.phase === 'done') s.over = true; }
      else s.cd = 3;
    }
    if (s.cd > 0) { if (!net) s.cd -= dt; }
    else if (!s.over) s.t += dt;
    const racing = s.cd <= 0 && !s.over;
    s.cars.forEach((c, idx) => {
      if (net && idx !== net.slot) {            // the rival: copy what the server relays
        const rc = f?.cars?.[net.otherId];
        if (rc) { c.x = rc.x; c.y = rc.y; c.h = rc.h; c.progress = rc.progress; }
        return;
      }
      let steer = 0;
      if (net) steer = (keys.current.d || keys.current.arrowright ? 1 : 0) - (keys.current.a || keys.current.arrowleft ? 1 : 0);
      else if (idx === 0) steer = (keys.current.d || (players === 1 && keys.current.arrowright) ? 1 : 0) - (keys.current.a || (players === 1 && keys.current.arrowleft) ? 1 : 0);
      else if (players === 2) steer = (keys.current.arrowright ? 1 : 0) - (keys.current.arrowleft ? 1 : 0);
      else {
        const th = Math.atan2((c.y - CR.cy) / CR.mid[1], (c.x - CR.cx) / CR.mid[0]) + 0.32;
        const tx = CR.cx + (CR.mid[0] + c.offset) * Math.cos(th), ty = CR.cy + (CR.mid[1] + c.offset * 0.7) * Math.sin(th);
        steer = clamp(wrapAngle(Math.atan2(ty - c.y, tx - c.x) - c.h) * 3.2, -1, 1);
      }
      const finished = c.finished !== null;
      const cap = (onTrack(c.x, c.y) ? CR.max : CR.max * 0.38) * (idx === 1 && players === 1 ? 0.93 : 1);
      const target = racing && !finished ? cap : 0;
      c.speed += (target - c.speed) * Math.min(1, dt * (target ? 2.2 : 3));
      if (racing && !finished) c.h += steer * dt * 2.7 * (0.45 + 0.55 * (c.speed / CR.max));
      c.x += Math.cos(c.h) * c.speed * dt; c.y += Math.sin(c.h) * c.speed * dt;
      c.x = clamp(c.x, 4, CR.w - 4); c.y = clamp(c.y, 4, CR.h - 4);
      const th = Math.atan2((c.y - CR.cy) / CR.outer[1], (c.x - CR.cx) / CR.outer[0]);
      c.progress += wrapAngle(th - c.prevTheta); c.prevTheta = th;
      if (!finished && c.progress >= TAU * CR.laps && racing) c.finished = s.t;
    });
    if (net) {
      const me = s.cars[net.slot];
      sendT.current += dt;
      if (!s.over && me.finished !== null) {
        s.over = true;
        net.send({ car: { x: me.x, y: me.y, h: me.h, progress: me.progress }, finish: true });
      } else if (!s.over && sendT.current >= 0.05) {
        sendT.current = 0;
        net.send({ car: { x: me.x, y: me.y, h: me.h, progress: me.progress } });
      }
    } else if (!s.over && s.cars.some(c => c.finished !== null)) {
      s.over = true;
      const [a, b] = s.cars;
      const winner = a.finished !== null && (b.finished === null || a.finished <= b.finished) ? 0 : 1;
      if (winner === 0 && players === 1) submitBest(Math.round(a.finished * 100) / 100);
      setUi(u => ({ ...u, over: winner, time: s.cars[winner].finished }));
    }
    const lap = s.cars.map(c => clamp(Math.floor(c.progress / TAU) + 1, 1, CR.laps));
    const sig = `${lap}|${Math.ceil(Math.max(0, s.cd))}|${Math.floor(s.t)}`;
    if (sig !== last.current && !s.over) { last.current = sig; setUi(u => ({ ...u, lap, cd: Math.ceil(Math.max(0, s.cd)), time: s.t })); }

    const ctx = cv.current?.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#12301f'; ctx.fillRect(0, 0, CR.w, CR.h);
    ctx.beginPath(); ctx.ellipse(CR.cx, CR.cy, CR.outer[0], CR.outer[1], 0, 0, TAU); ctx.fillStyle = '#2d2a3d'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#d9d4ee'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(CR.cx, CR.cy, CR.inner[0], CR.inner[1], 0, 0, TAU); ctx.fillStyle = '#12301f'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; for (let y = CR.cy - CR.outer[1]; y < CR.cy - CR.inner[1]; y += 8) ctx.fillRect(CR.cx - 2, y, 4, 4);
    for (const c of s.cars) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.h);
      ctx.fillStyle = c.color; rr(ctx, -10, -6, 20, 12, 3); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(1, -4, 6, 8);
      ctx.restore();
    }
  });

  const restart = () => { st.current = crInit(players); last.current = ''; setUi({ lap: [1, 1], cd: 3, over: null, time: 0 }); };
  const names = net ? (net.slot === 0 ? ['You', 'Rival'] : ['Rival', 'You']) : ['P1', players === 2 ? 'P2' : 'CPU'];
  return (
    <div className="gm-table">
      <StatBar>
        <Stat label={`Lap ${names[0]}`} value={`${ui.lap[0]}/${CR.laps}`} />
        <Stat label="Time" value={`${ui.time.toFixed(1)}s`} />
        <Stat label={`Lap ${names[1]}`} value={`${ui.lap[1]}/${CR.laps}`} />
        {players === 1 && <Stat label="Best" value={best === null ? '—' : `${best}s`} />}
      </StatBar>
      <div className="gm-stage">
        <GameCanvas w={CR.w} h={CR.h} canvasRef={cv} label="Circuit race track" />
        {ui.cd > 0 && !ui.over && <div className="gm-countdown">{ui.cd}</div>}
        {!net && ui.over !== null && <Overlay title={players === 2 ? `${names[ui.over]} wins! 🏁` : (ui.over === 0 ? 'You win! 🏁' : 'CPU wins')} sub={`${ui.time.toFixed(2)} seconds`} actions={<button type="button" className="gm-btn primary" onClick={restart}>Race again</button>} />}
      </div>
      <div className="gm-row gm-pads">
        <div className="gm-row"><HoldBtn k="a" keys={keys}>◀</HoldBtn><HoldBtn k="d" keys={keys}>▶</HoldBtn></div>
        {players === 2 && !net && <div className="gm-row"><HoldBtn k="arrowleft" keys={keys}>◀</HoldBtn><HoldBtn k="arrowright" keys={keys}>▶</HoldBtn></div>}
      </div>
      <p className="gm-hint">{net ? 'Steer with A / D or ← / →. First to finish 3 laps wins. Stay on the grey track!' : players === 2 ? 'P1 (purple): A / D · P2 (pink): ← / →. Cars accelerate automatically. Stay on the grey track!' : 'Steer with A / D or ← / →. Your car accelerates automatically. Stay on the track!'}</p>
    </div>
  );
}

/* ───────────────────────── Drag Race ───────────────────────── */
const DR_LEN = 60;
const DR_LEVELS = { Easy: 5, Normal: 6.5, Hard: 8 };
export function DragRace({ players = 1 }) {
  const R = useRef({ phase: 'ready', pos: [0, 0], t0: 0, winner: null, time: 0, msg: '' });
  const [, force] = useState(0);
  const re = () => force(n => n + 1);
  const timers = useRef([]);
  const [level, setLevel] = useState('Normal');
  const [best, submitBest] = useBest('drag-race', true);
  const clear = () => { timers.current.forEach(t => { clearTimeout(t); clearInterval(t); }); timers.current = []; };
  useEffect(() => clear, []);
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };

  const finish = (who) => {
    const r = R.current; if (r.phase === 'done') return;
    r.phase = 'done'; r.winner = who; r.time = (performance.now() - r.t0) / 1000; clear();
    if (players === 1 && who === 0) submitBest(Math.round(r.time * 100) / 100);
    re();
  };
  const tap = (who) => {
    const r = R.current;
    if (r.phase === 'go') { r.pos[who] += 1; if (r.pos[who] >= DR_LEN) finish(who); else re(); }
    else if (r.phase === 'count') { r.pos[who] = Math.max(0, r.pos[who] - 3); r.msg = `${who === 0 ? 'P1' : players === 2 ? 'P2' : 'You'}: false start! −3`; re(); }
  };
  useKeys((k) => { if (k === 'a' || (players === 1 && k === ' ')) tap(0); if (k === 'l') tap(players === 2 ? 1 : 0); });

  const start = () => {
    clear();
    Object.assign(R.current, { phase: 'count', pos: [0, 0], winner: null, msg: '3…' });
    re();
    later(() => { R.current.msg = '2…'; re(); }, 700);
    later(() => { R.current.msg = '1…'; re(); }, 1400);
    later(() => {
      R.current.phase = 'go'; R.current.msg = 'GO!'; R.current.t0 = performance.now(); re();
      if (players === 1) {
        let acc = 0;
        timers.current.push(setInterval(() => {
          acc += DR_LEVELS[level] * 0.05 * (0.8 + rand() * 0.4);
          while (acc >= 1 && R.current.phase === 'go') { acc -= 1; R.current.pos[1] += 1; if (R.current.pos[1] >= DR_LEN) { finish(1); break; } }
          re();
        }, 50));
      }
    }, 2100 + rnd(900));
  };

  const r = R.current;
  const names = ['P1', players === 2 ? 'P2' : 'CPU'];
  return (
    <div className="gm-table">
      <StatBar><Stat label="Track" value={`${DR_LEN} taps`} />{players === 1 && <Stat label="Best" value={best === null ? '—' : `${best}s`} />}</StatBar>
      {[0, 1].map(i => (
        <div key={i} className="gm-lane"><span className="gm-lane-name">{names[i]}</span>
          <div className="gm-lane-track"><div className="gm-lane-car" style={{ left: `calc(${(r.pos[i] / DR_LEN) * 100}% - ${(r.pos[i] / DR_LEN) * 34}px)`, background: i === 0 ? 'var(--violet-bright)' : 'var(--pink)' }}>🏎️</div><div className="gm-lane-flag">🏁</div></div></div>
      ))}
      <p className="gm-result" style={{ minHeight: 28, fontSize: r.phase === 'go' || r.phase === 'count' ? 22 : undefined }}>{r.phase === 'ready' ? 'Mash your key as fast as you can once the race starts!' : r.msg}</p>
      {players === 1 && r.phase === 'ready' && (
        <div className="gm-row">{Object.keys(DR_LEVELS).map(l => <button key={l} type="button" className={`gm-btn ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}</div>
      )}
      {r.phase === 'ready' && <button type="button" className="gm-btn primary" onClick={start}>Start race</button>}
      <div className="gm-row gm-tapzones">
        <button type="button" className="gm-btn gm-tap" onPointerDown={(e) => { e.preventDefault(); tap(0); }}>{players === 2 ? 'P1 TAP (A)' : 'TAP (A / Space)'}</button>
        {players === 2 && <button type="button" className="gm-btn gm-tap alt" onPointerDown={(e) => { e.preventDefault(); tap(1); }}>P2 TAP (L)</button>}
      </div>
      {r.phase === 'done' && <Overlay title={players === 1 ? (r.winner === 0 ? 'You win! 🏁' : 'CPU wins') : `${names[r.winner]} wins! 🏁`} sub={`${r.time.toFixed(2)} seconds`} actions={<button type="button" className="gm-btn primary" onClick={start}>Race again</button>} />}
    </div>
  );
}

/* ───────────────────────── Launch Control (F1 lights) ───────────────────────── */
export function LaunchControl({ players = 1 }) {
  const [phase, setPhase] = useState('idle'); // idle | lights | go | result | done
  const [lit, setLit] = useState(0);
  const [msg, setMsg] = useState('Press Start. When the five lights go out, hit your button!');
  const [times, setTimes] = useState([]);       // 1P reaction times
  const [wins, setWins] = useState([0, 0]);     // 2P round wins
  const t0 = useRef(0);
  const timers = useRef([]);
  const phaseRef = useRef('idle');
  const [best, submitBest] = useBest('launch-control', true);
  const setP = (p) => { phaseRef.current = p; setPhase(p); };
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clear, []);
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };

  const begin = () => {
    clear(); setLit(0); setP('lights'); setMsg('Wait for it…');
    for (let i = 1; i <= 5; i++) later(() => setLit(i), i * 800);
    later(() => { setLit(0); t0.current = performance.now(); setP('go'); setMsg('GO!'); }, 5 * 800 + 500 + rnd(2200));
  };

  const press = (who) => {
    const p = phaseRef.current;
    if (p === 'lights') {
      clear(); setLit(0);
      if (players === 2) {
        const w = [...wins]; w[1 - who]++; setWins(w);
        setMsg(`P${who + 1} jumped the start! P${2 - who} takes the round.`);
        setP(w[1 - who] >= 2 ? 'done' : 'result');
      } else { setMsg('False start! Wait for the lights to go out.'); setP('result'); }
    } else if (p === 'go') {
      const ms = Math.round(performance.now() - t0.current);
      if (players === 2) {
        const w = [...wins]; w[who]++; setWins(w);
        setMsg(`P${who + 1} reacts in ${ms} ms!`);
        setP(w[who] >= 2 ? 'done' : 'result');
      } else {
        const t = [...times, ms]; setTimes(t); setMsg(`${ms} ms`);
        if (t.length >= 3) { submitBest(Math.round(t.reduce((a, b) => a + b, 0) / t.length)); setP('done'); } else setP('result');
      }
    }
  };
  useKeys((k) => { if (k === 'a' || (players === 1 && k === ' ')) press(0); if (k === 'l' && players === 2) press(1); });

  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const reset = () => { clear(); setTimes([]); setWins([0, 0]); setLit(0); setP('idle'); setMsg('Press Start. When the five lights go out, hit your button!'); };
  return (
    <div className="gm-table">
      <StatBar>{players === 2 ? <><Stat label="P1 rounds" value={wins[0]} /><Stat label="P2 rounds" value={wins[1]} /></> : <><Stat label="Attempt" value={`${Math.min(times.length + 1, 3)}/3`} /><Stat label="Best avg" value={best === null ? '—' : `${best} ms`} /></>}</StatBar>
      <div className="gm-lights" aria-label={`${lit} of 5 lights on`}>{[1, 2, 3, 4, 5].map(i => <div key={i} className={`gm-light ${i <= lit ? 'on' : ''}`} />)}</div>
      <p className="gm-result" style={{ fontSize: phase === 'go' ? 28 : undefined, color: phase === 'go' ? 'var(--teal)' : undefined }}>{msg}</p>
      {players === 1 && times.length > 0 && <div className="gm-hint">{times.map((t, i) => `#${i + 1}: ${t} ms`).join('  ·  ')}</div>}
      {(phase === 'idle' || phase === 'result') && <button type="button" className="gm-btn primary" onClick={begin}>{phase === 'idle' ? 'Start' : 'Next round'}</button>}
      <div className="gm-row gm-tapzones">
        <button type="button" className="gm-btn gm-tap" onPointerDown={(e) => { e.preventDefault(); press(0); }}>{players === 2 ? 'P1 (A)' : 'HIT IT (A / Space)'}</button>
        {players === 2 && <button type="button" className="gm-btn gm-tap alt" onPointerDown={(e) => { e.preventDefault(); press(1); }}>P2 (L)</button>}
      </div>
      {phase === 'done' && <Overlay title={players === 2 ? `P${wins[0] > wins[1] ? 1 : 2} wins! 🏁` : `Average ${avg} ms`} sub={players === 2 ? `${wins[0]} – ${wins[1]}` : (avg < 250 ? 'Lightning reflexes! ⚡' : avg < 400 ? 'Solid launch.' : 'Keep practising!')}
        actions={<button type="button" className="gm-btn primary" onClick={reset}>Race again</button>} />}
    </div>
  );
}
