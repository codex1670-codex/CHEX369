// CHEX 3D Scanning Studio — pure maths (no WebGL, no DOM) so it can be unit-tested.
// Positions are flat Float32Array/number[] xyz triples; indices are flat triangle index lists
// (omit `indices` for a non-indexed triangle soup).

// ---------------------------------------------------------------- units
export const UNITS = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254 };
export const UNIT_NAMES = Object.keys(UNITS);
/** `metres` → number in `unit`. */
export const fromMetres = (metres, unit) => metres / (UNITS[unit] || 1);
export const toMetres = (value, unit) => value * (UNITS[unit] || 1);
export function formatLength(metres, unit = 'cm') {
  if (!Number.isFinite(metres)) return '—';
  const v = fromMetres(metres, unit);
  const a = Math.abs(v);
  return `${v.toFixed(a >= 100 ? 1 : a >= 1 ? 2 : 3)} ${unit}`;
}
export const formatArea = (sqm, unit = 'cm') => `${(sqm / (UNITS[unit] || 1) ** 2).toFixed(2)} ${unit}²`;
export const formatVolume = (cum, unit = 'cm') => `${(cum / (UNITS[unit] || 1) ** 3).toFixed(2)} ${unit}³`;

// ---------------------------------------------------------------- vectors
export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Angle at `b` between segments b→a and b→c, in degrees. */
export function angleDeg(a, b, c) {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const lu = Math.hypot(...u); const lv = Math.hypot(...v);
  if (!lu || !lv) return NaN;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// ---------------------------------------------------------------- mesh metrics
const triCount = (positions, indices) => (indices ? indices.length : positions.length / 3) / 3;
const vert = (positions, indices, t, k) => { const i = indices ? indices[t * 3 + k] : t * 3 + k; return i * 3; };

export function surfaceArea(positions, indices) {
  let area = 0;
  for (let t = 0, n = triCount(positions, indices); t < n; t++) {
    const a = vert(positions, indices, t, 0), b = vert(positions, indices, t, 1), c = vert(positions, indices, t, 2);
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return area;
}

/** Signed volume (divergence theorem). Only meaningful when the mesh is closed and consistently wound. */
export function signedVolume(positions, indices) {
  let v = 0;
  for (let t = 0, n = triCount(positions, indices); t < n; t++) {
    const a = vert(positions, indices, t, 0), b = vert(positions, indices, t, 1), c = vert(positions, indices, t, 2);
    v += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
  }
  return v;
}

const qkey = (p, i, q) => `${Math.round(p[i] * q)},${Math.round(p[i + 1] * q)},${Math.round(p[i + 2] * q)}`;

/** Weld vertices that share a position (exported meshes often duplicate them per face). */
export function weld(positions, indices, quantum = 1e5) {
  const map = new Map(); const remap = []; const out = [];
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const k = qkey(positions, i * 3, quantum);
    let id = map.get(k);
    if (id === undefined) { id = out.length / 3; map.set(k, id); out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
    remap.push(id);
  }
  const src = indices || Array.from({ length: n }, (_, i) => i);
  const idx = new Array(src.length);
  for (let i = 0; i < src.length; i++) idx[i] = remap[src[i]];
  return { positions: Float32Array.from(out), indices: idx };
}

/** Edge statistics after welding: closed = every edge shared by exactly two triangles. */
export function meshTopology(positions, indices) {
  const w = weld(positions, indices);
  const edges = new Map();
  const bump = (a, b) => { const k = a < b ? `${a}_${b}` : `${b}_${a}`; edges.set(k, (edges.get(k) || 0) + 1); };
  for (let t = 0; t < w.indices.length; t += 3) { const [a, b, c] = [w.indices[t], w.indices[t + 1], w.indices[t + 2]]; bump(a, b); bump(b, c); bump(c, a); }
  let boundary = 0; let nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
  return { closed: edges.size > 0 && boundary === 0 && nonManifold === 0, boundaryEdges: boundary, nonManifoldEdges: nonManifold, vertices: w.positions.length / 3, triangles: w.indices.length / 3 };
}

/** Group triangles into connected pieces (shared welded vertices). Returns arrays of triangle numbers, biggest first. */
export function connectedComponents(positions, indices) {
  const w = weld(positions, indices);
  const nv = w.positions.length / 3; const parent = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < w.indices.length; t += 3) { const a = find(w.indices[t]); const b = find(w.indices[t + 1]); const c = find(w.indices[t + 2]); parent[b] = a; parent[find(c)] = find(a); }
  const groups = new Map();
  for (let t = 0; t < w.indices.length / 3; t++) { const r = find(w.indices[t * 3]); (groups.get(r) || groups.set(r, []).get(r)).push(t); }
  return [...groups.values()].sort((x, y) => y.length - x.length);
}

/** Laplacian smoothing on a welded mesh. Boundary vertices stay put so open edges do not shrink. */
export function laplacianSmooth(positions, indices, iterations = 2, lambda = 0.5) {
  const w = weld(positions, indices);
  const nv = w.positions.length / 3; const nb = Array.from({ length: nv }, () => new Set());
  const edgeCount = new Map();
  for (let t = 0; t < w.indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = w.indices[t + k], b = w.indices[t + (k + 1) % 3]; nb[a].add(b); nb[b].add(a);
    const key = a < b ? `${a}_${b}` : `${b}_${a}`; edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
  }
  const fixed = new Uint8Array(nv);
  for (const [k, c] of edgeCount) if (c === 1) { const [a, b] = k.split('_').map(Number); fixed[a] = fixed[b] = 1; }
  let cur = Float32Array.from(w.positions);
  for (let it = 0; it < iterations; it++) {
    const next = Float32Array.from(cur);
    for (let v = 0; v < nv; v++) {
      if (fixed[v] || !nb[v].size) continue;
      let x = 0, y = 0, z = 0; for (const n of nb[v]) { x += cur[n * 3]; y += cur[n * 3 + 1]; z += cur[n * 3 + 2]; }
      const k = 1 / nb[v].size;
      next[v * 3] = cur[v * 3] + lambda * (x * k - cur[v * 3]); next[v * 3 + 1] = cur[v * 3 + 1] + lambda * (y * k - cur[v * 3 + 1]); next[v * 3 + 2] = cur[v * 3 + 2] + lambda * (z * k - cur[v * 3 + 2]);
    }
    cur = next;
  }
  return { positions: cur, indices: w.indices };
}

/** Flat 1→4 subdivision: more triangles to work with, but NOT smoothing by itself. */
export function subdivideFlat(positions, indices) {
  const out = [];
  const mid = (a, b) => [(positions[a] + positions[b]) / 2, (positions[a + 1] + positions[b + 1]) / 2, (positions[a + 2] + positions[b + 2]) / 2];
  for (let t = 0, n = triCount(positions, indices); t < n; t++) {
    const a = vert(positions, indices, t, 0), b = vert(positions, indices, t, 1), c = vert(positions, indices, t, 2);
    const A = [positions[a], positions[a + 1], positions[a + 2]], B = [positions[b], positions[b + 1], positions[b + 2]], C = [positions[c], positions[c + 1], positions[c + 2]];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    out.push(...A, ...ab, ...ca, ...ab, ...B, ...bc, ...ca, ...bc, ...C, ...ab, ...bc, ...ca);
  }
  return Float32Array.from(out);
}

export function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { const v = positions[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

// ---------------------------------------------------------------- photo quality (capture checks)
/** RGBA → 0..255 luminance, optionally box-downscaled so the longest side is ≤ maxSide. */
export function toGray(rgba, w, h, maxSide = 256) {
  const k = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  const gw = Math.floor(w / k), gh = Math.floor(h / k); const g = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let s = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const o = ((y * k + dy) * w + (x * k + dx)) * 4; s += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]; }
    g[y * gw + x] = s / (k * k);
  }
  return { gray: g, w: gw, h: gh };
}
/** Variance of the Laplacian: low = blurry. Compare photos of the same scene, thresholds are heuristics. */
export function sharpness(gray, w, h) {
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const l = 4 * gray[y * w + x] - gray[y * w + x - 1] - gray[y * w + x + 1] - gray[(y - 1) * w + x] - gray[(y + 1) * w + x];
    sum += l; sum2 += l * l; n++;
  }
  if (!n) return 0; const mean = sum / n; return sum2 / n - mean * mean;
}
export function exposure(gray) {
  let s = 0, dark = 0, bright = 0; for (const v of gray) { s += v; if (v < 12) dark++; else if (v > 243) bright++; }
  const n = gray.length || 1; return { mean: s / n, darkFrac: dark / n, brightFrac: bright / n };
}
/** 64-bit average hash (8×8) as an array of 0/1 — used to spot near-duplicate frames. */
export function averageHash(gray, w, h) {
  const cells = new Float32Array(64);
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
    let s = 0, c = 0;
    for (let y = Math.floor((cy * h) / 8); y < Math.floor(((cy + 1) * h) / 8); y++) for (let x = Math.floor((cx * w) / 8); x < Math.floor(((cx + 1) * w) / 8); x++) { s += gray[y * w + x]; c++; }
    cells[cy * 8 + cx] = c ? s / c : 0;
  }
  const mean = cells.reduce((a, b) => a + b, 0) / 64;
  return Array.from(cells, (v) => (v >= mean ? 1 : 0));
}
export const hamming = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

export const SHARP_MIN = 40;       // below this a photo is flagged blurry (heuristic, tune per camera)
export const DUP_MAX_DISTANCE = 3; // hash bits that may differ before two photos count as duplicates
export function qualityVerdict({ sharp, mean, darkFrac, brightFrac }) {
  const issues = [];
  if (sharp < SHARP_MIN) issues.push('blurry');
  if (mean < 45 || darkFrac > 0.4) issues.push('too dark');
  if (mean > 215 || brightFrac > 0.4) issues.push('over-exposed');
  return issues;
}
/** Mark later photos that look almost identical to an earlier kept one. Returns the indices flagged. */
export function findDuplicates(hashes, maxDistance = DUP_MAX_DISTANCE) {
  const dup = [];
  for (let i = 0; i < hashes.length; i++) for (let j = 0; j < i; j++) if (!dup.includes(j) && hamming(hashes[i], hashes[j]) <= maxDistance) { dup.push(i); break; }
  return dup;
}

/** The 12-sector orbit ring used by the guide: which 30° sectors have a photo (manual/ordered, not measured). */
export function sectorCoverage(shotCount, sectors = 12) {
  const hit = Array.from({ length: sectors }, (_, i) => i < shotCount);
  const covered = hit.filter(Boolean).length;
  return { hit, covered, fraction: covered / sectors, missing: hit.map((h, i) => (h ? -1 : i)).filter((i) => i >= 0) };
}

/** Distance from the centre of a sphere of `radius` at which a camera with vertical field of view `fovDeg` (square frame) sees all of it, with `margin` breathing room. */
export function fitDistance(radius, fovDeg = 35, margin = 1.15) {
  const r = Math.max(Number(radius) || 0, 1e-6); return (r / Math.sin((fovDeg * Math.PI) / 360)) * margin;
}
