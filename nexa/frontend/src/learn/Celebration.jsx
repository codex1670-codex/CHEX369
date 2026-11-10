import { useMemo } from 'react';
import CoinLogo from './CoinLogo.jsx';

const COLORS = ['#ffd23f', '#ff7a59', '#3bb36f', '#4cc9f0', '#b388ff', '#ff5ca8'];

// Duolingo-style finish: confetti burst, a bouncing trophy-star with sparkles, and (when a section is done) raining CHEX coins.
export default function Celebration({ coins = false }) {
  const bits = useMemo(() => Array.from({ length: 46 }, (_, i) => ({
    left: Math.round(Math.random() * 100), delay: (Math.random() * 0.7).toFixed(2), dur: (2.2 + Math.random() * 1.8).toFixed(2),
    rot: Math.round(Math.random() * 720), color: COLORS[i % COLORS.length], w: 6 + Math.round(Math.random() * 7), round: i % 3 === 0,
  })), []);
  const rain = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ left: 6 + i * 11 + Math.round(Math.random() * 5), delay: (i * 0.18).toFixed(2), size: 22 + (i % 3) * 8 })), []);
  return (
    <div className="learn-celebrate" aria-hidden="true">
      {bits.map((b, i) => <i key={i} className="learn-confetti" style={{ left: `${b.left}%`, background: b.color, width: b.w, height: b.round ? b.w : b.w * 1.8, borderRadius: b.round ? '50%' : 2, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, '--rot': `${b.rot}deg` }} />)}
      {coins && rain.map((c, i) => <span key={i} className="learn-coinrain" style={{ left: `${c.left}%`, animationDelay: `${c.delay}s` }}><CoinLogo size={c.size} spin /></span>)}
    </div>
  );
}

export function Trophy({ size = 130 }) {
  return (
    <div className="learn-trophy" style={{ width: size, height: size }}>
      <span className="learn-ring" /><span className="learn-ring r2" />
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <defs><linearGradient id="lt-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff1b3" /><stop offset=".5" stopColor="#ffc83d" /><stop offset="1" stopColor="#ff9a1f" /></linearGradient></defs>
        <path d="M32 4l7.6 15.4 17 2.5-12.3 12 2.9 16.9L32 42.8l-15.2 8 2.9-16.9-12.3-12 17-2.5z" fill="url(#lt-g)" stroke="#e88a10" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="learn-spark s1">✦</span><span className="learn-spark s2">✦</span><span className="learn-spark s3">✦</span>
    </div>
  );
}
