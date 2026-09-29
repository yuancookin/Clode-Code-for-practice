const CACHE_NAME = "clipstudio-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./js/utils.js",
  "./js/store.js",
  "./js/media.js",
  "./js/audio.js",
  "./js/renderer.js",
  "./js/player.js",
  "./js/timeline.js",
  "./js/inspector.js",
  "./js/library.js",
  "./js/export.js",
  "./js/toast.js",
  "./js/api.js",
  "./js/ai.js",
  "./js/ai-panel.js",
  "./js/ops.js",
  "./js/main.js",
  "./icons/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// API とアップロード済み素材はキャッシュしない（常に最新を取りに行く）
const NETWORK_ONLY = [/^\/upload/, /^\/files/, /^\/uploads\//, /^\/api/, /^\/docs/, /^\/openapi\.json/];

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (NETWORK_ONLY.some((pattern) => pattern.test(url.pathname))) return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => cached)
    )
  );
});
