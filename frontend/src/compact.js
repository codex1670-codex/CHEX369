// Compact mode: shorter, smarter UI.
//
//  • Plain-text action buttons (Save, Cancel, Delete, Follow …) show as a single icon, with the
//    original word kept as the hover/long-press tooltip.
//  • Long explanatory paragraphs collapse to one line; tap one to read the rest.
//
// How it works (and why it is safe): this layer only ever sets *attributes* (data-ico, data-hint,
// data-open, title). It never rewrites text or moves nodes, so React stays in control of the DOM,
// screen readers still read the full word, and tests that look for text keep working. All the
// visual change is CSS in compact.css, gated on <html data-compact="on">.
//
// Preference is kept on this device. On by default; switch off in Settings → Appearance.

const KEY = 'chex.compact';

export function compactEnabled() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setCompact(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* not persisted */ }
  document.documentElement.setAttribute('data-compact', on ? 'on' : 'off');
  try { window.dispatchEvent(new CustomEvent('chex:compact-changed', { detail: { on } })); } catch { /* old browser */ }
  return on;
}

export function applyCompact() { return setCompact(compactEnabled()); }

// ---- button label → icon -------------------------------------------------------------------
// Only unambiguous action verbs. Choice buttons (Truth / Dare, Higher / Lower …) are deliberately
// left as text because an icon would hide what you are choosing.
const ICONS = {
  // dismiss / confirm
  cancel: '✕', close: '✕', dismiss: '✕', 'not now': '✕', later: '✕', 'no thanks': '✕', decline: '✕', reject: '✕',
  done: '✓', ok: '✓', confirm: '✓', accept: '✓', approve: '✓', 'use this': '✓', 'got it': '✓', allow: '✓',
  save: '💾', 'save changes': '💾',
  // move
  back: '←', 'back to game store': '←', continue: '➜', next: '➜', 'next round': '➜', skip: '⏭', 'skip prompt': '⏭', pass: '⏭',
  join: '➜', 'join game': '➜',
  // edit
  edit: '✎', 'edit video': '✎', 'edit photo': '✎', 'edit profile': '✎', rename: '✎',
  delete: '🗑', remove: '🗑', 'delete content': '🗑', 'remove photo': '🗑', 'remove video': '🗑', 'remove my frame': '🗑',
  reset: '↺', undo: '↺', 'undo edits': '↺',
  'try again': '↻', retry: '↻', refresh: '↻', 'play again': '↻', 'race again': '↻', rematch: '↻',
  add: '＋', new: '＋', 'add text': '＋', 'new game': '＋', 'new puzzle': '＋', follow: '＋', 'follow back': '＋',
  following: '✓', requested: '⏳',
  // share / transfer
  message: '💬', send: '➤', share: '↗', copy: '⧉', 'copy link': '⧉', invite: '✉', publish: '🌐',
  download: '⬇', export: '⬇', install: '⬇', 'replace file': '⇄', 'choose file': '📁', 'choose a photo': '🖼️',
  'take a photo': '📷', retake: '📷', 'send a test notification': '🔔', 'try a sample': '✨',
  // safety / account
  block: '🚫', unblock: '✓', report: '⚑', mute: '🔇', unmute: '🔊',
  lock: '🔒', 'lock now': '🔒', unlock: '🔓', 'change password': '🔑', deactivate: '⏸',
  'log out': '⏻', logout: '⏻', 'sign out': '⏻', search: '🔍',
  // games
  roll: '🎲', 'surprise me': '🎲', 'draw a card': '🃏',
};

/** "✏️ Edit…" → "edit". Returns '' when the text is empty or too long to be a plain label. */
export function labelKey(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 28) return '';
  return t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[\s….!?:]+$/u, '').toLowerCase();
}

/** The icon for a button's text, or '' when it should stay as text. */
export function iconFor(text) { return ICONS[labelKey(text)] || ''; }

/** Words of the label without a leading emoji, used for the tooltip. */
const tipFor = (raw) => String(raw).replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+/u, '').trim();

// ---- where the layer must NOT touch -------------------------------------------------------
const KEEP = '[data-keep-text], .auth-card';                       // sign-in stays in plain words
const HINT_SKIP = `${KEEP}, [role="dialog"], .chat-messages, .bubble, .post-card, .codex-panel, [contenteditable]`;
const HINT_SEL = [
  'p[style*="text-mid"]', 'p[style*="text-low"]', '.me-hint', '.perm-help', '.sim-help', '.sim-hint', '.sim-note',
  '.as-sub', '.stickies-sub', '.pv-sub', '.ss-help', '.gs-hint', '.gs-hero-sub', '.rec-hint', '.react-hint', '.post-3d-hint',
].join(',');
const HINT_MIN = 64; // shorter notes are already short enough

// Tabs, filters and on/off switches choose between *named* options, so an icon would hide which
// one is which ("Following" the feed tab is not the "Following ✓" state of a Follow button).
const CHOICE_SELF = '[role="tab"],[role="switch"],[role="radio"],[role="menuitemcheckbox"],[aria-pressed],[aria-selected]';
const CHOICE_PARENT = '[role="tablist"],.tabs,[class*="-tabs"],[class*="tabs-"],[class$="-tab"]';

function processButton(b) {
  const ours = b.hasAttribute('data-cx-t');
  const clear = () => { b.removeAttribute('data-ico'); if (ours) { b.removeAttribute('title'); b.removeAttribute('data-cx-t'); } };
  if (b.closest(KEEP) || b.matches(CHOICE_SELF) || b.closest(CHOICE_PARENT) || b.children.length) return clear(); // only pure-text actions are compressed
  const raw = (b.textContent || '').trim();
  const ico = iconFor(raw);
  if (!ico) return clear();
  if (b.getAttribute('data-ico') !== ico) b.setAttribute('data-ico', ico);
  // Short explanation on hover / long-press. Never overwrite a title somebody wrote on purpose.
  if (ours || !b.hasAttribute('title')) { b.setAttribute('title', tipFor(raw)); b.setAttribute('data-cx-t', ''); }
}

function processHint(el) {
  const long = (el.textContent || '').trim().length > HINT_MIN;
  const ok = long && !el.closest(HINT_SKIP) && !el.querySelector('a,button,input,textarea,select');
  if (ok) { if (!el.hasAttribute('data-hint')) el.setAttribute('data-hint', ''); }
  else { el.removeAttribute('data-hint'); el.removeAttribute('data-open'); }
}

export function scan(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches('button')) processButton(root);
  root.querySelectorAll('button').forEach(processButton);
  if (root.matches(HINT_SEL)) processHint(root);
  root.querySelectorAll(HINT_SEL).forEach(processHint);
}

/** Start watching the page. Returns a function that stops it. */
export function startCompactLayer() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (f) => setTimeout(f, 16);
  const pending = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const items = [...pending]; pending.clear();
    items.forEach((n) => { if (n.isConnected) scan(n); });
  };
  const queue = (n) => {
    if (!n || n.nodeType !== 1) return;
    pending.add(n);
    if (!scheduled) { scheduled = true; raf(flush); }
  };
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => queue(n.nodeType === 1 ? n : n.parentElement));
        queue(m.target.closest?.('button')); // a button's own text was swapped (Follow → Following)
      } else if (m.type === 'characterData') {
        const p = m.target.parentElement;
        queue(p?.closest('button') || p);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Tap a collapsed note to read all of it, tap again to fold it.
  const onClick = (e) => {
    if (!compactEnabled()) return;
    const h = e.target.closest?.('[data-hint]');
    if (!h || h.closest('button,a,label,summary')) return;
    if (h.hasAttribute('data-open')) h.removeAttribute('data-open'); else h.setAttribute('data-open', '');
  };
  document.addEventListener('click', onClick);

  scan(document.body);
  return () => { observer.disconnect(); document.removeEventListener('click', onClick); };
}
