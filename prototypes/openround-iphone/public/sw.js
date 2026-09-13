// Bump the shell cache whenever the document contract changes. Navigation
// requests are also refreshed from the network below so a stale HTML shell
// cannot strand an installed client on old asset hashes.
const CACHE_NAME = "openround-shell-v2";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/assets/openround-app-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Course tiles and other imagery are intentionally remote. Keeping the
  // origin check here prevents the app shell from ever caching provider tiles.
  if (url.origin !== self.location.origin) return;

  // Always prefer the current document for navigations. If the user is
  // offline, fall back to the last known shell so the PWA still opens.
  if (request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (!response.ok || response.type !== "basic") return response;
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached || Response.error());
    }),
  );
});
