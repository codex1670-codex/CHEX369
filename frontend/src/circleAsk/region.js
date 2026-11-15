// Circle to Ask — geometry for the circled area. Pure functions (no DOM), so they are easy to test.
export const MIN_SIDE = 56;   // a selection is never smaller than this, so a quick scribble still captures something useful
export const MIN_STROKE = 40; // a path shorter than this is a tap, not a circle

export function boundsOf(points) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of points) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

export function clampRect(r, vp) {
  const x = Math.max(0, Math.min(r.x, vp.w)), y = Math.max(0, Math.min(r.y, vp.h));
  const x2 = Math.max(0, Math.min(r.x + r.w, vp.w)), y2 = Math.max(0, Math.min(r.y + r.h, vp.h));
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

// Grow a rect to at least `min` on each side (centred), then keep it on screen.
export function ensureMin(r, min, vp) {
  const w = Math.max(r.w, min), h = Math.max(r.h, min);
  let x = r.x - (w - r.w) / 2, y = r.y - (h - r.h) / 2;
  x = Math.max(0, Math.min(x, Math.max(0, vp.w - w))); y = Math.max(0, Math.min(y, Math.max(0, vp.h - h)));
  return clampRect({ x, y, w, h }, vp);
}

// The finger path → the rectangle to read. Returns null for a tap or a path too short to mean anything.
export function selectionFromPath(points, vp, { pad = 10 } = {}) {
  if (!Array.isArray(points) || points.length < 3 || pathLength(points) < MIN_STROKE) return null;
  const b = boundsOf(points);
  const padded = clampRect({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, vp);
  return ensureMin(padded, MIN_SIDE, vp);
}

export const wholeScreen = (vp) => ({ x: 0, y: 0, w: vp.w, h: vp.h });

const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
export function intersection(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}
// How much of `el` lies inside `sel` (0..1). A zero-size element counts if its point is inside.
export function overlapFraction(el, sel) {
  if (el.w <= 0 || el.h <= 0) return el.x >= sel.x && el.x <= sel.x + sel.w && el.y >= sel.y && el.y <= sel.y + sel.h ? 1 : 0;
  const i = intersection(el, sel);
  return i.w > 0 && i.h > 0 ? area(i) / area(el) : 0;
}

// Longest edge ≤ maxEdge, never upscaled.
export function fitSize(w, h, maxEdge) {
  const s = Math.min(1, maxEdge / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
}
