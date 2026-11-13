/* Headless smoke test: generates sample media with the bundled ffmpeg and runs
 * them through the exact probe + arg-builder + runner used by the app. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../lib/ffargs');
const M = require('../lib/media');

const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;
const dir = path.join(os.tmpdir(), `fluidconvert-smoke-${Date.now()}`);
const outDir = path.join(dir, 'out');
fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function gen(file, extra) {
  const args = ['-y', '-hide_banner', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...extra, file];
  const r = M.runFfmpeg(ffmpeg, args, {});
  const res = await r.done;
  if (res.code !== 0) throw new Error(`gen ${file}: ${res.stderr}`);
}

async function convert(name, input, opts) {
  const info = await M.probeFile(ffprobe, input);
  if (!info.ok) { record(name, false, `probe: ${info.message}`); return null; }
  const invalid = F.validateJob(opts, info);
  if (invalid) { record(name, false, invalid); return null; }
  const ext = F.outputExt(opts.format);
  const outputPath = F.uniqueOutputPath(opts.outputDir || outDir, F.outputBaseName(input), ext, new Set(), input);
  const total = F.effectiveDuration(info.duration, opts.trimStart, opts.trimEnd);
  let lastPct = null;
  const runOnce = async (over) => {
    const built = F.buildFfmpegArgs({ ...opts, format: ext, inputPath: input, outputPath, sourceWidth: info.width, source: info, ...over });
    const run = M.runFfmpeg(ffmpeg, built.args, { totalDuration: total, onProgress: (p) => { lastPct = p.percent; } });
    const res = await run.done;
    return { ...res, built };
  };
  let res = await runOnce({});
  let note = res.built.usedCopy ? 'stream copy' : res.built.usedHw ? `hw ${opts.hwEncoder}` : 'encode';
  if (res.code !== 0 && (res.built.usedCopy || res.built.usedHw)) {
    note += ' failed → fallback';
    res = await runOnce({ forceEncode: true, hwEncoder: null });
  }
  if (res.code !== 0 || !fs.existsSync(outputPath)) {
    record(name, false, res.stderr.trim().split(/\r?\n/).slice(-2).join(' '));
    return null;
  }
  const out = await M.probeFile(ffprobe, outputPath);
  const size = fs.statSync(outputPath).size;
  const okOut = out.ok && (F.isAudioExtract(ext) ? out.hasAudio && !out.hasVideo : out.hasVideo);
  record(name, okOut && size > 0, `${path.basename(outputPath)} · ${F.formatBytes(size)} · ${out.detected || '?'} · ${out.width ? `${out.width}x${out.height} · ` : ''}${out.durationLabel} · ${note} · progress seen ${lastPct != null ? `${Math.round(lastPct)}%` : 'n/a'}`);
  return outputPath;
}

(async () => {
  console.log(`ffmpeg: ${ffmpeg}\nffprobe: ${ffprobe}\nwork: ${dir}\n`);
  const mp4 = path.join(dir, 'sample.mp4');
  const ts = path.join(dir, 'clip.ts');
  const noext = path.join(dir, 'videoplayback');
  const crd = path.join(dir, 'Unconfirmed 812.crdownload');
  const txt = path.join(dir, 'notes.txt');
  await gen(mp4, ['-movflags', '+faststart']);
  await gen(ts, ['-f', 'mpegts']);
  fs.copyFileSync(ts, noext);
  fs.copyFileSync(mp4, crd);
  fs.writeFileSync(txt, 'hello, this is not a video\n'.repeat(20));

  // Folder expansion
  const listed = M.expandPaths([dir]).map((p) => path.basename(p));
  record('folder expand includes .ts, extensionless, partial; skips .txt',
    listed.includes('clip.ts') && listed.includes('videoplayback') && listed.includes('Unconfirmed 812.crdownload') && !listed.includes('notes.txt'),
    listed.join(', '));

  // Probing
  const pTs = await M.probeFile(ffprobe, ts);
  record('probe .ts', pTs.ok && pTs.detected === 'MPEG-TS · H.264 · AAC', pTs.detected);
  const pNo = await M.probeFile(ffprobe, noext);
  record('probe extensionless', pNo.ok && pNo.noExtension && pNo.container === 'MPEG-TS', `${pNo.detected} · noExtension=${pNo.noExtension}`);
  const pCrd = await M.probeFile(ffprobe, crd);
  record('.crdownload → "Download not finished"', !pCrd.ok && pCrd.message === 'Download not finished', pCrd.message);
  const pTxt = await M.probeFile(ffprobe, txt);
  record('text file → "Not a media file"', !pTxt.ok && pTxt.message === 'Not a media file', pTxt.message);

  // Naming
  record('naming: extensionless gets .mp4', path.basename(F.uniqueOutputPath(outDir, F.outputBaseName(noext), 'mp4', new Set())) === 'videoplayback.mp4');

  const base = { compress: 'balanced', resolution: 'original', fps: 'original', audio: 'keep', audioBitrate: '192', trimStart: '', trimEnd: '', outputDir: outDir };
  await convert('MP4 → MP4 (Balanced)', mp4, { ...base, format: 'mp4' });
  await convert('.ts → MP4 (Original / stream copy + aac_adtstoasc)', ts, { ...base, format: 'mp4', compress: 'original' });
  await convert('extensionless → MP4 (High, 480p, 24fps)', noext, { ...base, format: 'mp4', compress: 'high', resolution: '480p', fps: '24' });
  await convert('.ts → MP3 extract (128k)', ts, { ...base, format: 'mp3', audioBitrate: '128' });
  await convert('MP4 → M4A extract, trim 0.5–2.0', mp4, { ...base, format: 'm4a', trimStart: '0.5', trimEnd: '2' });
  await convert('MP4 → GIF', mp4, { ...base, format: 'gif' });
  await convert('.ts → WebM', ts, { ...base, format: 'webm', compress: 'max' });

  // Conflict naming
  const again = await convert('conflict rename (sample (1).mp4)', mp4, { ...base, format: 'mp4' });
  if (again && path.basename(again) !== 'sample (1).mp4') record('conflict name is "sample (1).mp4"', false, path.basename(again));

  // 3-file batch, sequential, into its own folder
  const batchDir = path.join(dir, 'batch');
  fs.mkdirSync(batchDir);
  for (const [i, f] of [mp4, ts, noext].entries()) {
    await convert(`batch ${i + 1}/3 → MP4 Share 720p`, f, { ...base, outputDir: batchDir, format: 'mp4', resolution: '720p', fps: '30', audio: 'aac128' });
  }
  const batchOut = fs.readdirSync(batchDir);
  record('batch produced 3 files', batchOut.length === 3, batchOut.join(', '));

  // Hardware encoder detection + test
  const hw = await M.detectHwEncoders(ffmpeg);
  console.log(`\nHW encoders working: ${hw.length ? hw.join(', ') : 'none'}`);
  if (hw.length) await convert(`MP4 via ${hw[0]}`, mp4, { ...base, format: 'mp4', hwEncoder: hw[0] });

  console.log(`\n${results.length - failures}/${results.length} passed. Output: ${dir}`);
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
