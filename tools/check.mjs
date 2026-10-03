import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, createReadStream, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as netCreateServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const notes = [];

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });
  if (res.status !== 0) {
    failures.push(`${cmd} ${args.join(" ")} exited ${res.status ?? "nonzero"}:\n${(res.stderr || res.stdout || "").slice(0, 1200)}`);
  }
  return res;
}

function chromiumName() {
  for (const name of ["chromium", "chromium-browser", "google-chrome", "chrome"]) {
    const res = spawnSync("which", [name], { encoding: "utf8" });
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  for (const p of ["/usr/bin/chromium", "/usr/lib/chromium/chromium", "/usr/bin/google-chrome"]) {
    if (existsSync(p)) return p;
  }
  return "";
}

function freePort() {
  return new Promise((resolve) => {
    const srv = netCreateServer();
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

const MIME = {
  ".html": "text/html", ".js": "text/javascript",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
};

function serve(dir, port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let file = join(dir, url.pathname === "/" ? "index.html" : url.pathname);
      if (!statSync(file, { throwIfNoEntry: false })?.isFile()) file = join(dir, "index.html");
      res.setHeader("Content-Type", MIME["." + file.split(".").pop()] || "application/octet-stream");
      createReadStream(file).pipe(res);
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, tries = 80, gap = 250) => {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(gap);
  }
  return null;
};

// 1. Syntax-check the two production scripts.
for (const file of ["src/main.js", "src/context.js", "src/offline.js", "public/sw.js", "functions/index.js"]) run("node", ["--check", file]);

run("node", ["--test", "tools/context.test.mjs", "tools/offline.test.mjs", "tools/manual.test.mjs"]);

// 2. Production build.
run("npx", ["vite", "build"]);

// 2b. PWA wiring: the manifest and icons must exist in dist and serve as real
//     content, not fall through to the SPA index.html rewrite — that is exactly
//     what shipped before v0.6.0, when /manifest.webmanifest and /icon.svg
//     answered with text/html on the live site (broken manifest + home-screen
//     icon on iOS).
const pwaPort = await freePort();
const pwaServer = await serve(join(root, "dist"), pwaPort).catch(() => null);
if (!pwaServer) {
  failures.push("pwa check: probe server could not start");
} else {
  const get = (p) => fetch(`http://127.0.0.1:${pwaPort}${p}`);
  const manifestBody = await get("/manifest.webmanifest").then((r) => r.text());
  let iconNames = [];
  let manifestOk = false;
  try {
    const parsed = JSON.parse(manifestBody);
    iconNames = (parsed.icons || []).map((i) => i.src);
    manifestOk = Array.isArray(parsed.icons) && parsed.icons.some((i) => i.type === "image/png");
  } catch {}
  if (!manifestOk) {
    failures.push(`pwa check: /manifest.webmanifest is not a JSON manifest with PNG icons — first bytes: ${manifestBody.slice(0, 80)}`);
  } else {
    for (const icon of ["/icon.svg", "/icon-180.png", "/icon-192.png", "/icon-512.png"]) {
      const buf = Buffer.from(await get(icon).then((r) => r.arrayBuffer()));
      const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const isSvg = buf.length > 5 && buf.subarray(0, 4).toString() === "<svg";
      const looksHtml = buf.length > 15 && buf.subarray(0, 15).toString().toLowerCase().startsWith("<!doctype html");
      if (looksHtml || (icon.endsWith(".png") && !isPng) || (icon.endsWith(".svg") && !isSvg)) {
        failures.push(`pwa check: ${icon} served the wrong bytes (html=${looksHtml} png=${isPng} svg=${isSvg}, ${buf.length} bytes)`);
      }
    }
    console.log(`  pwa: manifest OK (${iconNames.join(", ")}) + 4 icon files serve real content`);
  }
  pwaServer.close();
}

// 3. Headless boot probe over the freshly built dist/. Best-effort: skipped
//    when no Chromium is on PATH. Drives a real tab over CDP (the ui-probes
//    pattern) so the page boots, the model tiles render, and any boot-time
//    JS error surfaces. Asserts the two bug classes that have shipped: model
//    tiles not rendering and the history drawer staying empty.
const chrome = chromiumName();
if (!chrome) {
  notes.push("chromium not on PATH — browser boot probe skipped");
} else {
  const server = await serve(join(root, "dist"), 4197).catch((e) => {
    failures.push(`probe server failed: ${e.message}`);
    return null;
  });
  if (server) {
    const cdpPort = await freePort();
    const profile = mkdtempSync(join(tmpdir(), "pa-probe-chrome-"));
    const browser = spawn(chrome, [
      "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
      `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore"] });

    const cleanup = () => {
      try { browser.kill("SIGKILL"); } catch {}
      server.close();
      for (let i = 0; i < 8; i++) {
        try { rmSync(profile, { recursive: true, force: true }); break; } catch { sleep(200); }
      }
    };
    try {
      const version = await waitFor(() => fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json()).catch(() => null), 60, 250);
      if (!version) {
        failures.push("probe: chromium did not expose CDP in time");
        cleanup();
      } else {
        const ws = new WebSocket(version.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        let msgId = 0;
        const pending = new Map();
        const sendCdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
        const { targetId } = await sendCdp("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await sendCdp("Target.attachToTarget", { targetId, flatten: true });
        const tab = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });
        const ev = async (expression, awaitPromise = false) => {
          const r = await tab("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
          if (r.exceptionDetails) throw new Error("Eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 500) + " expr=" + expression.slice(0, 120));
          return r.result?.value;
        };

        await tab("Page.enable");
        await tab("Page.addScriptToEvaluateOnNewDocument", {
          source: "window.__bootErrors=[];addEventListener('error',e=>window.__bootErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__bootErrors.push('rejection: '+String(e.reason)));",
        });
        await tab("Page.navigate", { url: "http://127.0.0.1:4197/" });
        const loaded = await waitFor(() => ev("document.title && document.title.includes('Pocket')"), 200, 250);
        if (!loaded) {
          failures.push("probe: app document never loaded");
          cleanup();
        } else {
          const booted = await ev(
            "new Promise(res => { const t0 = performance.now(); (function p() { if (document.querySelectorAll('.model-option').length > 0) return res(1); if (performance.now() - t0 > 45000) return res(0); setTimeout(p, 200); })(); })",
            true,
          );
          if (!booted) {
            const diag = await ev("JSON.stringify({classes: [...new Set([...document.querySelectorAll('button, a, [id]')].map(el => el.className||el.id))].slice(0,40)})").catch(() => "diag failed");
            failures.push(`probe: app did not render model tiles in time — ${diag}`);
          } else {
            await sleep(600);
            const errors = await ev("window.__bootErrors.join(' | ')");
            if (errors) failures.push(`probe: boot errors — ${errors.slice(0, 400)}`);
            const offlineReady = await ev(`new Promise(resolve => {
              const start = Date.now();
              const poll = () => {
                if (document.querySelector('#connectionLabel').textContent.includes('App ready for offline GGUF')) return resolve(true);
                if (Date.now() - start > 45000) return resolve(false);
                setTimeout(poll, 250);
              }; poll();
            })`, true);
            if (!offlineReady) {
              const detail = await ev(`(async () => JSON.stringify({ label: document.querySelector('#connectionLabel').textContent, detail: document.querySelector('#offlineDetail').textContent, notice: document.querySelector('#notice').textContent, errors: window.__bootErrors, workers: (await navigator.serviceWorker.getRegistrations()).map(r => ({ active: r.active?.state, installing: r.installing?.state, waiting: r.waiting?.state })), caches: await Promise.all((await caches.keys()).map(async name => ({ name, files: (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname) }))) }))()`, true);
              failures.push("offline: complete app installation never became ready: " + detail);
            }
            if (offlineReady) {
              await tab("Network.enable");
              await tab("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
              await tab("Page.reload");
              const reloaded = await waitFor(() => ev("document.querySelectorAll('.model-option').length > 0"));
              if (!reloaded) failures.push("offline: app did not reopen without a network");
              else {
                const chunks = await ev(`(async () => {
                  const names = (await caches.keys()).filter(key => key.startsWith('pocket-ai-shell-'));
                  const cache = await caches.open(names[0]);
                  const paths = (await cache.keys()).map(r => new URL(r.url).pathname);
                  const scripts = paths.filter(path => path.endsWith('.js'));
                  await Promise.all(scripts.map(path => import(path)));
                  const small = await fetch('/tokenizer/tokenizer_config.json').then(r => r.json());
                  const large = await fetch('/tokenizer-27b/tokenizer_config.json').then(r => r.json());
                  return scripts.length > 2 && !!small.tokenizer_class && !!large.tokenizer_class;
                })()`, true);
                if (!chunks) failures.push("offline: runtime chunks or tokenizer configurations unavailable");
                await tab("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
                const guideWorks = await ev(`(() => {
                  document.querySelector('#welcomeHelp').focus(); document.querySelector('#welcomeHelp').click();
                  const guide = document.querySelector('#guideDialog');
                  const link = document.querySelector('#guideContent a[href="#guide-ask-about-text"]');
                  link.click();
                  const ok = guide.open && document.activeElement.id === 'guide-ask-about-text' && guide.scrollWidth <= guide.clientWidth + 1;
                  return ok;
                })()`);
                if (!guideWorks) failures.push("guide: offline contents navigation or phone layout failed");
                if (process.env.POCKET_SCREENSHOTS) {
                  await ev("document.querySelector('#guideDialog').scrollTop = 0");
                  const shot = await tab("Page.captureScreenshot", { format: "png" });
                  writeFileSync(join(tmpdir(), "pocket-ai-guide.png"), Buffer.from(shot.data, "base64"));
                }
                await tab("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
                await tab("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
                if (!await ev("document.querySelector('#guideDialog').contains(document.activeElement)")) failures.push("guide: Tab focus escaped the modal");
                await tab("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
                await tab("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
                if (!await waitFor(() => ev("!document.querySelector('#guideDialog').open"))) failures.push("guide: Escape did not close the modal");
                if (!await waitFor(() => ev("document.activeElement.id === 'welcomeHelp'"))) failures.push("guide: focus did not return to opener");
                await ev("document.querySelector('#setupButton').click()");
                if (process.env.POCKET_SCREENSHOTS) {
                  const shot = await tab("Page.captureScreenshot", { format: "png" });
                  writeFileSync(join(tmpdir(), "pocket-ai-setup.png"), Buffer.from(shot.data, "base64"));
                }
                await ev("document.querySelector('#setupDialog').close()");
                await ev(`document.querySelector('#pageButton').click();
                  const files = new DataTransfer(); files.items.add(new File(['<html><head><title>Saved article</title></head><body><article>Saved HTML text</article></body></html>'], 'article.html', {type:'text/html'}));
                  document.querySelector('#pageFile').files = files.files; document.querySelector('#pageFile').dispatchEvent(new Event('change'));`);
                if (!await waitFor(() => ev("document.querySelector('#pageText').value.includes('Saved HTML text')"))) failures.push("text: saved HTML was not extracted");
                await ev(`document.querySelector('#pageText').value = 'x'.repeat(100001); document.querySelector('#attachPage').click()`);
                if (!await ev("document.querySelector('#pageError').textContent.includes('100,000') && document.querySelector('#pageDialog').open")) failures.push("text: oversized attachment was accepted");
                await tab("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
                if (!await ev("document.querySelector('#pageDialog').scrollWidth <= document.querySelector('#pageDialog').clientWidth + 1")) failures.push("text: attachment panel overflows narrow phone width");
                if (process.env.POCKET_SCREENSHOTS) {
                  await ev("document.querySelector('#pageText').value = 'Rain comes from condensed water.'; document.querySelector('#pageError').textContent = ''; document.querySelector('#pageDialog').scrollTop = 0");
                  const shot = await tab("Page.captureScreenshot", { format: "png" });
                  writeFileSync(join(tmpdir(), "pocket-ai-text.png"), Buffer.from(shot.data, "base64"));
                }
                await ev("document.querySelector('#pageDialog').close()");

                await ev(`document.querySelector('#pageButton').click(); document.querySelector('#pageTitle').value = 'Offline reference'; document.querySelector('#pageText').value = 'Rain comes from condensed water.'; document.querySelector('#attachPage').click();`);
                const attached = await ev("document.querySelector('#sourceBadge').textContent.includes('Offline reference')");
                if (!attached) failures.push("offline: page text could not be attached");
                await ev("document.querySelector('#textSuggestions button:nth-of-type(2)').click()");
                if (!await ev("document.querySelector('#input').value === 'Explain this text in simple language.' && document.querySelectorAll('.message').length === 0")) failures.push("text: suggestion did not prepare an unsent question");
                await ev("document.querySelector('#sourceBadge button').click()");
                if (!await ev("document.querySelector('#pageDialog').open && document.querySelector('#pageText').value.includes('Rain comes')")) failures.push("text: reference could not be viewed");
                await ev("document.querySelector('#pageDialog').close()");
                await ev(`document.querySelector('#historySearch').value = 'Offline reference'; document.querySelector('#historySearch').dispatchEvent(new Event('input'));`);
                if (await ev("document.querySelectorAll('.history-item').length") !== 1) failures.push("history: search did not isolate attached-page chat");
                await tab("Page.reload");
                await waitFor(() => ev("document.querySelectorAll('.model-option').length > 0"));
                const persisted = await waitFor(() => ev("document.querySelector('#historyList').textContent.includes('Offline reference')"));
                if (!persisted) failures.push("offline: page chat was lost across reload");
                console.log("  offline: cold reopen, lazy runtimes, both tokenizer families, page attachment and history persistence");
              }
              await tab("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
            }
            await ev(`window.__beforeBlockedFetch = fetch; window.fetch = () => Promise.reject(new TypeError('Blocked by website')); document.querySelector('#pageButton').click(); document.querySelector('#pageUrl').value = 'https://example.com/article'; document.querySelector('#fetchPage').click();`);
            if (!await waitFor(() => ev("document.querySelector('#pageError').textContent.includes('Copy its text')"))) failures.push("text: blocked URL did not explain paste fallback");
            await ev("window.fetch = window.__beforeBlockedFetch; document.querySelector('#pageDialog').close()");
            // Exercise persisted chat actions with a fake cloud response, never a real API call.
            await ev(`window.__requests = []; window.__delayReply = false; window.__nativeFetch = fetch;
              window.fetch = (url, options = {}) => {
                if (url !== '/api/online-assist') return window.__nativeFetch(url, options);
                const payload = JSON.parse(options.body); window.__requests.push(payload);
                if (window.__delayReply) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
                return Promise.resolve(new Response(JSON.stringify({ content: 'Answer to: ' + payload.messages.at(-1).content }), { headers: { 'Content-Type': 'application/json' } }));
              };
              document.querySelector('#modelButton').click();
              [...document.querySelectorAll('.model-option')].find(el => el.textContent.includes('Online Assist')).click();
              document.querySelector('#loadButton').click();`);
            await waitFor(() => ev("!document.querySelector('#input').disabled"));
            await ev("document.querySelector('#textSuggestions button').click()");
            if (!await ev("window.__requests.length === 0 && document.querySelector('#input').value.includes('Summarize')")) failures.push("text: suggestion sent an online request automatically");
            await ev(`document.querySelector('#input').value = 'First question'; document.querySelector('#composer').requestSubmit();`);
            await waitFor(() => ev("document.querySelector('.message.assistant')?.textContent.includes('Answer to: First question')"));
            const sourceSent = await ev("window.__requests.at(-1)?.messages[0].content.includes('Rain comes from condensed water.')");
            if (!sourceSent) failures.push("page help: source was omitted from the explicitly selected online request");
            await ev(`document.querySelector('.message.user .message-actions button').click(); document.querySelector('#input').value = 'Edited question'; document.querySelector('#composer').requestSubmit();`);
            const edited = await waitFor(() => ev("document.querySelector('.message.assistant')?.textContent.includes('Answer to: Edited question')"));
            if (!edited || await ev("document.querySelectorAll('.message').length") !== 2) failures.push("chat edit: reply was not replaced cleanly");
            await ev("document.querySelector('.message.assistant .message-actions button').click()");
            await waitFor(() => ev("window.__requests.length === 3 && !document.querySelector('#input').disabled"));
            if (await ev("document.querySelectorAll('.message').length") !== 2) failures.push("retry: duplicated conversation turns");
            await ev(`window.__delayReply = true; document.querySelector('#input').value = 'Stop this reply'; document.querySelector('#composer').requestSubmit();`);
            await waitFor(() => ev("window.__requests.length === 4"));
            await ev("document.querySelector('#send').click()");
            const stopped = await waitFor(() => ev("!document.querySelector('#input').disabled && document.querySelector('#chat').textContent.includes('(stopped)')"));
            if (!stopped) failures.push("stop: online cancellation did not release the composer");
            const lateErrors = await ev("window.__bootErrors.join(' | ')");
            if (lateErrors) failures.push("interaction errors: " + lateErrors);
            console.log("  chat: page context, edit/resend, retry and stop (mock online responses)");
            if (process.env.POCKET_SCREENSHOTS) {
              await tab("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
              const shot = await tab("Page.captureScreenshot", { format: "png" });
              writeFileSync(join(tmpdir(), "pocket-ai-mobile.png"), Buffer.from(shot.data, "base64"));
            }
            const tiles = await ev(` [...new Set([...document.querySelectorAll('.model-option')].map(b => b.textContent.trim()))].join(', ') `);
            const hist = await ev("document.querySelectorAll('.history-item').length");
            if (!(hist >= 1)) failures.push("probe: history drawer rendered no rows");
            console.log(`  probe: ${hist} history row(s), ${[...new Set(tiles.split(','))].filter(Boolean).length} model tile(s)`);
          }
          cleanup();
        }
      }
    } catch (e) {
      failures.push(`probe: CDP failure — ${e.message}\n${e.stack || ""}`);
      cleanup();
    }
  }
}

if (failures.length) {
  console.error("✖ check failed:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("✔ check passed" + (notes.length ? `  (${notes.join("; ")})` : ""));