const CACHE = "bl-v26";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js",
  "./sync.js", "./firebase-config.js",
  "./manifest.webmanifest", "./icons/icon.svg",
];

self.addEventListener("install", e => {
  // {cache:'reload'} forces fresh copies from the network, bypassing the
  // browser's HTTP cache (which on GitHub Pages can serve stale files).
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // never intercept cross-origin (e.g. Firestore/Apps Script)
  if (url.origin !== location.origin) return;
  // Network-first, bypassing the HTTP cache, so code updates always win;
  // fall back to our cache only when offline.
  e.respondWith(
    fetch(e.request, { cache: "no-store" }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html")))
  );
});
