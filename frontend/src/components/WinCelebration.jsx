import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// 3D win animation: a spinning trophy, an extruded "YOU WIN!" that flips in, and confetti tumbling
// through 3D space. It is portalled to <body> (so it works inside blurred overlays), ignores
// pointer events (the game's buttons stay tappable) and removes itself after a few seconds.
const COLORS = ['#ffd23f', '#ff5c93', '#35e0ff', '#7dff6a', '#ff9d1a', '#b28bff', '#ffffff'];

export default function WinCelebration({ text = 'YOU WIN!', ms = 5200 }) {
  const [on, setOn] = useState(true);
  useEffect(() => { const t = setTimeout(() => setOn(false), ms); return () => clearTimeout(t); }, [ms]);
  const pieces = useMemo(() => Array.from({ length: 46 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 1.4,
    dur: 2.6 + Math.random() * 2.2,
    size: 8 + Math.random() * 9,
    color: COLORS[i % COLORS.length],
    spinX: 360 * (1 + Math.floor(Math.random() * 3)),
    spinY: 360 * (1 + Math.floor(Math.random() * 3)),
    drift: (Math.random() - 0.5) * 160,
  })), []);
  if (!on || typeof document === 'undefined') return null;
  return createPortal(
    <div className="wc-root" aria-hidden="true">
      <div className="wc-glow" />
      {pieces.map((p) => (
        <span key={p.id} className="wc-confetti"
          style={{ left: `${p.left}%`, width: p.size, height: p.size * 1.6, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, '--sx': `${p.spinX}deg`, '--sy': `${p.spinY}deg`, '--dx': `${p.drift}px` }} />
      ))}
      <div className="wc-stage">
        <div className="wc-trophy">🏆</div>
        <div className="wc-text" data-text={text}>{text}</div>
      </div>
    </div>,
    document.body,
  );
}
