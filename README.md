# Pocket AI — v0.6.0

## v0.6.0 — Bonsai weights on disk, and a PWA iPhones finally recognize

- **Bonsai weights are cached on device — up to about 384 MB.** bitgpu already streamed the GGUF, so the real cost was re-downloading it every launch. The app now hands bitgpu a Cache API-backed `fetchStream`: the first launch downloads once (streaming to disk as it loads), later launches stream from disk — instant and offline-capable. iOS Safari crashes its page process when writing bodies much beyond ~1.5 GB and its Cache API quota is ~1 GB, so the store is size-capped: 1.7B (~290 MB) caches; 4B/8B/27B silently fall back to plain network streaming every launch rather than draining the phone's memory. A one-shot `navigator.storage.persist()` reduces eviction odds.
- **The service worker plays nice with the cache.** It now ignores cross-origin fetches (model weights never churn the shell cache) and never deletes `pocket-ai-models-*` on activation, so shell updates can't wipe a multi-GB model.
- **The PWA manifest and icon actually reach iPhones now.** They lived at the repo root instead of `public/`, so the build never shipped them — the live site was answering `/manifest.webmanifest` and `/icon.svg` with `index.html` via the SPA rewrite. iOS was being handed an HTML page as its manifest and as its home-screen icon. They now live in `public/`, joined by `icon-180.png`, `icon-192.png`, and `icon-512.png` (rasterized from the SVG).
- **iOS PWA polish:** `apple-touch-icon` points at a real PNG (iOS ignores SVG icons), plus `apple-mobile-web-app-capable`, `mobile-web-app-capable`, and a `black-translucent` status bar.
- **`npm run check` now guards the PWA wiring**: it asserts `/manifest.webmanifest` parses as JSON with PNG icons, and that the icon files serve as images, not HTML.
- **The 27B finally has a reliable road onto an iPhone: load its weights from a local file.** The model sheet's "Load from a file…" opens Safari's file picker; pick a saved `Bonsai-*.gguf` (any model in the sheet has a "Save to Files" chip, which hands Safari a resumable background download) and the app parses the GGUF header in place with `fromGgufBytes` and streams weights straight from the file — no re-download, no Cache-quota or Jetsam risk from the store, and the download lives in Files where iOS storage rules are kind — 1.7B/4B/8B/27B all work this way, so those never need re-downloading either. Because a picked file can't survive a page reload, an in-session model switch disposes the old engine instead of reloading.
- **Honest ceiling for the 27B.** The ~3.8 GB WebGPU footprint is physics: on a phone, Safari can silently kill the tab mid-load (Jetsam) before the app can even report it. The app now faces a heavyweight file-load with a heads-up line about that ceiling and the device's storage-buffer cap before it starts, and a caught OOM error names the cap too. The 27B is a desktop-class experiment; on iPhone it may simply be beyond the device.

## v0.5.1 — Housekeeping: one check command, one service worker, a leaner repo

- **`npm run check`** is now the single local gate: syntax-checks `src/main.js` + `functions/index.js`, runs the production Vite build, then boots the fresh `dist/` headless over CDP and asserts the model tiles and the history drawer actually render with zero boot errors. It auto-skips the browser step when no Chromium is on PATH.
- **One service worker** lives in `public/sw.js` (copied into `dist/` at build). The old root-level copy is gone.
- **`dist/` and `.vite/` are no longer tracked.** Builds are ephemeral: `npm run build` regenerates them, and the Firebase GitHub Actions redeploy chain builds fresh in CI. To deploy by hand: `npm run build && firebase deploy`.
- Repository slimmed from 200+ tracked files to a handful: the vendored `.agents/` / `.claude/` skills (Flutter-era docs for this JS app) are out of git.

## v0.5.0 — Honest load bar, and an iPhone makes eyes at a 27B

- **The Bonsai load bar works now.** bitgpu reports phase + bytes (`loaded`/`total`), but the app was watching for a `fraction` field that never existed — the bar sat dead through every download. The bar now shows a live MB counter, percentage, and per-phase labels (manifest → weights → pipeline compilation).
- **Preflight for heavyweight models** (currently the 27B): asks the browser for persistent storage, reports free space, and warns before committing to a ~3.8 GB stream. It warns, it never blocks — the experiment is yours.
- **Bonsai 27B Q1 enabled as a desktop-class experiment on iPhone.** The architecture (qwen3_5 hybrid, `head_dim` 256) is within bitgpu 0.19.1's supported envelope; the risk is purely physics — if a phone refuses, it now says so somewhere informative.
- **Honest cache note:** WebLLM weights persist in IndexedDB; Bonsai weights currently re-stream from the network on every launch. An app-owned on-disk cache is planned once the 27B proves it boots.

## v0.4.5 — Stop button, a history drawer that actually draws, downloadable threads

- **Stop mid-answer.** The send button becomes ⏹ during generation (WebLLM `interruptGenerate()`, AbortSignal for bitgpu); a stopped answer keeps whatever text it had and never offers to Continue. Status line shows "…generating".
- **The history drawer finally exists.** It was wired in markup and CSS but never rendered — chats *were* saving; nothing listed them. Rows now open the chat, **↓ downloads a Markdown transcript** (straight to Files on iOS), **× deletes**.
- **Chats are ephemeral by default.** History now lives in sessionStorage: it survives the required reload on model switch, and vanishes when the tab closes. Download anything you want to keep. Existing conversations migrate across once, then the durable copy is removed.
- Friendlier context-overflow failure ("chat too long for the model's memory — start a new chat") instead of a raw engine traceback.
- Service-worker cache key bumped to v0.4.5.

## v0.4.4 — Finished answers

- Raised local answer-length limits (WebLLM 96 → 512 tokens, Bonsai 256 → 512) so longer replies can complete.
- When a reply still hits the length cap, a **Continue** chip appears under the bubble; tapping it resumes exactly where the answer stopped, in the same bubble (up to two chained continuations).
- Conversation history is now trimmed by token estimate against the 2048-token context window instead of a fixed message count, so long chats degrade gracefully instead of silently overflowing.
- Online Assist is unchanged (still capped server-side at 512 tokens).

## v0.4.3 — Online Assist

- Corrected the Bonsai 27B GGUF download URL.
- Added a clearly labeled remote Online Assist mode.
- Added a Firebase Function proxy so the PWA never contains the remote API key.

## Current model lineup

- **Qwen 0.5B** — MLC/WebLLM known-good baseline.
- **Bonsai 1.7B Q1** — browser-native bitgpu 1-bit WebGPU runtime; confirmed working on iPhone.
- **Bonsai 4B Q1** — larger 1-bit Bonsai experiment using the same bitgpu runtime; published model data is about 570 MB.

Qwen3 1.7B is intentionally omitted from this build while we continue testing the Bonsai 1-bit models.

## Current build

Pocket AI is a browser-local PWA that runs models directly on the device GPU. It does not require a server or API key.

It also includes an optional **Online Assist** mode. Local models remain private and
offline; Online Assist sends the active conversation to the FreeLLM-compatible service
that you configure through a Firebase Function.

## Online Assist setup

Online Assist deliberately keeps credentials out of the browser. Before deploying,
set the complete OpenAI-compatible chat-completions URL and your API key as Firebase
secrets:

```bash
firebase functions:secrets:set FREELLM_API_URL
firebase functions:secrets:set FREELLM_API_KEY
firebase deploy --only functions,hosting
```

For a self-hosted FreeLLMAPI instance, the URL is normally
`https://your-host.example/v1/chat/completions`. The proxy uses its `auto:smart`
route by default. Online Assist is remote by design: do not use it for messages you
want to keep entirely on-device.

### v0.4.2 — Bonsai 4B experiment
- Kept **Qwen 0.5B** as the known-good WebLLM baseline.
- Kept the working **Bonsai 1.7B Q1** bitgpu integration unchanged.
- Added **Bonsai 4B Q1** using bitgpu 0.19.1's published Bonsai 4B GGUF manifest and auxiliary data.
- Removed **Qwen3 1.7B** from the selector for now.
- Uses a 2048-token context and q8 KV cache for both Bonsai models as the initial iPhone experiment.
- Bumped the model-selection storage key and service-worker cache so an older Qwen3 selection/cache cannot silently persist into this build.

The bitgpu project documents ready-made manifests for Bonsai 1.7B, 4B, and 8B, with the weights streamed from Hugging Face and processed locally in the browser.

## Models

| Model | Runtime | Status | Approximate first download |
|---|---|---|---|
| Qwen 0.5B | MLC/WebLLM | Known-good baseline | small |
| Bonsai 1.7B Q1 | bitgpu/WebGPU | Confirmed working | ~240–290 MB class |
| Bonsai 4B Q1 | bitgpu/WebGPU | Experimental | ~570 MB class |
| Bonsai 27B Q1 | bitgpu/WebGPU | Desktop-class experiment (iPhone first) | load from a local GGUF file (no download) or stream ~3.8 GB |

## Run

```bash
npm install
npm run dev
```

Open the HTTPS Vite address on the iPhone.

Before shipping, run `npm run check` (syntax + production build + a headless
boot probe when Chromium is installed). CI runs it on every push.

## Important

The first time a WebLLM model (Qwen) is used, its weights are downloaded and cached in IndexedDB, so later launches are local. Bonsai weights are cached on device through the Cache API after their first download (1.7B; bigger models stream), so later launches stream from disk — or straight from the network if storage is full. Any Bonsai model can instead be loaded from a local file via the model sheet's "Load from a file…" picker, which bypasses downloads entirely.

Switching models after one is loaded reloads the PWA so the WebGPU runtime is cleanly recreated — except after "Load from a file…", where the picked file can't outlive a reload, so that path disposes the old engine and starts the new one in-session instead.

## Version history

### v0.4.2 — Bonsai 4B experiment
- Added Bonsai 4B Q1 through bitgpu.
- Removed Qwen3 1.7B from the active selector.
- Preserved the working Bonsai 1.7B Q1 path.

### v0.4.1 — bitgpu Bonsai + Qwen3 1.7B
- Bonsai 1.7B moved to bitgpu.
- Added Qwen3 1.7B as an experiment.
- Fixed the bitgpu integration import: `createEngine` from `bitgpu` and `createChat` from `bitgpu/chat`.
- Updated browser cache version and added detailed generation diagnostics.

### v0.3.2 — Correct custom ModelRecord
- Registered the Bonsai Q1 `ModelRecord` alongside the prebuilt WebLLM models.
- Fixed the `findModelRecord` initialization failure.
- Used the correct Bonsai Q1 WebGPU WASM library.

### v0.3.1 — Bonsai Q1 experiment
- Switched the experimental Bonsai entry to Bonsai 1.7B Q1.
- Added generation diagnostics.
- Reduced the first browser test to a small context/prefill configuration.

### v0.3.0 — Model selector
- Qwen 0.5B retained as the fallback.
- Added Bonsai experimental model selection.

### v0.2.1 — iPhone/Safari reliability
- HTTPS development configuration.
- WebGPU diagnostics.
- IndexedDB model caching.
- Qwen 0.5B as the known-good local model.

### v0.2.0 — WebLLM/WebGPU foundation
- Local browser inference through MLC/WebLLM.
- WebGPU capability detection.
- PWA-oriented chat interface.
