/* Worksheet Studio phone app: keeps the app itself available offline and starts instantly, and
   finishes sending scans in the background when the connection comes back (Background Sync).
   Data always comes fresh from the network; the app keeps its own copy for offline viewing. */
importScripts('./lib/outbox.js');
const CACHE = 'ws-app-v5';
const SHELL = ['./', './index.html', './app.css', './app.js', './lib/render.js', './lib/smartscan.js', './lib/pages.js', './lib/camera.js', './lib/outbox.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-192.png', './icons/maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // cloud requests go straight to the network
  // App files: use the network when online (so updates arrive), fall back to the saved copy offline.
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});

// Background Sync: Android wakes this up when the phone is online again, even if the app is closed.
async function tellPages(ev) {
  const list = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  list.forEach(c => c.postMessage({ outbox: ev.type, id: ev.job && ev.job.id, title: ev.job && ev.job.title, token: ev.job && ev.job.token }));
}
self.addEventListener('sync', (e) => {
  if (e.tag !== 'ws-outbox') return;
  e.waitUntil(Outbox.flush(tellPages).then(r => {
    if (r && r.left) throw new Error('still waiting'); // makes Android try again later
  }));
});
