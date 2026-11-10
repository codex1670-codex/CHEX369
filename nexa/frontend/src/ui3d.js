// 3D look for the navigation and buttons. On by default; people can switch it off in
// Settings → Appearance (kept on this device). CSS reads it from <html data-3d="on|off">.
const KEY = 'nexa.ui3d';

export function get3D() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function set3D(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* not persisted */ }
  document.documentElement.setAttribute('data-3d', on ? 'on' : 'off');
  return on;
}

export function apply3D() { return set3D(get3D()); }

// Tilt a button toward the pointer (sets --rx/--ry, which the CSS turns into a 3D rotation).
export function tiltMove(e) {
  const el = e.currentTarget;
  if (!el || e.pointerType === 'touch') return;
  const r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width - 0.5;
  const py = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty('--rx', `${(-py * 14).toFixed(1)}deg`);
  el.style.setProperty('--ry', `${(px * 14).toFixed(1)}deg`);
  el.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(0)}%`);
}

export function tiltLeave(e) {
  const el = e.currentTarget;
  el?.style.setProperty('--rx', '0deg');
  el?.style.setProperty('--ry', '0deg');
}
