/* Guscio dell'app in cache, tiles conservate man mano che le incontri:
   le zone già viste restano visibili anche senza campo. */
const V = 'gommone-v2';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/marine.js', './js/store.js', './js/como.js',
  './lib/leaflet.js', './lib/leaflet.css',
  './lib/images/marker-icon.png', './lib/images/marker-shadow.png',
  './icons/icon-192.png', './icons/icon-512.png',
];
const TILES = 'gommone-tiles-v2';
const MAX_TILES = 2500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const ks = await c.keys();
  if (ks.length > MAX_TILES) await Promise.all(ks.slice(0, ks.length - MAX_TILES).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // tiles: prima la cache, poi la rete
  if (/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const r = await fetch(e.request);
        if (r.ok) { c.put(e.request, r.clone()); trimTiles(); }
        return r;
      } catch (err) {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // dati vivi: sempre dalla rete
  if (/open-meteo\.com|overpass|emodnet/.test(url.hostname)) return;

  // guscio dell'app
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const hit = await caches.match(e.request);
      if (hit) {
        fetch(e.request).then(r => { if (r.ok) caches.open(V).then(c => c.put(e.request, r)); }).catch(() => {});
        return hit;
      }
      try { return await fetch(e.request); }
      catch (err) { return caches.match('./index.html'); }
    })());
  }
});
