const CACHE_NAME = "openround-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.mjs",
  "./capture.mjs",
  "./storage.mjs",
  "./pin-placement.mjs",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      if (event.request.mode === "navigate") {
        return caches.match("./index.html");
      }
      return fetch(event.request);
    }),
  );
});
