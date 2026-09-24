# FluidConvert

Compact, minimal Windows video converter — **convert**, **compress**, and **trim** locally.

> **Early build (v0.1.0)** — functional but unstable. Expect rough edges. Feedback welcome.

> **Screenshots:** placeholder — UI capture coming in a later release.

## Features

- Drag-and-drop or browse to pick a video
- Probe duration, size, and resolution (ffprobe)
- Convert to **MP4, MOV, MKV, WebM, AVI, GIF** (audio kept when applicable)
- Compress chips: **Original / High / Balanced / Small / Tiny**
- Live **estimated output size** (approximate — updates with format, compress, trim)
- Trim with start/end (`hh:mm:ss` or seconds)
- Choose output folder (default: same as source)
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

- `FluidConvert-Setup-0.1.0.exe` — NSIS installer
- `FluidConvert-Portable-0.1.0.exe` — portable single EXE

ffmpeg/ffprobe are bundled via `ffmpeg-static` / `ffprobe-static`.

## Privacy

All processing happens on your machine. See [PRIVACY.md](PRIVACY.md).

## Disclaimer

Early / unstable software. You are responsible for the rights to media you convert. See [DISCLAIMER.md](DISCLAIMER.md).

## License

MIT — Copyright © 2026 GTR / heeraj. See [LICENSE](LICENSE).
