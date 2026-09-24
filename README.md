# FluidConvert

Compact, minimal Windows video converter — **convert**, **compress**, **trim**, and **extract** locally.

> **Early build (v0.2.0)** — functional but unstable. Expect rough edges. Feedback welcome.

> **Screenshots:** placeholder — UI capture coming in a later release.

## Features

- Mac-style blended titlebar (Windows caption overlay) with settings gear
- **Dark / Light / System** themes (persisted in local settings)
- Drag-and-drop or browse to pick video (or audio) sources
- Probe duration, size, and resolution (ffprobe)
- Convert to **MP4, MOV, MKV, WebM, AVI, GIF**
- **Audio extract:** MP3, M4A, WAV, FLAC (`-vn`)
- Compress chips: **Original / High / Balanced / Small / Tiny**
- **Resolution** chips (Original / 1080p / 720p / 480p / Custom) — no upscale above source
- **FPS** chips (Original / 60 / 30 / 24)
- **Audio** chips for video: Keep / Strip / AAC 128k / AAC 96k
- Live **estimated output size** (approximate — reacts to format, compress, trim, resolution, fps, extract)
- Trim with start/end (`hh:mm:ss` or seconds) — applies to extract too
- Default output folder / format / compress via Settings
- Progress + cancel + open output folder when done
- **100% local** — no uploads, no accounts, no telemetry

## Requirements

- Windows 10/11 x64
- For development: Node.js 18+ and npm

## Run from source

```bash
cd FluidConvert
npm install
npm start
```

## Build Windows installers

```bash
npm run build
```

Artifacts land in `dist/`:

- `FluidConvert-Setup-0.2.0.exe` — NSIS installer
- `FluidConvert-Portable-0.2.0.exe` — portable single EXE

ffmpeg/ffprobe are bundled via `ffmpeg-static` / `ffprobe-static`.

## Privacy

All processing happens on your machine. See [PRIVACY.md](PRIVACY.md).

## Disclaimer

Early / unstable software. You are responsible for the rights to media you convert. See [DISCLAIMER.md](DISCLAIMER.md).

## License

MIT — Copyright © 2026 GTR / heeraj. See [LICENSE](LICENSE).
