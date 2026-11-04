import { useId } from 'react';

// Glossy "inflated 3D" emoji (shaded sphere, soft rim shadow, specular gloss) drawn as SVG.
// Faces and common objects are drawn by hand below. Any other emoji (typed by the user) is put on
// a matching glossy pearl bubble, so every emoji in the effect has the same 3D look.
const DARK = '#4a2208';
const strip = (c) => String(c || '').replace(/\uFE0F/g, '');
const ALIAS = { '❤': 'heart', '💖': 'heart', '💗': 'heart', '💕': 'heart', '💓': 'heart', '♥': 'heart', '🌟': '⭐' };

const star = (cx, cy, ro, ri, n = 5) => Array.from({ length: n * 2 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / n; const r = i % 2 ? ri : ro;
  return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
}).join(' ');

const HEART = 'M0 9 C-15 -3 -11 -17 0 -9 C11 -17 15 -3 0 9Z';

function defs(u, tone) {
  const face = {
    yellow: ['#fff3a0', '#ffcc2e', '#e98a06'],
    red: ['#ffc09a', '#ff6a3a', '#cf2316'],
  }[tone] || ['#fff3a0', '#ffcc2e', '#e98a06'];
  return (
    <defs>
      <radialGradient id={`${u}f`} cx=".36" cy=".27" r=".9"><stop offset="0" stopColor={face[0]} /><stop offset=".45" stopColor={face[1]} /><stop offset="1" stopColor={face[2]} /></radialGradient>
      <radialGradient id={`${u}r`} cx=".5" cy=".46" r=".52"><stop offset=".72" stopColor="#7a3a00" stopOpacity="0" /><stop offset="1" stopColor="#7a3a00" stopOpacity=".38" /></radialGradient>
      <radialGradient id={`${u}g`} cx=".4" cy=".3" r=".75"><stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${u}h`} cx=".35" cy=".28" r=".85"><stop offset="0" stopColor="#ffa3b8" /><stop offset=".5" stopColor="#ff3d62" /><stop offset="1" stopColor="#c4153b" /></radialGradient>
      <radialGradient id={`${u}t`} cx=".35" cy=".28" r=".9"><stop offset="0" stopColor="#bdf0ff" /><stop offset=".55" stopColor="#38a8ff" /><stop offset="1" stopColor="#1b6fd6" /></radialGradient>
      <radialGradient id={`${u}y`} cx=".35" cy=".28" r=".9"><stop offset="0" stopColor="#fff6a8" /><stop offset=".5" stopColor="#ffc400" stopOpacity="1" /><stop offset="1" stopColor="#e08a00" /></radialGradient>
      <radialGradient id={`${u}o`} cx=".5" cy=".7" r=".8"><stop offset="0" stopColor="#ffe45c" /><stop offset=".45" stopColor="#ff9a1f" /><stop offset="1" stopColor="#ee3d12" /></radialGradient>
      <linearGradient id={`${u}p`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff8ad0" /><stop offset="1" stopColor="#7b6bff" /></linearGradient>
      <linearGradient id={`${u}k`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4a4a58" /><stop offset="1" stopColor="#0c0c12" /></linearGradient>
      <clipPath id={`${u}m`}><path d="M27 58 Q50 62 73 58 Q71 84 50 84 Q29 84 27 58 Z" /></clipPath>
    </defs>
  );
}

const Eye = ({ x, y = 44 }) => <g><ellipse cx={x} cy={y} rx="5" ry="6.6" fill={DARK} /><circle cx={x - 1.6} cy={y - 2.6} r="1.9" fill="#fff" opacity=".9" /></g>;
const Happy = ({ x, y = 46 }) => <path d={`M${x - 8} ${y + 3} Q${x} ${y - 9} ${x + 8} ${y + 3}`} stroke={DARK} strokeWidth="3.8" strokeLinecap="round" fill="none" />;
const Smile = () => <path d="M32 62 Q50 79 68 62" stroke={DARK} strokeWidth="4" strokeLinecap="round" fill="none" />;
const Frown = () => <path d="M34 76 Q50 62 66 76" stroke={DARK} strokeWidth="4" strokeLinecap="round" fill="none" />;
const Grin = ({ u }) => (
  <g>
    <path d="M27 58 Q50 62 73 58 Q71 84 50 84 Q29 84 27 58 Z" fill="#7a2410" />
    <g clipPath={`url(#${u}m)`}><ellipse cx="50" cy="83" rx="13" ry="8" fill="#ff7a8a" /><path d="M20 55 Q50 61 80 55 L80 66 Q50 72 20 66 Z" fill="#fff" /></g>
  </g>
);
const Heart = ({ u, x, y, s = 1 }) => <g transform={`translate(${x} ${y}) scale(${s})`}><path d={HEART} fill={`url(#${u}h)`} /><ellipse cx="-4.5" cy="-8" rx="3.2" ry="1.8" fill="#fff" opacity=".7" transform="rotate(-30 -4.5 -8)" /></g>;
const Tear = ({ u, x, y, s = 1 }) => <g transform={`translate(${x} ${y}) scale(${s})`}><path d="M0 -9 C7 0 9 6 0 10 C-9 6 -7 0 0 -9Z" fill={`url(#${u}t)`} /><ellipse cx="-2.5" cy="-1" rx="1.6" ry="3" fill="#fff" opacity=".7" /></g>;

const Face = ({ u, tone, children, over }) => (
  <>
    {defs(u, tone)}
    <circle cx="50" cy="50" r="45" fill={`url(#${u}f)`} />
    <circle cx="50" cy="50" r="45" fill={`url(#${u}r)`} />
    {children}
    <ellipse cx="35" cy="24" rx="21" ry="11" fill={`url(#${u}g)`} transform="rotate(-24 35 24)" />
    {over}
  </>
);

const ART = {
  '😀': (u) => <Face u={u}><Eye x={36} /><Eye x={64} /><Grin u={u} /></Face>,
  '😄': (u) => <Face u={u}><Happy x={34} /><Happy x={66} /><Grin u={u} /></Face>,
  '😍': (u) => <Face u={u}><Heart u={u} x={34} y={42} s={1.5} /><Heart u={u} x={66} y={42} s={1.5} /><Grin u={u} /></Face>,
  '🥰': (u) => <Face u={u} over={<><Heart u={u} x={80} y={20} s={1} /><Heart u={u} x={14} y={66} s={1} /><Heart u={u} x={84} y={78} s={1} /></>}><Eye x={36} /><Eye x={64} /><Smile /></Face>,
  '😂': (u) => <Face u={u} over={<><Tear u={u} x={13} y={58} s={1.5} /><Tear u={u} x={87} y={58} s={1.5} /></>}><path d="M24 36 L40 44 L24 52" stroke={DARK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M76 36 L60 44 L76 52" stroke={DARK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><Grin u={u} /></Face>,
  '😋': (u) => <Face u={u}><Happy x={34} /><Happy x={66} /><Smile /><path d="M54 68 Q70 66 70 78 Q68 90 60 87 Q52 82 54 68Z" fill="#ff6f88" /><path d="M62 72 L62 82" stroke="#d9435f" strokeWidth="2" strokeLinecap="round" /></Face>,
  '😎': (u) => <Face u={u}><Smile /><path d="M17 38 H83 V47 Q83 62 66 62 Q53 62 51 47 H49 Q47 62 34 62 Q17 62 17 47Z" fill={`url(#${u}k)`} /><path d="M24 42 Q32 40 40 42" stroke="#fff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" fill="none" /><path d="M58 42 Q66 40 74 42" stroke="#fff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" fill="none" /></Face>,
  '😉': (u) => <Face u={u}><Eye x={36} /><Happy x={64} /><Smile /></Face>,
  '🤩': (u) => <Face u={u}><polygon points={star(34, 42, 13, 5.5)} fill="#ff8a1f" stroke="#ffd23f" strokeWidth="2" strokeLinejoin="round" /><polygon points={star(66, 42, 13, 5.5)} fill="#ff8a1f" stroke="#ffd23f" strokeWidth="2" strokeLinejoin="round" /><Grin u={u} /></Face>,
  '🥳': (u) => <Face u={u} over={<g transform="rotate(16 50 18)"><path d="M50 -6 L72 28 Q50 36 28 28Z" fill={`url(#${u}p)`} /><circle cx="50" cy="-6" r="6" fill="#ffd23f" /><circle cx="44" cy="16" r="3" fill="#fff" opacity=".8" /><circle cx="56" cy="22" r="3" fill="#ffd23f" /></g>}><Happy x={34} y={50} /><Happy x={66} y={50} /><Grin u={u} /></Face>,
  '😭': (u) => <Face u={u} over={<><path d="M22 46 Q17 72 20 90 Q28 94 36 90 Q36 68 38 50Z" fill={`url(#${u}t)`} opacity=".92" /><path d="M78 46 Q83 72 80 90 Q72 94 64 90 Q64 68 62 50Z" fill={`url(#${u}t)`} opacity=".92" /></>}><path d="M26 44 Q34 36 42 44" stroke={DARK} strokeWidth="3.8" strokeLinecap="round" fill="none" /><path d="M58 44 Q66 36 74 44" stroke={DARK} strokeWidth="3.8" strokeLinecap="round" fill="none" /><path d="M36 70 Q50 58 64 70 Q62 86 50 86 Q38 86 36 70Z" fill="#7a2410" /><ellipse cx="50" cy="82" rx="8" ry="4.5" fill="#ff7a8a" /></Face>,
  '😢': (u) => <Face u={u} over={<Tear u={u} x={72} y={62} s={1.3} />}><path d="M26 34 Q36 30 44 38" stroke={DARK} strokeWidth="3.6" strokeLinecap="round" fill="none" /><path d="M74 34 Q64 30 56 38" stroke={DARK} strokeWidth="3.6" strokeLinecap="round" fill="none" /><Eye x={36} y={48} /><Eye x={64} y={48} /><Frown /></Face>,
  '😠': (u) => <Face u={u} tone="red"><path d="M24 32 L44 42" stroke={DARK} strokeWidth="5.5" strokeLinecap="round" /><path d="M76 32 L56 42" stroke={DARK} strokeWidth="5.5" strokeLinecap="round" /><ellipse cx="36" cy="49" rx="5" ry="5.6" fill={DARK} /><ellipse cx="64" cy="49" rx="5" ry="5.6" fill={DARK} /><Frown /></Face>,
  '😮': (u) => <Face u={u}><Eye x={36} /><Eye x={64} /><ellipse cx="50" cy="72" rx="8" ry="10.5" fill="#7a2410" /><ellipse cx="50" cy="77" rx="5" ry="3.8" fill="#ff7a8a" /></Face>,

  heart: (u) => <>{defs(u)}<path d="M50 90 C6 58 12 16 36 18 C44 19 48 25 50 31 C52 25 56 19 64 18 C88 16 94 58 50 90Z" fill={`url(#${u}h)`} /><ellipse cx="32" cy="30" rx="12" ry="6.5" fill="#fff" opacity=".6" transform="rotate(-35 32 30)" /></>,
  '⭐': (u) => <>{defs(u)}<polygon points={star(50, 54, 46, 21)} fill={`url(#${u}y)`} stroke="#ffb300" strokeWidth="6" strokeLinejoin="round" /><ellipse cx="40" cy="36" rx="11" ry="5.5" fill="#fff" opacity=".6" transform="rotate(-35 40 36)" /></>,
  '🔥': (u) => <>{defs(u)}<path d="M50 4 C56 24 82 34 82 62 C82 82 68 94 50 94 C32 94 18 82 18 62 C18 46 28 40 32 28 C37 37 41 40 43 40 C42 27 44 15 50 4Z" fill={`url(#${u}o)`} /><path d="M50 46 C56 58 68 64 68 76 C68 86 60 92 50 92 C40 92 32 86 32 76 C32 66 44 60 50 46Z" fill="#ffe45c" opacity=".92" /><ellipse cx="36" cy="58" rx="4" ry="9" fill="#fff" opacity=".4" transform="rotate(15 36 58)" /></>,
  '🔔': (u) => <>{defs(u)}<path d="M50 8 C58 8 62 13 62 19 C80 23 84 42 84 60 L93 76 L7 76 L16 60 C16 42 20 23 38 19 C38 13 42 8 50 8Z" fill={`url(#${u}y)`} /><ellipse cx="50" cy="83" rx="10" ry="9" fill="#e08a00" /><ellipse cx="34" cy="40" rx="6" ry="14" fill="#fff" opacity=".5" transform="rotate(12 34 40)" /></>,
  '✨': (u) => <>{defs(u)}<path d="M50 4 Q54 46 96 50 Q54 54 50 96 Q46 54 4 50 Q46 46 50 4Z" fill={`url(#${u}y)`} /><g transform="translate(80 20) scale(.32)"><path d="M0 -50 Q4 -4 50 0 Q4 4 0 50 Q-4 4 -50 0 Q-4 -4 0 -50Z" fill="#ffd84d" /></g><g transform="translate(22 80) scale(.26)"><path d="M0 -50 Q4 -4 50 0 Q4 4 0 50 Q-4 4 -50 0 Q-4 -4 0 -50Z" fill="#ffd84d" /></g></>,
  '💎': (u) => <>{defs(u)}<path d="M24 20 H76 L96 44 L50 94 L4 44Z" fill={`url(#${u}t)`} /><path d="M24 20 L36 44 L50 94 L4 44Z" fill="#fff" opacity=".18" /><path d="M24 20 H76 L64 44 H36Z" fill="#fff" opacity=".35" /><path d="M4 44 H96 M36 44 L50 94 L64 44 M24 20 L36 44 M76 20 L64 44" stroke="#fff" strokeOpacity=".55" strokeWidth="2" fill="none" strokeLinejoin="round" /></>,
  '🪙': (u) => <>{defs(u)}<circle cx="50" cy="50" r="45" fill={`url(#${u}y)`} /><circle cx="50" cy="50" r="33" fill="none" stroke="#c98400" strokeWidth="4" /><polygon points={star(50, 52, 18, 8)} fill="#fff1a0" stroke="#d99000" strokeWidth="2" strokeLinejoin="round" /><ellipse cx="34" cy="26" rx="18" ry="8" fill="#fff" opacity=".5" transform="rotate(-30 34 26)" /></>,
  '🎈': (u) => <>{defs(u)}<path d="M50 94 Q38 98 50 100 M50 84 Q42 92 50 98" stroke="#9aa0b5" strokeWidth="2" fill="none" /><path d="M44 82 L50 76 L56 82Z" fill="#d91e3a" /><ellipse cx="50" cy="42" rx="34" ry="40" fill={`url(#${u}h)`} /><ellipse cx="36" cy="26" rx="9" ry="14" fill="#fff" opacity=".55" transform="rotate(25 36 26)" /></>,
  '🏆': (u) => <>{defs(u)}<path d="M30 8 H70 V38 C70 58 62 68 50 68 C38 68 30 58 30 38Z" fill={`url(#${u}y)`} /><path d="M30 18 H15 C13 38 22 48 33 50 M70 18 H85 C87 38 78 48 67 50" stroke="#f0a000" strokeWidth="6" strokeLinecap="round" fill="none" /><rect x="43" y="68" width="14" height="13" fill="#e08a00" /><path d="M28 94 L33 80 H67 L72 94Z" fill={`url(#${u}y)`} /><ellipse cx="40" cy="30" rx="5" ry="14" fill="#fff" opacity=".5" transform="rotate(8 40 30)" /></>,
};

export const EMOJI_3D_KEYS = Object.keys(ART).filter((k) => k.length > 1 || k.codePointAt(0) > 255);
export const hasArt = (ch) => !!ART[ALIAS[strip(ch)] || strip(ch)];

// <Emoji3D char="😍" size={28} /> — sized in px, block-level inline element.
export default function Emoji3D({ char, size = 28, className = '' }) {
  const u = `e3${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const key = ALIAS[strip(char)] || strip(char);
  const art = ART[key];
  if (art) {
    return <svg className={`e3 ${className}`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={char} style={{ overflow: 'visible' }}>{art(u)}</svg>;
  }
  return (
    <span className={`e3 e3-bubble ${className}`} role="img" aria-label={char} style={{ width: size, height: size, fontSize: size }}>
      <span>{char}</span>
    </span>
  );
}
