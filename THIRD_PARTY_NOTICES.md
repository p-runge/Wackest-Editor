# Third-Party Notices

This app bundles the following third-party components in addition to its npm dependencies
(see `package.json` / `pnpm-lock.yaml` for those).

## whisper.cpp

Compiled from source (see `scripts/ensure-whisper-binary.cjs`) and bundled as the `whisper-cli`
binary for local, offline transcription.

- Project: https://github.com/ggml-org/whisper.cpp
- License: MIT
- Copyright (c) 2023-2024 The ggml authors

## ggml-base (Whisper model weights)

Bundled as the default local-transcription model (see `scripts/ensure-whisper-model.cjs`),
downloaded from https://huggingface.co/ggerganov/whisper.cpp. Converted to the ggml format from
OpenAI's original Whisper model weights.

- Project: https://github.com/openai/whisper
- License: MIT
- Copyright (c) 2022 OpenAI
