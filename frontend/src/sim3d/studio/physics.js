// A deliberately SIMPLE rigid-body preview: axis-aligned boxes, gravity, a ground plane, box-box
// collisions and damping. It is a visual toy for "what happens if I drop / stack this", NOT an
// engineering, structural or safety analysis. Everything is plain numbers so it can be unit-tested.

export function makeBody({ id, min, max, mass = 1, fixed = false }) {
  const half = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
  return { id, pos: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], half, vel: [0, 0, 0], mass: fixed ? Infinity : mass, m0: mass, fixed, asleep: false };
}

export function stepWorld(bodies, dt, { gravity = -9.81, ground = 0, restitution = 0.25, friction = 0.9 } = {}) {
  for (const b of bodies) {
    if (b.fixed) continue;
    b.vel[1] += gravity * dt;
    for (let k = 0; k < 3; k++) b.pos[k] += b.vel[k] * dt;
    const bottom = b.pos[1] - b.half[1];
    if (bottom < ground) {
      b.pos[1] = ground + b.half[1];
      if (b.vel[1] < -0.3) b.vel[1] = -b.vel[1] * restitution; else b.vel[1] = 0;
      b.vel[0] *= friction ** (dt * 60); b.vel[2] *= friction ** (dt * 60);
    }
  }
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) collide(bodies[i], bodies[j], restitution);
}

function collide(a, b, restitution) {
  if (a.fixed && b.fixed) return;
  const d = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
  const pen = [0, 1, 2].map((k) => a.half[k] + b.half[k] - Math.abs(d[k]));
  if (pen.some((p) => p <= 0)) return;
  let axis = 0; for (let k = 1; k < 3; k++) if (pen[k] < pen[axis]) axis = k;
  const sign = d[axis] >= 0 ? 1 : -1;
  const ia = a.fixed ? 0 : 1 / a.mass, ib = b.fixed ? 0 : 1 / b.mass; const tot = ia + ib;
  a.pos[axis] -= sign * pen[axis] * (ia / tot); b.pos[axis] += sign * pen[axis] * (ib / tot);
  const rel = (b.vel[axis] - a.vel[axis]) * sign;
  if (rel < 0) {
    const j = (-(1 + restitution) * rel) / tot;
    a.vel[axis] -= sign * j * ia; b.vel[axis] += sign * j * ib;
  }
}

export const EASINGS = { linear: (f) => f, smooth: (f) => f * f * (3 - 2 * f), in: (f) => f * f, out: (f) => 1 - (1 - f) * (1 - f) };
export const ease = (kind, f) => (EASINGS[kind] || EASINGS.linear)(Math.min(1, Math.max(0, f)));

/** Keyframe interpolation: keys = [{t, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z]}] sorted by t. `easing` shapes each segment. */
export function sampleKeys(keys, t, easing = 'linear') {
  if (!keys.length) return null;
  if (t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1]; if (t >= last.t) return last;
  let i = 0; while (keys[i + 1].t < t) i++;
  const a = keys[i], b = keys[i + 1]; const f = ease(easing, (t - a.t) / (b.t - a.t || 1));
  const mix = (p, q) => p.map((v, k) => v + (q[k] - v) * f);
  return { t, pos: mix(a.pos, b.pos), rot: mix(a.rot, b.rot), scale: mix(a.scale, b.scale) };
}

/** Hinge demo: swing angle (radians) at time t — sine swing between ±amplitude. */
export const hingeAngle = (t, amplitudeDeg = 60, periodSec = 3) => (Math.sin((t / periodSec) * Math.PI * 2) * amplitudeDeg * Math.PI) / 180;

/** Slider joint (a drawer): 0 → travel → 0 along one axis, smooth at both ends. */
export const sliderOffset = (t, travel, periodSec = 3) => (travel * (1 - Math.cos((t / periodSec) * Math.PI * 2))) / 2;

/** Ball joint (a joystick): a circular wobble, returns [rotX, rotZ] in radians. */
export function ballAngles(t, amplitudeDeg = 25, periodSec = 3) {
  const w = (t / periodSec) * Math.PI * 2, a = (amplitudeDeg * Math.PI) / 180;
  return [Math.sin(w) * a, Math.cos(w) * a];
}

// ---------------------------------------------------------------------------------- interaction
/** Instantly change a body's velocity by `dv` along `dir` (need not be normalised). Fixed bodies ignore it. */
export function applyImpulse(body, dir, dv) {
  if (!body || body.fixed) return false;
  const len = Math.hypot(dir[0], dir[1], dir[2]); if (!(len > 1e-9) || !Number.isFinite(dv)) return false;
  for (let k = 0; k < 3; k++) body.vel[k] += (dir[k] / len) * dv;
  return true;
}
const speed = (b) => Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
export const movingCount = (bodies, eps = 0.05) => bodies.filter((b) => !b.fixed && speed(b) > eps).length;
export const isSettled = (bodies, eps = 0.05) => movingCount(bodies, eps) === 0;

// ---------------------------------------------------------------------------------- simple structural visualisation
// These are geometric checks on the boxes only. They say nothing about material strength, joints or stress.
const lo = (b, k) => b.pos[k] - b.half[k]; const hi = (b, k) => b.pos[k] + b.half[k];

/** Mass-weighted centre of the boxes (mass = box volume, i.e. every part is treated as the same solid material). */
export function centerOfMass(bodies) {
  let m = 0; const c = [0, 0, 0];
  for (const b of bodies) { const w = b.m0 ?? (Number.isFinite(b.mass) ? b.mass : 0); if (!(w > 0)) continue; m += w; for (let k = 0; k < 3; k++) c[k] += b.pos[k] * w; }
  return m > 0 ? c.map((v) => v / m) : null;
}

/** Bounding rectangle (x/z) of every box whose underside is within `tol` of the ground. */
export function supportRect(bodies, ground = 0, tol = 0.01) {
  const on = bodies.filter((b) => lo(b, 1) <= ground + tol); if (!on.length) return null;
  return { min: [Math.min(...on.map((b) => lo(b, 0))), Math.min(...on.map((b) => lo(b, 2)))], max: [Math.max(...on.map((b) => hi(b, 0))), Math.max(...on.map((b) => hi(b, 2)))], count: on.length };
}

/** Does the centre of mass sit over the footprint? `margin` is the distance to the nearest footprint edge (negative = outside). */
export function stability(bodies, { ground = 0, tol = 0.01 } = {}) {
  const com = centerOfMass(bodies); const support = supportRect(bodies, ground, tol);
  if (!com || !support) return { com, support, stable: false, margin: 0, comHeight: 0, tipAngleDeg: 0 };
  const margin = Math.min(com[0] - support.min[0], support.max[0] - com[0], com[2] - support.min[1], support.max[1] - com[2]);
  const comHeight = Math.max(1e-9, com[1] - ground);
  return { com, support, stable: margin > 0, margin, comHeight, tipAngleDeg: margin > 0 ? (Math.atan(margin / comHeight) * 180) / Math.PI : 0 };
}

/** For each box, the weight of everything resting on it (directly or through other boxes), as a share of total weight. Relative only. */
export function stackLoads(bodies, tol = 0.01) {
  const over = (a, b) => Math.min(hi(a, 0), hi(b, 0)) - Math.max(lo(a, 0), lo(b, 0)) > 0 && Math.min(hi(a, 2), hi(b, 2)) - Math.max(lo(a, 2), lo(b, 2)) > 0;
  const resting = (top, bottom) => top !== bottom && Math.abs(hi(bottom, 1) - lo(top, 1)) <= tol && over(top, bottom);   // `top` rests on `bottom`
  const total = bodies.reduce((s, b) => s + (b.m0 ?? 0), 0) || 1;
  return bodies.map((b) => {
    const seen = new Set([b]); const stack = [b]; let load = 0;
    while (stack.length) { const cur = stack.pop(); for (const o of bodies) if (!seen.has(o) && resting(o, cur)) { seen.add(o); load += o.m0 ?? 0; stack.push(o); } }
    return { id: b.id, load, rel: load / total };
  });
}

/** 0 → blue, 0.5 → yellow, 1 → red. Returns a hex number for three.js. */
export function heatColor(v) {
  const x = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)); const A = [0x3b, 0x82, 0xf6], B = [0xfa, 0xcc, 0x15], C = [0xef, 0x44, 0x44];
  const [p, q, f] = x < 0.5 ? [A, B, x * 2] : [B, C, (x - 0.5) * 2];
  const ch = (k) => Math.round(p[k] + (q[k] - p[k]) * f);
  return (ch(0) << 16) | (ch(1) << 8) | ch(2);
}
