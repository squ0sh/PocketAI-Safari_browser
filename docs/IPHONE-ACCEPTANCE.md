# iPhone acceptance checklist

Record the exact iPhone, iOS version, Safari or Home Screen mode, app version, model and load source. No physical iPhone result is inferred from the automated Chromium tests.

1. Install the production build with fresh website storage. Wait for offline readiness without loading a model. Save Bonsai 1.7B Q1_0 to Files and ensure it is downloaded locally.
2. Enable airplane mode, force-close the PWA, reopen it and select the GGUF. Verify successful generation, streamed output, Stop, retry and edit/resend.
3. Attach page text offline, ask a question, close and reopen the app, reselect the GGUF, and verify the reference and history survived. Search, export and delete the chat.
4. Try an oversized question and long reference. Verify a useful size error or visible excerpt notice; ensure the question is never silently dropped.
5. Cancel a file or network model load, choose another model, and verify progress belongs to the new attempt. Background and return during generation; verify either continued use or an actionable model-reload message.
6. Run Speed test and record measurements. Compare 4B/8B only on devices that can sustain their memory use; do not label 27B phone-compatible based on its offline assets.
7. Interrupt an app update before it finishes. Verify the previous version still opens offline and retains history. Finish the update online and verify the new version's readiness.
8. With internet disabled, select Online Assist and verify that it requests connectivity without sending through a different runtime. Local GGUF mode must remain selectable.

| Device / iOS | Mode | Model | Offline load + chat | Background recovery | Version / date |
| --- | --- | --- | --- | --- | --- |
| Awaiting physical-device validation | — | — | Not yet measured | Not yet measured | v0.7.0 |
