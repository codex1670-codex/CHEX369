// Real-time online boards. The server owns the clock/physics; these send tiny inputs and draw
// whatever 'game:frame' updates arrive.  Props: { room, myId, frame, send }.
import { useEffect, useRef } from 'react';
import { CircuitRace } from './racingGames.jsx';
import { GameCanvas, rr, useKeys } from './ui.jsx';

const nameOf = (room, id) => room.players.find((p) => p.user.id === id)?.user.displayName || 'Opponent';
const slotOf = (room, myId) => Math.max(0, room.state.order.indexOf(myId));
const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };

// Sends {dir:-1|0|1} whenever the up/down state changes (keyboard + on-screen buttons).
function useDirInput(send) {
  const keys = useRef({});
  const lastDir = useRef(0);
  const emit = () => {
    const d = (keys.current.s || keys.current.arrowdown ? 1 : 0) - (keys.current.w || keys.current.arrowup ? 1 : 0);
    if (d !== lastDir.current) { lastDir.current = d; send({ dir: d }); }
  };
  useEffect(() => {
    const down = (e) => { if (typing(e)) return; const k = e.key.toLowerCase(); if (['w', 's', 'arrowup', 'arrowdown'].includes(k)) { e.preventDefault(); keys.current[k] = true; emit(); } };
    const up = (e) => { const k = e.key.toLowerCase(); if (k in keys.current) { keys.current[k] = false; emit(); } };
    const blur = () => { keys.current = {}; emit(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); send({ dir: 0 }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { keys, emit };
}

/* ───────── Pong ───────── */
const PG = { w: 400, h: 260, pw: 8, ph: 56, m: 14 };
export function PongLive({ room, myId, frame, send }) {
  const cv = useRef(null);
  const slot = slotOf(room, myId);
  const { keys, emit } = useDirInput(send);
  const hold = (k) => ({
    onPointerDown: (e) => { e.preventDefault(); keys.current[k] = true; emit(); },
    onPointerUp: () => { keys.current[k] = false; emit(); }, onPointerLeave: () => { keys.current[k] = false; emit(); }, onPointerCancel: () => { keys.current[k] = false; emit(); },
  });
  useEffect(() => {
    const ctx = cv.current?.getContext('2d'); if (!ctx) return;
    const f = frame?.t === 'pong' ? frame : { y: [PG.h / 2, PG.h / 2], ball: { x: PG.w / 2, y: PG.h / 2 }, score: [0, 0] };
    ctx.fillStyle = '#14101f'; ctx.fillRect(0, 0, PG.w, PG.h);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; for (let y = 6; y < PG.h; y += 18) ctx.fillRect(PG.w / 2 - 1, y, 2, 10);
    ctx.fillStyle = slot === 0 ? '#9b7dff' : '#ff5c93'; rr(ctx, PG.m, f.y[0] - PG.ph / 2, PG.pw, PG.ph, 3); ctx.fill();
    ctx.fillStyle = slot === 1 ? '#9b7dff' : '#ff5c93'; rr(ctx, PG.w - PG.m - PG.pw, f.y[1] - PG.ph / 2, PG.pw, PG.ph, 3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.ball.x, f.ball.y, 5, 0, Math.PI * 2); ctx.fill();
  }, [frame, slot]);
  const sc = frame?.t === 'pong' ? frame.score : room.state.score || [0, 0];
  const opp = room.players.find((p) => p.user.id !== myId);
  return (
    <div className="gm-table">
      <div className="gm-statbar">
        <div className="gm-stat"><span>You ({slot === 0 ? 'left' : 'right'})</span><b>{sc[slot]}</b></div>
        <div className="gm-stat"><span>First to</span><b>7</b></div>
        <div className="gm-stat"><span>{opp?.user.displayName || 'Rival'}</span><b>{sc[1 - slot]}</b></div>
      </div>
      <div className="gm-stage" style={{ touchAction: 'none' }}><GameCanvas w={PG.w} h={PG.h} canvasRef={cv} label="Online Pong court" /></div>
      <div className="gm-row gm-pads"><button type="button" className="gm-btn gm-hold" aria-label="Up" {...hold('w')}>▲</button><button type="button" className="gm-btn gm-hold" aria-label="Down" {...hold('s')}>▼</button></div>
      <p className="gm-hint">Move with W / S or ↑ / ↓ (or hold the buttons). The server runs the ball, so it’s fair for both.</p>
    </div>
  );
}

/* ───────── Drag Race ───────── */
export function DragLive({ room, myId, frame, send }) {
  const slot = slotOf(room, myId);
  const f = frame?.t === 'drag' ? frame : { phase: 'count', msg: 'Get ready…', pos: [0, 0], len: 60 };
  const tap = () => send({ tap: true });
  useKeys((k) => { if (k === 'a' || k === ' ' || k === 'l') tap(); });
  const lanes = [slot, 1 - slot];
  return (
    <div className="gm-table">
      {lanes.map((i, row) => (
        <div key={i} className="gm-lane"><span className="gm-lane-name">{row === 0 ? 'You' : nameOf(room, room.state.order[i]).slice(0, 5)}</span>
          <div className="gm-lane-track"><div className="gm-lane-car" style={{ left: `calc(${(f.pos[i] / f.len) * 100}% - ${(f.pos[i] / f.len) * 34}px)`, background: row === 0 ? 'var(--violet-bright)' : 'var(--pink)' }}>🏎️</div><div className="gm-lane-flag">🏁</div></div></div>
      ))}
      <p className="gm-result" style={{ fontSize: f.phase === 'go' || f.phase === 'count' ? 22 : undefined, minHeight: 28 }}>{f.msg}</p>
      <div className="gm-row gm-tapzones"><button type="button" className="gm-btn gm-tap" onPointerDown={(e) => { e.preventDefault(); tap(); }}>TAP! (A / Space)</button></div>
      <p className="gm-hint">Wait for GO, then tap as fast as you can. Tapping early costs you 3 points. 60 taps to win.</p>
    </div>
  );
}

/* ───────── Launch Control ───────── */
export function LaunchLive({ room, myId, frame, send }) {
  const slot = slotOf(room, myId);
  const f = frame?.t === 'launch' ? frame : { phase: 'idle', lit: 0, msg: 'Get ready…', wins: [0, 0], round: 0 };
  const press = () => send({ press: true });
  useKeys((k) => { if (k === 'a' || k === ' ' || k === 'l') press(); });
  const opp = room.players.find((p) => p.user.id !== myId);
  return (
    <div className="gm-table">
      <div className="gm-statbar"><div className="gm-stat"><span>You</span><b>{f.wins[slot]}</b></div><div className="gm-stat"><span>Round</span><b>{f.round || '—'}</b></div><div className="gm-stat"><span>{opp?.user.displayName || 'Rival'}</span><b>{f.wins[1 - slot]}</b></div></div>
      <div className="gm-lights" aria-label={`${f.lit} of 5 lights on`}>{[1, 2, 3, 4, 5].map((i) => <div key={i} className={`gm-light ${i <= f.lit ? 'on' : ''}`} />)}</div>
      <p className="gm-result" style={{ fontSize: f.phase === 'go' ? 28 : undefined, color: f.phase === 'go' ? 'var(--teal)' : undefined }}>{f.msg}</p>
      <div className="gm-row gm-tapzones"><button type="button" className="gm-btn gm-tap" onPointerDown={(e) => { e.preventDefault(); press(); }}>HIT IT! (A / Space)</button></div>
      <p className="gm-hint">Best of 3. Wait until all five lights go out — pressing early gives your rival the round.</p>
    </div>
  );
}

/* ───────── Circuit Race ───────── */
export function CircuitLive({ room, myId, frame, send }) {
  const frameRef = useRef(null);
  frameRef.current = frame?.t === 'circuit' ? frame : null;
  const slot = slotOf(room, myId);
  const otherId = room.state.order[1 - slot];
  const net = useRef(null);
  if (!net.current) net.current = { slot, otherId, send, frameRef };
  net.current.send = send;
  return <CircuitRace net={net.current} />;
}
