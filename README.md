# Pocket AI

> Private on-device chat for iPhone Safari · v0.8.2

Pocket AI runs supported local models using WebGPU. Its Bonsai GGUF file path works offline after the app has finished installing its support files. Online Assist is a separate, explicit remote option.

## User guide

For everyday use, read the [Pocket AI user manual](USER-MANUAL-README.md). The same guide is available through **Help & user guide** in the app and works offline after setup. This README covers development, runtime details and deployment.

## Start here

```sh
npm install
npm run dev
```

The development server uses HTTPS. Offline installation is enabled in production builds, including a local production preview:

```sh
npm run build
npm run preview
```

No model downloads or starts automatically. New users start with Bonsai 1.7B selected; an existing selection is preserved. Choose **Load Local AI**, or **Load from a file…** in the model menu.

## Take a GGUF offline

1. Open the production app online. Wait for **App ready for offline GGUF**. On iPhone, add it to the Home Screen through Safari's Share menu.
2. Use **Save to Files** in the model menu. Ensure the GGUF is downloaded onto the device, not only present in iCloud.
3. Reopen in airplane mode. Choose **Load from a file…** and select the saved GGUF. A File handle cannot survive a restart, so you must select it again each session.

The installed bundle includes every JavaScript chunk, stylesheet and both tokenizer families. The GGUF supplies its own manifest and weight data. File loads check the support files before allocating GPU weights. The 27B tokenizer is now bundled too; this does **not** make its memory requirements suitable for every phone.

Bonsai weights are streamed from Files or the network and are never written to Cache API storage. This preserves the project's workaround for large in-page cache writes on Safari. The app shell and tokenizers **do** use the service worker's Cache API storage. Safari can evict website storage, so check readiness before travelling and retain your GGUF in Files.

**Update site** installs a complete replacement before switching over. A failed update keeps the working offline copy. Chat history and model metadata are preserved.

## Model choices

| Model | Runtime | Use |
| --- | --- | --- |
| Qwen 0.5B | WebLLM | Small baseline; separate runtime-managed model cache, not a GGUF file load |
| Bonsai 1.7B Q1 | bitgpu | Recommended starting point for GGUF on iPhone; roughly 290 MB download |
| Bonsai 4B Q1 | bitgpu | Larger option; roughly 570 MB download |
| Bonsai 8B Q1 | bitgpu | Experimental; roughly 1.16 GB download |
| Bonsai 27B Q1 | bitgpu | Desktop-class experiment; roughly 3.8 GB of weights plus runtime memory |

File loading supports the listed **Bonsai Q1_0 GGUF** releases, with their recognizable Bonsai filenames. It does not support arbitrary GGUF quantizations. Unknown filenames and incompatible architectures produce an error. There is no universally guaranteed iPhone model ceiling: available memory, context allocation, browser version and other apps all matter.

## Chat and text attachments

- Local answers stream as they are generated. Stop preserves partial text. Retry regenerates an answer; Edit & resend replaces the edited turn and subsequent messages after you send.
- History is stored in IndexedDB and is searchable by title or message. Export a Markdown transcript, including an attached reference, or delete a chat and its snapshots.
- **Ask about text** accepts pasted text or a saved text/HTML file. Each attachment starts a new chat and is retained across reloads. HTML scripts are not inserted into the live page.
- Local page questions work offline. The model receives a bounded excerpt, with a visible notice when the full source or older messages do not fit. Shorten the source to ask about a later section. This is page-context prompting, not a document search index.
- **Fetch a URL online** is an explicit direct request to that website. Browser CORS restrictions may block it; paste text instead. It requires HTTPS and limits downloads to 2 MB. Page text is capped at 100,000 characters.
- Context budgeting uses bitgpu's tokenizer and each model's configured window: 4K for 1.7B/4B, 8K for 8B, 2K for 27B. WebLLM uses a conservative text estimate. An oversized newest request is rejected, never silently discarded.

Transcripts are authoritative. A compatible short-chat KV snapshot can accelerate reopening; it never replaces newer chat messages. Chats with page references skip snapshots. Storage errors tell the user to export their chat.

## Measure your device

**Speed test** runs one warm-up and three measured replies using the same prompt and 128-token budget. It saves the median time to first visible text and whole-reply tokens/second (including prompt processing). Warm-up is excluded. Load medians use actual successful model loads with the same source, rather than repeated generation runs. Interrupted or empty runs are not saved.

Results are separated by browser, exposed GPU features/limits, model settings and runtime version. Model guidance requires successful load and reply evidence on the matching profile. Later load or GPU failures invalidate that guidance until a fresh successful load and reply. This is observed compatibility, not a memory guarantee. No phone model or RAM capacity is inferred. Measurements stay on this device and can be cleared. Older single-run measurements do not count toward the new comparison.

Temperature, battery state, GPU contention and warm caches affect results. These measurements compare speed, not answer quality. The separate offline setup and model guidance explain expected download and memory costs.

## Online Assist

Sending a message in Online Assist sends the active prompt and any attached page excerpt to the configured service. There is no automatic fallback from local inference. Cloud replies currently arrive as a complete response; Stop cancels the browser request, and both client and proxy have timeouts.

```sh
firebase functions:secrets:set FREELLM_API_URL
firebase functions:secrets:set FREELLM_API_KEY
firebase deploy --only functions,hosting
```

The generic proxy uses `auto:smart` unless `FREELLM_MODEL` is configured. Keep API credentials in Firebase secrets.

### Optional Bonsai 27B online route

Local 27B remains an experiment with a 2K context and q8 KV cache. Weight storage alone is about 3.8 GB; GPU buffer limits and working memory can prevent loading. Runtime memory errors retain their original allocation details. A session load journal reports unfinished loads after a reload or restored tab; it cannot prove that Safari killed the tab or recover a session Safari discarded.

After a failed local 27B load, or through **27B online options**, the app offers a consent dialog. Nothing is uploaded automatically. **Check online availability** contacts the app server without chat content. **Use Bonsai 27B online** switches the session; only a subsequent Send submits the question, relevant history and page excerpt. Reopening returns to local 27B. All existing local GGUF features remain usable offline.

To enable the option, set the Firebase string parameter `FREELLM_27B_MODEL` in the project's functions environment (`.env.<project-id>`) to the provider's exact Bonsai 27B model route, then deploy `onlineAssist`. The default empty value disables it; `auto:*` routes are rejected. The provider configured by `FREELLM_API_URL` must actually serve that checkpoint. Availability checks report configuration, not successful inference. No specific provider route has been verified by this change.

The client sends the fixed profile `bonsai-27b`; the server chooses the configured model. An outdated backend or missing configuration cannot silently substitute generic Online Assist. Credentials and provider model identifiers are not returned by the capabilities endpoint.

**Deployment:** the existing push workflow deploys Hosting only. Deploy the updated function separately with `firebase deploy --only functions:onlineAssist` before enabling this option. Hosting deployment alone does not install the new API handler.

## Validation and release

```sh
npm run check
```

The gate checks syntax, prompt budgets, offline installation/failure behavior and the production build. With Chromium installed, it also verifies manifest/icons, cold offline reload, lazy runtime imports, both tokenizer configurations, page attachment persistence, history search, and edit/retry/stop using simulated cloud responses. It never sends a real AI API request or downloads model weights.

The Chromium probe does not establish real iPhone GPU compatibility. Before release, follow [the iPhone acceptance checklist](docs/IPHONE-ACCEPTANCE.md) with actual GGUF files. Production deployment remains `npm run build && firebase deploy`; the Firebase GitHub workflow deploys Hosting on pushes to main, while functions require a separate deployment.

Tokenizer source and license information is recorded in [THIRD_PARTY.md](THIRD_PARTY.md).

## Version history

### v0.8.2

- Add a beginner user manual, also bundled as an offline in-app guide.
- Rename Page help to Ask about text, clarify attachments and add question suggestions that never send automatically.
- Guide offline setup through app files, saved models and an airplane-mode check; show original errors under Technical details.
- Improve phone-sized controls, dialog focus and reference viewing.

### v0.8.1

- Restore dependency constraints accidentally changed during the previous version bump, fixing Firebase CI installation.
- Finish reading app assets before caching them to avoid tokenizer stream cache failures. Limit downloads to two concurrent files, retry failures, and retain completed files across interrupted installations. Model weights are never buffered or cached by this installer.
- Add Repair offline setup, report missing files, and prevent stale readiness replies from overwriting current status.

### v0.8.0

- Warm-up plus three-run local benchmarks, real load medians and evidence-based model guidance.
- GPU/runtime profile separation, preserved allocation errors and unfinished-load session recovery.
- Explicit-consent Bonsai 27B online profile, disabled until the backend route is configured.
- Local offline mode and local 27B's 2K context remain available.

### v0.7.0

- Complete offline installation, including lazy runtime files and the 27B tokenizer; safe service-worker updates and visible readiness.
- iPhone guidance, source/model labels, GPU-loss recovery, generation/load cancellation improvements.
- Searchable history, edit/resend, retry, local page text and saved HTML/text input, optional direct URL fetching.
- Per-model context windows, visible excerpt trimming, durable transcript protection, and per-device speed measurements.
- Deferred WebLLM import reduces initial UI parsing; unchanged chats are no longer rewritten to IndexedDB on every save.
- Offline and chat-interaction regression checks.

Entries below describe historical behavior, including policies that v0.7.0 replaces.

### v0.6.0

- **Weights are never cached in-page.** On iOS Safari, `cache.put()` materializes the response body inside the tab's page process — a 546 MB GGUF (4B) was exactly enough to crash the tab and a 237 MB GGUF (1.7B) to wedge it. 8B, which had never fit that cap, loaded fine from the start. So Bonsai weights stream directly to the GPU — always online, never to the Cache API. Manifest and aux still cache for the download path, so **"Load from a file…" works fully offline**.
- **Offline file-load no longer depends on a cache write succeeding.** The shared 1.7B/4B/8B `Qwen2Tokenizer` now ships with the app at `/tokenizer/` and is precached same-origin by the service worker, instead of being written to the Cache API by a fire-and-forget `cache.put()` whose failure was silently swallowed. Manifest and aux are parsed out of the picked GGUF, so an airplane-mode file-load needs no network and no cache. The 27B hybrid keeps its own remote tokenizer — different vocab. Service-worker precaching also stopped using all-or-nothing `cache.addAll()`, which could abandon the whole install over one unreachable URL.
- **Cache failures are visible.** `metaFetch` and the tokenizer prefetch log their rejections instead of discarding them, so a storage problem shows up in the console rather than as a mysteriously broken offline load.
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
- **"Update site" button** (drawer footer) — pulls the newest build without deleting the app from the Home Screen: unregisters the service worker, drops the shell cache, reloads. **Your chats, KV snapshots and cached metadata stay put**, so updating never costs a re-download. (Weights are never cached, so streaming models don't re-download unless you switch them. The bundled tokenizer is re-precached automatically on the reload.)


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