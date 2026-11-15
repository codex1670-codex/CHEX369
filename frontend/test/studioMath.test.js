import { describe, it, expect } from 'vitest';
import {
  dist3, angleDeg, surfaceArea, signedVolume, meshTopology, connectedComponents, laplacianSmooth, subdivideFlat,
  boundsOf, toMetres, fromMetres, formatLength, sharpness, exposure, averageHash, hamming, findDuplicates, sectorCoverage, qualityVerdict, toGray,
} from '../src/sim3d/studio/studioMath.js';
import { makeBody, stepWorld, sampleKeys, hingeAngle, ease, sliderOffset, ballAngles, applyImpulse, movingCount, isSettled, centerOfMass, supportRect, stability, stackLoads, heatColor } from '../src/sim3d/studio/physics.js';

// Unit cube, outward winding, 8 verts / 12 tris.
const cubeP = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1];
const cubeI = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 2,3,7, 2,7,6, 1,2,6, 1,6,5, 0,4,7, 0,7,3];

describe('measurements', () => {
  it('distance, angle, units', () => {
    expect(dist3([0,0,0],[3,4,0])).toBe(5);
    expect(angleDeg([1,0,0],[0,0,0],[0,1,0])).toBeCloseTo(90);
    expect(fromMetres(toMetres(12, 'in'), 'cm')).toBeCloseTo(30.48);
    expect(formatLength(0.1, 'mm')).toBe('100.0 mm');
  });
  it('area and volume of a unit cube; closed-mesh check', () => {
    expect(surfaceArea(cubeP, cubeI)).toBeCloseTo(6);
    expect(Math.abs(signedVolume(cubeP, cubeI))).toBeCloseTo(1);
    expect(meshTopology(cubeP, cubeI).closed).toBe(true);
    expect(meshTopology(cubeP, cubeI.slice(0, 33)).closed).toBe(false);   // one face missing → open
    expect(boundsOf(cubeP).size).toEqual([1, 1, 1]);
  });
  it('welds a triangle soup before checking it', () => {
    const soup = []; for (let t = 0; t < cubeI.length; t++) soup.push(cubeP[cubeI[t]*3], cubeP[cubeI[t]*3+1], cubeP[cubeI[t]*3+2]);
    expect(meshTopology(soup).closed).toBe(true);
  });
});

describe('geometry tools', () => {
  it('separates two disjoint cubes into two components', () => {
    const p = [...cubeP, ...cubeP.map((v, i) => (i % 3 === 0 ? v + 5 : v))]; const i2 = [...cubeI, ...cubeI.map((i) => i + 8)];
    const parts = connectedComponents(p, i2);
    expect(parts.length).toBe(2); expect(parts[0].length).toBe(12);
  });
  it('subdivides 1→4 and keeps the area', () => {
    const s = subdivideFlat(cubeP, cubeI); expect(s.length / 9).toBe(48); expect(surfaceArea(s)).toBeCloseTo(6);
  });
  it('smoothing a closed cube pulls corners inward and keeps it closed', () => {
    const r = laplacianSmooth(cubeP, cubeI, 2, 0.5);
    expect(r.positions[0]).toBeGreaterThan(0); expect(meshTopology(r.positions, r.indices).closed).toBe(true);
  });
});

describe('photo quality', () => {
  const W = 32, H = 32;
  const sharpImg = new Float32Array(W * H).map((_, i) => ((i % W) + Math.floor(i / W)) % 2 ? 255 : 0);   // checkerboard
  const flatImg = new Float32Array(W * H).fill(128);
  it('flat image is blurrier than a checkerboard', () => { expect(sharpness(sharpImg, W, H)).toBeGreaterThan(sharpness(flatImg, W, H) + 100); });
  it('flags dark / bright / blurry', () => {
    expect(qualityVerdict({ sharp: 5, mean: 20, darkFrac: .6, brightFrac: 0 })).toEqual(['blurry', 'too dark']);
    expect(qualityVerdict({ sharp: 500, mean: 130, darkFrac: 0, brightFrac: 0 })).toEqual([]);
    expect(exposure(flatImg).mean).toBe(128);
  });
  it('finds near-duplicate frames', () => {
    const a = averageHash(sharpImg, W, H); const b = averageHash(sharpImg, W, H); const c = averageHash(new Float32Array(W * H).map((_, i) => (i % W < 16 ? 255 : 0)), W, H);
    expect(hamming(a, b)).toBe(0); expect(findDuplicates([a, c, b])).toEqual([2]);
  });
  it('downscales RGBA to gray', () => { const g = toGray(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64, 16); expect(g.w).toBe(16); expect(g.gray[0]).toBeCloseTo(255); });
  it('sector coverage', () => { const c = sectorCoverage(5); expect(c.covered).toBe(5); expect(c.missing[0]).toBe(5); });
});

describe('physics preview', () => {
  it('a box dropped from 2 m settles on the ground', () => {
    const b = makeBody({ id: 'a', min: [0, 2, 0], max: [1, 3, 1] });
    for (let i = 0; i < 600; i++) stepWorld([b], 1 / 60);
    expect(b.pos[1] - b.half[1]).toBeCloseTo(0, 2); expect(Math.abs(b.vel[1])).toBeLessThan(0.5);
  });
  it('a box lands on a fixed box instead of falling through it', () => {
    const base = makeBody({ id: 'base', min: [0, 0, 0], max: [2, 1, 2], fixed: true });
    const top = makeBody({ id: 'top', min: [0.5, 3, 0.5], max: [1.5, 4, 1.5] });
    for (let i = 0; i < 600; i++) stepWorld([base, top], 1 / 60);
    expect(top.pos[1] - top.half[1]).toBeGreaterThan(0.95);
  });
  it('keyframes interpolate and hinge swings both ways', () => {
    const k = [{ t: 0, pos: [0,0,0], rot: [0,0,0], scale: [1,1,1] }, { t: 2, pos: [2,0,0], rot: [0,0,0], scale: [1,1,1] }];
    expect(sampleKeys(k, 1).pos[0]).toBe(1); expect(sampleKeys(k, 9).pos[0]).toBe(2);
    expect(hingeAngle(0.75)).toBeGreaterThan(0); expect(hingeAngle(2.25)).toBeLessThan(0);
  });
});

describe('simulation: interaction, joints and easing', () => {
  it('easing shapes keyframe segments without moving the end points', () => {
    const k = [{ t: 0, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }, { t: 1, pos: [4, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }];
    expect(sampleKeys(k, 0.5, 'linear').pos[0]).toBeCloseTo(2); expect(sampleKeys(k, 0.5, 'smooth').pos[0]).toBeCloseTo(2);
    expect(sampleKeys(k, 0.25, 'smooth').pos[0]).toBeLessThan(1); expect(sampleKeys(k, 0.25, 'out').pos[0]).toBeGreaterThan(1);
    expect(sampleKeys(k, 0, 'in').pos[0]).toBe(0); expect(sampleKeys(k, 1, 'in').pos[0]).toBe(4);
    expect(ease('nonsense', 0.3)).toBeCloseTo(0.3); expect(ease('linear', 9)).toBe(1);
  });
  it('slider joint goes out and back; ball joint wobbles in a circle', () => {
    expect(sliderOffset(0, 2)).toBeCloseTo(0); expect(sliderOffset(1.5, 2, 3)).toBeCloseTo(2); expect(sliderOffset(3, 2, 3)).toBeCloseTo(0);
    const [rx0, rz0] = ballAngles(0, 30); expect(rx0).toBeCloseTo(0); expect(rz0).toBeCloseTo((30 * Math.PI) / 180);
    const [rx, rz] = ballAngles(0.37, 30); expect(Math.hypot(rx, rz)).toBeCloseTo((30 * Math.PI) / 180);
  });
  it('impulses move free bodies only', () => {
    const b = makeBody({ id: 'a', min: [0, 0, 0], max: [1, 1, 1] }); const f = makeBody({ id: 'f', min: [0, 0, 0], max: [1, 1, 1], fixed: true });
    expect(applyImpulse(b, [2, 0, 0], 3)).toBe(true); expect(b.vel[0]).toBeCloseTo(3);
    expect(applyImpulse(f, [1, 0, 0], 3)).toBe(false); expect(f.vel).toEqual([0, 0, 0]);
    expect(applyImpulse(b, [0, 0, 0], 3)).toBe(false); expect(applyImpulse(b, [1, 0, 0], NaN)).toBe(false);
  });
  it('a pushed box slides, then settles', () => {
    const b = makeBody({ id: 'a', min: [0, 0, 0], max: [1, 1, 1] }); applyImpulse(b, [1, 0, 0], 4);
    expect(isSettled([b])).toBe(false); expect(movingCount([b])).toBe(1);
    for (let i = 0; i < 900; i++) stepWorld([b], 1 / 60);
    expect(b.pos[0]).toBeGreaterThan(0.5); expect(isSettled([b], 0.05)).toBe(true);
  });
});

describe('simulation: balance and load path', () => {
  const box = (id, min, max, fixed = false) => makeBody({ id, min, max, mass: (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]), fixed });
  it('centre of mass is mass-weighted', () => {
    const c = centerOfMass([box('a', [0, 0, 0], [1, 1, 1]), box('b', [2, 0, 0], [4, 1, 1])]);   // volumes 1 and 2
    expect(c[0]).toBeCloseTo((0.5 * 1 + 3 * 2) / 3); expect(centerOfMass([])).toBeNull();
  });
  it('a cube is stable and tips at 45°; a lopsided stack is not', () => {
    const cube = stability([box('c', [0, 0, 0], [1, 1, 1])]);
    expect(cube.stable).toBe(true); expect(cube.margin).toBeCloseTo(0.5); expect(cube.tipAngleDeg).toBeCloseTo(45, 0);
    const lopsided = stability([box('base', [0, 0, 0], [1, 1, 1]), box('arm', [0, 1, 0], [6, 3, 1])]);
    expect(lopsided.stable).toBe(false); expect(lopsided.margin).toBeLessThan(0); expect(lopsided.tipAngleDeg).toBe(0);
  });
  it('footprint only counts parts that touch the ground; floating models have none', () => {
    expect(supportRect([box('a', [0, 0, 0], [1, 1, 1]), box('b', [3, 5, 3], [4, 6, 4])]).count).toBe(1);
    const air = stability([box('a', [0, 5, 0], [1, 6, 1])]); expect(air.support).toBeNull(); expect(air.stable).toBe(false);
  });
  it('load path: base carries everything above, side-by-side parts carry nothing', () => {
    const bodies = [box('base', [0, 0, 0], [2, 1, 2]), box('mid', [0, 1, 0], [2, 2, 2]), box('top', [0.5, 2, 0.5], [1.5, 3, 1.5]), box('beside', [5, 0, 0], [6, 1, 1])];
    const L = Object.fromEntries(stackLoads(bodies).map((x) => [x.id, x]));
    expect(L.top.load).toBe(0); expect(L.beside.load).toBe(0);
    expect(L.mid.load).toBeCloseTo(1); expect(L.base.load).toBeCloseTo(4 + 1);
    expect(L.base.rel).toBeGreaterThan(L.mid.rel);
  });
  it('heat colours run blue → yellow → red and clamp', () => {
    expect(heatColor(0)).toBe(0x3b82f6); expect(heatColor(0.5)).toBe(0xfacc15); expect(heatColor(1)).toBe(0xef4444);
    expect(heatColor(-3)).toBe(heatColor(0)); expect(heatColor(NaN)).toBe(heatColor(0));
  });
});
