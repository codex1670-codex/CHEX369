// CHEX ORBIT — settings, device capability checks and the double-tap detector.
//
// ORBIT is the 3D spatial launcher: double-tap (or double-click) any quiet part of any screen to open it.
// Nothing here touches the DOM on import; <Orbit> (mounted by GestureHub) does the rendering.

const KEY = 'chex.orbit';
export const ORBIT_CHANGED = 'chex:orbit-changed';
export const ORBIT_OPEN = 'chex:orbit-open';   // window.dispatchEvent(new Event(ORBIT_OPEN)) opens ORBIT from anywhere

// ---- settings (this browser only, like the other gesture settings) -------------------------------------------------
// enabled: the double-tap opens ORBIT.  mode: 'auto' (3D when the device can) | '3d' | '2d' (flat grid, no motion).
const defaults = () => ({ enabled: true, mode: 'auto' });

export function loadOrbit() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return defaults();
    return { enabled: raw.enabled !== false, mode: ['auto', '3d', '2d'].includes(raw.mode) ? raw.mode : 'auto' };
  } catch { return defaults(); }
}
export function saveOrbit(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not persisted */ }
  try { window.dispatchEvent(new Event(ORBIT_CHANGED)); } catch { /* old browser */ }
  return next;
}

// ---- capability checks -------------------------------------------------------------------------------------------
export const reducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
export const supports3D = () => {
  try { return !!(globalThis.CSS?.supports?.('transform-style', 'preserve-3d') && globalThis.CSS.supports('perspective', '1px')); } catch { return false; }
};
// Phones/PCs with very little memory or 1–2 cores get the lighter look (no live blur) from the start.
export const liteDevice = () => {
  try { return (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) || false; } catch { return false; }
};
// '3d' or '2d'. People who ask their device for reduced motion always get the flat version.
export function resolveMode(cfg = loadOrbit()) {
  if (reducedMotion()) return '2d';
  if (cfg.mode === '2d') return '2d';
  return supports3D() ? '3d' : '2d';
}

// ---- what ORBIT shows --------------------------------------------------------------------------------------------
// The big ring: the main CHEX modules.  `nav` = page key for navigate(); `codex` opens the Codex AI instead.
export const RING = [
  { id: 'feed',          label: 'Home',     hint: 'Feed, stories & notes',   icon: 'home',    hue: 212, nav: 'feed' },
  { id: 'messages',      label: 'Messages', hint: 'Chats & calls',            icon: 'chat',    hue: 188, nav: 'messages' },
  { id: 'codex',         label: 'Codex',    hint: 'Your AI assistant',        icon: 'codex',   hue: 268, codex: true },
  { id: 'reels',         label: 'Reels',    hint: 'Short videos',             icon: 'reels',   hue: 330, nav: 'reels' },
  { id: 'gallery',       label: 'Gallery',  hint: 'Your photos & videos',     icon: 'gallery', hue: 156, nav: 'profile' },
  { id: 'profile',       label: 'Profile',  hint: 'You, saved & settings',    icon: 'profile', hue: 36,  nav: 'profile' },
  { id: 'notifications', label: 'Alerts',   hint: 'Likes, follows & invites', icon: 'bell',    hue: 12,  nav: 'notifications' },
  { id: 'search',        label: 'Search',   hint: 'People, posts & reels',    icon: 'search',  hue: 240, nav: 'search' },
];
// Small floating cards under the ring: everything else in CHEX, one tap away.
export const SATELLITES = [
  { id: 'games',    label: 'Games',      icon: 'games',    nav: 'games' },
  { id: 'learn',    label: 'Learn',      icon: 'learn',    nav: 'learn' },
  { id: 'sim3d',    label: '3D',         icon: 'cube',     nav: 'sim3d' },
  { id: 'stickies', label: 'Notes',      icon: 'note',     nav: 'stickies' },
  { id: 'mylife',   label: 'Private',    icon: 'lock',     nav: 'mylife' },
  { id: 'coins',    label: 'Coins',      icon: 'coin',     nav: 'coins' },
  { id: 'settings', label: 'Settings',   icon: 'gear',     nav: 'settings' },
  { id: 'admin',    label: 'Admin',      icon: 'shield',   nav: 'admin', adminOnly: true },
];

// Which ring card matches the page you are on (so ORBIT opens facing it).
export const ringIndexForRoute = (route) => {
  const i = RING.findIndex(r => r.nav === route && r.id !== 'gallery');
  return i === -1 ? 0 : i;
};

// ---- double-tap detector -----------------------------------------------------------------------------------------
// A double tap/click is ignored on anything that already uses taps: buttons, links, form fields, photos & videos
// (double-tap = like), reels, the game boards, the camera and call screens … and on any element marked data-noorbit.
const IGNORE = [
  'a', 'button', 'input', 'textarea', 'select', 'label', 'summary', 'video', 'audio', 'canvas', 'img', 'iframe',
  '[contenteditable]', '[role="button"]', '[role="slider"]', '[role="menuitem"]', '[role="tab"]', '[data-noorbit]',
  '.reel-stage', '.post-3d', '.post-media-wrap', '.media-viewer-overlay', '.gx-fullscreen', '[class*="gm-"]',
  '.cam-overlay', '.call-screen', '.qs-back', '.ob-root',
].join(',');

export function isOrbitIgnored(target) {
  try { return !!(target && target.closest && target.closest(IGNORE)); } catch { return true; }
}

const TAP_MS = 300;        // finger/mouse down→up must be shorter than this to count as a tap
const GAP_MS = 340;        // two taps closer than this = a double tap
const SLOP = 14;           // px a tap may wobble
const NEAR = 40;           // px between the two taps

// Starts listening on `win`; calls onDouble() on a double tap. Returns stop(). `isEnabled` is checked on every tap.
export function startOrbitDoubleTap(onDouble, isEnabled = () => true, win = window) {
  let down = null;   // { x, y, t, id }
  let prev = null;   // { x, y, t }
  const onDown = (e) => {
    if ((e.button !== undefined && e.button > 0) || e.isPrimary === false) { down = null; return; }
    down = { x: e.clientX, y: e.clientY, t: Date.now(), ignored: isOrbitIgnored(e.target) };
  };
  const onUp = (e) => {
    const d = down; down = null;
    if (!d || !isEnabled()) { prev = null; return; }
    const now = Date.now();
    const tap = !d.ignored && now - d.t < TAP_MS && Math.hypot(e.clientX - d.x, e.clientY - d.y) < SLOP;
    if (!tap) { prev = null; return; }
    if (prev && now - prev.t < GAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < NEAR) {
      prev = null;
      // A mouse double-click on text selects a word: that is someone copying text, not asking for ORBIT.
      if (e.pointerType === 'mouse') { try { if (String(win.getSelection?.() || '').trim()) return; } catch { /* no selection API */ } }
      onDouble({ x: e.clientX, y: e.clientY });
    } else prev = { x: e.clientX, y: e.clientY, t: now };
  };
  const onCancel = () => { down = null; prev = null; };
  win.addEventListener('pointerdown', onDown, true);
  win.addEventListener('pointerup', onUp, true);
  win.addEventListener('pointercancel', onCancel, true);
  return () => {
    win.removeEventListener('pointerdown', onDown, true);
    win.removeEventListener('pointerup', onUp, true);
    win.removeEventListener('pointercancel', onCancel, true);
  };
}

// ---- ring maths (pure, unit-tested) ------------------------------------------------------------------------------
// Radius so n flat cards of width w just touch around a circle (slightly opened so the gaps read as glass).
export const ringRadius = (n, w, gap = 1.12) => (n < 2 ? 0 : Math.round(((w / 2) / Math.tan(Math.PI / n)) * gap));
// Which card faces the viewer when the ring is turned `theta` degrees.
export const frontIndex = (theta, n) => { const step = 360 / n; return ((Math.round(-theta / step) % n) + n) % n; };
// Smallest angle (−180…180] between card i and the front, for a ring turned `theta`.
export const angleFromFront = (i, theta, n) => { const a = (((i * (360 / n) + theta) % 360) + 540) % 360 - 180; return a; };
// Nearest resting angle after a flick: project the motion forward a little, then snap to a card.
export const snapTheta = (theta, velocity, n) => { const step = 360 / n; return Math.round((theta + velocity * 220) / step) * step; };
