# Wackest Editor

Highlight videos at the snap of your fingers 🫰

Automatic synchronization of multiple camera/mic recordings, speech-to-text, an AI-powered
highlight heatmap, a manual multicam edit via a camera switcher, and export to a finished video
file. Built with Electron, React, and ffmpeg.

## Requirements

- Node.js 22+
- pnpm (this repo's default package manager, see `pnpm-lock.yaml`)
- A C/C++ toolchain + CMake, needed once during `pnpm install` to build the bundled `whisper-cli`
  binary from source (Xcode Command Line Tools on macOS, `build-essential` on Linux, Visual
  Studio Build Tools on Windows — all already present on GitHub-hosted CI runners)

ffmpeg/ffprobe/whisper.cpp do **not** need to be installed separately — ffmpeg/ffprobe are
bundled as binaries via `ffmpeg-static`/`ffprobe-static`, and `whisper-cli` is compiled from
source into `resources/bin/` during `pnpm install` (see `scripts/ensure-whisper-binary.cjs`), all
bundled into the release builds too. A default ggml model (`ggml-tiny-q5_1`, multilingual) is bundled
the same way (`scripts/ensure-whisper-model.cjs`) so local transcription works with zero manual
setup; a larger/more accurate model (e.g. `ggml-large-v3`) can be downloaded on demand from
Settings, or a custom local model file can be selected there instead. If you only use the OpenAI
Whisper API for transcription, no local whisper.cpp setup is needed at all.

## Local Setup

```bash
pnpm install
pnpm dev
```

`pnpm install` also builds the bundled `whisper-cli` binary and downloads the default model
(one-time, skipped on subsequent installs once both are present). `pnpm dev` starts the Electron
app in development mode (hot reload for the renderer process). API keys for OpenAI/Claude are
then entered in the running app window via the settings dialog (gear icon, top right); the
whisper.cpp binary/model fields there are optional overrides only.

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
- **whisper.cpp (local)** – runs fully offline using the bundled `whisper-cli` binary and
  default model; a custom/larger model can optionally be selected in Settings

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

**API keys** (OpenAI, Anthropic) as well as an optional override for the whisper.cpp model path
are managed via the settings dialog (gear icon) and stored **locally** in Electron's `userData`
(`settings.json`) — not in project files or environment variables. If a key is missing for the
selected provider, a hint links directly to the relevant field.
