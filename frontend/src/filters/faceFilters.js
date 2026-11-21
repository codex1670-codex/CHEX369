// Video-call face filters. Three kinds:
//   face   – drawn on the face and follows it (needs the face tracker)
//   screen – animated overlay over the whole picture (no face needed)
//   color  – a colour / effect look applied to the whole picture (no face needed)
//
// Face filters are drawn in "face units": the origin is the middle between the eyes, the x axis runs along the
// eyes (so it tilts with the head) and 1 unit = the distance between the outer eye corners.

// ---------- face geometry ----------
export function computeFrame(lm, W, H) {
  const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  const a = P(33), b = P(263);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const roll = Math.atan2(b.y - a.y, b.x - a.x);
  const u = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const c = Math.cos(roll), s = Math.sin(roll);
  const loc = (i) => { const p = P(i); const dx = p.x - mx, dy = p.y - my; return { x: (dx * c + dy * s) / u, y: (-dx * s + dy * c) / u }; };
  const mid = (i, j) => { const p = loc(i), q = loc(j); return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };
  const up = loc(13), lo = loc(14);
  return {
    mx, my, roll, u,
    eyeL: mid(33, 133), eyeR: mid(362, 263),
    nose: loc(1), top: loc(10), chin: loc(152),
    mouth: mid(13, 14), mouthL: loc(61), mouthR: loc(291),
    cheekL: loc(234), cheekR: loc(454),
    open: Math.max(0, Math.min(1, (lo.y - up.y) / 0.5)),
  };
}

// Smooths the numbers between two frames so the filter doesn't jitter.
export function lerpFrame(prev, next, k = 0.55) {
  if (!prev) return next;
  const out = {};
  for (const key of Object.keys(next)) {
    const n = next[key], p = prev[key];
    out[key] = typeof n === 'number' ? p + (n - p) * k : lerpFrame(p, n, k);
  }
  return out;
}

// ---------- tiny drawing helpers ----------
const TAU = Math.PI * 2;
const rrp = (c, x, y, w, h, r) => { c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
const rr = (c, ...a) => { c.beginPath(); rrp(c, ...a); };
const ell = (c, x, y, rx, ry, rot = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); };
const heart = (c, x, y, s) => {
  c.beginPath(); c.moveTo(x, y + s * 0.35);
  c.bezierCurveTo(x - s * 0.9, y - s * 0.2, x - s * 0.5, y - s * 0.9, x, y - s * 0.35);
  c.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 0.9, y - s * 0.2, x, y + s * 0.35); c.closePath();
};
const star = (c, x, y, r) => {
  c.beginPath();
  for (let i = 0; i < 10; i++) { const rad = i % 2 ? r * 0.45 : r; const a = -Math.PI / 2 + (i * Math.PI) / 5; c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
  c.closePath();
};
const tri = (c, a, b, d) => { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.closePath(); };
const emojiMask = (c, f, ch) => { // emoji drawn at normal text size (the face-unit scale is undone so text stays sharp)
  const size = (f.chin.y - f.top.y) * 1.15, cy = (f.top.y + f.chin.y) / 2;
  c.save(); c.scale(0.01, 0.01); c.font = `${size * 100}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, 0, cy * 100); c.restore();
};
const vignette = (c, W, H, a = 0.5) => {
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
};
const tint = (c, W, H, color, mode = 'source-over') => { c.save(); c.globalCompositeOperation = mode; c.fillStyle = color; c.fillRect(0, 0, W, H); c.restore(); };
const seeded = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- face filters ----------
const FACE = [
  { id: 'shades', name: 'Cool shades', icon: '😎', draw(c, f, t) {
    c.fillStyle = '#0b0b12'; c.strokeStyle = '#0b0b12'; c.lineCap = 'round';
    for (const e of [f.eyeL, f.eyeR]) { rr(c, e.x - 0.32, e.y - 0.2, 0.64, 0.44, 0.16); c.fill(); }
    c.lineWidth = 0.07; c.beginPath(); c.moveTo(f.eyeL.x + 0.3, f.eyeL.y - 0.06); c.lineTo(f.eyeR.x - 0.3, f.eyeR.y - 0.06);
    c.moveTo(f.eyeL.x - 0.32, f.eyeL.y - 0.08); c.lineTo(f.cheekL.x, f.eyeL.y - 0.04);
    c.moveTo(f.eyeR.x + 0.32, f.eyeR.y - 0.08); c.lineTo(f.cheekR.x, f.eyeR.y - 0.04); c.stroke();
    c.fillStyle = `rgba(255,255,255,${0.22 + 0.1 * Math.sin(t * 2)})`;
    for (const e of [f.eyeL, f.eyeR]) { c.beginPath(); c.moveTo(e.x - 0.24, e.y - 0.14); c.lineTo(e.x - 0.08, e.y - 0.14); c.lineTo(e.x - 0.22, e.y + 0.16); c.lineTo(e.x - 0.3, e.y + 0.16); c.closePath(); c.fill(); }
  } },
  { id: 'round', name: 'Round specs', icon: '🤓', draw(c, f) {
    c.strokeStyle = '#d9a441'; c.lineWidth = 0.05; c.fillStyle = 'rgba(180,220,255,.16)';
    for (const e of [f.eyeL, f.eyeR]) { ell(c, e.x, e.y, 0.27, 0.27); c.fill(); c.stroke(); }
    c.beginPath(); c.moveTo(f.eyeL.x + 0.27, f.eyeL.y - 0.04); c.quadraticCurveTo(0, f.eyeL.y - 0.16, f.eyeR.x - 0.27, f.eyeR.y - 0.04);
    c.moveTo(f.eyeL.x - 0.27, f.eyeL.y); c.lineTo(f.cheekL.x, f.eyeL.y + 0.02); c.moveTo(f.eyeR.x + 0.27, f.eyeR.y); c.lineTo(f.cheekR.x, f.eyeR.y + 0.02); c.stroke();
  } },
  { id: 'hearteyes', name: 'Heart eyes', icon: '😍', draw(c, f, t) {
    for (const e of [f.eyeL, f.eyeR]) { const s = 0.36 + 0.05 * Math.sin(t * 8); heart(c, e.x, e.y, s); c.fillStyle = '#ff2d6f'; c.fill(); c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 0.025; c.stroke(); }
  } },
  { id: 'dog', name: 'Puppy', icon: '🐶', draw(c, f) {
    for (const s of [-1, 1]) { c.save(); c.translate(s * 0.72, f.top.y + 0.12); c.rotate(s * 0.35); ell(c, 0, 0.18, 0.24, 0.5); c.fillStyle = '#7a4a24'; c.fill(); ell(c, 0, 0.2, 0.14, 0.34); c.fillStyle = '#a8703d'; c.fill(); c.restore(); }
    ell(c, f.nose.x, f.nose.y - 0.02, 0.17, 0.12); c.fillStyle = '#1a1a1f'; c.fill();
    ell(c, f.nose.x - 0.05, f.nose.y - 0.06, 0.05, 0.03); c.fillStyle = 'rgba(255,255,255,.6)'; c.fill();
    if (f.open > 0.18) { rr(c, f.mouth.x - 0.12, f.mouth.y, 0.24, 0.1 + f.open * 0.5, 0.12); c.fillStyle = '#ff6f91'; c.fill(); c.strokeStyle = '#d6456b'; c.lineWidth = 0.015; c.stroke(); }
  } },
  { id: 'cat', name: 'Kitty', icon: '🐱', draw(c, f) {
    for (const s of [-1, 1]) {
      tri(c, [s * 0.78, f.top.y + 0.3], [s * 0.66, f.top.y - 0.55], [s * 0.18, f.top.y + 0.02]); c.fillStyle = '#3b3b46'; c.fill();
      tri(c, [s * 0.68, f.top.y + 0.12], [s * 0.62, f.top.y - 0.32], [s * 0.34, f.top.y + 0.0]); c.fillStyle = '#ff9db9'; c.fill();
    }
    tri(c, [f.nose.x - 0.1, f.nose.y - 0.07], [f.nose.x + 0.1, f.nose.y - 0.07], [f.nose.x, f.nose.y + 0.06]); c.fillStyle = '#ff7aa2'; c.fill();
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 0.018; c.lineCap = 'round'; c.beginPath();
    for (const s of [-1, 1]) for (const k of [-1, 0, 1]) { c.moveTo(s * 0.34, f.nose.y + 0.02 + k * 0.05); c.lineTo(s * 1.15, f.nose.y + 0.02 + k * 0.16); }
    c.stroke();
  } },
  { id: 'bunny', name: 'Bunny', icon: '🐰', draw(c, f, t) {
    for (const s of [-1, 1]) { c.save(); c.translate(s * 0.32, f.top.y - 0.6); c.rotate(s * (0.12 + 0.03 * Math.sin(t * 3))); ell(c, 0, 0, 0.17, 0.62); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 0.015; c.stroke(); ell(c, 0, 0.04, 0.09, 0.46); c.fillStyle = '#ffb3c8'; c.fill(); c.restore(); }
    ell(c, f.nose.x, f.nose.y - 0.03, 0.09, 0.06); c.fillStyle = '#ff7aa2'; c.fill();
  } },
  { id: 'crown', name: 'Crown', icon: '👑', draw(c, f, t) {
    const b = f.top.y + 0.04, g = c.createLinearGradient(0, b - 0.6, 0, b); g.addColorStop(0, '#fff2a8'); g.addColorStop(1, '#e0a21a');
    c.beginPath(); c.moveTo(-0.6, b); c.lineTo(-0.62, b - 0.46); c.lineTo(-0.3, b - 0.22); c.lineTo(0, b - 0.62); c.lineTo(0.3, b - 0.22); c.lineTo(0.62, b - 0.46); c.lineTo(0.6, b); c.closePath();
    c.fillStyle = g; c.fill(); c.strokeStyle = '#b87a10'; c.lineWidth = 0.025; c.stroke();
    [['#ff3b5c', -0.35], ['#3ba9ff', 0], ['#3bd16f', 0.35]].forEach(([col, x], i) => { ell(c, x, b - 0.1, 0.07 + 0.01 * Math.sin(t * 4 + i), 0.07); c.fillStyle = col; c.fill(); });
  } },
  { id: 'party', name: 'Party hat', icon: '🥳', draw(c, f) {
    const b = f.top.y + 0.08; c.save(); c.translate(0.1, 0); c.rotate(0.14);
    const g = c.createLinearGradient(-0.45, 0, 0.45, 0); g.addColorStop(0, '#7b5cff'); g.addColorStop(1, '#ff5cae');
    tri(c, [-0.46, b], [0.46, b], [0.04, b - 1.05]); c.fillStyle = g; c.fill();
    c.fillStyle = 'rgba(255,255,255,.85)'; for (const [x, y] of [[-0.1, b - 0.22], [0.14, b - 0.38], [-0.02, b - 0.6], [0.1, b - 0.8]]) { ell(c, x, y, 0.045, 0.045); c.fill(); }
    ell(c, 0.04, b - 1.05, 0.1, 0.1); c.fillStyle = '#ffd23f'; c.fill(); c.restore();
  } },
  { id: 'mustache', name: 'Mustache', icon: '🥸', draw(c, f) {
    const y = f.nose.y + (f.mouth.y - f.nose.y) * 0.42; c.fillStyle = '#2b1a10';
    for (const s of [-1, 1]) {
      c.beginPath(); c.moveTo(0, y - 0.02); c.bezierCurveTo(s * 0.18, y - 0.14, s * 0.5, y - 0.12, s * 0.66, y + 0.1);
      c.bezierCurveTo(s * 0.7, y + 0.2, s * 0.58, y + 0.2, s * 0.52, y + 0.12); c.bezierCurveTo(s * 0.4, y + 0.02, s * 0.2, y + 0.1, 0, y + 0.07); c.closePath(); c.fill();
    }
  } },
  { id: 'clown', name: 'Clown', icon: '🤡', draw(c, f) {
    for (const s of [-1, 1]) { ell(c, s * 0.9, f.top.y + 0.42, 0.3, 0.3); c.fillStyle = '#ff7b1a'; c.fill(); ell(c, s * 0.66, f.top.y + 0.08, 0.27, 0.27); c.fill(); }
    ell(c, f.nose.x, f.nose.y - 0.02, 0.17, 0.17); c.fillStyle = '#ff2b3a'; c.fill(); ell(c, f.nose.x - 0.05, f.nose.y - 0.08, 0.05, 0.04); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill();
    for (const e of [f.eyeL, f.eyeR]) { ell(c, e.x, e.y - 0.3, 0.2, 0.09, 0); c.fillStyle = 'rgba(60,140,255,.75)'; c.fill(); }
  } },
  { id: 'devil', name: 'Devil', icon: '😈', draw(c, f) {
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 0.2, f.top.y + 0.14); c.quadraticCurveTo(s * 0.55, f.top.y - 0.1, s * 0.5, f.top.y - 0.52); c.quadraticCurveTo(s * 0.8, f.top.y - 0.2, s * 0.62, f.top.y + 0.22); c.closePath(); c.fillStyle = '#d6142b'; c.fill(); c.strokeStyle = '#7d0716'; c.lineWidth = 0.02; c.stroke(); }
  } },
  { id: 'halo', name: 'Angel halo', icon: '😇', draw(c, f, t) {
    c.save(); c.shadowColor = '#ffe27a'; c.shadowBlur = 14; c.strokeStyle = '#ffd84a'; c.lineWidth = 0.07;
    ell(c, 0, f.top.y - 0.28 + Math.sin(t * 3) * 0.03, 0.55, 0.14); c.stroke(); c.restore();
  } },
  { id: 'blush', name: 'Blush', icon: '☺️', draw(c, f, t) {
    for (const s of [-1, 1]) { ell(c, s * 0.62, f.nose.y + 0.06, 0.24, 0.15); c.fillStyle = 'rgba(255,90,140,.38)'; c.fill(); heart(c, s * 0.78, f.nose.y - 0.2 - 0.05 * Math.abs(Math.sin(t * 2 + s)), 0.1); c.fillStyle = '#ff4d85'; c.fill(); }
  } },
  { id: 'rainbow', name: 'Rainbow', icon: '🌈', draw(c, f, t) {
    if (f.open < 0.14) return;
    const cols = ['#ff3b3b', '#ff9a1f', '#ffe11f', '#3bd16f', '#2aa8ff', '#5b5bff', '#b04bff'];
    c.lineCap = 'round'; c.lineWidth = 0.06;
    cols.forEach((col, i) => { const x = f.mouth.x + (i - 3) * 0.055; c.strokeStyle = col; c.beginPath(); c.moveTo(x, f.mouth.y + 0.03);
      c.quadraticCurveTo(x + Math.sin(t * 6 + i * 0.5) * 0.08, f.mouth.y + 1.0, x + (i - 3) * 0.12, f.mouth.y + 1.6 + 0.4 * f.open); c.stroke(); });
  } },
  { id: 'flowers', name: 'Flower crown', icon: '🌸', draw(c, f) {
    const cols = ['#ff7eb6', '#fff', '#ffd23f', '#ff9ed1', '#c79bff'];
    for (let i = 0; i < 9; i++) {
      const x = -0.86 + (i / 8) * 1.72, y = f.top.y + 0.32 + x * x * 0.42, col = cols[i % cols.length];
      c.fillStyle = col; for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + i; ell(c, x + Math.cos(a) * 0.075, y + Math.sin(a) * 0.075, 0.062, 0.062); c.fill(); }
      ell(c, x, y, 0.045, 0.045); c.fillStyle = '#f5a300'; c.fill();
    }
  } },
  { id: 'pirate', name: 'Pirate', icon: '🏴‍☠️', draw(c, f) {
    c.strokeStyle = '#141418'; c.lineWidth = 0.045; c.beginPath();
    c.moveTo(f.eyeR.x - 0.1, f.eyeR.y - 0.22); c.lineTo(-1.0, f.top.y + 0.28); c.moveTo(f.eyeR.x + 0.22, f.eyeR.y + 0.08); c.lineTo(1.05, f.eyeR.y + 0.22); c.stroke();
    ell(c, f.eyeR.x, f.eyeR.y, 0.3, 0.26, 0.2); c.fillStyle = '#141418'; c.fill();
  } },
  { id: 'hero', name: 'Hero mask', icon: '🦸', draw(c, f) {
    const g = c.createLinearGradient(-0.8, 0, 0.8, 0); g.addColorStop(0, '#2b6cff'); g.addColorStop(1, '#8a3cff');
    c.beginPath(); rrp(c, -0.82, -0.3, 1.64, 0.62, 0.3);
    for (const e of [f.eyeL, f.eyeR]) { c.moveTo(e.x + 0.2, e.y); c.ellipse(e.x, e.y, 0.2, 0.13, 0, 0, TAU); }
    c.fillStyle = g; c.fill('evenodd'); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 0.02; c.stroke();
  } },
  { id: 'alien', name: 'Alien', icon: '👽', draw(c, f) { emojiMask(c, f, '👽'); } },
  { id: 'robot', name: 'Robot', icon: '🤖', draw(c, f) { emojiMask(c, f, '🤖'); } },
  { id: 'ghost', name: 'Ghost', icon: '👻', draw(c, f) { emojiMask(c, f, '👻'); } },
  { id: 'santa', name: 'Santa', icon: '🎅', draw(c, f, t) {
    const b = f.top.y + 0.1; c.save(); c.rotate(-0.08);
    c.beginPath(); c.moveTo(-0.62, b); c.quadraticCurveTo(-0.5, b - 0.85, 0.35, b - 0.8); c.quadraticCurveTo(0.7, b - 0.7, 0.72, b - 0.2); c.lineTo(0.62, b); c.closePath(); c.fillStyle = '#d6142b'; c.fill();
    rr(c, -0.7, b - 0.1, 1.4, 0.22, 0.11); c.fillStyle = '#fff'; c.fill();
    ell(c, 0.72 + Math.sin(t * 3) * 0.02, b - 0.22, 0.12, 0.12); c.fillStyle = '#fff'; c.fill(); c.restore();
  } },
  { id: 'cowboy', name: 'Cowboy', icon: '🤠', draw(c, f) {
    const b = f.top.y + 0.12; c.fillStyle = '#8a5a2b'; c.strokeStyle = '#5a3612'; c.lineWidth = 0.02;
    ell(c, 0, b, 0.95, 0.16); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-0.45, b - 0.02); c.quadraticCurveTo(-0.5, b - 0.62, -0.18, b - 0.55); c.quadraticCurveTo(0, b - 0.4, 0.18, b - 0.55); c.quadraticCurveTo(0.5, b - 0.62, 0.45, b - 0.02); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#3b230d'; rr(c, -0.46, b - 0.16, 0.92, 0.1, 0.04); c.fill();
  } },
  { id: 'bear', name: 'Bear', icon: '🐻', draw(c, f) {
    for (const s of [-1, 1]) { ell(c, s * 0.62, f.top.y + 0.08, 0.26, 0.26); c.fillStyle = '#6b4423'; c.fill(); ell(c, s * 0.62, f.top.y + 0.1, 0.14, 0.14); c.fillStyle = '#d9a77a'; c.fill(); }
    ell(c, f.nose.x, f.nose.y - 0.02, 0.2, 0.15); c.fillStyle = '#d9a77a'; c.fill(); ell(c, f.nose.x, f.nose.y - 0.06, 0.09, 0.06); c.fillStyle = '#1a1a1f'; c.fill();
  } },
  { id: 'antlers', name: 'Reindeer', icon: '🦌', draw(c, f) {
    c.strokeStyle = '#7a4a24'; c.lineWidth = 0.06; c.lineCap = 'round';
    for (const s of [-1, 1]) { const x0 = s * 0.38, y0 = f.top.y + 0.1; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(s * 0.7, y0 - 0.3, s * 0.62, y0 - 0.85);
      c.moveTo(s * 0.62, y0 - 0.3); c.lineTo(s * 0.95, y0 - 0.5); c.moveTo(s * 0.66, y0 - 0.58); c.lineTo(s * 0.4, y0 - 0.82); c.stroke(); }
    ell(c, f.nose.x, f.nose.y - 0.02, 0.14, 0.14); c.fillStyle = '#ff2b3a'; c.fill();
  } },
  { id: 'tongue', name: 'Tongue out', icon: '😝', draw(c, f, t) {
    const o = Math.max(f.open, 0.25), w = 0.2, y = f.mouth.y + 0.02 + o * 0.12 + Math.sin(t * 8) * 0.01;
    c.beginPath(); c.moveTo(f.mouth.x - w, y); c.lineTo(f.mouth.x - w, y + 0.28); c.quadraticCurveTo(f.mouth.x, y + 0.5 + o * 0.2, f.mouth.x + w, y + 0.28); c.lineTo(f.mouth.x + w, y); c.closePath();
    c.fillStyle = '#ff5c7c'; c.fill(); c.strokeStyle = '#d6345a'; c.lineWidth = 0.015; c.beginPath(); c.moveTo(f.mouth.x, y + 0.04); c.lineTo(f.mouth.x, y + 0.34); c.stroke();
  } },
  { id: 'cry', name: 'Crying', icon: '😭', draw(c, f, t) {
    for (const e of [f.eyeL, f.eyeR]) for (let k = 0; k < 3; k++) {
      const p = ((t * 0.9 + k / 3 + (e.x > 0 ? 0.17 : 0)) % 1), y = e.y + 0.12 + p * 0.9;
      c.save(); c.globalAlpha = 1 - p * 0.8; ell(c, e.x + (e.x > 0 ? 0.08 : -0.08), y, 0.05, 0.085); c.fillStyle = '#5cc8ff'; c.fill(); c.restore();
    }
  } },
  { id: 'ninja', name: 'Ninja', icon: '🥷', draw(c, f) {
    c.fillStyle = '#e63946'; rr(c, -0.95, f.top.y + 0.28, 1.9, 0.2, 0.06); c.fill();
    c.beginPath(); c.moveTo(0.95, f.top.y + 0.34); c.quadraticCurveTo(1.25, f.top.y + 0.5, 1.3, f.top.y + 0.95); c.lineTo(1.15, f.top.y + 0.9); c.quadraticCurveTo(1.1, f.top.y + 0.55, 0.9, f.top.y + 0.46); c.closePath(); c.fill();
    c.fillStyle = '#fff'; rr(c, -0.2, f.top.y + 0.3, 0.4, 0.16, 0.04); c.fill();
  } },
  { id: 'monocle', name: 'Monocle', icon: '🧐', draw(c, f) {
    c.strokeStyle = '#d9a441'; c.lineWidth = 0.05; c.fillStyle = 'rgba(180,220,255,.18)'; ell(c, f.eyeR.x, f.eyeR.y, 0.3, 0.3); c.fill(); c.stroke();
    c.lineWidth = 0.02; c.beginPath(); c.moveTo(f.eyeR.x + 0.2, f.eyeR.y + 0.22); c.quadraticCurveTo(f.eyeR.x + 0.4, f.eyeR.y + 0.7, f.eyeR.x + 0.25, f.chin.y - 0.1); c.stroke();
  } },
  { id: 'visor', name: 'Cyber visor', icon: '🕶️', draw(c, f, t) {
    const g = c.createLinearGradient(-0.9, 0, 0.9, 0); g.addColorStop(0, '#00f0ff'); g.addColorStop(0.5, '#ff2bd6'); g.addColorStop(1, '#7b5cff');
    c.save(); c.shadowColor = '#00f0ff'; c.shadowBlur = 12; rr(c, -0.88, f.eyeL.y - 0.2, 1.76, 0.4, 0.2); c.fillStyle = 'rgba(8,8,24,.78)'; c.fill(); c.strokeStyle = g; c.lineWidth = 0.04; c.stroke(); c.restore();
    c.fillStyle = g; const sx = ((t * 0.7) % 1) * 1.5 - 0.75; rr(c, sx, f.eyeL.y - 0.14, 0.08, 0.28, 0.04); c.fill();
  } },
  { id: 'freckles', name: 'Freckles', icon: '🫧', draw(c, f) {
    c.fillStyle = 'rgba(140,80,40,.7)';
    for (const s of [-1, 1]) for (let i = 0; i < 7; i++) { ell(c, s * (0.2 + seeded(i + 3) * 0.28), f.nose.y - 0.1 + seeded(i + 11) * 0.16, 0.017 + seeded(i) * 0.012, 0.017 + seeded(i) * 0.012); c.fill(); }
  } },
  { id: 'sparkeyes', name: 'Sparkle eyes', icon: '🤩', draw(c, f, t) {
    for (const [i, e] of [f.eyeL, f.eyeR].entries()) { star(c, e.x, e.y, 0.3 + 0.06 * Math.sin(t * 7 + i)); c.fillStyle = '#ffe14a'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 0.02; c.stroke(); }
  } },
  { id: 'beard', name: 'Beard', icon: '🧔', draw(c, f) {
    c.beginPath(); c.moveTo(f.cheekL.x + 0.08, f.eyeL.y + 0.5); c.quadraticCurveTo(f.cheekL.x - 0.05, f.chin.y + 0.35, 0, f.chin.y + 0.45); c.quadraticCurveTo(f.cheekR.x + 0.05, f.chin.y + 0.35, f.cheekR.x - 0.08, f.eyeR.y + 0.5);
    c.quadraticCurveTo(0.5, f.mouth.y + 0.1, 0.18, f.mouth.y - 0.1); c.quadraticCurveTo(0, f.mouth.y - 0.16, -0.18, f.mouth.y - 0.1); c.quadraticCurveTo(-0.5, f.mouth.y + 0.1, f.cheekL.x + 0.08, f.eyeL.y + 0.5); c.closePath();
    c.fillStyle = '#3a2416'; c.fill();
  } },
  { id: 'stars', name: 'Starry', icon: '🌟', draw(c, f, t) {
    for (let i = 0; i < 6; i++) { const a = t * 1.6 + (i * TAU) / 6; star(c, Math.cos(a) * 1.05, f.top.y - 0.12 + Math.sin(a) * 0.26, 0.1 + 0.04 * Math.sin(t * 5 + i)); c.fillStyle = i % 2 ? '#fff3a0' : '#ffd23f'; c.fill(); }
  } },
].map((x) => ({ ...x, kind: 'face' }));

// ---------- full-screen overlays ----------
const SCREEN = [
  { id: 'confetti', name: 'Confetti', icon: '🎉', draw(c, W, H, t) {
    const cols = ['#ff4d6d', '#ffd23f', '#3bd1ff', '#7bff6a', '#b06bff'];
    for (let i = 0; i < 70; i++) {
      const x = (seeded(i) * W + Math.sin(t * 2 + i) * 20 + W) % W, y = ((t * (0.12 + seeded(i + 9) * 0.18) + seeded(i + 3)) % 1) * H;
      c.save(); c.translate(x, y); c.rotate(t * 3 + i); c.fillStyle = cols[i % cols.length]; c.fillRect(-4, -2, 8, 4); c.restore();
    }
  } },
  { id: 'hearts', name: 'Hearts rain', icon: '💖', draw(c, W, H, t) {
    for (let i = 0; i < 26; i++) {
      const x = seeded(i) * W + Math.sin(t * 1.5 + i) * 14, y = H - ((t * (0.08 + seeded(i + 5) * 0.1) + seeded(i + 2)) % 1) * (H + 40) + 20, s = 10 + seeded(i + 7) * 18;
      heart(c, x, y, s); c.fillStyle = `rgba(255,${60 + (i % 4) * 25},${120 + (i % 3) * 30},.85)`; c.fill();
    }
  } },
  { id: 'snow', name: 'Snow', icon: '❄️', draw(c, W, H, t) {
    c.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 90; i++) { const x = (seeded(i) * W + Math.sin(t + i) * 18 + W) % W, y = ((t * (0.05 + seeded(i + 4) * 0.1) + seeded(i + 8)) % 1) * H; c.beginPath(); c.arc(x, y, 1.5 + seeded(i + 6) * 3, 0, TAU); c.fill(); }
  } },
  { id: 'sparkle', name: 'Sparkle', icon: '✨', draw(c, W, H, t) {
    for (let i = 0; i < 28; i++) {
      const x = seeded(i) * W, y = seeded(i + 40) * H, p = (Math.sin(t * 2.2 + i * 1.7) + 1) / 2, r = 3 + p * 10;
      c.save(); c.globalAlpha = 0.25 + p * 0.75; c.fillStyle = '#fff'; c.translate(x, y); c.rotate(Math.PI / 4 * (i % 2));
      c.beginPath(); c.moveTo(0, -r); c.quadraticCurveTo(0, 0, r, 0); c.quadraticCurveTo(0, 0, 0, r); c.quadraticCurveTo(0, 0, -r, 0); c.quadraticCurveTo(0, 0, 0, -r); c.fill(); c.restore();
    }
  } },
  { id: 'bubbles', name: 'Bubbles', icon: '🫧', draw(c, W, H, t) {
    for (let i = 0; i < 22; i++) {
      const r = 8 + seeded(i + 2) * 22, x = seeded(i) * W + Math.sin(t * 1.3 + i) * 16, y = H + r - ((t * (0.05 + seeded(i + 5) * 0.08) + seeded(i + 9)) % 1) * (H + r * 2);
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = 'rgba(180,225,255,.12)'; c.fill(); c.strokeStyle = 'rgba(255,255,255,.65)'; c.lineWidth = 1.5; c.stroke();
      c.beginPath(); c.arc(x - r * 0.35, y - r * 0.35, r * 0.18, 0, TAU); c.fillStyle = 'rgba(255,255,255,.8)'; c.fill();
    }
  } },
  { id: 'rain', name: 'Rain', icon: '🌧️', draw(c, W, H, t) {
    tint(c, W, H, 'rgba(20,40,80,.22)'); c.strokeStyle = 'rgba(200,225,255,.7)'; c.lineWidth = 1.4; c.beginPath();
    for (let i = 0; i < 110; i++) { const x = seeded(i) * W, y = ((t * (0.9 + seeded(i + 3) * 0.6) + seeded(i + 7)) % 1) * (H + 40) - 20; c.moveTo(x, y); c.lineTo(x - 5, y + 18); }
    c.stroke();
  } },
  { id: 'fireflies', name: 'Fireflies', icon: '🪲', draw(c, W, H, t) {
    for (let i = 0; i < 30; i++) {
      const x = (seeded(i) + Math.sin(t * 0.4 + i) * 0.05) * W, y = (seeded(i + 30) + Math.cos(t * 0.35 + i * 2) * 0.05) * H, p = (Math.sin(t * 2 + i * 3) + 1) / 2;
      const g = c.createRadialGradient(x, y, 0, x, y, 16); g.addColorStop(0, `rgba(255,240,120,${0.9 * p})`); g.addColorStop(1, 'rgba(255,240,120,0)'); c.fillStyle = g; c.fillRect(x - 16, y - 16, 32, 32);
    }
  } },
  { id: 'cinema', name: 'Cinema', icon: '🎞️', draw(c, W, H, t) {
    const bar = H * 0.11; c.fillStyle = '#000'; c.fillRect(0, 0, W, bar); c.fillRect(0, H - bar, W, bar);
    c.fillStyle = 'rgba(255,255,255,.05)'; for (let i = 0; i < 40; i++) c.fillRect(seeded(i + Math.floor(t * 12)) * W, seeded(i + 60 + Math.floor(t * 12)) * H, 1.5, 1.5);
  } },
  { id: 'camcorder', name: 'Camcorder', icon: '📹', draw(c, W, H, t) {
    const m = Math.min(W, H) * 0.05, L = Math.min(W, H) * 0.08; c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2.5; c.beginPath();
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { c.moveTo(x + dx * L, y); c.lineTo(x, y); c.lineTo(x, y + dy * L); }
    c.stroke(); c.fillStyle = Math.floor(t * 2) % 2 ? '#ff2b3a' : 'rgba(255,43,58,.2)'; c.beginPath(); c.arc(m + 14, m + 34, 7, 0, TAU); c.fill();
    c.fillStyle = '#fff'; c.font = `bold ${Math.round(Math.min(W, H) * 0.045)}px monospace`; c.fillText('REC', m + 28, m + 40);
    const s = Math.floor(t); c.fillText(`00:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, W - m - 150, m + 40);
  } },
  { id: 'lightleak', name: 'Light leak', icon: '🌇', draw(c, W, H, t) {
    c.save(); c.globalCompositeOperation = 'screen'; const x = W * (0.5 + 0.4 * Math.sin(t * 0.5));
    const g = c.createRadialGradient(x, 0, 0, x, 0, W * 0.8); g.addColorStop(0, 'rgba(255,120,40,.55)'); g.addColorStop(0.5, 'rgba(255,60,120,.25)'); g.addColorStop(1, 'rgba(255,60,120,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
  } },
].map((x) => ({ ...x, kind: 'screen' }));

// ---------- colour looks ----------
const COLOR = [
  { id: 'bw', name: 'Black & white', icon: '⚫', css: 'grayscale(1) contrast(1.15)' },
  { id: 'sepia', name: 'Sepia', icon: '🟤', css: 'sepia(.9) contrast(1.05)' },
  { id: 'vintage', name: 'Vintage', icon: '📷', css: 'sepia(.45) saturate(1.3) contrast(.95) brightness(1.05)', after: (c, W, H) => vignette(c, W, H, 0.55) },
  { id: 'cool', name: 'Cool', icon: '🧊', css: 'saturate(1.1) hue-rotate(12deg)', after: (c, W, H) => tint(c, W, H, 'rgba(60,120,255,.14)') },
  { id: 'warm', name: 'Warm', icon: '🌅', css: 'saturate(1.2) sepia(.2)', after: (c, W, H) => tint(c, W, H, 'rgba(255,150,40,.14)') },
  { id: 'vivid', name: 'Vivid', icon: '🎨', css: 'saturate(1.9) contrast(1.15)' },
  { id: 'neon', name: 'Neon', icon: '💜', css: 'hue-rotate(290deg) saturate(2.4) contrast(1.25) brightness(1.05)' },
  { id: 'dreamy', name: 'Dreamy', icon: '☁️', css: 'blur(1.5px) brightness(1.12) saturate(1.2)', after: (c, W, H) => tint(c, W, H, 'rgba(255,190,230,.16)') },
  { id: 'night', name: 'Night vision', icon: '🟢', css: 'grayscale(1) brightness(1.25) contrast(1.4)', after: (c, W, H) => { tint(c, W, H, '#4dff6a', 'multiply'); vignette(c, W, H, 0.6); } },
  { id: 'comic', name: 'Comic', icon: '💥', css: 'contrast(1.8) saturate(1.8) brightness(1.05)' },
  { id: 'glitch', name: 'Glitch', icon: '📺', custom(c, v, W, H, t) {
    c.drawImage(v, 0, 0, W, H);
    c.save(); c.globalAlpha = 0.4; c.globalCompositeOperation = 'screen';
    const d = 6 + Math.sin(t * 9) * 4;
    c.drawImage(v, -d, 0, W, H); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.18; c.drawImage(v, d, 0, W, H); c.restore();
    for (let i = 0; i < 3; i++) { if (seeded(Math.floor(t * 8) + i) < 0.55) { const y = seeded(Math.floor(t * 8) * 3 + i) * H, h = 8 + seeded(i + 1) * 26, off = (seeded(Math.floor(t * 12) + i) - 0.5) * 60; c.drawImage(v, 0, (y / H) * v.videoHeight, v.videoWidth, (h / H) * v.videoHeight, off, y, W, h); } }
  } },
  { id: 'pixel', name: 'Pixelate', icon: '🟦', custom(c, v, W, H, t, eng) {
    const s = eng.scratch(Math.max(24, Math.round(W / 14)), Math.max(18, Math.round(H / 14)));
    s.ctx.drawImage(v, 0, 0, s.canvas.width, s.canvas.height);
    c.imageSmoothingEnabled = false; c.drawImage(s.canvas, 0, 0, W, H); c.imageSmoothingEnabled = true;
  } },
  { id: 'mirror', name: 'Mirror', icon: '🪞', custom(c, v, W, H) {
    c.drawImage(v, 0, 0, W, H);
    c.save(); c.beginPath(); c.rect(W / 2, 0, W / 2, H); c.clip(); c.translate(W, 0); c.scale(-1, 1); c.drawImage(v, 0, 0, W, H); c.restore();
  } },
  { id: 'golden', name: 'Golden hour', icon: '🌞', css: 'saturate(1.25) sepia(.25) brightness(1.06) contrast(1.05)', after: (c, W, H) => { tint(c, W, H, 'rgba(255,170,60,.18)', 'soft-light'); vignette(c, W, H, 0.3); } },
  { id: 'noir', name: 'Film noir', icon: '🎩', css: 'grayscale(1) contrast(1.6) brightness(.9)', after: (c, W, H) => vignette(c, W, H, 0.7) },
  { id: 'cyber', name: 'Cyberpunk', icon: '🌃', css: 'saturate(1.6) contrast(1.2) hue-rotate(-12deg)', after: (c, W, H) => { tint(c, W, H, 'rgba(255,0,200,.16)', 'screen'); tint(c, W, H, 'rgba(0,200,255,.12)', 'overlay'); } },
  { id: 'fade', name: 'Faded', icon: '🌫️', css: 'contrast(.85) brightness(1.1) saturate(.8)', after: (c, W, H) => tint(c, W, H, 'rgba(255,255,255,.1)') },
  { id: 'lomo', name: 'Lomo', icon: '📸', css: 'saturate(1.5) contrast(1.25) sepia(.1)', after: (c, W, H) => vignette(c, W, H, 0.75) },
  { id: 'xray', name: 'X-ray', icon: '🦴', css: 'invert(1) grayscale(1) contrast(1.3)' },
  { id: 'invert', name: 'Invert', icon: '🔄', css: 'invert(1) hue-rotate(180deg)' },
  { id: 'thermal', name: 'Thermal', icon: '🔥', css: 'grayscale(1) contrast(1.4)', after: (c, W, H) => {
    const g = c.createLinearGradient(0, H, 0, 0); g.addColorStop(0, '#2b0a8a'); g.addColorStop(0.35, '#d6145a'); g.addColorStop(0.7, '#ff9a1f'); g.addColorStop(1, '#fff7a0');
    c.save(); c.globalCompositeOperation = 'color'; c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
  } },
  { id: 'duotone', name: 'Duotone', icon: '🟣', css: 'grayscale(1) contrast(1.2)', after: (c, W, H) => {
    c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = '#9b5cff'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'lighten'; c.fillStyle = '#2a0a5e'; c.fillRect(0, 0, W, H); c.restore();
  } },
  { id: 'beauty', name: 'Soft skin', icon: '💄', custom(c, v, W, H) {
    c.drawImage(v, 0, 0, W, H);
    c.save(); c.globalAlpha = 0.55; c.filter = 'blur(2.5px) brightness(1.08) saturate(1.08)'; c.drawImage(v, 0, 0, W, H); c.restore();
    c.save(); c.globalAlpha = 0.25; c.filter = 'none'; c.drawImage(v, 0, 0, W, H); c.restore();
  }, needsCss: true },
  { id: 'rgb', name: 'RGB split', icon: '🔴', custom(c, v, W, H, t) {
    const d = 5 + Math.sin(t * 3) * 3; c.drawImage(v, 0, 0, W, H);
    c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = 0.5; c.drawImage(v, -d, 0, W, H); c.drawImage(v, d, 0, W, H); c.restore();
  } },
  { id: 'vhs', name: 'VHS', icon: '📼', custom(c, v, W, H, t) {
    c.drawImage(v, 0, 0, W, H);
    c.save(); c.globalAlpha = 0.35; c.globalCompositeOperation = 'screen'; c.drawImage(v, 4, 0, W, H); c.restore();
    c.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 1.5);
    const by = ((t * 0.18) % 1) * H; c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(0, by, W, 26);
    tint(c, W, H, 'rgba(120,80,255,.08)');
  } },
  { id: 'halftone', name: 'Halftone', icon: '⚪', custom(c, v, W, H, t, eng) {
    const step = Math.max(6, Math.round(W / 70)), s = eng.scratch(Math.ceil(W / step), Math.ceil(H / step));
    s.ctx.drawImage(v, 0, 0, s.canvas.width, s.canvas.height); const d = s.ctx.getImageData(0, 0, s.canvas.width, s.canvas.height).data;
    c.fillStyle = '#f4efe4'; c.fillRect(0, 0, W, H); c.fillStyle = '#16161c';
    for (let y = 0; y < s.canvas.height; y++) for (let x = 0; x < s.canvas.width; x++) { const i = (y * s.canvas.width + x) * 4, l = 1 - (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255; c.beginPath(); c.arc(x * step + step / 2, y * step + step / 2, l * step * 0.62, 0, TAU); c.fill(); }
  } },
  { id: 'kaleido', name: 'Kaleidoscope', icon: '🔮', custom(c, v, W, H, t) {
    const n = 6, r = Math.min(W, H) * 0.75; c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < n; i++) { c.save(); c.translate(W / 2, H / 2); c.rotate((i * TAU) / n + t * 0.1); if (i % 2) c.scale(1, -1);
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, 0, TAU / n); c.closePath(); c.clip(); c.drawImage(v, -W / 2, -H / 2, W, H); c.restore(); }
  } },
  { id: 'zoomwave', name: 'Wavy', icon: '🌊', custom(c, v, W, H, t) {
    const strips = 36, sh = H / strips; for (let i = 0; i < strips; i++) { const off = Math.sin(t * 3 + i * 0.5) * 10; c.drawImage(v, 0, (i * v.videoHeight) / strips, v.videoWidth, v.videoHeight / strips + 1, off - 10, i * sh, W + 20, sh + 1); }
  } },
].map((x) => ({ ...x, kind: 'color' }));

export const NO_FILTER = { id: 'none', name: 'None', icon: '🚫', kind: 'none' };
const FX_IDS = new Set(['glitch', 'pixel', 'mirror', 'rgb', 'vhs', 'halftone', 'kaleido', 'zoomwave', 'xray', 'invert', 'thermal', 'duotone']);
const LOOKS = COLOR.filter((f) => !FX_IDS.has(f.id));
const FX = COLOR.filter((f) => FX_IDS.has(f.id));
export const FILTERS = [...FACE, ...SCREEN, ...LOOKS, ...FX];
export const FILTER_GROUPS = [
  ['face', 'Face', FACE], ['screen', 'Overlays', SCREEN], ['color', 'Looks', LOOKS], ['fx', 'Effects', FX],
];
export const filterById = (id) => FILTERS.find((f) => f.id === id) || NO_FILTER;

// Most colour looks use the canvas "filter" property, which Safari lacks; those are hidden there.
export function canvasFilterSupported() {
  try { return typeof document !== 'undefined' && 'filter' in document.createElement('canvas').getContext('2d'); } catch { return false; }
}
export const isAvailable = (f) => f.kind !== 'color' || (!!f.custom && !f.needsCss) || canvasFilterSupported();
