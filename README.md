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
no re-downloading, no web-storage quota involved, and it works with no connection at all.
That's the offline route for every model: **the app deliberately caches no weights** (see
[Why weights are never cached](#why-weights-are-never-cached)).

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

WebLLM weights persist in IndexedDB. **Bonsai weights are never cached by the app** — they stream
straight to the GPU (see [Why weights are never cached](#why-weights-are-never-cached)). Every Bonsai
model's small support files — manifest, aux, and the tokenizer — *are* cached, so **"Load from a
file…" works in airplane mode**: the file supplies the weights and the cached copies supply everything
else. A one-shot `navigator.storage.persist()` reduces eviction odds, and the service worker ignores
cross-origin fetches and never deletes `pocket-ai-meta-*`, so a shell update can't wipe them.

Switching models after one is loaded reloads the PWA so the WebGPU runtime is cleanly
recreated — except after "Load from a file…", where the picked file can't outlive a
reload, so that path disposes the old engine and starts the new one in-session instead.

## Why weights are never cached

The short version: **caching the weights in the Cache API was itself the bug.** 4B kept
crashing the tab while 8B — the *bigger* model — loaded fine every time, which ruled out
GPU memory and pointed at the one thing the two didn't share.

| Model | GGUF | Under the old 640 MB cap? | Result |
| --- | --- | --- | --- |
| 1.7B | 237 MiB | yes → `cache.put()` | stalled, then locked the UI |
| **4B** | **546 MiB** | **yes → `cache.put()`** | **tab killed** |
| 8B | 1105 MiB | no → streamed | worked, every time |

The old build capped `pocket-ai-models-v1` at 640 MB, so 1.7B and 4B were written into the
Cache API and 8B was not. iOS Safari materializes a `cache.put()` body **inside the tab's
page process**, so the only two models that ever ran that code path were the only two that
failed — and the failure scaled with body size: 237 MiB was survivable, 546 MiB was not. The
`"done"` marker, the truncation checks, and the per-model "Clear saved copy" chips all tried to
make that write *safe*; none of them could make it *small*.

So the write is gone. Weights go network → GPU with nothing in between, which is the same
path 8B always took. Offline is the file's job: **Save to Files** puts the GGUF on the device
via Safari's resumable download, and **Load from a file…** streams it from there. Only the
small support files (manifest, aux, tokenizer — KB, not MB) stay in the Cache API, which is
what makes that offline file-load complete. One-shot cleanup deletes any `pocket-ai-models-*`
cache left by an older build.

Chats are **durable on-device**: transcripts mirror into IndexedDB as you chat, so closing or
reloading the tab never loses them (and the app reopens ready to go). Context windows are
**token-accurate** (bitgpu's real tokenizer, not a character guess) and, for local chats under
~64 MB of KV cache, the whole conversation snapshot is saved too — reopening resumes at high
speed instead of re-prefilling everything. All of it stays on the phone; nothing is uploaded,
and no index or transcript leaves the device.

## Version history

### v0.6.0

- **Weights are never cached in-page.** On iOS Safari, `cache.put()` materializes the response body inside the tab's page process — a 546 MB GGUF (4B) was exactly enough to crash the tab and a 237 MB GGUF (1.7B) to wedge it. 8B, which had never fit that cap, loaded fine from the start. So Bonsai weights stream directly to the GPU — always online, never to the Cache API. The small support files (manifest/aux/tokenizer) still cache so **"Load from a file…" works fully offline**. The manifest, aux, and tokenizer files cache too, so a file-based load has everything it needs in airplane mode.
- **"Load from a file…" for every Bonsai model.** Pick a saved `Bonsai-*.gguf` from Files; the app parses the GGUF header in place (`fromGgufBytes`) and streams weights straight from the file. Per-model **"Save to Files"** chips hand Safari a resumable background download. No re-downloads, no quota games.
- **Honest 27B ceiling.** A heavyweight file-load shows a heads-up about the ~3.8 GB GPU footprint and the device's storage-buffer cap before it starts; caught OOM errors name the cap too. On a phone, Safari can still JetSam the tab silently — that's the device, not the app.
- **PWA iPhones finally recognize.** The manifest + icon lived at the repo root instead of `public/`, so iOS was handed an HTML page as its manifest and home-screen icon. Now `/manifest.webmanifest`, `/icon.svg`, and PNG icons (180/192/512) actually ship, with `apple-touch-icon`, `apple-mobile-web-app-capable`, and a `black-translucent` status bar.
- **Service worker plays nice with the model cache** — ignores cross-origin fetches and never deletes `pocket-ai-meta-*`.
- **`npm run check` guards the PWA wiring** (manifest parses as JSON, icons serve as images).
- **Token-accurate context.** Local chats are measured with bitgpu's real tokenizer and trimmed to the model's window — the system prompt stays pinned, newest turns survive, and max-token budgets no longer silently eat your context.
- **Higher-quality local defaults** — dedicated sampling presets (`temperature` 0.7, `topP` 0.9, `topK` 40) per Bonsai model instead of one shared guess.
- **Durable, instantly-resumable chats.** Transcripts persist in IndexedDB across tab close/reload. For local chats that fit ~64 MB of KV cache, a snapshot of the prewarmed context is saved after each turn (and on exit), so the next open restores the conversation at speed. Chats stay purely on-device.
- **Loads that can be interrupted.** Every load carries a **Cancel** button, a 45-second stall warning, and a load token: picking a different model cancels the one in flight (disposing its GPU memory) and starts the new one immediately — a stuck load can never lock you out of the app.
- **Nothing loads until you say so.** There is no auto-load at all: opening the app never downloads or starts a model, never picks a model for you, and never silently swaps you to a different one. You choose the model and tap **Load Local AI**. (The only automatic action is a hint button after a file-based session, since a picked `.gguf` can't survive a reload.)
- **"Update site" button** (drawer footer) — pulls the newest build without deleting the app from the Home Screen: unregisters the service worker, drops the shell cache, reloads. **Your cached metadata files and chats stay put**, so updating never costs a re-download. (Weights are never cached, so streaming models don't re-download unless you switch them.)


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