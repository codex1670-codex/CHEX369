import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getEmojiFx } from '../emojiFx.js';
import Emoji3D from './Emoji3D.jsx';

// Premium glossy 3D emoji (see Emoji3D.jsx) that wobble in 3D while they float up or drift down.
// Mounted once in App. Pointer events pass straight through it.
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
let seq = 0;

function makePiece(kind, emojis) {
  const r = Math.random;
  const ambient = kind === 'ambient';
  const size = ambient ? 18 + r() * 8 : 22 + r() * 12;
  return {
    id: ++seq, kind,
    emoji: emojis[Math.floor(r() * emojis.length)],
    left: 4 + r() * 92,
    size,
    delay: ambient ? 0 : r() * 1.4,
    dur: kind === 'fall' ? 4.6 + r() * 2.4 : kind === 'float' ? 5.2 + r() * 2.8 : 9 + r() * 5,
    dx: (r() - 0.5) * 90,
    sway: 6 + r() * 12,
    swayDur: 1.8 + r() * 1.6,
    turn: 3.4 + r() * 3,
    spin: (r() < 0.5 ? -1 : 1) * 360,
    rx: 14 + Math.round(r() * 22),
    glow: ['255,214,90', '255,150,200', '120,220,255', '170,255,160'][Math.floor(r() * 4)],
  };
}

export default function EmojiRain() {
  const [pieces, setPieces] = useState([]);
  const timers = useRef(new Set());

  const add = (list) => {
    if (!list.length) return;
    setPieces((p) => [...p, ...list].slice(-70));
    const longest = Math.max(...list.map((x) => x.delay + x.dur)) * 1000 + 400;
    const ids = new Set(list.map((x) => x.id));
    const t = setTimeout(() => { timers.current.delete(t); setPieces((p) => p.filter((x) => !ids.has(x.id))); }, longest);
    timers.current.add(t);
  };

  useEffect(() => {
    const onBurst = () => {
      if (reduced()) return;
      const { emojis, style } = getEmojiFx();
      const list = [];
      for (let i = 0; i < 22; i++) {
        const kind = style === 'falling' ? 'fall' : style === 'floating' ? 'float' : (i % 2 ? 'fall' : 'float');
        list.push(makePiece(kind, emojis));
      }
      add(list);
    };
    window.addEventListener('chex:emoji-burst', onBurst);
    return () => window.removeEventListener('chex:emoji-burst', onBurst);
  }, []);

  // Gentle ambient floating while the setting is on (pauses when the tab is hidden).
  useEffect(() => {
    let iv = null;
    const sync = () => {
      clearInterval(iv); iv = null;
      if (!getEmojiFx().ambient || reduced()) return;
      iv = setInterval(() => {
        if (document.hidden) return;
        add([makePiece('ambient', getEmojiFx().emojis)]);
      }, 1100);
    };
    sync();
    window.addEventListener('chex:emoji-fx-changed', sync);
    return () => { clearInterval(iv); window.removeEventListener('chex:emoji-fx-changed', sync); };
  }, []);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  if (!pieces.length || typeof document === 'undefined') return null;
  return createPortal(
    <div className="ef-root" aria-hidden="true">
      {pieces.map((p) => (
        <span key={p.id} className={`ef-piece ef-${p.kind}`}
          style={{ left: `${p.left}%`, fontSize: p.size, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, '--dx': `${p.dx}px`, '--sway': `${p.sway}px`, '--swayDur': `${p.swayDur}s`, '--turn': `${p.turn}s`, '--spin': `${Math.round(18 + Math.abs(p.spin) / 24)}deg`, '--rx': `${Math.round(p.rx / 2.2)}deg`, '--glow': p.glow, '--delay': `${p.delay}s` }}>
          <b className="ef-sway"><i className="ef-body"><Emoji3D char={p.emoji} size={p.size} /></i></b>
        </span>
      ))}
    </div>,
    document.body,
  );
}
