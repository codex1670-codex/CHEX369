// The floating AI bar (the small Codex box that sits on every page). It is OFF by default: it only appears on the
// pages after the person switches it on in Settings → Floating AI bar. Kept on this device, like the other display settings.
const KEY = 'chex.floatingAi';
export const floatingAiEnabled = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };
export function setFloatingAi(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* not persisted */ }
  window.dispatchEvent(new Event('chex:floating-ai-changed'));
  return !!on;
}
