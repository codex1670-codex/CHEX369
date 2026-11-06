// CHEX service worker: offline app shell. Never touches API, uploads or websockets.
const CACHE = 'chex-shell-v5';
const SHELL = ['/', '/icon-192.png', '/logo.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/(api|uploads|socket\.io)/.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    // network-first so deploys show up immediately; cached shell when offline
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  // static assets (hashed by Vite): cache-first, fill on miss
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});

// Home-screen notifications (Web Push).
// - iPhone/iPad require every push to show a notification (a silent push gets the subscription revoked), so there we always show it.
// - Elsewhere the alert is skipped only while CHEX is open AND focused (the app itself chimes and speaks then). Checking
//   visibility alone is wrong: some phones keep reporting 'visible' for an app that is in the background or has the screen off.
const IOS = /iPad|iPhone|iPod/.test(self.navigator.userAgent || '');
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const inUse = wins.some((w) => w.focused && w.visibilityState === 'visible');
    if (inUse && !IOS && !data.force) return;
    const loud = !!(data.sticky || data.call);
    try {
      await self.registration.showNotification(data.title || 'CHEX', {
        body: data.body || 'You have a new notification',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: data.tag || 'chex',
        renotify: true,
        requireInteraction: loud,
        vibrate: data.call ? [400, 200, 400, 200, 400, 200, 400] : loud ? [250, 120, 250, 120, 250] : [120, 60, 120],
        timestamp: Date.now(),
        data: { url: data.url || '/' },
      });
    } catch {
      // Some phones reject an option (e.g. a missing badge image): show the plain notification rather than nothing.
      await self.registration.showNotification(data.title || 'CHEX', { body: data.body || 'You have a new notification', icon: '/icon-192.png', tag: data.tag || 'chex', data: { url: data.url || '/' } });
    }
  })());
});
// The browser replaced this phone's subscription: ask any open CHEX window to register the new one with the server.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'push-resync' }));
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); if ('navigate' in w) { try { await w.navigate(url); } catch { /* cross-scope */ } } return; }
    }
    await self.clients.openWindow(url);
  })());
});
