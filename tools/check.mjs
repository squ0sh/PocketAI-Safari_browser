import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, createReadStream, rmSync } from "node:fs";
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
  ".css": "text/css", ".svg": "image/svg+xml",
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
for (const file of ["src/main.js", "functions/index.js"]) run("node", ["--check", file]);

// 2. Production build.
run("npx", ["vite", "build"]);

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