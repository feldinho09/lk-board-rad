/* LK Board Rad – Service Worker.
 * Precache des kompletten App-Codes; Navigationen werden offline aus dem Cache
 * mit index.html beantwortet (SPA mit Hash-Routing, deshalb genügt index.html).
 * Wichtig: KEIN skipWaiting() automatisch – ein Update wird erst aktiv, wenn
 * die App es ausdrücklich anfordert (nie während Live).
 */
const VERSION = '__VERSION__';
const CACHE = 'lk-board-app-' + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('lk-board-app-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source && event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fremde Domains nie abfangen

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match('./index.html', { ignoreVary: true });
        if (cached) return cached;
        return fetch(req);
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // ignoreVary: Server senden oft „Vary: Origin“ o. ä.; Modul-Skripte werden mit
      // Origin-Header angefragt → ohne ignoreVary findet der Cache die Datei offline
      // nicht (in Tests reproduziert). Für die eigenen, versionierten Dateien ist das sicher.
      const cached =
        (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ||
        (await cache.match(url.origin + url.pathname, { ignoreVary: true }));
      if (cached) return cached;
      return fetch(req);
    })(),
  );
});
