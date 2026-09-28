const CACHE = "pocket-ai-shell-v0.6.0";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-180.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
);

self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE && !key.startsWith("pocket-ai-models-"))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
);

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const cached = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, cached)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
