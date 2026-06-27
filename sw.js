const CACHE = "bl-v16";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js",
  "./sync.js", "./firebase-config.js",
  "./manifest.webmanifest", "./icons/icon.svg",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // never cache cross-origin (e.g. Apps Script POSTs)
  if (url.origin !== location.origin) return;
  // Network-first for our own files so code updates always reach the user;
  // fall back to cache only when offline.
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html")))
  );
});
