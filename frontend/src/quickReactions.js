// The person's own "top 10" quick reactions for chat messages. Saved on this device.
export const DEFAULT_QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥', '🙏', '👏', '🎉', '😍'];
export const QUICK_COUNT = 10;
const KEY = 'chexQuickReactions';

// A pickable palette for customizing the 10 slots.
export const EMOJI_PALETTE = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😇',
  '😮', '😲', '😱', '😢', '😭', '😡', '🤔', '🙄', '😴', '🤗', '🤭', '😏', '😅', '😬', '🥺', '😤', '🤯', '😜', '😉', '🙃',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '👌', '✌️', '🤝', '👋', '🫶', '🤞', '👀', '🔥', '✨', '💯', '🎉', '🎂', '🌹', '☀️',
  '⭐', '💥', '💩', '🤡', '👻', '💀', '🐶', '🐱', '🍕', '☕', '⚽', '🚀',
];

// First emoji (grapheme) of whatever was typed/pasted, or '' if it isn't one.
export function firstEmoji(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const g = typeof Intl !== 'undefined' && Intl.Segmenter
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)][0]?.segment
    : [...t][0];
  return g && /\p{Extended_Pictographic}/u.test(g) ? g : '';
}

export function normalizeQuick(list) {
  if (!Array.isArray(list)) return [...DEFAULT_QUICK_REACTIONS];
  const clean = list.filter(e => typeof e === 'string' && e && e.length <= 16);
  if (clean.length !== QUICK_COUNT) return [...DEFAULT_QUICK_REACTIONS];
  return clean;
}
export function loadQuickReactions() {
  try { return normalizeQuick(JSON.parse(localStorage.getItem(KEY))); } catch { return [...DEFAULT_QUICK_REACTIONS]; }
}
export function saveQuickReactions(list) {
  const clean = normalizeQuick(list);
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* storage unavailable */ }
  return clean;
}
