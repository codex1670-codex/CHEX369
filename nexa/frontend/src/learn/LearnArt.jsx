import { useId } from 'react';
// CHEX learn — artwork: the purple owl mascot, the CHEX Learn book logo and glossy icons.
// Everything is inline SVG so it stays sharp at any size and can be animated with CSS.

/* Owl mascot. mood: 'happy' (default) | 'sad' | 'cheer'. cap shows the graduation cap. */
export function Owl({ size = 90, mood = 'happy', cap = true, className = '' }) {
  const u = useId().replace(/:/g, '');
  const sad = mood === 'sad';
  return (
    <svg viewBox="0 0 200 210" width={size} height={size} role="img" aria-label="CHEX learn owl" className={`lx-owl ${mood} ${className}`}>
      <defs>
        <linearGradient id={`ow-body${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9a63ff" /><stop offset="1" stopColor="#5b2bd6" /></linearGradient>
        <linearGradient id={`ow-hood${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b2358" /><stop offset="1" stopColor="#15102f" /></linearGradient>
        <linearGradient id={`ow-beak${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffc24a" /><stop offset="1" stopColor="#ff8a1f" /></linearGradient>
        <linearGradient id={`ow-cap${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a2f6e" /><stop offset="1" stopColor="#1a1338" /></linearGradient>
        <radialGradient id={`ow-face${u}`} cx=".5" cy=".4" r=".7"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#ece6ff" /></radialGradient>
      </defs>
      <ellipse cx="100" cy="203" rx="48" ry="6" fill="#2a1a6b" opacity=".18" className="lx-owl-shadow" />
      <g className="lx-owl-body">
        {/* feet */}
        <ellipse cx="80" cy="190" rx="15" ry="7" fill={`url(#ow-beak${u})`} /><ellipse cx="120" cy="190" rx="15" ry="7" fill={`url(#ow-beak${u})`} />
        {/* hoodie body */}
        <path d="M46 128c0-20 24-30 54-30s54 10 54 30v44c0 14-20 20-54 20s-54-6-54-20z" fill={`url(#ow-hood${u})`} />
        <text x="100" y="160" textAnchor="middle" fontFamily="Nunito, system-ui, sans-serif" fontWeight="900" fontSize="17" fill="#fff" letterSpacing="1">CHEX<tspan fill="#ffc83d">★</tspan></text>
        {/* wings */}
        <path className="lx-owl-wing l" d="M44 112c-18 10-22 40-8 56 8-4 16-18 18-34z" fill={`url(#ow-body${u})`} />
        <path className="lx-owl-wing r" d="M156 112c18 10 22 40 8 56-8-4-16-18-18-34z" fill={`url(#ow-body${u})`} />
        {/* head */}
        <path d="M100 30C58 30 38 56 38 88c0 28 26 48 62 48s62-20 62-48c0-32-20-58-62-58z" fill={`url(#ow-body${u})`} />
        <path d="M52 44l-6-20 24 12zM148 44l6-20-24 12z" fill="#7a45f0" />
        {/* face */}
        <ellipse cx="72" cy="86" rx="31" ry="33" fill={`url(#ow-face${u})`} /><ellipse cx="128" cy="86" rx="31" ry="33" fill={`url(#ow-face${u})`} />
        <g className="lx-owl-eyes">
          <ellipse cx="74" cy={sad ? 90 : 88} rx="17" ry="20" fill="#1b1340" /><ellipse cx="126" cy={sad ? 90 : 88} rx="17" ry="20" fill="#1b1340" />
          <circle cx="68" cy="80" r="6.5" fill="#fff" /><circle cx="120" cy="80" r="6.5" fill="#fff" />
          <circle cx="81" cy="96" r="3" fill="#fff" opacity=".8" /><circle cx="133" cy="96" r="3" fill="#fff" opacity=".8" />
        </g>
        {sad && <><path d="M54 62l36 10" stroke="#1b1340" strokeWidth="5" strokeLinecap="round" /><path d="M146 62l-36 10" stroke="#1b1340" strokeWidth="5" strokeLinecap="round" /></>}
        <ellipse cx="50" cy="108" rx="9" ry="6" fill="#ff8fc1" opacity=".55" /><ellipse cx="150" cy="108" rx="9" ry="6" fill="#ff8fc1" opacity=".55" />
        {/* beak */}
        <path d="M86 100c4-8 24-8 28 0-2 12-10 22-14 22s-12-10-14-22z" fill={`url(#ow-beak${u})`} />
        {!sad && <path d="M92 114c4 6 12 6 16 0-4 2-12 2-16 0z" fill="#d9531e" opacity=".85" />}
        {sad && <path d="M92 118c4-5 12-5 16 0" stroke="#b34312" strokeWidth="3" fill="none" strokeLinecap="round" />}
        {/* graduation cap */}
        {cap && (
          <g className="lx-owl-cap">
            <path d="M62 38l38-16 38 16-38 16z" fill={`url(#ow-cap${u})`} /><path d="M78 46v14c0 6 44 6 44 0V46l-22 9z" fill="#120d2b" />
            <path d="M100 22l38 16" stroke="#000" strokeOpacity=".15" strokeWidth="1" />
            <path d="M132 40v26" stroke="#ffc83d" strokeWidth="3" strokeLinecap="round" /><path d="M126 64h12l-2 16h-8z" fill="#ffc83d" />
            <circle cx="100" cy="38" r="3.5" fill="#ffc83d" />
          </g>
        )}
      </g>
    </svg>
  );
}

/* CHEX Learn logo: an open book with a star. */
export function BookLogo({ size = 44 }) {
  const u = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="lx-booklogo">
      <defs>
        <linearGradient id={`bk-a${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6c8cff" /><stop offset="1" stopColor="#7b3ff2" /></linearGradient>
        <linearGradient id={`bk-b${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c7b2ff" /><stop offset="1" stopColor="#8d5cf5" /></linearGradient>
      </defs>
      <path d="M6 16c10-4 20-3 26 3v34C26 47 16 46 6 50z" fill={`url(#bk-a${u})`} /><path d="M58 16c-10-4-20-3-26 3v34c6-6 16-7 26-3z" fill={`url(#bk-b${u})`} />
      <path d="M13 24c5-1 10 0 14 2M13 31c5-1 10 0 14 2M13 38c5-1 10 0 14 2" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".9" />
      <path d="M44 4l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#ffc83d" stroke="#e88a10" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

/* Glossy blue diamond used for XP. */
export function Gem({ size = 34 }) {
  const u = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="lx-gem">
      <defs><linearGradient id={`gm-a${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9be7ff" /><stop offset=".55" stopColor="#2aa7ff" /><stop offset="1" stopColor="#1463e0" /></linearGradient></defs>
      <path d="M16 8h32l12 16-28 34L4 24z" fill={`url(#gm-a${u})`} stroke="#0e4fb8" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 24h56M22 24l10 34 10-34M16 8l6 16 10-16 10 16 6-16" stroke="#fff" strokeOpacity=".55" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

/* Glossy heart. */
export function Heart({ size = 26 }) {
  const u = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="lx-heart">
      <defs><linearGradient id={`ht-a${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff7ab0" /><stop offset="1" stopColor="#e3195f" /></linearGradient></defs>
      <path d="M32 58C10 42 4 30 4 21 4 12 11 6 19 6c6 0 10 3 13 8 3-5 7-8 13-8 8 0 15 6 15 15 0 9-6 21-28 37z" fill={`url(#ht-a${u})`} stroke="#b80f4a" strokeWidth="1.5" />
      <ellipse cx="20" cy="19" rx="7" ry="4" fill="#fff" opacity=".55" transform="rotate(-30 20 19)" />
    </svg>
  );
}

/* Gold crown for the premium banner. */
export function Crown({ size = 60 }) {
  const u = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="lx-crown">
      <defs><linearGradient id={`cr-a${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff1b3" /><stop offset=".5" stopColor="#ffc83d" /><stop offset="1" stopColor="#ff9a1f" /></linearGradient></defs>
      <path d="M6 22l14 12 12-20 12 20 14-12-6 32H12z" fill={`url(#cr-a${u})`} stroke="#d97a06" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="6" cy="21" r="4" fill="#ffd23f" stroke="#d97a06" strokeWidth="1.5" /><circle cx="32" cy="12" r="4" fill="#ffd23f" stroke="#d97a06" strokeWidth="1.5" /><circle cx="58" cy="21" r="4" fill="#ffd23f" stroke="#d97a06" strokeWidth="1.5" />
      <path d="M32 36l3 5-3 5-3-5z" fill="#ff8a1f" />
    </svg>
  );
}

/* Speaker button icon (lesson). */
export function Speaker({ size = 30 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M4 12h5l7-6v20l-7-6H4z" fill="#fff" />
      <path d="M21 11c2 3 2 7 0 10M25 7c4 5 4 13 0 18" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" className="lx-waves" />
    </svg>
  );
}

/* Landscape behind the owl on the home screen: sky, clouds, hills, trees and a tower. */
export function Scene() {
  const u = useId().replace(/:/g, '');
  return (
    <svg className="lx-scene" viewBox="0 0 800 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id={`sc-sky${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6fc3ff" /><stop offset=".7" stopColor="#cfe8ff" /><stop offset="1" stopColor="#f1ecff" /></linearGradient>
        <linearGradient id={`sc-hill${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fe06a" /><stop offset="1" stopColor="#4fb84a" /></linearGradient>
      </defs>
      <rect width="800" height="300" fill={`url(#sc-sky${u})`} />
      <g fill="#fff" opacity=".95"><g className="lx-cloud c1"><ellipse cx="120" cy="60" rx="46" ry="16" /><ellipse cx="150" cy="48" rx="30" ry="18" /></g><g className="lx-cloud c2"><ellipse cx="640" cy="40" rx="52" ry="16" /><ellipse cx="610" cy="30" rx="26" ry="14" /></g></g>
      <g fill="#b9a6f5" opacity=".75"><path d="M300 270L318 120 322 60 326 40 330 60 334 120 352 270H340L330 160 320 270z" /><rect x="316" y="118" width="28" height="5" /></g>
      <path d="M0 250c120-50 260-40 380-10s280 20 420-20v80H0z" fill={`url(#sc-hill${u})`} />
      <path d="M0 280c160-30 300-20 440 0s260 10 360-10v30H0z" fill="#3fa63f" />
      <g><rect x="60" y="214" width="6" height="30" fill="#7a4b2a" /><circle cx="63" cy="206" r="22" fill="#2f9d44" /><rect x="740" y="206" width="6" height="34" fill="#7a4b2a" /><circle cx="743" cy="196" r="26" fill="#2f9d44" /></g>
    </svg>
  );
}
