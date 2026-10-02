// The production build injects every runtime chunk, stylesheet and public asset.
const BUILD_ASSETS = []; // @build-assets
const CACHE = "pocket-ai-shell-__BUILD_ID__";
async function saveAsset(cache, path) {
  const response = await fetch(new Request(path, { cache: "reload" }));
  const type = response.headers.get("content-type") || "";
  const expected = path.endsWith(".js") ? /javascript/ : path.endsWith(".css") ? /text\/css/ : /\.(json|webmanifest)$/.test(path) ? /json/ : path.endsWith(".html") ? /text\/html/ : null;
  if (!response.ok || (expected && !expected.test(type))) throw new Error(`Unable to save ${path}`);
  await cache.put(path, response);
}
async function cacheStatus(cache) {
  const saved = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  const missing = BUILD_ASSETS.filter((path) => !saved.has(path));
  return { ready: BUILD_ASSETS.length > 0 && !missing.length, missing };
}
self.addEventListener("install", (event) => event.waitUntil((async () => {
  if (!BUILD_ASSETS.length) throw new Error("Build the app before installing offline support.");
  const cache = await caches.open(CACHE);
  const results = await Promise.allSettled(BUILD_ASSETS.map((path) => saveAsset(cache, path)));
  if (results.some((r) => r.status === "rejected")) {
    await caches.delete(CACHE);
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
    const { missing } = await cacheStatus(cache);
    await Promise.allSettled(missing.map((path) => saveAsset(cache, path)));
    event.ports[0]?.postMessage(await cacheStatus(cache));
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
