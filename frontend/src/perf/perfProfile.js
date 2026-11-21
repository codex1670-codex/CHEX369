// CHEX SMOOTH — adaptive 60 / 120 FPS engine.
//
// What it does
//   1. Detects what this device can do: real screen refresh rate (measured, not guessed), memory, CPU cores,
//      data-saver, reduced-motion and battery.
//   2. Picks a frame target (30 / 60 / 120) and a visual level ('lite' | 'balanced' | 'ultra').
//   3. Publishes them on <html data-perf="…" data-fps="…"> so CSS can adapt, and via usePerf() for React.
//   4. Watches real frame times while the person scrolls / drags and steps DOWN if the device can't keep up,
//      and back UP (slowly) once it can — so a hot or busy phone never stutters.
//   5. Remembers the result on this device (localStorage), so the next launch is smooth from the first frame
//      with no re-test.
//
// Safe by design: nothing here runs on import. main.tsx calls initPerf(); tests can use the pure functions.
// Everything touching the browser is wrapped in try/catch, so an old browser just gets the default profile.

export const PERF_KEY = 'chex.perf';          // the person's choice: { mode }
export const PERF_CACHE_KEY = 'chex.perf.cache'; // what we learned about this device
export const PERF_CHANGED = 'chex:perf-changed';

export const MODES = ['auto', 'smooth120', 'smooth60', 'saver'];
export const LEVELS = ['lite', 'balanced', 'ultra'];
const REFRESH_STEPS = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
const CACHE_TTL = 14 * 24 * 3600 * 1000;      // re-measure every two weeks (or when the screen changes)

// ---------- pure helpers (unit-tested) -------------------------------------------------------------------------

/** Snap a measured frame rate to the nearest real display rate (e.g. 118.7 → 120). */
export function snapRefresh(fps) {
  if (!Number.isFinite(fps) || fps <= 0) return 60;
  return REFRESH_STEPS.reduce((best, r) => (Math.abs(r - fps) < Math.abs(best - fps) ? r : best), REFRESH_STEPS[0]);
}

/** Refresh rate + stability from a list of frame gaps in ms. Ignores the first few (page still starting) and spikes. */
export function analyseFrames(gaps) {
  const g = (gaps || []).filter((x) => Number.isFinite(x) && x > 0).slice(3);
  if (g.length < 8) return { refresh: 60, stable: false, samples: g.length };
  const sorted = [...g].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const janky = g.filter((x) => x > median * 1.5).length / g.length;
  return { refresh: snapRefresh(1000 / median), stable: janky <= 0.12, samples: g.length };
}

/** Score a device from the signals the browser gives us. >=3 high, <=-1 low, otherwise mid. */
export function classifyDevice({ memory, cores, refresh = 60, stable = false, saveData = false, slowNet = false, mobile = false } = {}) {
  let s = 0;
  if (memory) s += memory >= 8 ? 2 : memory >= 4 ? 1 : memory >= 3 ? 0 : memory >= 2 ? -1 : -2;   // deviceMemory is Chrome-only; unknown counts 0
  if (cores) s += cores >= 8 ? 1 : cores >= 6 ? 1 : cores >= 4 ? 0 : cores >= 3 ? -1 : -2;
  if (refresh >= 90) s += stable ? 2 : 1;           // a screen that really delivers 90/120 Hz is strong evidence of a fast device
  if (saveData || slowNet) s -= 1;
  if (mobile && !memory && !cores) s -= 0;           // nothing known → stay in the middle
  return s >= 3 ? 'high' : s <= -1 ? 'low' : 'mid';
}

/**
 * The single place that decides what the app runs at.
 *   mode      – the person's choice: auto | smooth120 | smooth60 | saver
 *   refresh   – measured screen rate
 *   tier      – 'low' | 'mid' | 'high' (classifyDevice)
 *   governor  – { fpsCap?, levelCap? } set by the runtime watchdog when frames are being dropped
 *   saver     – true when the OS asks for less (data-saver, low battery) – only honoured in auto
 *   reduced   – prefers-reduced-motion
 */
export function resolveProfile({ mode = 'auto', refresh = 60, tier = 'mid', governor = {}, saver = false, reduced = false } = {}) {
  const screen = Math.min(120, Math.max(30, refresh));       // above 120 Hz gives no visible gain for this UI
  let fps; let level; let reason;

  if (mode === 'saver') { fps = 30; level = 'lite'; reason = 'Battery saver'; }
  else if (mode === 'smooth60') { fps = Math.min(60, screen); level = tier === 'low' ? 'lite' : 'balanced'; reason = '60 FPS'; }
  else if (mode === 'smooth120') { fps = screen; level = tier === 'low' ? 'lite' : screen >= 90 ? 'ultra' : 'balanced'; reason = '120 FPS'; }
  else {
    // auto: fastest the screen AND the device can hold
    if (tier === 'high') { fps = screen; level = screen >= 90 ? 'ultra' : 'balanced'; reason = screen >= 90 ? 'High-end device, fast screen' : 'High-end device'; }
    else if (tier === 'mid') { fps = Math.min(screen, 60); level = 'balanced'; reason = 'Balanced for this device'; }
    else { fps = Math.min(screen, 60); level = 'lite'; reason = 'Lighter effects for this device'; }
    if (saver) { fps = Math.min(fps, 60); level = 'lite'; reason = 'Saving data / battery'; }
  }
  if (reduced) { level = 'lite'; reason = 'Reduced motion is on'; }

  // runtime watchdog can only lower what the settings chose
  if (governor.fpsCap) fps = Math.min(fps, governor.fpsCap);
  if (governor.levelCap && LEVELS.indexOf(governor.levelCap) < LEVELS.indexOf(level)) { level = governor.levelCap; reason = 'Adjusted to keep scrolling smooth'; }
  fps = snapTarget(fps);
  return { fps, level, reason };
}

/** Frame targets we actually use. */
export function snapTarget(fps) { return fps >= 90 ? 120 : fps >= 45 ? 60 : 30; }

/** One step down: 120 → 60 → 30 first, then ultra → balanced → lite. Returns null when there's nothing left to give up. */
export function stepDown(cur) {
  if (cur.fps > 60) return { fpsCap: 60 };
  if (cur.level === 'ultra') return { levelCap: 'balanced' };
  if (cur.fps > 30 && cur.level === 'balanced') return { levelCap: 'lite' };
  if (cur.fps > 30) return { fpsCap: 30 };
  return null;
}

/**
 * Decide from one measurement window. `avgMs` is the average frame gap while moving.
 * Returns 'down' | 'up' | 'hold'. Hysteresis lives in the caller (2 bad windows to drop, 5 good to climb).
 */
export function judgeWindow(avgMs, targetFps) {
  if (!Number.isFinite(avgMs) || avgMs <= 0) return 'hold';
  const delivered = 1000 / avgMs;
  if (delivered < targetFps * 0.8) return 'down';
  if (delivered >= targetFps * 0.95) return 'up';
  return 'hold';
}

/**
 * A frame gate for requestAnimationFrame loops. Call gate(t) every rAF; it returns the elapsed seconds when a
 * frame should be drawn, or 0 to skip it. Lets a 120 Hz phone that can't hold 120 draw every 2nd frame.
 */
export function createFrameGate(getFps = () => state.fps) {
  let last = 0;
  return (t) => {
    if (!last) { last = t; return 0; }
    const fps = getFps();
    const dt = t - last;
    if (dt < 1000 / fps - 1.5) return 0;       // 1.5 ms of slack so 60 Hz screens don't skip every 17th frame
    last = t;
    return dt / 1000;
  };
}

// ---------- state ------------------------------------------------------------------------------------------------

const state = {
  mode: 'auto', refresh: 60, stable: false, tier: 'mid',
  level: 'balanced', fps: 60, reason: '',
  governor: {}, saver: false, reduced: false,
  measured: false, auto: true, delivered: 0,
};
let started = false;
const listeners = new Set();

export function getPerf() { return state; }
export function subscribePerf(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let snapshot = { ...state };
export function getPerfSnapshot() { return snapshot; }   // stable object between changes (for useSyncExternalStore)

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

// Smoothness is always automatic now (the manual 60 / 120 / Saver picker was removed from Settings):
// every page, including small / low-memory phones, gets the best frame rate and the lightest effects it can hold.
export function loadMode() { return 'auto'; }
export function saveMode(mode) {
  const m = MODES.includes(mode) ? mode : 'auto';
  safe(() => localStorage.setItem(PERF_KEY, JSON.stringify({ mode: m })));
  state.mode = m;
  state.governor = {};           // a fresh choice starts from a clean slate
  recompute(true);
  return m;
}

// ---------- reading the device -----------------------------------------------------------------------------------

function deviceSignals() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const conn = nav.connection || {};
  return {
    memory: nav.deviceMemory || 0,
    cores: nav.hardwareConcurrency || 0,
    saveData: !!conn.saveData,
    slowNet: /(^|-)2g$/.test(conn.effectiveType || ''),
    mobile: /Mobi|Android|iPhone|iPad/i.test(nav.userAgent || ''),
  };
}
const reducedMotion = () => safe(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, false);
const screenKey = () => safe(() => `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`, 'unknown');

function readCache() {
  return safe(() => {
    const c = JSON.parse(localStorage.getItem(PERF_CACHE_KEY) || 'null');
    if (!c || c.v !== 1 || Date.now() - c.at > CACHE_TTL || c.screen !== screenKey()) return null;
    return c;
  }, null);
}
function writeCache(extra = {}) {
  safe(() => localStorage.setItem(PERF_CACHE_KEY, JSON.stringify({
    v: 1, at: Date.now(), screen: screenKey(), refresh: state.refresh, stable: state.stable, tier: state.tier,
    governor: state.governor, ...extra,
  })));
}
/** Forget what we learned; the next launch (or Re-test) measures again. */
export function clearPerfCache() { safe(() => localStorage.removeItem(PERF_CACHE_KEY)); }

// ---------- publishing -------------------------------------------------------------------------------------------

function publish(changed) {
  snapshot = { ...state };
  safe(() => {
    const el = document.documentElement;
    el.setAttribute('data-perf', state.level);
    el.setAttribute('data-fps', String(state.fps));
    el.style.setProperty('--fps', String(state.fps));
    el.style.setProperty('--frame-ms', `${(1000 / state.fps).toFixed(2)}ms`);
  });
  if (changed) {
    listeners.forEach((fn) => safe(fn));
    safe(() => window.dispatchEvent(new CustomEvent(PERF_CHANGED, { detail: snapshot })));
  }
}

function recompute(force) {
  const next = resolveProfile({
    mode: state.mode, refresh: state.refresh, tier: state.tier,
    governor: state.governor, saver: state.saver, reduced: state.reduced,
  });
  const changed = force || next.fps !== state.fps || next.level !== state.level || next.reason !== state.reason;
  Object.assign(state, next, { auto: state.mode === 'auto' });
  publish(changed);
}

// ---------- measuring --------------------------------------------------------------------------------------------

/** Measure the screen's real refresh rate with ~40 frames of rAF. Resolves to { refresh, stable }. */
export function measureRefresh({ frames = 40, timeout = 2500 } = {}) {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') return resolve({ refresh: 60, stable: false });
    const gaps = []; let last = 0; let done = false; let raf = 0;
    const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(to); resolve(analyseFrames(gaps)); };
    const to = setTimeout(finish, timeout);
    const tick = (t) => {
      if (last) gaps.push(t - last);
      last = t;
      if (gaps.length >= frames) finish(); else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}

/** Wait until the tab is visible (rAF doesn't run in a hidden tab), then measure. */
function measureWhenVisible() {
  return new Promise((resolve) => {
    const go = () => measureRefresh().then(resolve);
    if (!safe(() => document.hidden, false)) return go();
    const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); go(); } };
    document.addEventListener('visibilitychange', on);
  });
}

/** Re-test this device now (Settings → "Test my device"). */
export async function retestDevice() {
  clearPerfCache();
  state.governor = {};
  const m = await measureWhenVisible();
  state.refresh = m.refresh; state.stable = m.stable; state.measured = true;
  state.tier = classifyDevice({ ...deviceSignals(), refresh: m.refresh, stable: m.stable });
  writeCache();
  recompute(true);
  return snapshot;
}

// ---------- runtime governor -------------------------------------------------------------------------------------
// Samples real frame times in short windows while the person scrolls or drags (the moments jank is felt),
// never in the background. 2 bad windows in a row → step down. 5 good windows in a row → step back up.

function startGovernor() {
  const WINDOW = 45;              // frames per sample
  const COOLDOWN = 3000;          // ms between windows
  let sampling = false; let lastEnd = 0; let bad = 0; let good = 0;

  const sample = () => {
    sampling = true;
    const gaps = []; let last = 0;
    const tick = (t) => {
      if (document.hidden) { sampling = false; return; }
      if (last) gaps.push(t - last);
      last = t;
      if (gaps.length < WINDOW) { requestAnimationFrame(tick); return; }
      sampling = false; lastEnd = performance.now();
      // ignore the odd long frame caused by the page itself loading something
      const sorted = [...gaps].sort((a, b) => a - b);
      const trimmed = sorted.slice(0, Math.floor(sorted.length * 0.9));
      const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
      state.delivered = Math.round(1000 / avg);
      verdict(judgeWindow(avg, state.fps));
    };
    requestAnimationFrame(tick);
  };

  const verdict = (v) => {
    if (v === 'down') { good = 0; bad += 1; if (bad >= 2) { bad = 0; const s = stepDown(state); if (s) { state.governor = { ...state.governor, ...s }; writeCache(); recompute(); } } }
    else if (v === 'up') { bad = 0; good += 1; if (good >= 5 && (state.governor.fpsCap || state.governor.levelCap)) { good = 0; state.governor = stepUp(state.governor); writeCache(); recompute(); } }
    else { bad = 0; good = 0; }
  };

  const onMove = () => {
    if (sampling || reducedMotion() || performance.now() - lastEnd < COOLDOWN) return;
    sample();
  };
  window.addEventListener('scroll', onMove, { capture: true, passive: true });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('wheel', onMove, { passive: true });
  return () => {
    window.removeEventListener('scroll', onMove, { capture: true });
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('wheel', onMove);
  };
}

/** Lift the most recent cap first. */
export function stepUp(gov) {
  const g = { ...gov };
  if (g.fpsCap === 30) delete g.fpsCap;
  else if (g.levelCap === 'lite') g.levelCap = 'balanced';
  else if (g.levelCap === 'balanced') delete g.levelCap;
  else if (g.fpsCap === 60) delete g.fpsCap;
  return g;
}

// ---------- battery / data-saver ---------------------------------------------------------------------------------

function watchPower() {
  const evaluate = (b) => {
    const low = !!b && !b.charging && b.level <= 0.15;
    const conn = navigator.connection || {};
    const saver = low || !!conn.saveData;
    if (saver !== state.saver) { state.saver = saver; recompute(); }
  };
  try {
    navigator.getBattery?.().then((b) => {
      evaluate(b);
      b.addEventListener('levelchange', () => evaluate(b));
      b.addEventListener('chargingchange', () => evaluate(b));
    }).catch(() => {});
  } catch { /* no Battery API (Safari / Firefox) */ }
  try { navigator.connection?.addEventListener?.('change', () => evaluate(null)); } catch { /* not supported */ }
}

// ---------- start ------------------------------------------------------------------------------------------------

/** Call once at startup (main.tsx). Applies the saved profile immediately, then measures if needed. Returns a stop fn. */
export function initPerf() {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  state.mode = loadMode();
  state.reduced = reducedMotion();
  const sig = deviceSignals();
  state.saver = !!sig.saveData;

  const cached = readCache();
  if (cached) {
    // instant: no flash, no re-test
    state.refresh = cached.refresh; state.stable = !!cached.stable; state.tier = cached.tier; state.governor = cached.governor || {};
    state.measured = true;
  } else {
    // first ever launch: a sensible guess until the measurement lands (a few hundred ms)
    state.tier = classifyDevice({ ...sig, refresh: 60 });
  }
  recompute(true);

  let stopGov = () => {};
  const begin = () => {
    stopGov = startGovernor();
    watchPower();
  };
  if (cached) begin();
  else measureWhenVisible().then((m) => {
    state.refresh = m.refresh; state.stable = m.stable; state.measured = true;
    state.tier = classifyDevice({ ...sig, refresh: m.refresh, stable: m.stable });
    writeCache();
    recompute(true);
    begin();
  });

  const mq = safe(() => window.matchMedia('(prefers-reduced-motion: reduce)'), null);
  const onReduce = () => { state.reduced = reducedMotion(); recompute(); };
  safe(() => mq?.addEventListener?.('change', onReduce));

  return () => { stopGov(); started = false; safe(() => mq?.removeEventListener?.('change', onReduce)); };
}
