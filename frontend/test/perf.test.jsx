import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  snapRefresh, analyseFrames, classifyDevice, resolveProfile, stepDown, stepUp, judgeWindow,
  createFrameGate, saveMode, loadMode, getPerf, PERF_KEY,
} from '../src/perf/perfProfile';
import PerfSettings from '../src/perf/PerfSettings';

const gaps = (ms, n = 40) => Array.from({ length: n }, () => ms);

describe('refresh-rate detection', () => {
  it('snaps measured rates to real display rates', () => {
    expect(snapRefresh(118.7)).toBe(120);
    expect(snapRefresh(59.4)).toBe(60);
    expect(snapRefresh(91)).toBe(90);
    expect(snapRefresh(NaN)).toBe(60);
  });
  it('reads 120 Hz and 60 Hz from frame gaps and flags unstable runs', () => {
    expect(analyseFrames(gaps(8.33))).toMatchObject({ refresh: 120, stable: true });
    expect(analyseFrames(gaps(16.7))).toMatchObject({ refresh: 60, stable: true });
    const jumpy = gaps(8.33).map((g, i) => (i % 3 === 0 ? 30 : g));
    expect(analyseFrames(jumpy).stable).toBe(false);
  });
  it('falls back to 60 when there are too few frames', () => {
    expect(analyseFrames([16, 16, 16])).toMatchObject({ refresh: 60, stable: false });
  });
});

describe('device tiers', () => {
  it('high: 8 GB, 8 cores, stable 120 Hz', () => {
    expect(classifyDevice({ memory: 8, cores: 8, refresh: 120, stable: true })).toBe('high');
  });
  it('high: iPhone-style (no deviceMemory) with a stable 120 Hz screen', () => {
    expect(classifyDevice({ cores: 6, refresh: 120, stable: true })).toBe('high');
  });
  it('low: 2 GB, 2 cores', () => {
    expect(classifyDevice({ memory: 2, cores: 2, refresh: 60 })).toBe('low');
  });
  it('mid: unknown signals stay in the middle; data-saver pushes down', () => {
    expect(classifyDevice({})).toBe('mid');
    expect(classifyDevice({ memory: 4, cores: 4, saveData: true })).toBe('mid');
    expect(classifyDevice({ memory: 2, cores: 4, saveData: true })).toBe('low');
  });
});

describe('profile resolution', () => {
  it('auto: high-end + 120 Hz → 120 FPS ultra', () => {
    expect(resolveProfile({ refresh: 120, tier: 'high' })).toMatchObject({ fps: 120, level: 'ultra' });
  });
  it('auto: mid-range on a 120 Hz screen holds 60 FPS', () => {
    expect(resolveProfile({ refresh: 120, tier: 'mid' })).toMatchObject({ fps: 60, level: 'balanced' });
  });
  it('auto: low-end gets lite effects', () => {
    expect(resolveProfile({ refresh: 60, tier: 'low' })).toMatchObject({ fps: 60, level: 'lite' });
  });
  it('120 mode never exceeds what the screen can show', () => {
    expect(resolveProfile({ mode: 'smooth120', refresh: 60, tier: 'high' }).fps).toBe(60);
    expect(resolveProfile({ mode: 'smooth120', refresh: 144, tier: 'high' }).fps).toBe(120);
  });
  it('saver is 30 FPS lite; reduced motion forces lite; low battery lowers auto', () => {
    expect(resolveProfile({ mode: 'saver', refresh: 120, tier: 'high' })).toMatchObject({ fps: 30, level: 'lite' });
    expect(resolveProfile({ refresh: 120, tier: 'high', reduced: true }).level).toBe('lite');
    expect(resolveProfile({ refresh: 120, tier: 'high', saver: true })).toMatchObject({ fps: 60, level: 'lite' });
  });
  it('the watchdog can lower but never raise what the person chose', () => {
    expect(resolveProfile({ refresh: 120, tier: 'high', governor: { fpsCap: 60 } }).fps).toBe(60);
    expect(resolveProfile({ refresh: 120, tier: 'high', governor: { levelCap: 'balanced' } }).level).toBe('balanced');
    expect(resolveProfile({ refresh: 60, tier: 'low', governor: { levelCap: 'ultra' } }).level).toBe('lite');
  });
});

describe('adaptive governor', () => {
  it('steps down 120 → 60 first, then ultra → balanced → lite, then 30', () => {
    expect(stepDown({ fps: 120, level: 'ultra' })).toEqual({ fpsCap: 60 });
    expect(stepDown({ fps: 60, level: 'ultra' })).toEqual({ levelCap: 'balanced' });
    expect(stepDown({ fps: 60, level: 'balanced' })).toEqual({ levelCap: 'lite' });
    expect(stepDown({ fps: 60, level: 'lite' })).toEqual({ fpsCap: 30 });
    expect(stepDown({ fps: 30, level: 'lite' })).toBeNull();
  });
  it('steps back up in the reverse order', () => {
    expect(stepUp({ fpsCap: 30, levelCap: 'lite' })).toEqual({ levelCap: 'lite' });
    expect(stepUp({ levelCap: 'lite', fpsCap: 60 })).toEqual({ levelCap: 'balanced', fpsCap: 60 });
    expect(stepUp({ levelCap: 'balanced', fpsCap: 60 })).toEqual({ fpsCap: 60 });
    expect(stepUp({ fpsCap: 60 })).toEqual({});
  });
  it('judges a frame window against the target with a dead zone between', () => {
    expect(judgeWindow(8.4, 120)).toBe('up');      // ~119 fps
    expect(judgeWindow(16.7, 120)).toBe('down');    // only 60 delivered
    expect(judgeWindow(9.5, 120)).toBe('hold');     // ~105 fps: in between
    expect(judgeWindow(0, 60)).toBe('hold');
  });
});

describe('frame gate', () => {
  it('passes every frame at the screen rate and every 2nd frame when capped to half', () => {
    let fps = 60; const gate = createFrameGate(() => fps);
    gate(0.1);                                   // first call only starts the clock
    const at60 = [1, 2, 3, 4].map((i) => gate(0.1 + i * 16.67));
    expect(at60.every((d) => d > 0)).toBe(true);
    fps = 30; const gate30 = createFrameGate(() => fps);
    gate30(0.1);
    const out = [1, 2, 3, 4, 5, 6].map((i) => gate30(0.1 + i * 16.67));
    expect(out.filter((d) => d > 0).length).toBe(3);                // every second frame
    expect(out.find((d) => d > 0)).toBeCloseTo(0.0333, 3);         // elapsed time is passed on, so game speed is unchanged
  });
});

describe('Settings → Smooth performance', () => {
  beforeEach(() => { localStorage.clear(); saveMode('auto'); });
  it('remembers the chosen mode on this device and updates the status line', () => {
    render(<PerfSettings />);
    expect(screen.getByTestId('perf-status').textContent).toMatch(/FPS/);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Saver/ })); });
    expect(loadMode()).toBe('saver');
    expect(JSON.parse(localStorage.getItem(PERF_KEY)).mode).toBe('saver');
    expect(getPerf().fps).toBe(30);
    expect(document.documentElement.getAttribute('data-fps')).toBe('30');
    expect(document.documentElement.getAttribute('data-perf')).toBe('lite');
    expect(screen.getByRole('button', { name: /Saver/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
