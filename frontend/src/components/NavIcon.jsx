// Premium line icons for the bottom bar (replace the emoji). They inherit the button's colour via
// currentColor; the active tab gets a soft fill + a draw-in animation (see glassnav.css).
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

const ICONS = {
  feed: (
    <>
      <path className="ln fl" pathLength="1" d="M3.5 10.6 12 3.5l8.5 7.1V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.6H9.2v5.6H5A1.5 1.5 0 0 1 3.5 19z" />
    </>
  ),
  search: (
    <>
      <circle className="ln fl" pathLength="1" cx="11" cy="11" r="6.6" />
      <path className="ln" pathLength="1" d="m20 20-4.3-4.3" />
    </>
  ),
  reels: (
    <>
      <rect className="ln fl" pathLength="1" x="3.2" y="3.2" width="17.6" height="17.6" rx="5.2" />
      <path className="ln" pathLength="1" d="M3.4 8.6h17.2M9 3.4l3 5.2M14.6 3.4l3 5.2" />
      <path className="ln pl" pathLength="1" d="M10.4 12.4v4.6l4-2.3z" />
    </>
  ),
  messages: (
    <>
      <path className="ln fl" pathLength="1" d="M20.6 11.4a8.4 8.4 0 0 1-12.2 7.5L3.5 20.5l1.6-4.7a8.4 8.4 0 1 1 15.5-4.4z" />
      <path className="ln" pathLength="1" d="M8.6 11.6h.01M12 11.6h.01M15.4 11.6h.01" strokeWidth="2.4" />
    </>
  ),
  notifications: (
    <>
      <path className="ln fl" pathLength="1" d="M17.8 8.4a5.8 5.8 0 1 0-11.6 0c0 6.4-2.7 8-2.7 8h17s-2.7-1.6-2.7-8z" />
      <path className="ln" pathLength="1" d="M13.6 19.8a2 2 0 0 1-3.2 0" />
    </>
  ),
  games: (
    <>
      <path className="ln fl" pathLength="1" d="M6.2 7.8h11.6a4.2 4.2 0 0 1 4.1 3.5l.7 4.3a2.6 2.6 0 0 1-4.5 2.1l-1.6-2H7.5l-1.6 2a2.6 2.6 0 0 1-4.5-2.1l.7-4.3a4.2 4.2 0 0 1 4.1-3.5z" />
      <path className="ln" pathLength="1" d="M8 10.8v3.2M6.4 12.4h3.2" />
      <path className="ln" pathLength="1" d="M15.6 11.4h.01M17.8 13.4h.01" strokeWidth="2.4" />
    </>
  ),
  profile: (
    <>
      <circle className="ln fl" pathLength="1" cx="12" cy="8" r="4.1" />
      <path className="ln fl" pathLength="1" d="M4.2 20.4c.6-3.7 3.6-5.9 7.8-5.9s7.2 2.2 7.8 5.9" />
    </>
  ),
  more: (
    <>
      <path className="ln" pathLength="1" d="M5.5 12h.01M12 12h.01M18.5 12h.01" strokeWidth="3" />
    </>
  ),
};

export default function NavIcon({ name }) {
  const g = ICONS[name];
  if (!g) return null;
  return <svg className="nb-svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" {...S}>{g}</svg>;
}

// Gold CHEX coin (the 🪙 emoji is missing on many Windows PCs and shows as an empty box).
export function CoinLogo({ size = 24 }) {
  return (
    <svg className="coin-logo" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="gnCoinFace" x1="6" y1="3" x2="26" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff0a8" /><stop offset=".45" stopColor="#ffc933" /><stop offset="1" stopColor="#e08a00" />
        </linearGradient>
        <linearGradient id="gnCoinRim" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffe58a" /><stop offset="1" stopColor="#b86b00" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#gnCoinRim)" />
      <circle cx="16" cy="16" r="11.4" fill="url(#gnCoinFace)" stroke="#a85f00" strokeOpacity=".55" strokeWidth=".8" />
      <circle cx="16" cy="16" r="8.6" fill="none" stroke="#fff6c9" strokeOpacity=".7" strokeWidth=".9" strokeDasharray="1.2 1.6" />
      <path d="M19.6 12.4A5 5 0 1 0 19.6 19.6" fill="none" stroke="#8a4b00" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8.5 9.5a9.6 9.6 0 0 1 8.6-5" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Power / log-out icon (the ⏻ character is missing on many Windows PCs).
export function PowerIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...S}>
      <path d="M12 3.2v8.1" />
      <path d="M6.9 6.9a7.6 7.6 0 1 0 10.2 0" />
    </svg>
  );
}
