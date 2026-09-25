# Changelog

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
