// Shared building blocks for the built-in games.
import { useCallback, useEffect, useRef, useState } from 'react';

// All game randomness goes through rand() so a Score Duel can seed it: both players then get
// the identical shuffle / obstacles / puzzle. Without a seed it is just Math.random.
let source = Math.random;
export const rand = () => source();
export function seedRandom(seed) {
  if (seed === null || seed === undefined) { source = Math.random; return; }
  let a = (seed >>> 0) || 1; // mulberry32
  source = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const rnd = (n) => Math.floor(rand() * n);
export const pick = (arr) => arr[rnd(arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- personal best, stored on this device ----
export function readBest(id) {
  try { const v = localStorage.getItem(`chex.best.${id}`); return v === null ? null : Number(v); } catch { return null; }
}
// lowerIsBetter: times / move counts. Returns true when `value` is a new personal best.
export function useBest(id, lowerIsBetter = false) {
  const [best, setBest] = useState(() => readBest(id));
  const submit = useCallback((value) => {
    const cur = readBest(id);
    const better = cur === null || (lowerIsBetter ? value < cur : value > cur);
    if (better) { try { localStorage.setItem(`chex.best.${id}`, String(value)); } catch { /* private mode */ } setBest(value); }
    return better;
  }, [id, lowerIsBetter]);
  return [best, submit];
}

// ---- keyboard: a live { key: true } map. Never steals keys while typing in a text box
// (the Codex assistant input lives on the same page). ----
const GAME_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']);
export function useKeys(onPress) {
  const keys = useRef({});
  const cb = useRef(onPress);
  cb.current = onPress;
  useEffect(() => {
    const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
    const down = (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (GAME_KEYS.has(k)) e.preventDefault();
      if (!keys.current[k]) cb.current?.(k);
      keys.current[k] = true;
    };
    const up = (e) => { keys.current[e.key.toLowerCase()] = false; };
    const blur = () => { keys.current = {}; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
  return keys;
}

// ---- requestAnimationFrame loop; step(dt seconds). Pauses while the tab is hidden. ----
export function useLoop(step) {
  const ref = useRef(step);
  ref.current = step;
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (t) => {
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      if (!document.hidden) ref.current(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

// A timeout that is cleared automatically on unmount.
export function useTimeouts() {
  const ids = useRef(new Set());
  useEffect(() => () => { ids.current.forEach(clearTimeout); ids.current.clear(); }, []);
  return useCallback((fn, ms) => {
    const id = setTimeout(() => { ids.current.delete(id); fn(); }, ms);
    ids.current.add(id);
    return id;
  }, []);
}

// ---- touch / mouse buttons that act like a held key ----
export function HoldBtn({ k, keys, children, className = '', style }) {
  const set = (v) => { keys.current[k] = v; };
  return (
    <button type="button" className={`gm-btn gm-hold ${className}`} style={style}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); set(true); }}
      onPointerUp={() => set(false)} onPointerCancel={() => set(false)} onPointerLeave={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}>
      {children}
    </button>
  );
}

export function Stat({ label, value }) {
  return <div className="gm-stat"><span>{label}</span><b>{value}</b></div>;
}
export function StatBar({ children }) { return <div className="gm-statbar">{children}</div>; }

export function Overlay({ title, sub, actions }) {
  return (
    <div className="gm-overlay" role="status">
      <div className="gm-overlay-title">{title}</div>
      {sub && <div className="gm-overlay-sub">{sub}</div>}
      <div className="gm-overlay-actions">{actions}</div>
    </div>
  );
}

// Canvas with a fixed logical size that scales to the container.
export function GameCanvas({ w, h, canvasRef, onPointerDown, onPointerMove, onPointerUp, label }) {
  return (
    <canvas ref={canvasRef} width={w} height={h} className="gm-canvas" role="img" aria-label={label}
      style={{ aspectRatio: `${w} / ${h}`, maxWidth: w }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
  );
}
// Convert a pointer event to canvas logical coordinates.
export function canvasPoint(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / (r.width || 1)) * canvas.width, y: ((e.clientY - r.top) / (r.height || 1)) * canvas.height };
}

// Swipe detection for touch screens.
export function useSwipe(onSwipe) {
  const start = useRef(null);
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  return {
    onPointerDown: (e) => { start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e) => {
      const s = start.current; start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      cb.current(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    },
  };
}

// ---- playing cards ----
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const rankValue = (r) => (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r));
export function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s, id: r + s });
  return shuffle(d);
}
export function PlayingCard({ card, faceDown, small, onClick, disabled, highlight, dim }) {
  const red = card && (card.s === '♥' || card.s === '♦');
  return (
    <button type="button" onClick={onClick} disabled={disabled || !onClick}
      className={`gm-card ${faceDown ? 'back' : red ? 'red' : ''} ${small ? 'small' : ''} ${highlight ? 'hl' : ''} ${dim ? 'dim' : ''}`}
      aria-label={faceDown ? 'Face-down card' : `${card.r} of ${card.s}`}>
      {!faceDown && (<><span className="r">{card.r}</span><span className="s">{card.s}</span></>)}
    </button>
  );
}

// Rounded rectangle path (ctx.roundRect isn't available in older browsers).
export function rr(ctx, x, y, w, h, r = 6) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
