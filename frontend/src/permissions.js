// One place for every "allow this on my phone" permission CHEX can use.
// A web app (PWA) can only ask for what the browser exposes: notifications, camera, microphone,
// location, clipboard and persistent storage. Gallery access needs no permission on the web: the
// file picker opens the phone gallery on demand. Calls (voice/video) run inside the app and use
// the microphone + camera permissions below.
import { enablePush } from './push.js';

export const PERMS = [
  { key: 'notifications', icon: '🔔', label: 'Notifications', why: 'Messages, calls and likes on your home screen.' },
  { key: 'microphone', icon: '🎙', label: 'Microphone', why: 'Voice and video calls, voice notes, and talking to Codex.' },
  { key: 'camera', icon: '📷', label: 'Camera', why: 'Video calls, and taking photos or videos for posts, stories and reels.' },
  { key: 'location', icon: '📍', label: 'Location', why: 'Share where you are and find people and games nearby.' },
  { key: 'clipboard', icon: '📋', label: 'Clipboard', why: 'Paste links and text straight into CHEX.' },
  { key: 'storage', icon: '💾', label: 'Keep my data', why: 'Stops the phone clearing your saved drafts and offline data.' },
];

// 'granted' | 'denied' | 'prompt' (not asked yet) | 'unsupported' | 'insecure' (needs https)
const secureNeeded = new Set(['microphone', 'camera', 'location', 'clipboard']);
const queryName = { microphone: 'microphone', camera: 'camera', location: 'geolocation', clipboard: 'clipboard-read' };

export async function getStatus(key) {
  if (typeof window === 'undefined') return 'unsupported';
  if (secureNeeded.has(key) && !window.isSecureContext) return 'insecure';
  if (key === 'notifications') {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission === 'default' ? 'prompt' : Notification.permission;
  }
  if (key === 'storage') {
    if (!navigator.storage?.persist) return 'unsupported';
    try { return (await navigator.storage.persisted()) ? 'granted' : 'prompt'; } catch { return 'prompt'; }
  }
  const supported =
    key === 'location' ? !!navigator.geolocation
    : key === 'clipboard' ? !!navigator.clipboard?.readText
    : !!navigator.mediaDevices?.getUserMedia;
  if (!supported) return 'unsupported';
  try {
    const res = await navigator.permissions.query({ name: queryName[key] });
    return res.state; // granted | denied | prompt
  } catch {
    return 'prompt'; // browser (Safari/Firefox) can't report it: it will simply ask when used
  }
}

export async function getAllStatuses() {
  const out = {};
  await Promise.all(PERMS.map(async (p) => { out[p.key] = await getStatus(p.key); }));
  return out;
}

const stopStream = (s) => s.getTracks().forEach((t) => t.stop());

// Shows the phone's own permission dialog. Call from a tap. Resolves to the new status.
export async function requestPermission(key) {
  try {
    if (key === 'notifications') await enablePush();
    else if (key === 'microphone') stopStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
    else if (key === 'camera') stopStream(await navigator.mediaDevices.getUserMedia({ video: true }));
    else if (key === 'location') {
      await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000, maximumAge: 600000 }));
    } else if (key === 'clipboard') await navigator.clipboard.readText(); // only triggers the prompt; the text is discarded
    else if (key === 'storage') await navigator.storage.persist();
  } catch { /* denied or dismissed: report the real state below */ }
  return getStatus(key);
}

// Asks for everything not yet decided, one after another (notifications first: iPhone only allows it right after a tap).
export async function requestAll() {
  const before = await getAllStatuses();
  for (const p of PERMS) {
    if (before[p.key] === 'prompt') await requestPermission(p.key);
  }
  return getAllStatuses();
}

export const anyUndecided = (statuses) => Object.values(statuses).some((s) => s === 'prompt');
