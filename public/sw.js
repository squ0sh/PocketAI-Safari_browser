// The production build injects every runtime chunk, stylesheet and public asset.
const BUILD_ASSETS = []; // @build-assets
const CACHE = "pocket-ai-shell-__BUILD_ID__";
async function saveAsset(cache, path) {
  const response = await fetch(new Request(path, { cache: "reload" }));
  const type = response.headers.get("content-type") || "";
  const expected = path.endsWith(".js") ? /javascript/ : path.endsWith(".css") ? /text\/css/ : /\.(json|webmanifest)$/.test(path) ? /json/ : path.endsWith(".html") ? /text\/html/ : null;
  if (!response.ok || (expected && !expected.test(type))) throw new Error(`Unable to save ${path}`);
  // Finish reading each small app asset before asking Cache Storage to save it.
  // Passing the live large tokenizer stream to cache.put can fail mid-transfer.
  // Model weights never enter this cache or this buffering path.
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  await cache.put(path, new Response(body, { status: response.status, statusText: response.statusText, headers }));
}
// Limit simultaneous large response bodies on Safari. Keep completed files so
// an interrupted installation can resume without downloading everything again.
async function saveMissing(cache) {
  const { missing } = await cacheStatus(cache);
  const queue = [...missing];
  const errors = [];
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (queue.length) {
      const path = queue.shift();
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await saveAsset(cache, path); break; } catch (error) {
          if (attempt === 1) errors.push(`${path}: ${error.name}: ${error.message}`);
        }
      }
    }
  }));
  return { ...(await cacheStatus(cache)), errors };
}
async function cacheStatus(cache) {
  const saved = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  const missing = BUILD_ASSETS.filter((path) => !saved.has(path));
  return { ready: BUILD_ASSETS.length > 0 && !missing.length, missing };
}
self.addEventListener("install", (event) => event.waitUntil((async () => {
  if (!BUILD_ASSETS.length) throw new Error("Build the app before installing offline support.");
  const cache = await caches.open(CACHE);
  const result = await saveMissing(cache);
  if (!result.ready) {
    const clients = await self.clients.matchAll?.({ type: "window", includeUncontrolled: true }) || [];
    for (const client of clients) client.postMessage({ type: "OFFLINE_INSTALL_ERROR", missing: result.errors });
    throw new Error("Offline installation incomplete. Reconnect and try again.");
  }
})()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith("pocket-ai-shell-") && key !== CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "OFFLINE_STATUS") event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    event.ports[0]?.postMessage(await cacheStatus(cache));
  })());
  if (event.data?.type === "REPAIR_OFFLINE") event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    event.ports[0]?.postMessage(await saveMissing(cache));
  })());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = event.request.mode === "navigate" ? "/index.html" : url.pathname;
    if (BUILD_ASSETS.includes(key)) {
      const saved = await cache.match(key);
      if (saved) return saved;
    }
    return fetch(event.request);
  })());
});
