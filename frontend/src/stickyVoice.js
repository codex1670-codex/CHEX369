// Spoken sticky-note reminders. Separate from the "AI alerts" switch: a reminder you asked for should
// still speak even if message announcements are muted — it has its own On/Off in Sticky notes.
const KEY = 'chex.stickyVoice';
export const stickyVoiceOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export const setStickyVoice = (on) => {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (!on) { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }
  window.dispatchEvent(new Event('chex:sticky-voice-changed'));
  return on;
};

let touched = false;            // browsers only allow sound/speech after the first tap or key press
let queued = null;
let ctx = null;

const langFor = (text) => /[\u0B80-\u0BFF]/.test(text) ? 'ta-IN' : /[\u0900-\u097F]/.test(text) ? 'hi-IN' : (navigator.language || 'en-US');

function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    [[784, 0], [988, 0.18], [1319, 0.36]].forEach(([f, o]) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + o); g.gain.exponentialRampToValueAtTime(0.3, t + o + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + o + 0.45);
      osc.connect(g); g.connect(ctx.destination); osc.start(t + o); osc.stop(t + o + 0.5);
    });
  } catch { /* no audio */ }
}

function say(text) {
  if (!window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(`Reminder. ${text}`);
    const lang = langFor(text);
    const voices = window.speechSynthesis.getVoices?.() || [];
    const v = voices.find(x => x.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) || voices.find(x => /^en/i.test(x.lang));
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang;
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}

// Chime, then read the reminder out loud. Held until the first tap if the page hasn't had one yet.
export function speakReminder(text, { force = false } = {}) {
  if (!text || (!force && !stickyVoiceOn())) return false;
  if (!touched) { queued = text; return false; }
  chime();
  setTimeout(() => say(text), 900);
  return true;
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    touched = true;
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(ev => window.removeEventListener(ev, unlock));
    if (queued) { const t = queued; queued = null; speakReminder(t); }
  };
  ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));
}
