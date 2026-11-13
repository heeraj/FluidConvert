# Privacy Policy — FluidConvert

FluidConvert processes video **entirely on your computer**.

## What we do not do

- **No uploads** — media never leaves your device
- **No accounts** — nothing to sign in to
- **No telemetry** — no analytics, crash reporting, or usage tracking built into the app
- **No network calls** for conversion — ffmpeg runs locally

## What stays on disk

- Your source files stay where you chose them
- Output files are written only to the folder you select (or the source folder / Desktop default)
- Temporary/partial outputs from a cancelled job (or from closing the app mid-conversion) are removed when possible
- Settings (theme, last options, last output folder) are stored in a local `settings.json` in your Windows user profile

## Notifications and hardware check

- Batch-finished notifications are local Windows notifications; nothing is sent anywhere
- Optional GPU encoding runs a tiny local test encode to see which encoders work; no data leaves your PC

## Third-party binaries

The app bundles ffmpeg/ffprobe (via npm packages). Those tools run locally as part of conversion; FluidConvert does not send your media to any remote ffmpeg service.

## Contact

Questions: open an issue on the GitHub repository, or email heeraj.x@gmail.com.
