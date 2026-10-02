import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function worker({ fail = false } = {}) {
  const origin = 'https://pocket.test';
  const stores = new Map([['pocket-ai-shell-old', new Map()], ['pocket-ai-meta-v1', new Map()], ['other-app-cache', new Map()]]);
  const handlers = {};
  let network = true, requests = 0;
  const key = (x) => new URL(typeof x === 'string' ? x : x.url, origin).href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return { put: async (path, response) => entries.set(key(path), response), match: async (path) => entries.get(key(path))?.clone(), keys: async () => [...entries.keys()].map((url) => ({ url })) };
    },
  };
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .replace('const BUILD_ASSETS = []; // @build-assets', 'const BUILD_ASSETS = ["/index.html", "/assets/runtime.js", "/tokenizer-27b/tokenizer.json"];')
    .replace('__BUILD_ID__', 'test');
  vm.runInNewContext(source, {
    self: { location: { origin }, clients: { claim: async () => {} }, addEventListener: (name, fn) => handlers[name] = fn, skipWaiting() {} },
    caches, URL, Error, Request: class extends Request { constructor(path, opts) { super(new URL(path, origin), opts); } },
    fetch: async (request) => { requests++; if (!network || (fail && key(request).includes('tokenizer'))) throw new Error('offline'); return new Response('saved bytes', { headers: { 'Content-Type': key(request).endsWith('.js') ? 'text/javascript' : key(request).endsWith('.json') ? 'application/json' : 'text/html' } }); },
  });
  const lifecycle = async (type) => { let pending; handlers[type]({ waitUntil: (p) => pending = p }); return pending; };
  return { stores, handlers, lifecycle, offline() { network = false; }, requests: () => requests };
}

test('failed installation keeps the existing app and removes partial cache', async () => {
  const w = worker({ fail: true });
  await assert.rejects(w.lifecycle('install'), /incomplete/);
  assert.ok(w.stores.has('pocket-ai-shell-old'));
  assert.ok(!w.stores.has('pocket-ai-shell-test'));
});
test('offline navigation, runtime and 27B tokenizer use no network', async () => {
  const w = worker();
  await w.lifecycle('install');
  await w.lifecycle('activate');
  assert.ok(!w.stores.has('pocket-ai-shell-old'));
  assert.ok(w.stores.has('pocket-ai-meta-v1'));
  assert.ok(w.stores.has('other-app-cache'));
  w.offline();
  const requests = w.requests();
  for (const path of ['/', '/assets/runtime.js', '/tokenizer-27b/tokenizer.json']) {
    let pending;
    w.handlers.fetch({ request: { method: 'GET', url: 'https://pocket.test' + path, mode: path === '/' ? 'navigate' : 'cors' }, respondWith: (p) => pending = p });
    assert.equal(await (await pending).text(), 'saved bytes');
  }
  assert.equal(w.requests(), requests);
});
test('readiness detects missing cached support files', async () => {
  const w = worker(); await w.lifecycle('install');
  w.stores.get('pocket-ai-shell-test').delete('https://pocket.test/tokenizer-27b/tokenizer.json');
  let pending, result;
  w.handlers.message({ data: { type: 'OFFLINE_STATUS' }, ports: [{ postMessage: (value) => result = value }], waitUntil: (p) => pending = p });
  await pending;
  assert.equal(result.ready, false);
  assert.equal(result.missing[0], '/tokenizer-27b/tokenizer.json');
});

test('explicit repair restores evicted support files without wiping existing data', async () => {
  const w = worker(); await w.lifecycle('install');
  w.stores.get('pocket-ai-shell-test').delete('https://pocket.test/tokenizer-27b/tokenizer.json');
  let pending, result;
  w.handlers.message({ data: { type: 'REPAIR_OFFLINE' }, ports: [{ postMessage: (value) => result = value }], waitUntil: (p) => pending = p });
  await pending;
  assert.equal(result.ready, true);
  assert.ok(w.stores.has('pocket-ai-meta-v1'));
});
