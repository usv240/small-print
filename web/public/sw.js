// Service worker: lets the test work offline after the first visit (camps and clinics often have weak signal).
// - Pages: network first, cached copy if offline.
// - Hashed build files, the face model, the WebAssembly runtime and voice clips: cache first (they never change in place).
// - The results API is never cached; the app queues results while offline and sends them later.
const VERSION = 'small-print-v1';
const PRECACHE = [
  '/test.html',
  '/favicon.svg',
  '/audio/manifest.json',
  '/models/face_landmarker.task',
  '/mediapipe/wasm/vision_wasm_internal.js',
  '/mediapipe/wasm/vision_wasm_internal.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CACHE_FIRST = [/^\/assets\//, /^\/models\//, /^\/mediapipe\//, /^\/audio\//, /^\/favicon\.svg$/];

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (CACHE_FIRST.some((re) => re.test(url.pathname))) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(event.request, copy)); }
        return res;
      })),
    );
    return;
  }

  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(url.pathname === '/' ? '/index.html' : url.pathname, copy)); }
        return res;
      }).catch(() => caches.match(url.pathname === '/' ? '/index.html' : url.pathname).then((hit) => hit || caches.match('/test.html'))),
    );
  }
});
