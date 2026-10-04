// オフラインでもひとり用が遊べるように静的ファイルをキャッシュ
const CACHE = 'magic-maze-v2';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/engine.js', 'js/tiles.js', 'js/render.js', 'js/net.js', 'vendor/peerjs.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// ネットワーク優先、失敗したらキャッシュ
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
