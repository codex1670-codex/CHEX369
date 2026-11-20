import { useEffect, useRef } from 'react';
import { actionFor, fireGesture } from './gestureStore.js';

// Press-and-hold on a Share button (post card, reel card, full-screen reel).
//   <button {...useShareGesture({ kind: 'reel', id, thumb: url, thumbType: 'video' })} onClick={…}>
// A normal tap is untouched (it still opens the share sheet). A hold fires the "Hold Share button" gesture; the
// quick-send circle then keeps following the same finger, so you can drag the video onto a profile in one move.
export function useShareGesture({ kind, id, thumb = null, thumbType = 'image' }) {
  const item = useRef({}); item.current = { kind, id, thumb, thumbType };
  const press = useRef(null);
  const fired = useRef(false);

  const cancel = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  useEffect(() => cancel, []);

  return {
    onPointerDown: (e) => {
      if ((e.button !== undefined && e.button > 0) || actionFor('shareHold') === 'none') return;
      cancel();
      fired.current = false;
      const x = e.clientX, y = e.clientY;
      const timer = setTimeout(() => {
        press.current = null;
        fired.current = true;
        fireGesture('shareHold', { ...item.current, x, y, held: true });
      }, 380);
      press.current = { timer, x, y };
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancel();   // a finger that moves is a scroll
    },
    onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel,
    // Right-click / the phone's own long-press menu: open the same thing, but "sticky" (tap a profile) since no finger is down.
    onContextMenu: (e) => {
      if (actionFor('shareHold') === 'none') return;
      e.preventDefault(); cancel();
      fired.current = false;
      fireGesture('shareHold', { ...item.current, x: e.clientX, y: e.clientY, held: false });
    },
    // The click that follows a long press must not also open the share sheet.
    onClickCapture: (e) => { if (fired.current) { fired.current = false; e.stopPropagation(); e.preventDefault(); } },
    style: { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' },
  };
}
