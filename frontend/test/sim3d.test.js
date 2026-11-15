import { describe, it, expect } from 'vitest';
import { segmentObject, prepareModel, fillPositions, extents, clampParams, DEFAULT_PARAMS, PRESETS } from '../src/sim3d/model3d.js';

// 64x64 photo: light-grey background with a red disc in the middle.
function discPhoto(w = 64, h = 64, r = 18, bgv = 235) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < r * r;
    px[o] = inside ? 200 : bgv; px[o + 1] = inside ? 30 : bgv; px[o + 2] = inside ? 40 : bgv; px[o + 3] = 255;
  }
  return px;
}
const cutoutRGBA = (px, mask) => { const out = new Uint8ClampedArray(px); for (let i = 0; i < mask.length; i++) out[i * 4 + 3] = mask[i] ? 255 : 0; return out; };

describe('cut-out', () => {
  it('finds the object and drops the background', () => {
    const { mask, fallback, coverage } = segmentObject(discPhoto(), 64, 64, 0.5);
    expect(fallback).toBe(false);
    expect(mask[32 * 64 + 32]).toBe(1);   // centre = object
    expect(mask[2 * 64 + 2]).toBe(0);     // corner = background
    expect(coverage).toBeGreaterThan(0.15); expect(coverage).toBeLessThan(0.3);
  });
  it('falls back to the whole photo when the picture is one flat colour', () => {
    const flat = new Uint8ClampedArray(32 * 32 * 4).fill(120);
    const r = segmentObject(flat, 32, 32);
    expect(r.fallback).toBe(true);
    expect(r.mask[16 * 32 + 16]).toBe(1);
  });
});

describe('3D model', () => {
  const photo = discPhoto();
  const seg = segmentObject(photo, 64, 64);
  const prep = prepareModel(cutoutRGBA(photo, seg.mask), 64, 64);
  const make = (p) => fillPositions(prep, { ...DEFAULT_PARAMS, ...p }, new Float32Array(prep.vertexCount * 3));

  it('builds a closed solid: index in range, thick in the middle, zero at the outline', () => {
    expect(prep.index.length).toBeGreaterThan(0);
    expect(Math.max(...prep.index)).toBeLessThan(prep.vertexCount);
    const pos = make({});
    const nv = prep.vertexCount / 2;
    const mid = (Math.floor(prep.gh / 2)) * prep.gw + Math.floor(prep.gw / 2);
    expect(pos[mid * 3 + 2]).toBeGreaterThan(0.3);                    // front surface bulges toward the viewer
    expect(pos[(nv + mid) * 3 + 2]).toBeCloseTo(-pos[mid * 3 + 2], 5); // back is the mirror
    expect(pos[2]).toBe(0);                                            // padded corner = empty = depth 0
  });
  it('depth, width and twist really change the shape', () => {
    const [, , z1] = extents(make({ depth: 0.3 })); const [, , z2] = extents(make({ depth: 0.9 }));
    expect(z2).toBeGreaterThan(z1 * 2);
    const [x1] = extents(make({ width: 1 })); const [x2] = extents(make({ width: 1.5 }));
    expect(x2).toBeCloseTo(x1 * 1.5, 1);
    expect(Array.from(make({ twist: 90 }).slice(0, 3000))).not.toEqual(Array.from(make({ twist: 0 }).slice(0, 3000)));
    expect(make({ bend: 60, wave: 0.1, twist: 40 }).every(Number.isFinite)).toBe(true);
  });
  it('longer side is 2 world units', () => {
    const [x, y] = extents(make({}));
    expect(Math.max(x, y) * 2).toBeLessThanOrEqual(2.2); expect(Math.max(x, y) * 2).toBeGreaterThan(0.5);
  });
});

describe('settings', () => {
  it('clamps out-of-range and junk input', () => {
    const p = clampParams({ depth: 99, twist: -999, tint: 'javascript:alert(1)', finish: 'lava', spin: false, bg: '#FFAA00' });
    expect(p.depth).toBe(1.2); expect(p.twist).toBe(-180); expect(p.tint).toBe('#ffffff');
    expect(p.finish).toBe('matte'); expect(p.spin).toBe(false); expect(p.bg).toBe('#ffaa00');
  });
  it('every preset stays within range', () => {
    for (const o of Object.values(PRESETS)) expect(clampParams({ ...DEFAULT_PARAMS, ...o })).toMatchObject(o);
  });
});

describe('smooth outline + seam', () => {
  it('slides outline vertices toward the real edge, and blends normals along the seam', async () => {
    const { blendSeamNormals } = await import('../src/sim3d/model3d.js');
    const photo = discPhoto(); const seg = segmentObject(photo, 64, 64);
    const prep = prepareModel(cutoutRGBA(photo, seg.mask), 64, 64);
    let moved = 0; for (let i = 0; i < prep.shift.length; i++) if (prep.shift[i] !== 0) moved++;
    expect(moved).toBeGreaterThan(20);
    for (let i = 0; i < prep.shift.length; i++) expect(Math.abs(prep.shift[i])).toBeLessThanOrEqual(0.86);
    const nv = prep.vertexCount / 2; const normals = new Float32Array(prep.vertexCount * 3);
    const seam = Array.from({ length: nv }, (_, i) => i).find((i) => prep.dist[i] === 0 && prep.shift[i * 2] !== 0);
    normals.set([0, 0, 1], seam * 3); normals.set([0, 0, -1], (nv + seam) * 3);   // front up, back down → average points sideways/zero
    normals.set([1, 0, 1], seam * 3); normals.set([1, 0, -1], (nv + seam) * 3);
    blendSeamNormals(normals, prep);
    expect(Array.from(normals.slice(seam * 3, seam * 3 + 3))).toEqual(Array.from(normals.slice((nv + seam) * 3, (nv + seam) * 3 + 3)));
    expect(normals[seam * 3]).toBeCloseTo(1, 5);
  });
});
