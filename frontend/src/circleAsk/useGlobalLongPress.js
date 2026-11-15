import { useEffect, useRef } from 'react';

// A long press (about 0.8 s) on an EMPTY part of the page starts Circle to Ask.
// It stays out of the way of everything that already reacts to touch: buttons, links, form fields, videos and
// anything with its own long-press (marked data-longpress by useLongPress), horizontal scrollers, and the
// Circle to Ask UI itself. A finger that moves is a scroll, not a press.
const IGNORE = 'a, button, input, textarea, select, option, video, audio, canvas, summary, label, [role="button"], [role="link"], [role="slider"], [contenteditable="true"], [data-circle-ui], [data-noswipe], [data-longpress], [data-no-circle]';

export function shouldIgnoreTarget(el) {
  if (!el || !el.closest) return true;
  return !!el.closest(IGNORE);
}

export function useGlobalLongPress(onFire, { enabled = true, ms = 800, tolerance = 10 } = {}) {
  const cb = useRef(onFire); cb.current = onFire;
  useEffect(() => {
    if (!enabled) return undefined;
    let press = null;
    let blockMenuUntil = 0;
    const cancel = () => { if (press) { clearTimeout(press.timer); press = null; } };
    const down = (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || shouldIgnoreTarget(e.target)) return;
      cancel();
      const x = e.clientX, y = e.clientY;
      press = { x, y, timer: setTimeout(() => { press = null; blockMenuUntil = Date.now() + 1500; navigator.vibrate?.(15); cb.current?.({ x, y }); }, ms) };
    };
    const move = (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > tolerance) cancel(); };
    // The phone's own "save image / copy text" menu must not pop up on top of ours.
    const menu = (e) => { if (Date.now() < blockMenuUntil) e.preventDefault(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', cancel, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('scroll', cancel, true);
    document.addEventListener('contextmenu', menu, true);
    return () => {
      cancel();
      document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', cancel, true); document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('scroll', cancel, true); document.removeEventListener('contextmenu', menu, true);
    };
  }, [enabled, ms, tolerance]);
}
