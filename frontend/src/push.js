// Home-screen / notification-shade alerts (Web Push). The browser asks the person for permission once.
import { api } from './api.js';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const urlBase64ToUint8Array = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

async function subscribe() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api.pushKey();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
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
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try { await subscribe(); } catch { /* offline / blocked: try again next launch */ }
}
