# Pocket AI

> **Private 1-bit local AI chat · v0.6.0**
> Low-bit LLMs running directly on your device GPU. No server,
> no API key, no uploads. Install it to your iPhone Home Screen and it behaves like an app.

Built on [bitgpu](https://github.com/stfurkan/bitgpu) — a dependency-free WebGPU runtime
for 1-bit Bonsai models — with MLC/WebLLM as the baseline runtime and an optional
**Online Assist** cloud mode.

---

## What it does

- **Truly local.** Weights stream to your device and inference runs on the GPU; nothing leaves the phone. Load the page and the app works — or go further and load models from a file, and it works offline too.
- **1-bit Bonsai Qwen3 models** via the native WebGPU path — pocket-sized files at unusually small memory footprints (a 27B at ~1.1 bits/weight).
- **PWA-first on iOS.** Real manifest, PNG touch icon, `black-translucent` status bar — it installs and launches full-screen.
- **Optional Online Assist** for current information, proxied through a private Firebase Function so no key ever ships in the client.

## Model lineup

| Model | Runtime | First load | Status |
|---|---|---|---|
| Qwen 0.5B | MLC/WebLLM | IndexedDB cache | Known-good baseline |
| Bonsai 1.7B Q1 | bitgpu/WebGPU | Cache API (~290 MB) or file | Confirmed working |
| Bonsai 4B Q1 | bitgpu/WebGPU | Network or file (~570 MB) | Working |
| Bonsai 8B Q1 | bitgpu/WebGPU | Network or file (~1.16 GB) | Working — **largest that fits a phone** |
| Bonsai 27B Q1 | bitgpu/WebGPU | Local GGUF file, or ~3.8 GB stream | Desktop-class; phones may refuse |

Every Bonsai row exposes a **"Save to Files"** chip (Safari's resumable download) and a
**"Load from a file…"** picker, so any model can run straight from a local `.gguf` —
no re-downloading, no web-storage quota involved. 1.7B and 4B also load offline from the
on-device weight cache once they've loaded online; 8B and 27B use the file while offline.

Qwen3 1.7B is intentionally omitted from this build while Bonsai bitgpu testing continues.

## The 1-bit model landscape — why 8B is the iPhone ceiling

bitgpu accepts exactly one format: **binary 1-bit GGUF in ggml type `Q1_0`**, on a
`qwen3` dense or `qwen3.5` hybrid architecture. Everything else hard-fails at load
(and the engine validates loudly, never silently).

| Rung | What exists | Fits a phone? |
|---|---|---|
| ≤ 1.7B | Bonsai 1.7B | ✔ Confirmed |
| 4B | Bonsai 4B | ✔ Works |
| 8B | Bonsai 8B | ✔ **The practical ceiling** |
| 8B → 27B | — *nothing* — | ✗ This gap has no entries |
| 27B | Bonsai 27B (hybrid) | ✗ Desktop-class; phones usually die |

We audited the Hugging Face Hub for a mid-size rung and every lead falls at the same gate:

- **Ternary-Bonsai (Q2_0)** — ternary `{−1, 0, +1}` packing, not type `Q1_0`; and *bigger* (7.2 GB), so it would be worse, not better.
- **Ollama's "Bonsai 27B Q1"** — an unofficial mirror of the identical `Bonsai-27B-Q1_0.gguf` we already ship: same bytes, same size, same memory ceiling.
- **Qwen3-14B & friends** — only standard multi-bit quants (`Q2_K` … `Q4_K_M`); wrong type, and 5.7 GB+ anyway.
- **`Qwen3-14B-medusa-1bit`** — raw medusa-head tensor dumps, not a loadable model.
- **`1bit-MONSTER/*`** — the "1bit" is the org's name; repos actually hold `Q4_K_M` files.
- **llama.cpp `IQ1_S`/`IQ1_M`** — genuine ~1-bit, but ggml types 33/34, not 41.

So **8B is the real iPhone ceiling and 27B is the next step up — there is no middle
tier from anyone.** Should PrismML ever ship a mid-size Bonsai, it drops straight into
the data-driven `MODELS` config (the file-load path already matches picks by filename)
as a one-entry change — no new plumbing.

## Run it

```bash
npm install
npm run dev
```

Open the HTTPS Vite address on the iPhone.

### Before shipping

`npm run check` is the whole local gate: it syntax-checks the app and functions, runs the
production build, then boots the fresh `dist/` headless over CDP and asserts the model
tiles and history drawer render with zero boot errors (auto-skips the browser probe when
no Chromium is on PATH). CI runs it on every push.

```bash
npm run check
```

### Deploy

Builds are ephemeral (`dist/`/`.vite/` are untracked). By hand:

```bash
npm run build && firebase deploy
```

Firebase hosting auto-deploys from the GitHub Actions workflow on every push.

## Online Assist

Local models stay private and offline. **Online Assist** is the one opt-in remote path:
the active conversation goes to the FreeLLM-compatible service you configure. Keep
credentials out of the browser — set them as Firebase secrets:

```bash
firebase functions:secrets:set FREELLM_API_URL
firebase functions:secrets:set FREELLM_API_KEY
firebase deploy --only functions,hosting
```

For a self-hosted FreeLLMAPI instance, the URL is usually
`https://your-host.example/v1/chat/completions`. The proxy uses its `auto:smart` route.
Remote by design — don't use it for messages you want to keep entirely on-device.

## Important

WebLLM weights persist in IndexedDB. Bonsai **1.7B and 4B weights** cache through the Cache API
(store capped at 640 MB — iOS Safari crashes its page process on larger `cache.put` bodies and its
Cache quota is ~1 GB, so **8B / 27B** stream from the network each launch). Every Bonsai model's
small support files — manifest, aux, and the tokenizer — are cached too, so **any model that has
ever loaded online boots again in airplane mode**: 1.7B/4B straight from the cached weights, and
**8B/27B from a saved GGUF file** ("Load from a file…", which never touches the cache — the tokenizer
the file-load needs is served from its cached copy). A one-shot `navigator.storage.persist()`
reduces eviction odds, and the service worker ignores cross-origin fetches and never
deletes `pocket-ai-models-*`, so shell updates can't wipe a multi-GB model.

Switching models after one is loaded reloads the PWA so the WebGPU runtime is cleanly
recreated — except after "Load from a file…", where the picked file can't outlive a
reload, so that path disposes the old engine and starts the new one in-session instead.

Chats are **durable on-device**: transcripts mirror into IndexedDB as you chat, so closing or
reloading the tab never loses them (and the app reopens ready to go). Context windows are
**token-accurate** (bitgpu's real tokenizer, not a character guess) and, for local chats under
~64 MB of KV cache, the whole conversation snapshot is saved too — reopening resumes at high
speed instead of re-prefilling everything. All of it stays on the phone; nothing is uploaded,
and no index or transcript leaves the device.

## Version history

### v0.6.0

- **Bonsai weights cached on device — 1.7B (~290 MB) and 4B (~570 MB)** via a Cache API-backed `fetchStream`: first launch downloads once, and the copy is what airplane mode boots from (and the fallback when the network drops). Online launches stream fresh from the network and refresh the copy. 8B/27B out-grow iOS's ~1 GB Cache quota, so they're never cached (or load from a saved file). The manifest, aux, and tokenizer files cache too, so whatever has loaded online once also boots in airplane mode.
- **"Load from a file…" for every Bonsai model.** Pick a saved `Bonsai-*.gguf` from Files; the app parses the GGUF header in place (`fromGgufBytes`) and streams weights straight from the file. Per-model **"Save to Files"** chips hand Safari a resumable background download. No re-downloads, no quota games.
- **Honest 27B ceiling.** A heavyweight file-load shows a heads-up about the ~3.8 GB GPU footprint and the device's storage-buffer cap before it starts; caught OOM errors name the cap too. On a phone, Safari can still JetSam the tab silently — that's the device, not the app.
- **PWA iPhones finally recognize.** The manifest + icon lived at the repo root instead of `public/`, so iOS was handed an HTML page as its manifest and home-screen icon. Now `/manifest.webmanifest`, `/icon.svg`, and PNG icons (180/192/512) actually ship, with `apple-touch-icon`, `apple-mobile-web-app-capable`, and a `black-translucent` status bar.
- **Service worker plays nice with the model cache** — ignores cross-origin fetches, never deletes `pocket-ai-models-*`.
- **`npm run check` guards the PWA wiring** (manifest parses as JSON, icons serve as images).
- **Token-accurate context.** Local chats are measured with bitgpu's real tokenizer and trimmed to the model's window — the system prompt stays pinned, newest turns survive, and max-token budgets no longer silently eat your context.
- **Higher-quality local defaults** — dedicated sampling presets (`temperature` 0.7, `topP` 0.9, `topK` 40) per Bonsai model instead of one shared guess.
- **Durable, instantly-resumable chats.** Transcripts persist in IndexedDB across tab close/reload. For local chats that fit ~64 MB of KV cache, a snapshot of the prewarmed context is saved after each turn (and on exit), so the next open restores the conversation at speed. Chats stay purely on-device.
- **Loads that can be interrupted.** Every load carries a **Cancel** button, a 45-second stall warning, and a load token: picking a different model cancels the one in flight (disposing its GPU memory) and starts the new one immediately — a stuck load can never lock you out of the app.
- **Never downloads behind your back.** On open, the app auto-loads **only** a model whose weights are already saved on this device (a pure disk read — online or offline); a first launch just shows the model chooser, and no surprise 300 MB+ stream ever starts on its own. Pick a model → tap **Load Local AI** → it remembers itself as "installed" and resumes next time.
- **A saved copy is only trusted when it's provably whole.** The weights get a "done" marker written *after* the body lands, so an interrupted/evicted `cache.put()` can never masquerade as a usable model (a truncated GGUF is what used to stall a load forever or crash it). Damaged copies are deleted automatically. Online loads stream from the network and refresh the saved copy — reading a few hundred MB back out of iOS's Cache API proved unreliable — so the saved copy is what airplane mode uses, plus a fallback when the network hiccups.
- **"Clear saved copy" per model** (model sheet, under "Saved copies:") — drop one model's stored weights without reinstalling the app.
- **"Update site" button** (drawer footer) — pulls the newest build without deleting the app from the Home Screen: unregisters the service worker, drops the shell cache, reloads. **Your model weights, cached support files, and chats all stay put**, so updating never costs a re-download.

### v0.5.1 — Housekeeping

- `npm run check` is the single local gate (syntax + production build + headless CDP boot probe).
- One service worker (`public/sw.js`); the root-level copy is gone.
- `dist/` and `.vite/` untracked; vendor skill docs out of git. Repo slimmed from 200+ files to a handful.

### v0.5.0 — Honest load bar, and an iPhone makes eyes at a 27B

- **The Bonsai load bar works now** — bitgpu reports `{ phase, loaded, total }`; the bar previously watched a `fraction` field that never existed. Live MB counter, percentage, per-phase labels.
- **Preflight for heavyweight models** (27B): persistent-storage request, free-space report, honest warning before a ~3.8 GB stream. Warns, never blocks.
- **Bonsai 27B Q1 enabled as a desktop-class experiment** (qwen3.5 hybrid, `head_dim` 256 — inside bitgpu 0.19.1's envelope; the risk is purely physics).

### v0.4.5 — Stop button, a history drawer that actually draws, downloadable threads

- **Stop mid-answer.** Send becomes ⏹ during generation; a stopped answer keeps its text and never offers to Continue.
- **The history drawer exists** — chats were saving; nothing listed them. Rows open, **↓ download a Markdown transcript** (to Files on iOS), **× delete**.
- **Chats are ephemeral by design** (sessionStorage: survive the model-switch reload, vanish with the tab). Download what you want to keep.
- Friendlier context-overflow failure ("chat too long — start a new chat").

### v0.4.4 — Finished answers

- Answer lengths raised (96 → 512 tokens); overshoot offers a **Continue** chip that resumes exactly where it stopped (up to two chained).
- History trimmed by token estimate against the 2048-token window instead of message count.
- Online Assist still capped server-side at 512.

### v0.4.3 — Online Assist

- **Private FreeLLM proxy** via Firebase Function (no API key in the PWA) with the `auto:smart` route; corrected the Bonsai 27B GGUF download URL.

### v0.4.2 — Bonsai 4B experiment

- Kept Qwen 0.5B + Bonsai 1.7B; added Bonsai 4B via bitgpu's manifest + aux. 2048-token context, q8 KV for both. Bumped selection/cache keys so old Qwen3 state can't persist.

### v0.4.1 — bitgpu Bonsai + Qwen3 1.7B

- Bonsai 1.7B moved to bitgpu; Qwen3 1.7B added as experiment; cache version + generation diagnostics updated.

### v0.3.2 — Correct custom ModelRecord

- Registered the Bonsai Q1 `ModelRecord`; fixed `findModelRecord` init; used the correct Bonsai Q1 WebGPU WASM library.

### v0.3.1 — Bonsai Q1 experiment

- Switched the Bonsai entry to 1.7B Q1; generation diagnostics; smaller first-test context/prefill.

### v0.3.0 — Model selector

- Qwen 0.5B retained as fallback; Bonsai experimental selection added.

### v0.2.1 — iPhone/Safari reliability

- HTTPS dev config, WebGPU diagnostics, IndexedDB model caching, Qwen 0.5B baseline.

### v0.2.0 — WebLLM/WebGPU foundation

- Local browser inference via MLC/WebLLM, WebGPU detection, PWA-oriented chat interface.