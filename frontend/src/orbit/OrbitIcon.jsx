import { CoinLogo } from '../components/NavIcon.jsx';

// Line icons for ORBIT. Drawn as SVG (not emoji) so they render on every phone and Windows PC.
const P = {
  home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></>,
  chat: <><path d="M4 5.5h16v10.5H9.5L5.5 19.5V16H4z" /><path d="M8 10h8M8 12.8h5" /></>,
  codex: <><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" /><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>,
  reels: <><rect x="4" y="3.5" width="16" height="17" rx="3.5" /><path d="M4 9h16M9.5 3.5 8 9M15.5 3.5 14 9" /><path d="M10.5 12.5v4.5l4-2.25z" /></>,
  gallery: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.7" /><path d="M4 17l4.8-4.6 3.4 3.2 3-2.8L20 16.5" /></>,
  profile: <><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20c.7-3.7 3.4-5.6 7-5.6s6.3 1.9 7 5.6" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  search: <><circle cx="11" cy="11" r="6.2" /><path d="M15.6 15.6 20 20" /></>,
  games: <><rect x="3" y="7.5" width="18" height="10" rx="5" /><path d="M8 10.5v4M6 12.5h4" /><circle cx="15.5" cy="11.5" r=".9" /><circle cx="17.8" cy="13.6" r=".9" /></>,
  learn: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z" /></>,
  cube: <><path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8z" /><path d="M4.5 8 12 12.5 19.5 8M12 12.5v8" /></>,
  note: <><path d="M5 4.5h14v10l-5 5H5z" /><path d="M14 19.5v-5h5" /><path d="M8.5 9h7M8.5 12h4" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><circle cx="12" cy="15" r="1.2" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.6M12 17.9v2.6M3.5 12h2.6M17.9 12h2.6M6 6l1.8 1.8M16.2 16.2 18 18M18 6l-1.8 1.8M7.8 16.2 6 18" /></>,
  shield: <><path d="M12 3.5 19 6v5.5c0 4.4-2.9 7.4-7 9-4.1-1.6-7-4.6-7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
  lasso: <><ellipse cx="12" cy="10" rx="7.5" ry="5.5" /><path d="M7.5 14.2c-.6 2 .1 3.6 1.6 4.3" /><circle cx="9.6" cy="19" r="1.3" /></>,
  volume: <><path d="M4.5 9.5h3.5L12.5 5.5v13L8 14.5H4.5z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /></>,
  mute: <><path d="M4.5 9.5h3.5L12.5 5.5v13L8 14.5H4.5z" /><path d="m16 9.5 4 5M20 9.5l-4 5" /></>,
  cube3: <><path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8z" /><path d="M4.5 8 12 12.5 19.5 8M12 12.5v8" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" /></>,
  flat: <><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M4 12h16M12 5v14" /></>,
  power: <><path d="M12 3.5v8" /><path d="M6.9 7a7.4 7.4 0 1 0 10.2 0" /></>,
  coinline: <><circle cx="12" cy="12" r="8.5" /><path d="M14.9 9.3a3.6 3.6 0 1 0 0 5.4" /></>,
  camera: <><path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10H4z" /><circle cx="12" cy="13.3" r="3.4" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  up: <path d="M6 14.5 12 8.5l6 6" />,
  spark: <><path d="M12 4v4M12 16v4M4 12h4M16 12h4" /></>,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  down: <path d="M6 9.5 12 15.5l6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  reset: <><path d="M5 12a7 7 0 1 0 2.2-5.1" /><path d="M4.5 4.5v4h4" /></>,
  open: <><path d="M9 5.5h9.5V15" /><path d="M18.5 5.5 6 18" /></>,
};
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };

export default function OrbitIcon({ name, size = 24 }) {
  if (name === 'coin') return <CoinLogo size={size} />;
  const g = P[name];
  if (!g) return null;
  return <svg className="ob-svg" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...S}>{g}</svg>;
}
