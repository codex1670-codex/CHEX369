// Matching line icons for the permissions list, each on its own soft gradient tile
// (the emoji versions looked uneven: a black-and-white camera, a tiny red pin, a dark mic…).
const S = { fill: 'none', stroke: '#fff', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
const TILE = {
  notifications: ['#ffd25e', '#f59e0b'], microphone: ['#ff8fb1', '#e0457b'], camera: ['#7fb0ff', '#3f6fe0'],
  location: ['#ff9d8a', '#e5484d'], clipboard: ['#5fe7d2', '#14b8a6'], storage: ['#b79bff', '#7c5cf0'], gallery: ['#8ee08f', '#2fa84f'],
};
const G = {
  notifications: (<><path d="M17.8 8.4a5.8 5.8 0 1 0-11.6 0c0 6.4-2.7 8-2.7 8h17s-2.7-1.6-2.7-8z" /><path d="M13.6 19.8a2 2 0 0 1-3.2 0" /></>),
  microphone: (<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>),
  camera: (<><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.2-2h5.6L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.3" /></>),
  location: (<><path d="M12 21s6.5-5.6 6.5-11A6.5 6.5 0 0 0 5.5 10C5.5 15.4 12 21 12 21z" /><circle cx="12" cy="10" r="2.4" /></>),
  clipboard: (<><rect x="6" y="4.5" width="12" height="16" rx="2.2" /><path d="M9.5 4.5h5v2.4h-5zM9 12h6M9 15.5h4" /></>),
  storage: (<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>),
  gallery: (<><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3L16 12l4.5 5" /></>),
};

export default function PermIcon({ name }) {
  const g = G[name]; if (!g) return null;
  const [a, b] = TILE[name];
  return (
    <span className="perm-tile" style={{ background: `linear-gradient(145deg, ${a}, ${b})`, boxShadow: `0 6px 14px -6px ${b}` }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" focusable="false" {...S}>{g}</svg>
    </span>
  );
}
