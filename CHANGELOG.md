# Changelog

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
