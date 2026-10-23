// CHEX service worker: offline app shell. Never touches API, uploads or websockets.
const CACHE = 'chex-shell-v3';
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

// Home-screen notifications (Web Push). When CHEX is already open and visible the app itself chimes and speaks,
// so the system notification is skipped to avoid doubling up.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'CHEX', {
      body: data.body || 'You have a new notification',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'chex',
      renotify: true,
      data: { url: data.url || '/' },
    });
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
