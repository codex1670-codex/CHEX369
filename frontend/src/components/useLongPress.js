import { useEffect, useRef } from 'react';

// Long press (about half a second) or right-click on an element. A finger that moves is a scroll, not a
// press, and the click that follows a long press is swallowed so it doesn't also open/like the thing.
// Spread the result on the element: <div {...useLongPress(openPicker)}>.
export function useLongPress(onLongPress, { ms = 450, disabled = false } = {}) {
  const press = useRef(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const cancel = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  useEffect(() => cancel, []);

  return {
    onPointerDown: (e) => {
      if (disabled || (e.button !== undefined && e.button > 0)) return;
      cancel();
      fired.current = false; // a fresh press: forget any earlier long press whose click never came
      const timer = setTimeout(() => { fired.current = true; press.current = null; navigator.vibrate?.(15); cb.current?.(); }, ms);
      press.current = { timer, x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancel();
    },
    onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel,
    onContextMenu: (e) => { if (disabled) return; e.preventDefault(); cancel(); fired.current = false; cb.current?.(); },
    onClickCapture: (e) => { if (fired.current) { fired.current = false; e.stopPropagation(); e.preventDefault(); } },
  };
}
