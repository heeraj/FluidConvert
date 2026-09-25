const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let currentJob = null; // { proc, cancelled }

const DEFAULT_SETTINGS = {
  theme: 'dark',
  defaultOutputFolder: null,
  defaultFormat: 'mp4',
  defaultCompress: 'balanced',
  defaultAudioBitrate: '192',
  rememberLastUsed: true,
  lastFormat: null,
  lastCompress: null,
  lastResolution: 'original',
  lastFps: 'original',
  lastAudio: 'keep',
  lastAudioBitrate: null,
  lastCustomBitrate: '',
  sectionsOpen: {
    compress: true,
    video: false,
    audio: false,
    trim: false,
    output: true,
  },
};

/** Migrate old compress keys (quality naming) → level naming (higher = more compress). */
function migrateCompressKey(key) {
  const map = { high: 'low', small: 'high', tiny: 'max' };
  if (!key) return key;
  return map[key] || key;
}

function migrateSettings(raw) {
  const s = { ...raw };
  if (s.defaultCompress) s.defaultCompress = migrateCompressKey(s.defaultCompress);
  if (s.lastCompress) s.lastCompress = migrateCompressKey(s.lastCompress);
  if (!s.sectionsOpen || typeof s.sectionsOpen !== 'object') {
    s.sectionsOpen = { ...DEFAULT_SETTINGS.sectionsOpen };
  } else {
    s.sectionsOpen = { ...DEFAULT_SETTINGS.sectionsOpen, ...s.sectionsOpen };
  }
  if (!s.defaultAudioBitrate) s.defaultAudioBitrate = '192';
  return s;
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_SETTINGS };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return migrateSettings({ ...DEFAULT_SETTINGS, ...raw });
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(partial) {
  const current = loadSettings();
  const next = migrateSettings({ ...current, ...partial });
  if (partial && partial.sectionsOpen) {
    next.sectionsOpen = {
      ...DEFAULT_SETTINGS.sectionsOpen,
      ...(current.sectionsOpen || {}),
      ...partial.sectionsOpen,
    };
  }
  const p = settingsPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  } catch (_) { /* ignore */ }
  return next;
}

function resolveTheme(theme) {
  const t = theme || 'dark';
  if (t === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return t === 'light' ? 'light' : 'dark';
}

function overlayColors(resolved) {
  if (resolved === 'light') {
    return { color: '#f4f5f7', symbolColor: '#1a1d24' };
  }
  return { color: '#0f1115', symbolColor: '#e8eaed' };
}

function applyNativeTheme(theme) {
  const t = theme || 'dark';
  if (t === 'system') nativeTheme.themeSource = 'system';
  else if (t === 'light') nativeTheme.themeSource = 'light';
  else nativeTheme.themeSource = 'dark';
}

function resolveBinary(pkgName) {
  try {
    let binPath;
    if (pkgName === 'ffmpeg') {
      binPath = require('ffmpeg-static');
    } else {
      const ffprobe = require('ffprobe-static');
      binPath = ffprobe.path;
    }
    if (binPath && binPath.includes('app.asar')) {
      binPath = binPath.replace('app.asar', 'app.asar.unpacked');
    }
    if (binPath && fs.existsSync(binPath)) return binPath;
  } catch (_) { /* continue */ }

  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
    : path.join(__dirname, 'node_modules');

  if (pkgName === 'ffmpeg') {
    const candidates = [
      path.join(base, 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
  } else {
    const plat = process.platform === 'win32' ? 'win32' : process.platform;
    const arch = process.arch === 'x64' ? 'x64' : process.arch;
    const candidates = [
      path.join(base, 'ffprobe-static', 'bin', plat, arch, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
  }
  return null;
}

function createWindow() {
  const settings = loadSettings();
  applyNativeTheme(settings.theme);
  const resolved = resolveTheme(settings.theme);
  const overlay = overlayColors(resolved);

  mainWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: overlay.color,
    title: 'FluidConvert',
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: overlay.color,
      symbolColor: overlay.symbolColor,
      height: 36,
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

nativeTheme.on('updated', () => {
  const settings = loadSettings();
  if (settings.theme !== 'system') return;
  const resolved = resolveTheme('system');
  const overlay = overlayColors(resolved);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setTitleBarOverlay({
        color: overlay.color,
        symbolColor: overlay.symbolColor,
        height: 36,
      });
      mainWindow.setBackgroundColor(overlay.color);
    } catch (_) { /* ignore */ }
    send('theme:changed', { resolved });
  }
});

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
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
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(sec) {
  if (!sec || sec < 0 || !Number.isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const AUDIO_EXTRACT_FORMATS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac']);

function isAudioExtract(format) {
  return AUDIO_EXTRACT_FORMATS.has((format || '').toLowerCase());
}

/** Parse user bitrate like "2500k", "2.5M", "2500", "2.5" (Mbps) → ffmpeg string or null. */
function parseVideoBitrate(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(k|kbps|m|mbps)?$/.exec(s);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = m[2] || '';
  if (unit === 'm' || unit === 'mbps') {
    return `${Math.round(num * 1000)}k`;
  }
  if (unit === 'k' || unit === 'kbps') {
    return `${Math.round(num)}k`;
  }
  // bare number: if <= 50 treat as Mbps, else as kbps
  if (num <= 50) return `${Math.round(num * 1000)}k`;
  return `${Math.round(num)}k`;
}

function parseAudioBitrateKbps(raw) {
  const n = parseInt(String(raw || '192').replace(/k$/i, ''), 10);
  if (![320, 192, 128, 96, 64].includes(n)) return 192;
  return n;
}

ipcMain.handle('dialog:openVideo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a media file',
    properties: ['openFile'],
    filters: [
      { name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'gif', 'm4v', 'wmv', 'flv', 'ts', 'mts', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'wma'] },
      { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'gif', 'm4v', 'wmv', 'flv', 'ts', 'mts'] },
      { name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'wma'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:chooseOutputDir', async (_e, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultPath || app.getPath('desktop'),
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('shell:openPath', async (_e, targetPath) => {
  if (!targetPath) return;
  await shell.openPath(targetPath);
});

ipcMain.handle('shell:showItem', async (_e, targetPath) => {
  if (!targetPath) return;
  shell.showItemInFolder(targetPath);
});

ipcMain.handle('fs:getDesktop', () => app.getPath('desktop'));

ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:set', (_e, partial) => {
  const next = saveSettings(partial || {});
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'theme')) {
    applyNativeTheme(next.theme);
    const resolved = resolveTheme(next.theme);
    const overlay = overlayColors(resolved);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setTitleBarOverlay({
          color: overlay.color,
          symbolColor: overlay.symbolColor,
          height: 36,
        });
        mainWindow.setBackgroundColor(overlay.color);
      } catch (_) { /* ignore */ }
    }
    send('theme:changed', { resolved, theme: next.theme });
  }
  return next;
});

ipcMain.handle('theme:resolve', () => {
  const settings = loadSettings();
  return { theme: settings.theme, resolved: resolveTheme(settings.theme) };
});

ipcMain.handle('media:probe', async (_e, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('File not found');
  }
  const ffprobe = resolveBinary('ffprobe');
  if (!ffprobe) throw new Error('ffprobe binary not found');

  const stat = fs.statSync(filePath);
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobe, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ffprobe exited with code ${code}`));
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const duration = parseFloat(data.format?.duration || 0);
        const videoStream = (data.streams || []).find((s) => s.codec_type === 'video');
        const audioStream = (data.streams || []).find((s) => s.codec_type === 'audio');
        let fps = null;
        if (videoStream?.r_frame_rate && videoStream.r_frame_rate.includes('/')) {
          const [a, b] = videoStream.r_frame_rate.split('/').map(Number);
          if (b) fps = a / b;
        }
        resolve({
          path: filePath,
          name: path.basename(filePath),
          size: stat.size,
          sizeLabel: formatBytes(stat.size),
          duration,
          durationLabel: formatDuration(duration),
          width: videoStream?.width || null,
          height: videoStream?.height || null,
          fps,
          hasVideo: Boolean(videoStream),
          hasAudio: Boolean(audioStream),
          format: data.format?.format_name || null,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
});

/**
 * Compress level presets — higher level = more compression / smaller file.
 * low ≈ old "high" quality (CRF 18)
 * balanced ≈ CRF 23
 * high ≈ old "small" (CRF 28)
 * max ≈ old "tiny" (CRF 32 + half scale)
 * original = stream copy when possible
 * custom = -b:v from user
 */
const COMPRESS_PRESETS = {
  original: { crf: null, copy: true, label: 'Original' },
  low: { crf: 18, videoBitrate: null, label: 'Low' },
  balanced: { crf: 23, videoBitrate: null, label: 'Balanced' },
  high: { crf: 28, videoBitrate: null, label: 'High' },
  max: { crf: 32, videoBitrate: '800k', scale: 'iw*0.5:ih*0.5', label: 'Max' },
  custom: { crf: null, videoBitrate: null, label: 'Custom', useCustomBitrate: true },
};

const RES_WIDTH = {
  '1080p': 1920,
  '720p': 1280,
  '480p': 854,
};

function resolveTargetWidth(resolution, customWidth, sourceWidth) {
  const res = (resolution || 'original').toLowerCase();
  if (res === 'original') return null;
  let w = null;
  if (res === 'custom') {
    const n = parseInt(customWidth, 10);
    if (Number.isFinite(n) && n > 0) w = n;
  } else if (RES_WIDTH[res]) {
    w = RES_WIDTH[res];
  }
  if (w == null) return null;
  if (sourceWidth && Number.isFinite(sourceWidth) && sourceWidth > 0) {
    w = Math.min(w, sourceWidth);
  }
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
    else filters.push('scale=480:-2:flags=lanczos');
    return filters;
  }

  if (targetW) {
    filters.push(`scale=${targetW}:-2`);
  } else if (preset.scale) {
    filters.push(`scale=${preset.scale}`);
  }

  if (fpsVal && Number.isFinite(fpsVal) && fpsVal > 0) {
    filters.push(`fps=${fpsVal}`);
  }

  return filters;
}

function applyAudioArgs(args, audioMode, fmt) {
  const mode = (audioMode || 'keep').toLowerCase();
  if (mode === 'strip') {
    args.push('-an');
    return;
  }
  if (mode === 'aac128') {
    args.push('-c:a', 'aac', '-b:a', '128k');
    return;
  }
  if (mode === 'aac96') {
    args.push('-c:a', 'aac', '-b:a', '96k');
    return;
  }
  if (fmt === 'webm') {
    args.push('-c:a', 'libopus', '-b:a', '128k');
  } else {
    args.push('-c:a', 'aac', '-b:a', '160k');
  }
}

function buildFfmpegArgs(opts) {
  const {
    inputPath,
    outputPath,
    format,
    compress,
    trimStart,
    trimEnd,
    duration,
    customBitrate,
    audioBitrate,
  } = opts;

  const level = migrateCompressKey(compress) || 'balanced';
  const preset = COMPRESS_PRESETS[level] || COMPRESS_PRESETS.balanced;
  const args = ['-y', '-hide_banner', '-progress', 'pipe:1', '-nostats'];
  const fmt = (format || 'mp4').toLowerCase();

  const startSec = parseTimeToSeconds(trimStart);
  const endSec = parseTimeToSeconds(trimEnd);

  if (startSec !== null && startSec > 0) {
    args.push('-ss', String(startSec));
  }
  args.push('-i', inputPath);

  if (endSec !== null && endSec > 0) {
    args.push('-to', String(endSec));
  } else if (startSec !== null && startSec > 0 && duration) {
    // encode to EOF
  }

  // —— Audio extract ——
  if (isAudioExtract(fmt)) {
    args.push('-vn');
    const aBit = `${parseAudioBitrateKbps(audioBitrate)}k`;
    if (fmt === 'mp3') {
      args.push('-c:a', 'libmp3lame', '-b:a', aBit);
    } else if (fmt === 'm4a' || fmt === 'aac') {
      args.push('-c:a', 'aac', '-b:a', aBit);
    } else if (fmt === 'wav') {
      args.push('-c:a', 'pcm_s16le');
    } else if (fmt === 'flac') {
      args.push('-c:a', 'flac');
    }
    args.push(outputPath);
    return args;
  }

  const vf = buildVideoFilters({ ...opts, format: fmt }, preset);
  const hasCustomVideo = Boolean(
    (opts.resolution && opts.resolution !== 'original')
    || (opts.fps && opts.fps !== 'original')
    || vf.length
  );
  const audioMode = (opts.audio || 'keep').toLowerCase();
  const canCopy = preset.copy
    && level === 'original'
    && ['mp4', 'mov', 'mkv'].includes(fmt)
    && !hasCustomVideo
    && (audioMode === 'keep');

  const customBv = level === 'custom' ? parseVideoBitrate(customBitrate) : null;
  if (level === 'custom' && !customBv) {
    throw new Error('Custom bitrate required (e.g. 2500k or 2.5)');
  }

  if (fmt === 'gif') {
    if (vf.length) args.push('-vf', vf.join(','));
    args.push('-loop', '0');
    args.push('-an');
  } else if (canCopy) {
    args.push('-c', 'copy');
  } else {
    if (fmt === 'webm') {
      args.push('-c:v', 'libvpx-vp9');
      if (customBv) {
        args.push('-b:v', customBv);
      } else if (preset.crf != null) {
        args.push('-crf', String(preset.crf), '-b:v', '0');
      }
    } else if (fmt === 'avi') {
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
      if (customBv) {
        args.push('-b:v', customBv);
      } else {
        if (preset.crf != null) args.push('-crf', String(preset.crf));
        if (preset.videoBitrate) args.push('-b:v', preset.videoBitrate);
      }
    } else {
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium');
      if (customBv) {
        args.push('-b:v', customBv);
      } else {
        if (preset.crf != null) args.push('-crf', String(preset.crf));
        if (preset.videoBitrate) args.push('-b:v', preset.videoBitrate);
      }
      if (fmt === 'mp4' || fmt === 'mov') {
        args.push('-movflags', '+faststart');
      }
    }
    if (vf.length) args.push('-vf', vf.join(','));
    applyAudioArgs(args, audioMode, fmt);
  }

  args.push(outputPath);
  return args;
}

ipcMain.handle('job:cancel', async () => {
  if (currentJob && currentJob.proc) {
    currentJob.cancelled = true;
    try {
      currentJob.proc.kill('SIGTERM');
    } catch (_) { /* ignore */ }
    try {
      if (process.platform === 'win32' && currentJob.proc.pid) {
        spawn('taskkill', ['/pid', String(currentJob.proc.pid), '/T', '/F'], { windowsHide: true });
      }
    } catch (_) { /* ignore */ }
  }
  return true;
});

ipcMain.handle('job:convert', async (_e, options) => {
  if (currentJob && currentJob.proc) {
    throw new Error('A conversion is already running');
  }

  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) throw new Error('ffmpeg binary not found');

  const {
    inputPath,
    outputDir,
    format,
    compress,
    trimStart,
    trimEnd,
    duration,
    resolution,
    customWidth,
    fps,
    audio,
    sourceWidth,
    customBitrate,
    audioBitrate,
  } = options;

  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('Input file not found');
  }

  const outDir = outputDir || path.dirname(inputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  let ext = (format || 'mp4').toLowerCase();
  if (ext === 'aac') ext = 'm4a';
  const suffix = isAudioExtract(ext) ? 'audio' : 'converted';
  let outputPath = path.join(outDir, `${baseName}_${suffix}.${ext}`);
  let n = 1;
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(outDir, `${baseName}_${suffix}_${n}.${ext}`);
    n += 1;
  }

  const args = buildFfmpegArgs({
    inputPath,
    outputPath,
    format: ext,
    compress: compress || 'balanced',
    trimStart,
    trimEnd,
    duration,
    resolution: resolution || 'original',
    customWidth,
    fps: fps || 'original',
    audio: audio || 'keep',
    sourceWidth: sourceWidth || null,
    customBitrate: customBitrate || '',
    audioBitrate: audioBitrate || '192',
  });

  const startSec = parseTimeToSeconds(trimStart) || 0;
  const endSec = parseTimeToSeconds(trimEnd);
  const totalDuration = endSec != null && endSec > startSec
    ? endSec - startSec
    : Math.max(0, (duration || 0) - startSec);

  return new Promise((resolve, reject) => {
    send('job:log', { line: `ffmpeg ${args.join(' ')}` });
    send('job:progress', { percent: 0, indeterminate: true, status: 'Starting…' });

    const proc = spawn(ffmpeg, args, { windowsHide: true });
    currentJob = { proc, cancelled: false };

    let stderrBuf = '';

    const onProgressLine = (line) => {
      const m = /out_time_ms=(\d+)/.exec(line);
      if (m && totalDuration > 0) {
        const outSec = parseInt(m[1], 10) / 1e6;
        const percent = Math.min(99, Math.max(0, (outSec / totalDuration) * 100));
        send('job:progress', {
          percent,
          indeterminate: false,
          status: `Encoding… ${percent.toFixed(0)}%`,
        });
      }
      const t = /out_time=(\d+:\d+:\d+\.\d+)/.exec(line);
      if (t && totalDuration > 0) {
        const parts = t[1].split(':').map(Number);
        const outSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
        const percent = Math.min(99, Math.max(0, (outSec / totalDuration) * 100));
        send('job:progress', {
          percent,
          indeterminate: false,
          status: `Encoding… ${percent.toFixed(0)}%`,
        });
      }
    };

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      text.split(/\r?\n/).forEach((line) => {
        if (line.trim()) onProgressLine(line.trim());
      });
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stderrBuf += text;
      text.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && /time=|frame=|error|Error/i.test(trimmed)) {
          send('job:log', { line: trimmed });
        }
      });
    });

    proc.on('error', (err) => {
      currentJob = null;
      send('job:progress', { percent: 0, indeterminate: false, status: 'Failed' });
      reject(err);
    });

    proc.on('close', (code) => {
      const wasCancelled = currentJob?.cancelled;
      currentJob = null;
      if (wasCancelled) {
        send('job:progress', { percent: 0, indeterminate: false, status: 'Cancelled' });
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
        resolve({ cancelled: true, outputPath: null });
        return;
      }
      if (code !== 0) {
        send('job:progress', { percent: 0, indeterminate: false, status: 'Failed' });
        reject(new Error(stderrBuf.slice(-800) || `ffmpeg exited with code ${code}`));
        return;
      }
      send('job:progress', { percent: 100, indeterminate: false, status: 'Done' });
      let outSize = 0;
      try { outSize = fs.statSync(outputPath).size; } catch (_) {}
      resolve({
        cancelled: false,
        outputPath,
        outputDir: outDir,
        size: outSize,
        sizeLabel: formatBytes(outSize),
      });
    });
  });
});
