# Third-party assets

## Bonsai 27B tokenizer

The files in `public/tokenizer-27b/` are unmodified copies retrieved from PrismML on 2026-10-02. The upstream model card declares Apache-2.0; the license is included alongside the assets. These are tokenizer/support assets, not model weights.

Model card: https://huggingface.co/prism-ml/Bonsai-27B-unpacked/blob/main/README.md

- Source: https://huggingface.co/prism-ml/Bonsai-27B-unpacked/resolve/main/tokenizer.json
  SHA-256: `5f9e4d4901a92b997e463c1f46055088b6cca5ca61a6522d1b9f64c4bb81cb42`
- Source: https://huggingface.co/prism-ml/Bonsai-27B-unpacked/resolve/main/tokenizer_config.json
  SHA-256: `5186f0defcd7f232382c7f0aebcd2252d073bb921ab240e407b7ae8745d2b29b`

The existing `public/tokenizer/` assets are the shared Qwen2Tokenizer used by Bonsai 1.7B/4B/8B. bitgpu and WebLLM retain their own dependency licenses.
