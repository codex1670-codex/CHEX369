// CHEX Simulation — turns a flat photo of an object into a solid, rotatable 3D shape.
//
// How it works (all on the device, no server model, nothing uploaded until you post):
//   1. CUT-OUT   The background colour is read from the photo's border, everything connected to the
//                border that looks like it is removed, and the biggest remaining blob is the object.
//   2. DEPTH     Each pixel inside the object gets a thickness from its distance to the outline
//                (a rounded "inflated" profile) — thick in the middle, tapering to the edge.
//   3. MESH      A front surface and a mirrored back surface meet at the outline, giving a closed
//                solid. The photo is wrapped on the front and (mirrored) on the back.
//   4. MODIFY    Depth, roundness, width/height, twist, bend and wave reshape the vertices.
//
// This is an honest "inflate the silhouette" 3D, not a camera-based scan: the far side of the object
// is a mirror of the visible side. Everything here is plain JS (no WebGL) so it is unit-testable.

// min, max, default. Keep in step with MODEL3D_RANGES in backend/src/uploads.js.
export const RANGES = {
  depth: [0.05, 1.2, 0.45], roundness: [0.15, 1, 0.7], width: [0.5, 1.6, 1], height: [0.5, 1.6, 1],
  twist: [-180, 180, 0], bend: [-90, 90, 0], wave: [0, 0.3, 0], tintAmount: [0, 1, 0], spinSpeed: [0, 4, 1.2],
};
export const FINISHES = ['matte', 'glossy', 'metal'];
export const BACKGROUNDS = ['#101847', '#0b0b0f', '#1d2b53', '#3a1c71', '#0f5c4d', '#f4efe6'];

export const DEFAULT_PARAMS = Object.freeze({
  v: 1,
  ...Object.fromEntries(Object.entries(RANGES).map(([k, r]) => [k, r[2]])),
  tint: '#ffffff', finish: 'matte', clay: false, wireframe: false, spin: true, bg: '#101847',
});

const HEX6 = /^#[0-9a-f]{6}$/i;
const clamp = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

/** Any object → a complete, in-range settings object (same rules the server applies). */
export function clampParams(p = {}) {
  const out = { v: 1 };
  for (const [k, [lo, hi, def]] of Object.entries(RANGES)) out[k] = clamp(p[k], lo, hi, def);
  out.tint = HEX6.test(p.tint) ? p.tint.toLowerCase() : DEFAULT_PARAMS.tint;
  out.bg = HEX6.test(p.bg) ? p.bg.toLowerCase() : DEFAULT_PARAMS.bg;
  out.finish = FINISHES.includes(p.finish) ? p.finish : 'matte';
  out.clay = p.clay === true;
  out.wireframe = p.wireframe === true;
  out.spin = p.spin !== false;
  return out;
}

/** Ready-made looks the editor offers as one-tap starting points. */
export const PRESETS = {
  Puffy:   { depth: 0.7, roundness: 1, twist: 0, bend: 0, wave: 0, finish: 'glossy' },
  Slab:    { depth: 0.18, roundness: 0.2, twist: 0, bend: 0, wave: 0, finish: 'matte' },
  Twisted: { depth: 0.5, roundness: 0.8, twist: 120, bend: 0, wave: 0, finish: 'glossy' },
  Curved:  { depth: 0.35, roundness: 0.5, twist: 0, bend: 70, wave: 0, finish: 'matte' },
  Flag:    { depth: 0.12, roundness: 0.3, twist: 0, bend: 0, wave: 0.16, finish: 'matte' },
  'Metal toy': { depth: 0.55, roundness: 0.9, twist: 0, bend: 0, wave: 0, finish: 'metal', tint: '#ffd27a', tintAmount: 0.6 },
};

// ------------------------------------------------------------------------------------------
// 1. CUT-OUT
// ------------------------------------------------------------------------------------------

/** Otsu threshold of values in 0..1 (256 bins). */
function otsu(values) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i++) hist[Math.min(255, Math.floor(values[i] * 255))]++;
  const total = values.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 40;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr / 255;
}

const median = (arr) => { const a = Array.from(arr).sort((x, y) => x - y); return a[a.length >> 1]; };

/** 3x3 majority filter on a 0/1 mask (smooths jagged edges, drops 1-pixel specks). */
function majority(mask, w, h) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) n += mask[yy * w + xx];
    }
    out[y * w + x] = n >= 5 ? 1 : 0;
  }
  return out;
}

/** Remove 1 pixel from the object's outline (hides the background-coloured fringe). */
function erode(mask, w, h) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    out[i] = (x > 0 && y > 0 && x < w - 1 && y < h - 1 && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w]) ? 1 : 0;
  }
  return out;
}

/** Keep only the largest 8-connected blob of a 0/1 mask. */
function largestBlob(mask, w, h) {
  const label = new Int32Array(mask.length);
  let best = 0, bestId = 0, id = 0;
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    id++; let size = 0; stack.push(s); label[s] = id;
    while (stack.length) {
      const i = stack.pop(); size++;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (mask[j] && !label[j]) { label[j] = id; stack.push(j); }
      }
    }
    if (size > best) { best = size; bestId = id; }
  }
  const out = new Uint8Array(mask.length);
  if (bestId) for (let i = 0; i < mask.length; i++) out[i] = label[i] === bestId ? 1 : 0;
  return out;
}

/**
 * Find the object in an RGBA image. Returns { mask (1 = object), coverage (0..1), fallback }.
 * `sensitivity` 0..1 (default .5): higher removes more of the background.
 * If nothing sensible is found (object fills the frame, or the background matches the object) the
 * whole photo is used as the object and `fallback` is true.
 */
export function segmentObject(rgba, w, h, sensitivity = 0.5) {
  // Background colour = median of the border pixels (2 px ring).
  const br = [], bg = [], bb = [];
  const ring = Math.max(1, Math.min(2, (Math.min(w, h) / 20) | 0));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= ring && y >= ring && x < w - ring && y < h - ring) continue;
    const o = (y * w + x) * 4; br.push(rgba[o]); bg.push(rgba[o + 1]); bb.push(rgba[o + 2]);
  }
  const R = median(br), G = median(bg), B = median(bb);

  // Colour distance to the background ("redmean" weighting, 0..1).
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const dr = rgba[o] - R, dg = rgba[o + 1] - G, db = rgba[o + 2] - B;
    const rm = (rgba[o] + R) / 2;
    dist[i] = Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 765 * 1.7;
  }
  const base = Math.min(0.5, Math.max(0.08, otsu(dist) * 0.8));
  const thr = base * Math.pow(3, (clamp(sensitivity, 0, 1, 0.5) - 0.5) * 2);

  // Everything "background-looking" that touches the border is background (flood fill).
  const isBgLike = (i) => dist[i] < thr;
  const bgMask = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => { const i = y * w + x; if (isBgLike(i) && !bgMask[i]) { bgMask[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const i = stack.pop(); const x = i % w, y = (i / w) | 0;
    if (x > 0) seed(x - 1, y); if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1); if (y < h - 1) seed(x, y + 1);
  }
  let fg = new Uint8Array(w * h);
  for (let i = 0; i < fg.length; i++) fg[i] = bgMask[i] ? 0 : 1;
  fg = majority(majority(fg, w, h), w, h);
  fg = largestBlob(fg, w, h);
  fg = erode(fg, w, h);

  let count = 0; for (let i = 0; i < fg.length; i++) count += fg[i];
  const coverage = count / (w * h);
  if (coverage < 0.03 || coverage > 0.97) {
    // Couldn't isolate anything: use the whole photo (slightly inset so it has an outline).
    const all = new Uint8Array(w * h);
    const mx = Math.max(1, Math.round(w * 0.02)), my = Math.max(1, Math.round(h * 0.02));
    for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) all[y * w + x] = 1;
    return { mask: all, coverage: 1, fallback: true };
  }
  return { mask: fg, coverage, fallback: false };
}

// ------------------------------------------------------------------------------------------
// 2 + 3. DEPTH FIELD AND MESH
// ------------------------------------------------------------------------------------------

export const GRID = 160; // mesh resolution along the longer side (≤ ~52k vertices, still smooth on phones)

/** Distance of every object cell to the nearest empty cell (3-4 chamfer, in cells). */
function distanceField(mask, w, h) {
  const INF = 1e6, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) { v = Math.min(v, d[i - w] + 1); if (x > 0) v = Math.min(v, d[i - w - 1] + 1.4142); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 1.4142); }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < h - 1) { v = Math.min(v, d[i + w] + 1); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 1.4142); if (x > 0) v = Math.min(v, d[i + w - 1] + 1.4142); }
    d[i] = v;
  }
  return d;
}

function boxBlur(src, w, h, passes) {
  let a = src, b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += a[yy * w + xx]; n++; }
      }
      b[y * w + x] = s / n;
    }
    [a, b] = [b, a];
  }
  return a;
}

/**
 * The outline ring (empty cells touching the object) normally sits on the grid, which makes a
 * stair-stepped edge. Slide each ring vertex toward the object until it sits where the coverage
 * crosses 50 % — a marching-squares style fix that gives a smooth outline at any grid size.
 * Returns [dx, dy] per cell in grid units (x right, y down); zero everywhere else.
 */
function outlineShift(mask, cov, gw, gh) {
  const shift = new Float32Array(gw * gh * 2);
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
    const v = j * gw + i; if (mask[v]) continue;
    let sx = 0, sy = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const f = (j + dy) * gw + i + dx; if (!mask[f]) continue;
      const t = Math.min(1, Math.max(0, (cov[f] - 0.5) / Math.max(1e-6, cov[f] - cov[v]))); // where along f→v the coverage hits 50 %
      const move = Math.min(0.85, 1 - t);                                                  // how far v slides toward f
      sx += dx * move; sy += dy * move; n++;
    }
    if (n) { shift[v * 2] = sx / n; shift[v * 2 + 1] = sy / n; }
  }
  return shift;
}

/**
 * Front and back surfaces meet along the outline. Give the vertices on that seam one shared normal
 * (the average of the two sides) so the rim shades as a smooth rounded edge instead of a dark line.
 * Call after computeVertexNormals(); `normals` is the 3 × vertexCount array.
 */
export function blendSeamNormals(normals, prep) {
  const nv = prep.vertexCount / 2;
  for (let idx = 0; idx < nv; idx++) {
    if (prep.dist[idx] !== 0) continue;
    const a = idx * 3, b = (nv + idx) * 3;
    const x = normals[a] + normals[b], y = normals[a + 1] + normals[b + 1], z = normals[a + 2] + normals[b + 2];
    const len = Math.hypot(x, y, z);
    if (len < 1e-6) continue;
    normals[a] = normals[b] = x / len; normals[a + 1] = normals[b + 1] = y / len; normals[a + 2] = normals[b + 2] = z / len;
  }
  return normals;
}

/**
 * Build the fixed part of the model from an object silhouette: grid, depth field, triangle indices
 * and texture coordinates. `alpha` is the RGBA cut-out's alpha channel source (rgba, w, h); the
 * silhouette is every pixel with alpha ≥ 128. The returned object is passed to fillPositions().
 */
export function prepareModel(rgba, w, h, grid = GRID) {
  const scale = grid / Math.max(w, h);
  const cw = Math.max(2, Math.round(w * scale)), ch = Math.max(2, Math.round(h * scale));
  const gw = cw + 2, gh = ch + 2; // one empty cell of padding all round so the outline always closes
  const mask = new Uint8Array(gw * gh);
  const cov = new Float32Array(gw * gh); // how much of each cell is object (0..1) — gives the outline sub-cell accuracy
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const x0 = Math.floor((cx / cw) * w), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) / cw) * w));
    const y0 = Math.floor((cy / ch) * h), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) / ch) * h));
    let sum = 0, n = 0;
    for (let y = y0; y < y1 && y < h; y++) for (let x = x0; x < x1 && x < w; x++) { sum += rgba[(y * w + x) * 4 + 3]; n++; }
    const c = n ? sum / n / 255 : 0;
    cov[(cy + 1) * gw + cx + 1] = c;
    if (c >= 0.5) mask[(cy + 1) * gw + cx + 1] = 1;
  }
  const dist = distanceField(mask, gw, gh);
  const shift = outlineShift(mask, cov, gw, gh);
  let maxDist = 1; for (let i = 0; i < dist.length; i++) if (dist[i] > maxDist) maxDist = dist[i];

  const nv = gw * gh;
  // Triangles: any quad that touches the object (its empty corners sit at depth 0, closing the outline).
  const tris = [];
  const front = (i, j) => j * gw + i, back = (i, j) => nv + j * gw + i;
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
    if (!(mask[a] || mask[b] || mask[c] || mask[d])) continue;
    tris.push(front(i, j), front(i, j + 1), front(i + 1, j), front(i + 1, j), front(i, j + 1), front(i + 1, j + 1));
    tris.push(back(i, j), back(i + 1, j), back(i, j + 1), back(i + 1, j), back(i + 1, j + 1), back(i, j + 1));
  }
  const uvs = new Float32Array(nv * 2 * 2);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    // The padded grid maps to the photo: cell (i,j) ↔ photo position ((i-1+.5)/cw, (j-1+.5)/ch).
    const u = Math.min(1, Math.max(0, (i - 0.5) / cw)), v = 1 - Math.min(1, Math.max(0, (j - 0.5) / ch));
    const k = (j * gw + i) * 2;
    uvs[k] = u; uvs[k + 1] = v;
    const kb = (nv + j * gw + i) * 2;
    uvs[kb] = 1 - u; uvs[kb + 1] = v; // back face shows the photo the right way round when you look at it from behind
  }
  const objectCells = mask.reduce((s, m) => s + m, 0);
  return { gw, gh, cw, ch, mask, dist, shift, maxDist, index: new Uint32Array(tris), uvs, vertexCount: nv * 2, objectCells, aspect: w / h };
}

const smooth = (() => { const cache = new WeakMap(); return (prep, passes) => { // blurred distance, cached per model + blur
  let m = cache.get(prep); if (!m) { m = new Map(); cache.set(prep, m); }
  if (!m.has(passes)) m.set(passes, boxBlur(prep.dist, prep.gw, prep.gh, passes));
  return m.get(passes);
}; })();

/**
 * Write vertex positions for the given settings into `out` (Float32Array, 3 × vertexCount).
 * The model is normalised so its longer side is 2 world units across (before width/height).
 */
export function fillPositions(prep, params, out) {
  const p = clampParams(params);
  const { gw, gh, maxDist, vertexCount } = prep;
  const nv = vertexCount / 2;
  const d = smooth(prep, 2);
  const cell = 2 / Math.max(prep.cw, prep.ch);
  const R = Math.max(1, p.roundness * maxDist); // how far in from the outline the surface takes to reach full thickness
  const halfH = (gh / 2) * cell * p.height;
  const twist = (p.twist * Math.PI) / 180;
  const kappa = (p.bend * Math.PI) / 180 / Math.max(0.5, prep.cw * cell * p.width); // bend: radians per world unit of width
  const bendOn = Math.abs(kappa) > 1e-4;
  const wave = p.wave;

  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const idx = j * gw + i;
    // distance is measured from the empty cell's centre; the true outline is ~½ a cell nearer
    const t = Math.min(1, Math.max(0, d[idx] - (prep.dist[idx] > 0 ? 0.5 : 0)) / R);
    const z0 = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))) * p.depth;
    let x = (i - gw / 2 + 0.5 + prep.shift[idx * 2]) * cell * p.width;
    let y = (gh / 2 - j - 0.5 - prep.shift[idx * 2 + 1]) * cell * p.height;
    for (let side = 0; side < 2; side++) {
      let X = x, Y = y, Z = side === 0 ? z0 : -z0;
      if (wave) Z += wave * Math.sin(Y * 5);
      if (bendOn) { const th = X * kappa, Rb = 1 / kappa; X = Rb * Math.sin(th); Z += Rb * (1 - Math.cos(th)); }
      if (twist) { const a = twist * (Y / Math.max(halfH, 1e-3)); const c = Math.cos(a), s = Math.sin(a); const nx = X * c + Z * s, nz = -X * s + Z * c; X = nx; Z = nz; }
      const o = (side * nv + idx) * 3;
      out[o] = X; out[o + 1] = Y; out[o + 2] = Z;
    }
  }
  return out;
}

/** Size of the model's bounding box for camera framing: [x, y, z] half-extents. */
export function extents(positions) {
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < positions.length; i += 3) {
    mx = Math.max(mx, Math.abs(positions[i])); my = Math.max(my, Math.abs(positions[i + 1])); mz = Math.max(mz, Math.abs(positions[i + 2]));
  }
  return [mx, my, mz];
}

// ------------------------------------------------------------------------------------------
// Browser helpers (canvas) — used by the page and the viewer, not by the unit tests.
// ------------------------------------------------------------------------------------------

export const TEXTURE_SIZE = 768;

/** Decode a File/Blob into a canvas whose longer side is at most `max` px (honours phone rotation). */
export async function loadImageToCanvas(file, max = TEXTURE_SIZE) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    bmp = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo format can't be opened here. Try a JPG or PNG, or take the photo with the camera.")); };
      img.src = url;
    });
  }
  const sw = bmp.width || bmp.naturalWidth, sh = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/**
 * Photo canvas → RGBA cut-out canvas (transparent background) at the same size.
 * `keepAll` skips the background removal and uses the whole photo.
 */
export function makeCutout(photo, { sensitivity = 0.5, keepAll = false } = {}) {
  const W = photo.width, H = photo.height;
  const work = Math.min(1, 256 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * work)), h = Math.max(8, Math.round(H * work));
  const small = document.createElement('canvas'); small.width = w; small.height = h;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(photo, 0, 0, w, h);
  const px = sctx.getImageData(0, 0, w, h).data;

  let seg;
  if (photo.drawnMask) {
    // The person drew the outline: everything inside it is the object (alpha is 0 outside the drawing).
    const mask = new Uint8Array(w * h); let n = 0;
    for (let i = 0; i < mask.length; i++) if (px[i * 4 + 3] >= 128) { mask[i] = 1; n++; }
    seg = { mask, coverage: n / (w * h), fallback: false };
  } else if (keepAll) {
    const all = new Uint8Array(w * h); const mx = Math.max(1, Math.round(w * 0.02)), my = Math.max(1, Math.round(h * 0.02));
    for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) all[y * w + x] = 1;
    seg = { mask: all, coverage: 1, fallback: false };
  } else seg = segmentObject(px, w, h, sensitivity);

  // Soft-upscale the mask to the photo's size, then keep the photo only where the mask is.
  const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
  const mctx = mc.getContext('2d'); const mi = mctx.createImageData(w, h);
  for (let i = 0; i < seg.mask.length; i++) { mi.data[i * 4] = mi.data[i * 4 + 1] = mi.data[i * 4 + 2] = 255; mi.data[i * 4 + 3] = seg.mask[i] ? 255 : 0; }
  mctx.putImageData(mi, 0, 0);
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  const bctx = big.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(mc, 0, 0, W, H);
  const bi = bctx.getImageData(0, 0, W, H);
  for (let i = 3; i < bi.data.length; i += 4) bi.data[i] = Math.max(0, Math.min(255, (bi.data[i] - 128) * 4 + 128)); // crisp, slightly soft edge
  bctx.putImageData(bi, 0, 0);
  bctx.globalCompositeOperation = 'source-in';
  bctx.drawImage(photo, 0, 0);
  return { canvas: big, coverage: seg.coverage, fallback: seg.fallback };
}

/** RGBA cut-out canvas → opaque texture canvas (empty areas filled with the object's average colour). */
export function textureFromCutout(cut) {
  const W = cut.width, H = cut.height;
  const ctx = cut.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, W, H).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d');
  octx.fillStyle = n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : '#888';
  octx.fillRect(0, 0, W, H);
  octx.drawImage(cut, 0, 0);
  return out;
}

/** A small hand-drawn demo object so people can try the page without a photo. */
export function demoPhoto() {
  const c = document.createElement('canvas'); c.width = 600; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#e9eef7'; x.fillRect(0, 0, 600, 600);
  x.fillStyle = 'rgba(0,0,0,.12)'; x.beginPath(); x.ellipse(300, 520, 170, 26, 0, 0, Math.PI * 2); x.fill();
  const g = x.createRadialGradient(240, 250, 30, 300, 320, 240);
  g.addColorStop(0, '#ff8a8a'); g.addColorStop(0.5, '#e8212e'); g.addColorStop(1, '#8e0f1c');
  x.fillStyle = g; x.beginPath();
  x.moveTo(300, 150); x.bezierCurveTo(430, 90, 530, 220, 490, 350); x.bezierCurveTo(460, 470, 380, 520, 300, 500);
  x.bezierCurveTo(220, 520, 140, 470, 110, 350); x.bezierCurveTo(70, 220, 170, 90, 300, 150); x.fill();
  x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.ellipse(220, 250, 34, 60, -0.5, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#4b2e12'; x.lineWidth = 14; x.lineCap = 'round'; x.beginPath(); x.moveTo(300, 150); x.quadraticCurveTo(305, 110, 330, 78); x.stroke();
  x.fillStyle = '#2fa84f'; x.beginPath(); x.moveTo(318, 110); x.bezierCurveTo(360, 50, 440, 60, 450, 90); x.bezierCurveTo(410, 130, 350, 135, 318, 110); x.fill();
  return c;
}
