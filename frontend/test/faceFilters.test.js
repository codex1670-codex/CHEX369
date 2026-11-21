import { describe, it, expect } from 'vitest';
import { FILTERS, FILTER_GROUPS, computeFrame, lerpFrame, filterById } from '../src/filters/faceFilters.js';

// A drawing context that accepts any call, so every filter's drawing code runs end to end.
const mockCtx = () => new Proxy({}, {
  get: (_, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: () => true,
});
// 468 landmarks of a plausible, slightly tilted face (normalized 0-1).
const landmarks = () => {
  const lm = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  Object.assign(lm[33], { x: 0.4, y: 0.42 }); Object.assign(lm[133], { x: 0.46, y: 0.42 });
  Object.assign(lm[362], { x: 0.54, y: 0.43 }); Object.assign(lm[263], { x: 0.6, y: 0.43 });
  Object.assign(lm[1], { x: 0.5, y: 0.55 }); Object.assign(lm[10], { x: 0.5, y: 0.2 }); Object.assign(lm[152], { x: 0.5, y: 0.82 });
  Object.assign(lm[13], { x: 0.5, y: 0.66 }); Object.assign(lm[14], { x: 0.5, y: 0.7 });
  Object.assign(lm[61], { x: 0.44, y: 0.68 }); Object.assign(lm[291], { x: 0.56, y: 0.68 });
  Object.assign(lm[234], { x: 0.3, y: 0.5 }); Object.assign(lm[454], { x: 0.7, y: 0.5 });
  return lm;
};

describe('call filters', () => {
  it('offers more than 60 filters with unique ids', () => {
    expect(FILTERS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(FILTERS.map(f => f.id)).size).toBe(FILTERS.length);
    expect(FILTER_GROUPS.flatMap(g => g[2]).length).toBe(FILTERS.length);
  });
  it('reads the face geometry (eyes level, head tilt, mouth open)', () => {
    const f = computeFrame(landmarks(), 640, 480);
    expect(f.u).toBeGreaterThan(100);
    expect(f.eyeL.x).toBeLessThan(0); expect(f.eyeR.x).toBeGreaterThan(0);
    expect(f.top.y).toBeLessThan(0); expect(f.chin.y).toBeGreaterThan(0.5);
    expect(f.open).toBeGreaterThan(0);
  });
  it('smooths between frames', () => {
    const a = computeFrame(landmarks(), 640, 480), b = { ...a, mx: a.mx + 100, eyeL: { ...a.eyeL } };
    expect(lerpFrame(a, b, 0.5).mx).toBeCloseTo(a.mx + 50);
  });
  it.each(FILTERS.filter(f => f.kind === 'face').map(f => [f.id, f]))('face filter %s draws without error (mouth shut and open)', (_, filter) => {
    const frame = computeFrame(landmarks(), 640, 480);
    expect(() => { filter.draw(mockCtx(), frame, 1.3); filter.draw(mockCtx(), { ...frame, open: 0.9 }, 2.1); }).not.toThrow();
  });
  it.each(FILTERS.filter(f => f.kind === 'screen').map(f => [f.id, f]))('overlay %s draws without error', (_, filter) => {
    expect(() => filter.draw(mockCtx(), 640, 480, 3.2)).not.toThrow();
  });
  it('looks every colour filter has a css recipe or custom drawing', () => {
    for (const f of FILTERS.filter(x => x.kind === 'color')) expect(Boolean(f.css) || typeof f.custom === 'function').toBe(true);
    expect(filterById('nope').id).toBe('none');
  });
});
