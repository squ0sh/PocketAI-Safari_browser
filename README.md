# Pocket AI — v0.4.2

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

## Run

```bash
npm install
npm run dev
```

Open the HTTPS Vite address on the iPhone.

## Important

The first time a model is used, its weights are downloaded and cached by the browser. The application itself does not need a model server.

Switching models after one is loaded reloads the PWA so the WebGPU runtime is cleanly recreated.

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
