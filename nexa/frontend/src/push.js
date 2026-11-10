// Home-screen / notification-shade alerts (Web Push). The browser asks the person for permission once.
// Written to work across phones: Android (Chrome, Samsung Internet, Firefox, Edge), iPhone/iPad (only once CHEX is added
// to the Home Screen) and desktop. Every step has a time limit so a phone that can't do push never leaves a button hanging.
import { api } from './api.js';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const ua = () => (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');
export const isIOS = () => /iPad|iPhone|iPod/.test(ua()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => {
  try { return !!navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch { return false; }
};
// iPhone/iPad only allow notifications for a web app that was added to the Home Screen (and opened from there).
export const needsInstall = () => isIOS() && !isStandalone() && !pushSupported();

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

const urlBase64ToUint8Array = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

const sameKey = (sub, key) => {
  const cur = sub?.options?.applicationServerKey;
  if (!cur) return true;                       // this browser doesn't report it: assume it's fine
  const a = new Uint8Array(cur);
  return a.length === key.length && a.every((v, i) => v === key[i]);
};

// The service worker is registered on page load; if that hasn't happened (slow phone, in-app browser) do it here instead of waiting forever.
async function readyRegistration() {
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg && import.meta.env.PROD) reg = await navigator.serviceWorker.register('/sw.js');
  return withTimeout(navigator.serviceWorker.ready, 10000);
}

async function subscribe() {
  const reg = await readyRegistration();
  const { publicKey } = await api.pushKey();
  const key = urlBase64ToUint8Array(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with different server keys can never receive anything (the push service answers 403): replace it.
  if (sub && !sameKey(sub, key)) { try { await sub.unsubscribe(); } catch { /* already gone */ } sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.pushSubscribe(sub.toJSON());
  return true;
}

// Must be called from a tap/click (browsers only show the permission dialog after a gesture).
export async function enablePush() {
  if (!pushSupported()) return false;
  try {
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') return false;
    return await subscribe();
  } catch { return false; }
}

// Already allowed earlier: quietly make sure this device is registered with the server.
export async function syncPushIfAllowed() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try { return await subscribe(); } catch { return false; /* offline / blocked: try again next launch */ }
}

// Sign-out: stop this phone receiving the previous person's notifications.
export async function unregisterPush() {
  if (!pushSupported()) return;
  try {
    const reg = await withTimeout(navigator.serviceWorker.getRegistration(), 3000);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    try { await withTimeout(api.pushUnsubscribe(sub.endpoint), 4000); } catch { /* server unreachable: the account check on the server still stops delivery */ }
    await sub.unsubscribe();
  } catch { /* nothing to undo */ }
}

// Keep the phone registered while the app is in use: re-check when the app comes back to the front (at most every 10 minutes)
// and whenever the browser tells us it replaced the subscription. Returns a cleanup function.
export function watchPush() {
  if (!pushSupported()) return () => {};
  let last = Date.now();
  const again = () => { if (document.visibilityState === 'visible' && Date.now() - last > 10 * 60 * 1000) { last = Date.now(); syncPushIfAllowed(); } };
  const fromWorker = (e) => { if (e?.data?.type === 'push-resync') syncPushIfAllowed(); };
  document.addEventListener('visibilitychange', again);
  navigator.serviceWorker.addEventListener('message', fromWorker);
  return () => { document.removeEventListener('visibilitychange', again); navigator.serviceWorker.removeEventListener('message', fromWorker); };
}

// Settings → "Send a test notification": proves this phone really receives alerts. Re-registers the phone first if the server has none.
export async function sendTestPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return { ok: false, reason: 'not-allowed' };
  let r = await api.pushTest().catch(() => null);
  if (!r || !r.devices) { await syncPushIfAllowed(); r = await api.pushTest().catch(() => null); }
  return r && r.devices ? { ok: true, devices: r.devices } : { ok: false, reason: 'no-device' };
}
