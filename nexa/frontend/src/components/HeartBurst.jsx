import { useCallback, useRef, useState } from 'react';

// Instagram-style "double tap to like" with a live 3D heart: a big heart pops at the tap
// point, spins on its Y axis and floats up, with a few smaller hearts drifting around it.
//
// Usage:
//   const { bursts, trigger, layer } = useHeartBurst();
//   <div onClick/onPointerUp=...>  {layer}  </div>
//   trigger(clientX, clientY, containerEl)
export function useHeartBurst() {
  const [bursts, setBursts] = useState([]);
  const idRef = useRef(0);

  const trigger = useCallback((clientX, clientY, container) => {
    const r = container?.getBoundingClientRect?.();
    const x = r && clientX != null ? clientX - r.left : (r ? r.width / 2 : 0);
    const y = r && clientY != null ? clientY - r.top : (r ? r.height / 2 : 0);
    const id = ++idRef.current;
    const minis = Array.from({ length: 6 }, (_, i) => ({
      dx: (Math.random() - 0.5) * 150,
      dy: -60 - Math.random() * 110,
      rot: (Math.random() - 0.5) * 80,
      delay: i * 45,
      size: 16 + Math.random() * 14,
    }));
    setBursts(b => [...b, { id, x, y, minis }]);
    setTimeout(() => setBursts(b => b.filter(h => h.id !== id)), 1300);
  }, []);

  const layer = (
    <div className="heart-layer" aria-hidden="true">
      {bursts.map(b => (
        <div key={b.id} className="heart-burst" style={{ left: b.x, top: b.y }}>
          <span className="heart-3d">
            <svg viewBox="0 0 32 29" width="96" height="87" aria-hidden="true">
              <defs>
                <linearGradient id={`hg${b.id}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ffb3c8" /><stop offset=".45" stopColor="#ff2d6f" /><stop offset="1" stopColor="#a8003a" />
                </linearGradient>
                <radialGradient id={`hs${b.id}`} cx=".3" cy=".25" r=".5">
                  <stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
                </radialGradient>
              </defs>
              <path d="M16 28.5C6 21 1 15.5 1 9.2 1 4.6 4.4 1.5 8.4 1.5c3 0 5.6 1.7 7.6 4.6 2-2.9 4.6-4.6 7.6-4.6 4 0 7.4 3.1 7.4 7.7 0 6.3-5 11.8-15 19.3z" fill={`url(#hg${b.id})`} />
              <path d="M16 28.5C6 21 1 15.5 1 9.2 1 4.6 4.4 1.5 8.4 1.5c3 0 5.6 1.7 7.6 4.6 2-2.9 4.6-4.6 7.6-4.6 4 0 7.4 3.1 7.4 7.7 0 6.3-5 11.8-15 19.3z" fill={`url(#hs${b.id})`} />
            </svg>
          </span>
          {b.minis.map((m, i) => (
            <span key={i} className="heart-mini"
              style={{ '--dx': `${m.dx}px`, '--dy': `${m.dy}px`, '--rot': `${m.rot}deg`, animationDelay: `${m.delay}ms`, fontSize: m.size }}>♥</span>
          ))}
        </div>
      ))}
    </div>
  );

  return { trigger, layer };
}

// Tells a single tap from a double tap (mouse and touch). A single tap fires after a short
// wait so a double tap never also triggers the single-tap action.
//   const tap = useTapHandlers({ onSingle, onDouble });  →  spread {...tap} on the element
export function useTapHandlers({ onSingle, onDouble, delay = 380, window: windowMs = 520, seed = null }) {
  // `seed` = a first tap that happened just before this component appeared (e.g. the click that
  // opened the fullscreen viewer), so the second click of a slow double-tap still counts.
  const last = useRef(seed || { t: 0, x: 0, y: 0 });
  const timer = useRef(null);

  const onClick = (e) => {
    const now = Date.now();
    const { t, x, y } = last.current;
    const near = Math.abs(e.clientX - x) < 40 && Math.abs(e.clientY - y) < 40;
    // e.detail >= 2 is the browser's own double-click (it follows the OS double-click speed).
    if ((now - t < windowMs && near) || e.detail >= 2) {
      clearTimeout(timer.current);
      last.current = { t: 0, x: 0, y: 0 };
      onDouble?.(e);
    } else {
      last.current = { t: now, x: e.clientX, y: e.clientY };
      const target = e.currentTarget;
      const cx = e.clientX; const cy = e.clientY; const tapTime = now;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        last.current = { t: 0, x: 0, y: 0 };
        onSingle?.({ clientX: cx, clientY: cy, currentTarget: target, t: tapTime });
      }, delay);
    }
  };
  return { onClick };
}
