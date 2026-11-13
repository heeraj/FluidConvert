'use strict';
/**
 * Pure ffmpeg argument + naming helpers (no Electron imports) so they can be
 * unit/smoke tested from plain Node.
 */
const path = require('path');
const fs = require('fs');

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'gif', 'm4v', 'wmv', 'flv', 'ts', 'm2ts', 'mts',
  'm2t', 'tsv', '3gp', '3g2', 'ogv', 'mpg', 'mpeg', 'mpe', 'm2v', 'vob', 'asf', 'divx', 'f4v', 'mxf', 'rm', 'rmvb', 'dv', 'y4m', 'h264', 'h265', 'hevc'];
const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'ac3', 'eac3', 'dts', 'amr', 'mka', 'm4b', 'alac', 'ape', 'wv'];
const MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS];
const PARTIAL_EXTS = ['crdownload', 'part', 'partial', 'download', 'opdownload'];
// Extensions we strip when naming outputs. Anything else is kept as part of the name
// (e.g. "my.video.title" -> "my.video.title.mp4").
const STRIP_EXTS = new Set([...MEDIA_EXTS, ...PARTIAL_EXTS, 'tmp', 'bin', 'dat', 'php', 'aspx', 'videoplayback']);

const AUDIO_EXTRACT_FORMATS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac']);
const VIDEO_FORMATS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'gif']);

function isAudioExtract(format) {
  return AUDIO_EXTRACT_FORMATS.has(String(format || '').toLowerCase());
}

function migrateCompressKey(key) {
  const map = { small: 'high', tiny: 'max' };
  if (!key) return key;
  return map[key] || key;
}

function parseTimeToSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(sec) {
  if (!sec || sec < 0 || !Number.isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "2500k" | "2.5M" | "2500" | "2.5" (Mbps) -> "2500k" or null */
function parseVideoBitrate(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(k|kbps|m|mbps)?$/.exec(s);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = m[2] || '';
  if (unit === 'm' || unit === 'mbps') return `${Math.round(num * 1000)}k`;
  if (unit === 'k' || unit === 'kbps') return `${Math.round(num)}k`;
  if (num <= 50) return `${Math.round(num * 1000)}k`;
  return `${Math.round(num)}k`;
}

function parseAudioBitrateKbps(raw) {
  const n = parseInt(String(raw || '192').replace(/k$/i, ''), 10);
  if (![320, 256, 192, 128, 96, 64].includes(n)) return 192;
  return n;
}

// ---------- Input classification ----------

function lowerExt(name) {
  const base = path.basename(name);
  const m = /\.([^.\\/]+)$/.exec(base);
  return m ? m[1].toLowerCase() : '';
}

function isPartialDownload(filePath) {
  return PARTIAL_EXTS.includes(lowerExt(filePath));
}

/** Should a file found while enumerating a folder be offered to the queue? */
function isCandidateInFolder(name) {
  if (name.startsWith('~$') || /^(desktop\.ini|thumbs\.db)$/i.test(name)) return false;
  const ext = lowerExt(name);
  if (!ext) return true; // extensionless (Chrome downloads etc.)
  return MEDIA_EXTS.includes(ext) || PARTIAL_EXTS.includes(ext);
}

/** Output base name: strips known media/partial extensions; tolerates no-dot names. */
function outputBaseName(inputPath) {
  let name = path.basename(String(inputPath || ''));
  for (let i = 0; i < 3; i += 1) {
    const m = /^(.*)\.([^.]+)$/.exec(name);
    if (!m) break;
    const ext = m[2].toLowerCase();
    if (!STRIP_EXTS.has(ext)) break;
    name = m[1];
  }
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!name) name = 'output';
  return name;
}

function outputExt(format) {
  let ext = String(format || 'mp4').toLowerCase();
  if (ext === 'aac') ext = 'm4a';
  return ext;
}

/** "name.mp4", then "name (1).mp4", ... never overwriting, never the input itself. */
function uniqueOutputPath(outDir, base, ext, reserved, inputPath) {
  const taken = (p) => {
    const lp = p.toLowerCase();
    if (inputPath && path.resolve(inputPath).toLowerCase() === path.resolve(p).toLowerCase()) return true;
    if (reserved && reserved.has(lp)) return true;
    return fs.existsSync(p);
  };
  let candidate = path.join(outDir, `${base}.${ext}`);
  let n = 1;
  while (taken(candidate)) {
    candidate = path.join(outDir, `${base} (${n}).${ext}`);
    n += 1;
  }
  return candidate;
}

// ---------- Probe parsing ----------

const CODEC_LABELS = {
  h264: 'H.264', hevc: 'HEVC', h265: 'HEVC', vp9: 'VP9', vp8: 'VP8', av1: 'AV1', mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2', mpeg1video: 'MPEG-1', msmpeg4v3: 'DivX', wmv3: 'WMV9', wmv2: 'WMV8', vc1: 'VC-1',
  prores: 'ProRes', dnxhd: 'DNxHD', mjpeg: 'MJPEG', gif: 'GIF', theora: 'Theora', h263: 'H.263', flv1: 'FLV1',
  aac: 'AAC', mp3: 'MP3', mp2: 'MP2', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'AC-3', eac3: 'E-AC-3',
  dts: 'DTS', alac: 'ALAC', wmav2: 'WMA', pcm_s16le: 'PCM', pcm_s24le: 'PCM', pcm_f32le: 'PCM', amr_nb: 'AMR',
  truehd: 'TrueHD',
};

function codecLabel(name) {
  if (!name) return null;
  return CODEC_LABELS[name] || name.toUpperCase();
}

function containerLabel(formatName, tags, vCodec, aCodec) {
  const f = String(formatName || '');
  if (!f) return null;
  if (f.includes('mpegts')) return 'MPEG-TS';
  if (f.startsWith('mov,mp4')) {
    const brand = String(tags?.major_brand || '').trim().toLowerCase();
    if (brand === 'qt') return 'MOV';
    if (brand.startsWith('m4a')) return 'M4A';
    if (brand.startsWith('3gp')) return '3GP';
    return 'MP4';
  }
  if (f.startsWith('matroska')) {
    const webmV = !vCodec || ['vp8', 'vp9', 'av1'].includes(vCodec);
    const webmA = !aCodec || ['opus', 'vorbis'].includes(aCodec);
    return webmV && webmA ? 'WebM' : 'MKV';
  }
  const map = {
    avi: 'AVI', flv: 'FLV', asf: 'WMV', mp3: 'MP3', ogg: 'OGG', wav: 'WAV', flac: 'FLAC', gif: 'GIF',
    mpeg: 'MPEG-PS', mpegvideo: 'MPEG', aac: 'AAC', ac3: 'AC-3', aiff: 'AIFF', amr: 'AMR', mxf: 'MXF',
    rm: 'RealMedia', dv: 'DV', h264: 'H.264 raw', hevc: 'HEVC raw', webm_dash_manifest: 'WebM',
  };
  const first = f.split(',')[0];
  return map[first] || first.toUpperCase();
}

/**
 * Turn ffprobe JSON into an item description.
 * Returns { ok:false, reason, message } when the file is not usable media.
 */
function parseProbe(data, filePath, size) {
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const fmt = data?.format || {};
  const formatName = fmt.format_name || '';
  const videoStream = streams.find((s) => s.codec_type === 'video'
    && !(s.disposition && s.disposition.attached_pic === 1)
    && s.codec_name !== 'ansi');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  if (formatName === 'tty' || (!videoStream && !audioStream)) {
    return { ok: false, reason: 'not-media', message: 'Not a media file' };
  }
  if (/(_pipe|^image2$|^png$|^webp$)/.test(formatName) && !audioStream) {
    return { ok: false, reason: 'image', message: 'Image file, not a video' };
  }

  let duration = parseFloat(fmt.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = parseFloat(videoStream?.duration || audioStream?.duration || 0) || 0;
  }
  let fps = null;
  const rate = videoStream?.avg_frame_rate && videoStream.avg_frame_rate !== '0/0'
    ? videoStream.avg_frame_rate : videoStream?.r_frame_rate;
  if (rate && rate.includes('/')) {
    const [a, b] = rate.split('/').map(Number);
    if (b) fps = a / b;
  }
  const vCodec = videoStream?.codec_name || null;
  const aCodec = audioStream?.codec_name || null;
  const container = containerLabel(formatName, fmt.tags, vCodec, aCodec);
  const detected = [container, codecLabel(vCodec), codecLabel(aCodec)].filter(Boolean).join(' · ');

  return {
    ok: true,
    path: filePath,
    name: path.basename(filePath),
    size,
    sizeLabel: formatBytes(size),
    duration,
    durationLabel: formatDuration(duration),
    width: videoStream?.width || null,
    height: videoStream?.height || null,
    fps,
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(audioStream),
    videoCodec: vCodec,
    audioCodec: aCodec,
    formatName,
    container,
    detected,
    bitRate: parseInt(fmt.bit_rate || 0, 10) || null,
    noExtension: !lowerExt(filePath),
  };
}

// ---------- ffmpeg args ----------

/**
 * Compress levels — higher level = more compression / smaller file.
 * original = stream copy when possible (CRF 18 if a re-encode is required).
 */
const COMPRESS_PRESETS = {
  original: { crf: 18, copy: true },
  low: { crf: 19 },
  balanced: { crf: 23 },
  high: { crf: 28 },
  max: { crf: 32, scale: 'iw*0.5:ih*0.5' },
  custom: { crf: null, useCustomBitrate: true },
};

const RES_WIDTH = { '2160p': 3840, '1440p': 2560, '1080p': 1920, '720p': 1280, '480p': 854, '360p': 640 };

function resolveTargetWidth(resolution, customWidth, sourceWidth) {
  const res = String(resolution || 'original').toLowerCase();
  if (res === 'original') return null;
  let w = null;
  if (res === 'custom') {
    const n = parseInt(customWidth, 10);
    if (Number.isFinite(n) && n > 0) w = n;
  } else if (RES_WIDTH[res]) {
    w = RES_WIDTH[res];
  }
  if (w == null) return null;
  if (sourceWidth && Number.isFinite(sourceWidth) && sourceWidth > 0) w = Math.min(w, sourceWidth);
  if (w % 2 !== 0) w -= 1;
  if (w < 2) return null;
  return w;
}

function buildVideoFilters(opts, preset) {
  const filters = [];
  const targetW = resolveTargetWidth(opts.resolution, opts.customWidth, opts.sourceWidth);
  const fpsVal = opts.fps && opts.fps !== 'original' ? parseInt(opts.fps, 10) : null;

  if (opts.format === 'gif') {
    filters.push(fpsVal ? `fps=${fpsVal}` : 'fps=12');
    if (targetW) filters.push(`scale=${targetW}:-2:flags=lanczos`);
    else if (preset.scale) filters.push(`scale=${preset.scale}:flags=lanczos`);
    else filters.push(`scale='min(480,iw)':-2:flags=lanczos`);
    filters.push('split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4');
    return filters;
  }
  if (targetW) filters.push(`scale=${targetW}:-2`);
  else if (preset.scale) filters.push(`scale=trunc(iw*0.25)*2:-2`);
  if (fpsVal && Number.isFinite(fpsVal) && fpsVal > 0) filters.push(`fps=${fpsVal}`);
  return filters;
}

function applyAudioArgs(args, audioMode, fmt) {
  const mode = String(audioMode || 'keep').toLowerCase();
  if (mode === 'strip') { args.push('-an'); return; }
  const kb = mode === 'aac128' ? '128k' : mode === 'aac96' ? '96k' : null;
  if (fmt === 'webm') { args.push('-c:a', 'libopus', '-b:a', kb || '128k'); return; }
  if (fmt === 'avi' && !kb) { args.push('-c:a', 'libmp3lame', '-b:a', '192k'); return; }
  args.push('-c:a', 'aac', '-b:a', kb || '160k');
}

const HW_ENCODERS = {
  nvenc: { codec: 'h264_nvenc', label: 'NVIDIA NVENC' },
  qsv: { codec: 'h264_qsv', label: 'Intel Quick Sync' },
  amf: { codec: 'h264_amf', label: 'AMD AMF' },
};

function pushH264(args, { crf, bitrate, hw }) {
  if (hw === 'nvenc') {
    args.push('-c:v', 'h264_nvenc', '-preset', 'p5', '-pix_fmt', 'yuv420p');
    if (bitrate) args.push('-b:v', bitrate);
    else args.push('-rc', 'vbr', '-cq', String(Math.min(51, (crf || 23) + 1)), '-b:v', '0');
  } else if (hw === 'qsv') {
    args.push('-c:v', 'h264_qsv', '-preset', 'medium', '-pix_fmt', 'nv12');
    if (bitrate) args.push('-b:v', bitrate);
    else args.push('-global_quality', String(crf || 23));
  } else if (hw === 'amf') {
    args.push('-c:v', 'h264_amf', '-quality', 'balanced', '-pix_fmt', 'nv12');
    if (bitrate) args.push('-b:v', bitrate);
    else { const q = String(crf || 23); args.push('-rc', 'cqp', '-qp_i', q, '-qp_p', q, '-qp_b', q); }
  } else {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p');
    if (bitrate) args.push('-b:v', bitrate, '-maxrate', bitrate, '-bufsize', `${parseInt(bitrate, 10) * 2}k`);
    else args.push('-crf', String(crf || 23));
  }
}

/**
 * Validate a job for a given probed source. Returns error message or null.
 */
function validateJob(opts, source) {
  const fmt = String(opts.format || 'mp4').toLowerCase();
  if (isAudioExtract(fmt)) {
    if (source && source.hasAudio === false) return 'No audio track to extract';
    return null;
  }
  if (source && source.hasVideo === false) return 'Audio-only file — pick MP3/M4A/WAV/FLAC';
  const level = migrateCompressKey(opts.compress) || 'balanced';
  if (level === 'custom' && fmt !== 'gif' && !parseVideoBitrate(opts.customBitrate)) {
    return 'Custom bitrate required (e.g. 2500k or 2.5)';
  }
  return null;
}

/**
 * Build ffmpeg args.
 * opts: { inputPath, outputPath, format, compress, trimStart, trimEnd, resolution, customWidth, fps,
 *         audio, sourceWidth, customBitrate, audioBitrate, hwEncoder, forceEncode,
 *         source: { formatName, videoCodec, audioCodec, hasAudio, hasVideo } }
 * Returns { args, usedCopy, usedHw }
 */
function buildFfmpegArgs(opts) {
  const fmt = String(opts.format || 'mp4').toLowerCase();
  const level = migrateCompressKey(opts.compress) || 'balanced';
  const preset = COMPRESS_PRESETS[level] || COMPRESS_PRESETS.balanced;
  const source = opts.source || {};
  const isTs = /mpegts/.test(source.formatName || '');
  const args = ['-y', '-hide_banner', '-nostdin', '-progress', 'pipe:1', '-nostats'];

  const startSec = parseTimeToSeconds(opts.trimStart);
  const endSec = parseTimeToSeconds(opts.trimEnd);

  if (isTs || !source.formatName) args.push('-fflags', '+genpts');
  if (startSec !== null && startSec > 0) args.push('-ss', String(startSec));
  args.push('-i', opts.inputPath);
  if (endSec !== null && endSec > 0) {
    const len = endSec - (startSec && startSec > 0 ? startSec : 0);
    if (len > 0) args.push('-t', String(len));
  }

  // —— Audio extract ——
  if (isAudioExtract(fmt)) {
    args.push('-map', '0:a:0', '-vn', '-sn', '-dn');
    const aBit = `${parseAudioBitrateKbps(opts.audioBitrate)}k`;
    if (fmt === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', aBit);
    else if (fmt === 'm4a' || fmt === 'aac') args.push('-c:a', 'aac', '-b:a', aBit, '-movflags', '+faststart');
    else if (fmt === 'wav') args.push('-c:a', 'pcm_s16le');
    else if (fmt === 'flac') args.push('-c:a', 'flac');
    args.push(opts.outputPath);
    return { args, usedCopy: false, usedHw: false };
  }

  const vf = buildVideoFilters({ ...opts, format: fmt }, preset);
  const audioMode = String(opts.audio || 'keep').toLowerCase();
  const canCopy = !opts.forceEncode
    && level === 'original'
    && ['mp4', 'mov', 'mkv'].includes(fmt)
    && (!opts.resolution || opts.resolution === 'original')
    && (!opts.fps || opts.fps === 'original')
    && audioMode === 'keep'
    && vf.length === 0;

  if (fmt === 'gif') {
    args.push('-map', '0:v:0', '-vf', vf.join(','), '-loop', '0', '-an');
    args.push(opts.outputPath);
    return { args, usedCopy: false, usedHw: false };
  }

  args.push('-map', '0:v:0', '-map', '0:a?', '-sn', '-dn');

  if (canCopy) {
    args.push('-c', 'copy');
    if ((fmt === 'mp4' || fmt === 'mov') && (source.audioCodec === 'aac' || isTs || !source.audioCodec)) {
      if (source.hasAudio !== false) args.push('-bsf:a', 'aac_adtstoasc');
    }
    if (fmt === 'mp4' || fmt === 'mov') args.push('-movflags', '+faststart');
    args.push(opts.outputPath);
    return { args, usedCopy: true, usedHw: false };
  }

  const customBv = level === 'custom' ? parseVideoBitrate(opts.customBitrate) : null;
  if (level === 'custom' && !customBv) throw new Error('Custom bitrate required (e.g. 2500k or 2.5)');

  let usedHw = false;
  if (fmt === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-pix_fmt', 'yuv420p');
    if (customBv) args.push('-b:v', customBv);
    else args.push('-crf', String(Math.round((preset.crf || 23) * 1.35)), '-b:v', '0');
  } else {
    const hw = opts.hwEncoder && HW_ENCODERS[opts.hwEncoder] ? opts.hwEncoder : null;
    usedHw = Boolean(hw);
    pushH264(args, { crf: preset.crf, bitrate: customBv, hw });
    if (fmt === 'mp4' || fmt === 'mov') args.push('-movflags', '+faststart');
  }
  if (vf.length) args.push('-vf', vf.join(','));
  applyAudioArgs(args, audioMode, fmt);
  args.push(opts.outputPath);
  return { args, usedCopy: false, usedHw };
}

/** Effective encoded duration for progress (seconds). */
function effectiveDuration(duration, trimStart, trimEnd) {
  const startSec = parseTimeToSeconds(trimStart) || 0;
  const endSec = parseTimeToSeconds(trimEnd);
  const dur = Number(duration) || 0;
  if (endSec != null && endSec > startSec) return dur ? Math.min(endSec, dur) - startSec : endSec - startSec;
  return Math.max(0, dur - startSec);
}

module.exports = {
  VIDEO_EXTS, AUDIO_EXTS, MEDIA_EXTS, PARTIAL_EXTS, VIDEO_FORMATS, AUDIO_EXTRACT_FORMATS, HW_ENCODERS,
  COMPRESS_PRESETS,
  isAudioExtract, migrateCompressKey, parseTimeToSeconds, formatBytes, formatDuration,
  parseVideoBitrate, parseAudioBitrateKbps, isPartialDownload, isCandidateInFolder,
  outputBaseName, outputExt, uniqueOutputPath, parseProbe, codecLabel, containerLabel,
  buildFfmpegArgs, validateJob, effectiveDuration, resolveTargetWidth,
};
