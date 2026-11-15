// Circle to Ask — geometry, privacy masking/redaction, text reading, capture fallbacks, long-press rules, settings.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { selectionFromPath, ensureMin, clampRect, overlapFraction, fitSize, wholeScreen, MIN_SIDE } from '../src/circleAsk/region.js';
import { redactText, routeStatus, maskSensitiveIn, isSensitive } from '../src/circleAsk/sensitive.js';
import { collectRegionText, captureRegion, encodeJpeg } from '../src/circleAsk/capture.js';
import { shouldIgnoreTarget, useGlobalLongPress } from '../src/circleAsk/useGlobalLongPress.js';
import { circleAskEnabled, setCircleAsk, loadPrefs, savePrefs, clearPrefs, browserLanguageCode } from '../src/circleAsk/settings.js';
import { renderHook } from '@testing-library/react';

const VP = { w: 400, h: 800 };
const circle = (cx, cy, r, n = 24) => Array.from({ length: n + 1 }, (_, i) => ({ x: cx + r * Math.cos((i / n) * 2 * Math.PI), y: cy + r * Math.sin((i / n) * 2 * Math.PI) }));

describe('region geometry', () => {
  it('turns a drawn circle into a padded rectangle around it', () => {
    const r = selectionFromPath(circle(200, 300, 80), VP);
    expect(r.x).toBeCloseTo(110, 0); expect(r.y).toBeCloseTo(210, 0); expect(r.w).toBeCloseTo(180, 0); expect(r.h).toBeCloseTo(180, 0);
  });
  it('ignores taps and tiny scribbles', () => {
    expect(selectionFromPath([{ x: 5, y: 5 }], VP)).toBeNull();
    expect(selectionFromPath([{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 7 }], VP)).toBeNull();
    expect(selectionFromPath(null, VP)).toBeNull();
  });
  it('keeps the selection on screen and never smaller than the minimum', () => {
    const edge = selectionFromPath(circle(395, 10, 60), VP);
    expect(edge.x + edge.w).toBeLessThanOrEqual(VP.w); expect(edge.y).toBeGreaterThanOrEqual(0);
    const line = selectionFromPath([{ x: 100, y: 400 }, { x: 160, y: 401 }, { x: 220, y: 400 }], VP);
    expect(line.h).toBeGreaterThanOrEqual(MIN_SIDE);
  });
  it('clamps, measures overlap, fits sizes', () => {
    expect(clampRect({ x: -20, y: -5, w: 100, h: 100 }, VP)).toEqual({ x: 0, y: 0, w: 80, h: 95 });
    expect(ensureMin({ x: 390, y: 790, w: 10, h: 10 }, 56, VP).x + 56).toBeLessThanOrEqual(VP.w);
    expect(overlapFraction({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 100, h: 100 })).toBeCloseTo(0.5);
    expect(overlapFraction({ x: 500, y: 500, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 })).toBe(0);
    expect(overlapFraction({ x: 50, y: 50, w: 0, h: 0 }, { x: 0, y: 0, w: 100, h: 100 })).toBe(1);
    expect(fitSize(2000, 1000, 1000)).toEqual({ w: 1000, h: 500, scale: 0.5 });
    expect(fitSize(300, 200, 1000).scale).toBe(1);
    expect(wholeScreen(VP)).toEqual({ x: 0, y: 0, w: 400, h: 800 });
  });
});

describe('privacy: redaction and screen rules', () => {
  it('hides cards whole, codes, passwords, emails, UPI, phones and long numbers', () => {
    const r = (s) => redactText(s).text;
    expect(r('card 4111 1111 1111 1111')).toBe('card [card number hidden]');
    expect(r('order 1234 5678 9012 3456')).toBe('order [number hidden]');
    expect(r('Your OTP is 482913')).toMatch(/OTP: \[hidden\]/i);
    expect(r('password: hunter2')).toBe('[password hidden]');
    expect(r('ann@example.com')).toBe('[email hidden]');
    expect(r('pay ramesh@okaxis')).toBe('pay [payment ID hidden]');
    expect(r('+91 98765 43210')).toBe('[phone hidden]');
    expect(r('Aadhaar 2345 6789 0123')).toBe('Aadhaar [ID number hidden]');
    expect(r('1,200 likes and 45 comments')).toBe('1,200 likes and 45 comments');
    expect(redactText('a@b.co c@d.co').count).toBe(2);
  });
  it('classifies screens', () => {
    expect(routeStatus('feed')).toBe('full'); expect(routeStatus('games')).toBe('full');
    expect(routeStatus('mylife')).toBe('blocked'); expect(routeStatus('admin')).toBe('blocked');
    expect(routeStatus('messages')).toBe('text-only'); expect(routeStatus('coins')).toBe('text-only'); expect(routeStatus('settings')).toBe('text-only');
    expect(routeStatus('feed', true)).toBe('blocked');   // Private space open → blocked everywhere
  });
  it('blacks out password/card/bubble elements and clears typed text in a page copy', () => {
    document.body.innerHTML = `<div id="r"><input type="password" value="hunter2"><input name="cardnumber" value="4111"><div data-sensitive>secret</div>
      <div class="bubble-row">hello there</div><input id="s" value="my draft"><textarea>draft msg</textarea><p>Plain text</p></div>`;
    const root = document.getElementById('r');
    const n = maskSensitiveIn(root);
    expect(n).toBe(4);
    expect(root.querySelector('[data-sensitive]').textContent).toBe('');
    expect(root.querySelector('.bubble-row').textContent).toBe('');
    expect(root.querySelector('input[type=password]').value).toBe('');
    expect(root.querySelector('#s').value).toBe('');
    expect(root.querySelector('textarea').value).toBe('');
    expect(root.querySelector('p').textContent).toBe('Plain text');
    expect(root.querySelector('[data-sensitive]').style.background).toBe('rgb(17, 17, 17)');
    expect(isSensitive(root.querySelector('.bubble-row'))).toBe(true);
    expect(isSensitive(root.querySelector('p'))).toBe(false);
  });
});

describe('collectRegionText', () => {
  // jsdom has no layout, so each test gives elements a rectangle by id.
  const rects = {};
  const getRect = (el) => rects[el.id] || { x: -999, y: -999, w: 1, h: 1 };
  const place = (id, x, y, w = 100, h = 20) => { rects[id] = { x, y, w, h }; };
  beforeEach(() => { for (const k of Object.keys(rects)) delete rects[k]; });

  it('reads only text inside the area, in reading order, plus its buttons', () => {
    document.body.innerHTML = `<h2 id="h">Games</h2><p id="a">Play chess online</p><button id="b" aria-label="Create room">＋</button><p id="far">Far away text</p>`;
    place('h', 10, 10); place('a', 10, 40); place('b', 150, 40, 30, 30); place('far', 10, 600);
    const r = collectRegionText({ x: 0, y: 0, w: 300, h: 200 }, { getRect });
    expect(r.text).toContain('Games · Play chess online'); expect(r.text).not.toContain('Far away');
    expect(r.controls).toEqual(['Create room']); expect(r.text).toContain('Buttons and links here: Create room');
  });
  it('never reads password fields, data-sensitive blocks, chat bubbles, hidden or circle UI', () => {
    document.body.innerHTML = `<p id="ok">Visible</p><div id="s" data-sensitive>TOP SECRET</div><div id="b" class="bubble-row">private chat</div>
      <p id="h" hidden>hidden</p><p id="a" aria-hidden="true">aria hidden</p><div id="u" data-circle-ui>overlay</div><input id="pw" type="password" value="x" aria-label="Password">`;
    for (const id of ['ok', 's', 'b', 'h', 'a', 'u', 'pw']) place(id, 0, 0);
    const r = collectRegionText({ x: 0, y: 0, w: 300, h: 200 }, { getRect });
    expect(r.text).toBe('Visible'); expect(r.hidden).toBeGreaterThanOrEqual(3);
  });
  it('scrubs card numbers out of visible text', () => {
    document.body.innerHTML = `<p id="p">Saved card 4111 1111 1111 1111</p>`; place('p', 0, 0);
    const r = collectRegionText({ x: 0, y: 0, w: 300, h: 200 }, { getRect });
    expect(r.text).not.toMatch(/4111|1111/); expect(r.text).toContain('[card number hidden]');
  });
  it('on Messages reads button/heading labels only — never message text', () => {
    document.body.innerHTML = `<h2 id="h">Messages</h2><button id="b">New chat</button><p id="m">my bank pin is nearby</p><div id="c" class="convo-preview">see you at 5</div>`;
    for (const id of ['h', 'b', 'm', 'c']) place(id, 0, 0);
    const r = collectRegionText({ x: 0, y: 0, w: 300, h: 200 }, { getRect, route: 'messages' });
    expect(r.text).toContain('Messages'); expect(r.text).toContain('New chat');
    expect(r.text).not.toContain('bank pin'); expect(r.text).not.toContain('see you');
  });
});

describe('captureRegion', () => {
  const fakeCanvas = () => ({ width: 800, height: 1200 });
  const mkCanvas = (bytesFor) => () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }),
    toDataURL(_t, q) { return `data:image/jpeg;base64,${'A'.repeat(bytesFor(q, this.width))}`; } });
  beforeEach(() => { document.body.innerHTML = '<p id="p">Hello</p>'; });

  it('captures just the rectangle, masks the page copy, and returns a small JPEG', async () => {
    let opts; const h2c = vi.fn(async (_el, o) => { opts = o; const clone = document.implementation.createHTMLDocument('x'); clone.body.innerHTML = '<input type="password" value="pw"><p>ok</p>'; o.onclone(clone); expect(clone.querySelector('input').value).toBe(''); return fakeCanvas(); });
    const res = await captureRegion({ x: 10, y: 20, w: 200, h: 100 }, { loadHtml2canvas: async () => h2c, createCanvas: mkCanvas(() => 1000), route: 'feed' });
    expect(opts).toMatchObject({ x: 10, y: 20, width: 200, height: 100, useCORS: true, allowTaint: false });
    expect(opts.ignoreElements(Object.assign(document.createElement('div'), {}))).toBe(false);
    const ui = document.createElement('div'); ui.setAttribute('data-circle-ui', ''); expect(opts.ignoreElements(ui)).toBe(true);
    expect(res.image.mediaType).toBe('image/jpeg'); expect(res.image.data).toMatch(/^A+$/); expect(res.hidden).toBeGreaterThanOrEqual(1);
  });
  it('shrinks the picture until it fits the size limit', async () => {
    const res = await captureRegion({ x: 0, y: 0, w: 300, h: 300 }, { loadHtml2canvas: async () => async () => fakeCanvas(), maxBytes: 20_000, createCanvas: mkCanvas((q, w) => Math.round(w * w * 0.05)) });
    expect(res.image.bytes).toBeLessThanOrEqual(20_000); expect(res.image.width).toBeLessThan(1024);
  });
  it('never draws pictures on Messages / Coins / Settings (text only, h2c never loaded)', async () => {
    const load = vi.fn();
    for (const route of ['messages', 'coins', 'settings']) {
      const res = await captureRegion({ x: 0, y: 0, w: 100, h: 100 }, { route, loadHtml2canvas: load });
      expect(res.image).toBeNull(); expect(res.reason).toBe('text-only-screen');
    }
    expect(load).not.toHaveBeenCalled();
  });
  it('falls back to text only if drawing fails or times out — never throws', async () => {
    let res = await captureRegion({ x: 0, y: 0, w: 100, h: 100 }, { loadHtml2canvas: async () => async () => { throw new Error('tainted'); } });
    expect(res.image).toBeNull(); expect(res.reason).toBe('capture-failed');
    res = await captureRegion({ x: 0, y: 0, w: 100, h: 100 }, { timeoutMs: 20, loadHtml2canvas: async () => () => new Promise(() => {}) });
    expect(res.reason).toBe('capture-failed');
  });
  it('encodeJpeg gives up cleanly when nothing fits', () => {
    expect(() => encodeJpeg({ width: 500, height: 500 }, { maxBytes: 10, createCanvas: mkCanvas(() => 100000) })).toThrow('picture too large');
  });
});

describe('long-press trigger', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '<div id="empty">x</div><button id="btn">b</button><div data-longpress id="lp"><span id="in">y</span></div><div data-noswipe id="ns">z</div><input id="i">'; });
  afterEach(() => { vi.useRealTimers(); });
  const press = (target, x = 5, y = 5) => target.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { isPrimary: true, pointerType: 'touch', button: 0, clientX: x, clientY: y }));
  const move = (target, x, y) => target.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { clientX: x, clientY: y }));

  it('ignores controls, fields, elements with their own long-press, and swipe-blocked areas', () => {
    for (const id of ['btn', 'i', 'lp', 'in', 'ns']) expect(shouldIgnoreTarget(document.getElementById(id)), id).toBe(true);
    expect(shouldIgnoreTarget(document.getElementById('empty'))).toBe(false);
  });
  it('fires after the hold on an empty area, not on a button, not if the finger moves, not when disabled', () => {
    const fire = vi.fn();
    const { rerender, unmount } = renderHook(({ on }) => useGlobalLongPress(fire, { enabled: on }), { initialProps: { on: true } });
    press(document.getElementById('btn')); vi.advanceTimersByTime(1000); expect(fire).not.toHaveBeenCalled();
    press(document.getElementById('empty')); vi.advanceTimersByTime(500); expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400); expect(fire).toHaveBeenCalledWith({ x: 5, y: 5 });
    fire.mockClear();
    press(document.getElementById('empty')); move(document.getElementById('empty'), 60, 5); vi.advanceTimersByTime(1500); expect(fire).not.toHaveBeenCalled();   // it was a scroll
    rerender({ on: false }); press(document.getElementById('empty')); vi.advanceTimersByTime(1500); expect(fire).not.toHaveBeenCalled();
    unmount();
  });
});

describe('settings & opt-in memory', () => {
  beforeEach(() => localStorage.clear());
  it('is OFF by default and the choice is remembered on this device', () => {
    expect(circleAskEnabled()).toBe(false); setCircleAsk(true); expect(circleAskEnabled()).toBe(true); setCircleAsk(false); expect(circleAskEnabled()).toBe(false);
  });
  it('remembers a language only when the person opts in, and can forget it', () => {
    expect(loadPrefs()).toEqual({ remember: false, language: '' });
    savePrefs({ remember: false, language: 'ta' }); expect(loadPrefs().language).toBe('');
    savePrefs({ remember: true, language: 'ta' }); expect(loadPrefs()).toEqual({ remember: true, language: 'ta' });
    savePrefs({ remember: true, language: 'xx' }); expect(loadPrefs().remember).toBe(false);   // not a supported language → nothing saved
    savePrefs({ remember: true, language: 'hi' }); clearPrefs(); expect(loadPrefs().remember).toBe(false);
    expect(browserLanguageCode({ language: 'ta-IN' })).toBe('ta'); expect(browserLanguageCode({ language: 'zz' })).toBe('en');
  });
});
