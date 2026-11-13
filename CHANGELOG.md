# Changelog

## [0.4.0] — 2026-11-14 — Batch queue, premium UI, any-file input

### Added

- **Batch queue**: drop many files at once, multi-select in Browse, or drop/add a whole folder (non-recursive)
  - Each item shows detected container · codecs (e.g. `MPEG-TS · H.264 · AAC`), resolution, duration, size and estimated output
  - Per-item status: Waiting / Converting xx% / Done / Failed / Cancelled, with elapsed time + ETA
  - Remove item, show-in-folder when done, cancel a single item, Clear finished, Clear queue
  - Convert All runs sequentially (optional 2 at a time in Settings), Cancel / Cancel all, overall “n of N · %” progress
  - Total estimated output size for the batch; “Convert again” re-runs a finished batch with new settings
- **Any-file input**: nothing is filtered by extension — every file is checked with ffprobe
  - Chrome downloads with no extension work (`videoplayback` → `videoplayback.mp4`)
  - `.ts`, `.m2ts`, `.mts`, `.m4v`, `.3gp`, `.flv`, `.wmv`, `.ogv`, `.mpg`, `.vob`, `.opus`, `.ogg` and more
  - Unfinished downloads (`.crdownload`, `.part`) show “Download not finished”; non-media shows “Not a media file”
  - MPEG-TS sources get `-fflags +genpts`; stream copy to MP4/MOV adds `aac_adtstoasc`
  - If a stream copy or GPU encode fails, the file is automatically re-encoded in software
- **Quick presets**: Smaller file · Share 720p · High quality · Extract MP3 · GIF
- **Compact option bar**: Format / Level / Video / Audio / Trim / Save to pills with animated popovers (click-outside / Esc to close)
- **Themes**: Dark (refined), Light, System, Midnight (OLED black), Nord, Sand — plus 6 accent colours; titlebar caption buttons follow the theme
- **Hardware encoding (optional)**: detects NVIDIA NVENC / Intel Quick Sync / AMD AMF with a real test encode; falls back to x264
- Toast when a batch finishes, Windows notification if the window is in the background, “Open folder” action
- Keyboard: `Ctrl+O` add files, `Ctrl+Shift+O` add folder, `Enter` convert, `Esc` close popover / cancel batch, `Delete` remove selected, arrow keys move through the queue
- Remembers last output folder (optional)
- Headless smoke test: `npm run smoke`

### Changed

- Full visual redesign: Segoe UI Variable typography, 8px spacing scale, layered translucent surfaces, soft shadows, inline SVG icons, gradient primary button, animated progress
- Removed the stacked accordion list — options now fit in one row; the queue gets the rest of the window (fits at ~900×640 with no scrolling)
- Output names no longer get a `_converted` suffix: `name.mp4`, and `name (1).mp4` on conflict — never overwrites, never the source file
- GIF output uses a generated palette (sharper colours, smaller files)
- WebM encodes faster (`-row-mt`, `-cpu-used 4`); WebM audio is always Opus
- AVI uses MP3 audio for better player compatibility
- Installer no longer ships macOS/Linux/32-bit ffprobe binaries

### Fixed

- Drag-and-drop on Electron 33 (uses `webUtils.getPathForFile`; `File.path` no longer exists)
- Trim with both start and end now produces the right length (`-t` instead of `-to` after input seek)
- Saved “High” compress level was being reset to “Low” on every launch
- Closing the app mid-conversion now removes the half-written file

## [0.3.0] — 2026-09-25 — UI declutter, compress levels, bitrates

### Added

- Foldable option sections (accordion): Compress, Video, Audio, Trim, Output — open/closed remembered in settings
- **Compress level** chips (higher = more compression / smaller file): Low · Balanced · High · Max · Original · Custom
- **Custom video bitrate** input (`2500k` or Mbps) applied as `-b:v`, included in size estimate
- **Audio extract bitrate** chips for MP3/M4A: 320 / 192 / 128 / 96 / 64 kbps (default 192); WAV/FLAC stay lossless
- One-line job summary above Convert
- Soft-collapse log after success (“Show log” toggle); done banner with output path
- Enter key converts when ready (not while typing in an input)
- Settings defaults for compress level + audio extract bitrate

### Changed

- Compress naming inverted for clarity (level = compression amount, not quality label)
- Migrates saved `high`→`low`, `small`→`high`, `tiny`→`max` so old settings keep working
- Badge → v0.3.0 Early; larger hit targets on fold headers and chips
- Convert stays disabled until a file is loaded (and custom bitrate is valid when Custom is selected)

### Notes

- Still early / unstable — expect bugs
- Trim timeline/preview scrubber still out of scope (start/end text fields only)

## [0.2.0] — 2026-09-24 — Themes, Settings & Media Options

### Added

- Mac-style blended titlebar with Windows `titleBarOverlay` (drag region, no hard chrome strip)
- Light / Dark / System themes with CSS variables
- Settings slide-over: theme, default output folder, default format, default compress (JSON in userData)
- Resolution chips: Original / 1080p / 720p / 480p / Custom (scale filter, clamp to source width)
- FPS chips: Original / 60 / 30 / 24
- Audio chips for video modes: Keep / Strip / AAC 128k / AAC 96k
- Audio extract formats: MP3, M4A, WAV, FLAC (hides video-only controls when active)
- Size estimate reacts to resolution, fps, and audio-extract
- Tagline: Convert · Compress · Trim · Extract

### Notes

- Still early / unstable — expect bugs
- Size estimate remains a heuristic

## [0.1.0] — 2026-09-24 — Early Build

First public early build of FluidConvert for Windows.

### Added

- Electron desktop app with dark minimal UI
- Drag-and-drop / browse video picker with ffprobe metadata
- Format chips: MP4, MOV, MKV, WebM, AVI, GIF
- Compress chips: Original, High, Balanced, Small, Tiny
- Estimated output size (approximate) updating with format / compress / trim
- Trim start/end (`hh:mm:ss` or seconds)
- Output folder picker
- ffmpeg progress, cancel, and open-output-folder
- Local-only processing (no uploads)
- Windows NSIS installer + portable EXE via electron-builder

### Notes

- Early / unstable — expect bugs
- Size estimate is a heuristic, not a guarantee
