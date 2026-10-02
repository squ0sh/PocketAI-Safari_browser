const CACHE = "pocket-ai-shell-v0.6.0";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-180.png", "/icon-192.png", "/icon-512.png"];

// Bundled Qwen2Tokenizer (~8.7 MB raw, ~1.9 MB gzipped) so loading a model from a
// local file needs no network. Precached here so offline loading does not depend
// on a runtime cache write having landed earlier.
const TOKENIZER = ["/tokenizer/tokenizer.json", "/tokenizer/tokenizer_config.json"];

// cache.addAll rejects as a unit, so one unreachable URL would abandon the whole
// install and leave the app with no service worker at all. Add each entry
// independently and only fail the install if the app shell itself is missing.
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const critical = [...SHELL];
      const results = await Promise.allSettled(
        [...critical, ...TOKENIZER].map((url) => cache.add(url))
      );
      critical.forEach((url, i) => {
        if (results[i].status === "rejected") {
          throw results[i].reason;
        }
      });
      results.slice(critical.length).forEach((result, i) => {
        if (result.status === "rejected") {
          console.warn("[sw] tokenizer precache failed:", TOKENIZER[i], result.reason);
        }
      });
    })
  )
);

self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== CACHE &&
                !key.startsWith("pocket-ai-models-") &&
                !key.startsWith("pocket-ai-meta-")
            )
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
