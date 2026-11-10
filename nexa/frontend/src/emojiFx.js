// 3D emoji falling / floating effects. The person chooses the emoji, the style and when it plays
// (Settings → Emoji effects). Kept on this device, like the other appearance settings.
const KEY = 'chex.emojiFx';
export const DEFAULT_EMOJIS = ['😍', '💖', '⭐', '🥳'];
// Every emoji here has hand-drawn glossy 3D art (components/Emoji3D.jsx); anything else the user types gets a glossy 3D bubble.
export const EMOJI_PALETTE = ['😀', '😄', '😍', '🥰', '😂', '😋', '😎', '😉', '🤩', '🥳', '😭', '😢', '😠', '😮', '💖', '⭐', '🔥', '🔔', '✨', '💎', '🪙', '🎈', '🏆'];
export const MAX_EMOJIS = 10;
const DEFAULTS = { onNotify: true, ambient: false, style: 'both', emojis: DEFAULT_EMOJIS };

export function getEmojiFx() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    const emojis = Array.isArray(raw.emojis) ? raw.emojis.filter((e) => typeof e === 'string' && e).slice(0, MAX_EMOJIS) : DEFAULTS.emojis;
    return {
      onNotify: raw.onNotify !== false,
      ambient: raw.ambient === true,
      style: ['falling', 'floating', 'both'].includes(raw.style) ? raw.style : 'both',
      emojis: emojis.length ? emojis : DEFAULTS.emojis,
    };
  } catch { return { ...DEFAULTS }; }
}

export function setEmojiFx(patch) {
  const next = { ...getEmojiFx(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not persisted */ }
  window.dispatchEvent(new Event('chex:emoji-fx-changed'));
  return next;
}

// Split typed text into single emoji / characters (handles flags, skin tones, ZWJ families).
export function splitEmojis(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const parts = typeof Intl !== 'undefined' && Intl.Segmenter
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment)
    : Array.from(s);
  return parts.filter((p) => p.trim() && /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u2600-\u27BF]|[#*0-9]\uFE0F?\u20E3/u.test(p));
}

// Fire the effect (used for new notifications and the Preview button). `force` ignores the
// "on notifications" switch so Preview always works.
export function burstEmoji({ force = false } = {}) {
  if (typeof window === 'undefined') return;
  if (!force && !getEmojiFx().onNotify) return;
  window.dispatchEvent(new CustomEvent('chex:emoji-burst'));
}
