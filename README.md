# Wackest Editor

Highlight videos at the snap of your fingers 🫰

Automatic synchronization of multiple camera/mic recordings, speech-to-text, an AI-powered
highlight heatmap, a manual multicam edit via a camera switcher, and export to a finished video
file. Built with Electron, React, and ffmpeg.

## Requirements

- Node.js 22+
- pnpm (this repo's default package manager, see `pnpm-lock.yaml`)
- For local transcription (optional): `whisper.cpp`, e.g. via `brew install whisper-cpp`, plus
  a model from [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/tree/main) —
  `ggml-large-v3` is recommended for the best transcription accuracy (larger download and slower
  than `base`/`small`, but noticeably fewer errors)

ffmpeg/ffprobe do **not** need to be installed separately — they're bundled as binaries via
`ffmpeg-static` / `ffprobe-static`, in the release builds too. `whisper.cpp` is **not** bundled,
though: even when running a packaged release artifact (.dmg/.exe/.AppImage), local transcription
still requires installing the `whisper-cli` binary and a model yourself and pointing to them in
Settings. If you only use the OpenAI Whisper API for transcription, no local whisper.cpp install
is needed at all.

## Local Setup

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the Electron app in development mode (hot reload for the renderer process).
API keys for OpenAI/Claude and, if needed, the whisper.cpp path are then entered in the running
app window via the settings dialog (gear icon, top right).

### Other Scripts

```bash
pnpm lint            # ESLint
pnpm format          # Prettier
pnpm typecheck       # tsc for main and renderer processes
pnpm build           # Typecheck + electron-vite build
pnpm start           # Preview of the production build (electron-vite preview)
```

### Distribution Builds

```bash
pnpm build:mac       # macOS (.dmg/.zip)
pnpm build:win       # Windows (NSIS installer)
pnpm build:linux     # Linux (AppImage)
pnpm build:unpack    # Unpacked build for local testing (--dir)
```

Releases are additionally built automatically via `.github/workflows/release.yml` and
published as GitHub release assets whenever a tag in the format `v*` is pushed.

## Features

### Projects

A project is a folder containing a `project.json` (raw sources, sync data, transcript, heatmap,
edit) and a `cache` subfolder (thumbnails, waveforms). From the start screen you can create new
projects, open existing ones, or resume from the list of recently opened projects. Every change
can be **undone/redone** (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z).

### Import

Video and audio files (camera, mic, phone recording, …) are imported via a file dialog or by
**drag & drop** into the window. On import, duration, resolution, and audio track are probed and
thumbnails are generated.

### Synchronization (Sync)

The time offset between recordings is calculated automatically via **audio cross-correlation**,
since different devices rarely start recording at exactly the same moment. Each sync segment
shows a **confidence level** (high/medium/low); the offset can also be adjusted manually in
seconds per segment. **Hard cuts** within a recording (e.g. a camera briefly stopped and
restarted) are detected separately and flagged.

### Transcript (Speech-to-Text)

A **timestamped transcript** is generated from an audio track, using either:

- **OpenAI Whisper API** (requires an OpenAI API key)
- **whisper.cpp (local)** – runs fully offline, requires a locally installed `whisper-cli`
  binary and a downloaded model (`.bin`)

A language can be hinted (Automatic/German/English). The transcript also appears as a subtitle
track in the timeline.

### Highlight Heatmap

Scores the content of the transcript section by section on a scale from "low" to "high" to
quickly find interesting spots in the footage. Three **providers** are available:

- **Local heuristic** – no API key required, rule-based
- **Claude API** (requires an Anthropic API key)
- **OpenAI API** (requires an OpenAI API key)

The result is shown as a colored bar (and as its own track in the timeline), including a
per-segment reason on hover.

### Multicam Timeline Editor

The heart of the app: each imported source gets a video or audio track with a **waveform**, plus
optional subtitle and heatmap tracks. A **preview player** shows the currently active
video/audio combination at the **playhead**. A zoom slider and a custom horizontal scrollbar
make it easy to navigate long recordings.

**Camera switcher:** Switches the active video source (or, with Shift+digit, the active audio
source) at the current playhead, either by clicking a tile or via number key (1–9,
layout-independent). **"Audio follows video"** automatically couples the audio selection to the
camera switch. Segment boundaries in the edit can be dragged to adjust.

**Keyboard shortcuts:**

| Key                               | Action                     |
| --------------------------------- | -------------------------- |
| `1`–`9`                           | Switch active camera       |
| `Shift` + `1`–`9`                 | Switch active audio source |
| `Space`                           | Play/pause                 |
| `←` / `→`                         | Skip back/forward 5s       |
| `Home` / `End`                    | Jump to start/end          |
| `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` | Undo/redo                  |

### Export

**Renders** the finished video from the video/audio ranges active in the edit via ffmpeg
(including progress per render segment), and can open the destination folder in the file
manager afterwards.

### Settings

**API keys** (OpenAI, Anthropic) as well as paths to the whisper.cpp binary and model are
managed via the settings dialog (gear icon) and stored **locally** in Electron's `userData`
(`settings.json`) — not in project files or environment variables. If a key is missing for the
selected provider, a hint links directly to the relevant field.
