// Spoken alerts: the AI reads out who a message / notification / request is from.
const KEY = 'chex.aiAlerts';
export const alertsEnabled = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export const setAlertsEnabled = (on) => {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (!on) { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } } // muting also stops anything being read right now
  window.dispatchEvent(new Event('chex:alerts-changed')); // keeps the floating AI and the ＋ menu in sync
};

// One spoken line for a batch, e.g. "Message from user-1, user-2 and user-3".
export function announcementForBatch(items) {
  const uniq = (list) => [...new Set(list.map(n => n.actor?.username || 'someone'))];
  const join = (names) => {
    const shown = names.slice(0, 4);
    const more = names.length - shown.length;
    const head = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
    return more > 0 ? `${shown.join(', ')} and ${more} more` : head;
  };
  const msgs = items.filter(n => n.type === 'message');
  const reqs = items.filter(n => n.type === 'message_request');
  const invites = items.filter(n => n.type === 'game_invite');
  const rest = items.filter(n => !['message', 'message_request', 'game_invite'].includes(n.type));
  const parts = [];
  if (msgs.length) parts.push(`Message from ${join(uniq(msgs))}`);
  if (reqs.length) parts.push(`Message request from ${join(uniq(reqs))}`);
  if (invites.length) parts.push(`Request from ${join(uniq(invites))}`);
  if (rest.length) parts.push(`Notification from ${join(uniq(rest))}`);
  return parts.join('. ');
}

export function announcementText(n) {
  const who = n.actor?.username || 'someone';
  if (n.type === 'message') return `Message from ${who}`;
  if (n.type === 'message_request') return `Message request from ${who}`;
  if (n.type === 'game_invite') return `Request from ${who}`;
  return `Notification from ${who}`;
}

export function speakAlert(text) {
  if (!alertsEnabled() || !text || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1;
    const voices = window.speechSynthesis.getVoices?.() || [];
    const v = voices.find(x => /^en/i.test(x.lang));
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    window.speechSynthesis.speak(u); // queued, so several alerts are read one after another
  } catch { /* speech unavailable */ }
}

// ---- One-time notification chime (generated in code, no audio file) ----
let audioCtx = null;
let userTouched = false;
let pending = null; // announcement waiting for the first tap (browsers block sound/speech before that)

function getCtx() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch { return null; }
}

export function playNotificationSound() {
  if (!alertsEnabled()) return;
  const ctx = getCtx();
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  [[880, 0], [1175, 0.22]].forEach(([freq, offset]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.5);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now + offset); osc.stop(now + offset + 0.55);
  });
}

// Chime once, then speak the line once. If the person has not touched the page yet, hold it until they do.
export function notifyOnce(text) {
  if (!alertsEnabled() || !text) return;
  if (!userTouched) { pending = text; return; }
  playNotificationSound();
  setTimeout(() => speakAlert(text), 650); // let the chime finish first
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    userTouched = true;
    getCtx();
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(ev => window.removeEventListener(ev, unlock));
    if (pending) { const t = pending; pending = null; notifyOnce(t); }
  };
  ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));
}
