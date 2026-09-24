const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let currentJob = null; // { proc, cancelled }

function resolveBinary(pkgName) {
  // Prefer packaged unpacked path; fall back to require() for dev.
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

  // Fallback: look under resources/app.asar.unpacked
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
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: '#0f1115',
    title: 'FluidConvert',
    frame: true,
    titleBarStyle: 'default',
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

ipcMain.handle('dialog:openVideo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a video',
    properties: ['openFile'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'gif', 'm4v', 'wmv', 'flv', 'ts', 'mts'] },
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
        resolve({
          path: filePath,
          name: path.basename(filePath),
          size: stat.size,
          sizeLabel: formatBytes(stat.size),
          duration,
          durationLabel: formatDuration(duration),
          width: videoStream?.width || null,
          height: videoStream?.height || null,
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
 * Compress presets → ffmpeg settings.
 * original: remux/copy when possible, else light re-encode
 * high / balanced / small / tiny: CRF + optional scale
 */
const COMPRESS_PRESETS = {
  original: { crf: null, copy: true, label: 'Original' },
  high: { crf: 18, videoBitrate: null, label: 'High' },
  balanced: { crf: 23, videoBitrate: null, label: 'Balanced' },
  small: { crf: 28, videoBitrate: null, label: 'Small' },
  tiny: { crf: 32, videoBitrate: '800k', scale: 'iw*0.5:ih*0.5', label: 'Tiny' },
};

function buildFfmpegArgs(opts) {
  const {
    inputPath,
    outputPath,
    format,
    compress,
    trimStart,
    trimEnd,
    duration,
  } = opts;

  const preset = COMPRESS_PRESETS[compress] || COMPRESS_PRESETS.balanced;
  const args = ['-y', '-hide_banner', '-progress', 'pipe:1', '-nostats'];

  const startSec = parseTimeToSeconds(trimStart);
  const endSec = parseTimeToSeconds(trimEnd);

  // Input seeking for speed when trimming from start
  if (startSec !== null && startSec > 0) {
    args.push('-ss', String(startSec));
  }
  args.push('-i', inputPath);

  if (endSec !== null && endSec > 0) {
    // -to is relative to input timeline when used after -i with -ss before -i
    // Prefer -to as absolute end time on the input timeline
    args.push('-to', String(endSec));
  } else if (startSec !== null && startSec > 0 && duration) {
    // no end — encode to EOF (ffmpeg default)
  }

  const fmt = (format || 'mp4').toLowerCase();

  if (fmt === 'gif') {
    // Simple GIF: scale + palette-ish via fps + scale
    const gifFilters = [];
    if (startSec !== null || endSec !== null) {
      // already trimmed via -ss/-to
    }
    gifFilters.push('fps=12');
    if (preset.scale) gifFilters.push(`scale=${preset.scale}:flags=lanczos`);
    else gifFilters.push('scale=480:-1:flags=lanczos');
    args.push('-vf', gifFilters.join(','));
    args.push('-loop', '0');
  } else if (preset.copy && compress === 'original' && ['mp4', 'mov', 'mkv'].includes(fmt)) {
    // Stream copy when staying in compatible containers
    args.push('-c', 'copy');
  } else {
    // Video encode
    if (fmt === 'webm') {
      args.push('-c:v', 'libvpx-vp9');
      if (preset.crf != null) args.push('-crf', String(preset.crf), '-b:v', '0');
      if (preset.scale) args.push('-vf', `scale=${preset.scale}`);
      args.push('-c:a', 'libopus', '-b:a', '128k');
    } else if (fmt === 'avi') {
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
      if (preset.crf != null) args.push('-crf', String(preset.crf));
      if (preset.videoBitrate) args.push('-b:v', preset.videoBitrate);
      if (preset.scale) args.push('-vf', `scale=${preset.scale}`);
      args.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      // mp4 / mov / mkv
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium');
      if (preset.crf != null) args.push('-crf', String(preset.crf));
      if (preset.videoBitrate) args.push('-b:v', preset.videoBitrate);
      if (preset.scale) args.push('-vf', `scale=${preset.scale}`);
      args.push('-c:a', 'aac', '-b:a', '160k');
      if (fmt === 'mp4' || fmt === 'mov') {
        args.push('-movflags', '+faststart');
      }
    }
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
    // On Windows, force kill tree if needed
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
  } = options;

  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('Input file not found');
  }

  const outDir = outputDir || path.dirname(inputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const ext = (format || 'mp4').toLowerCase();
  let outputPath = path.join(outDir, `${baseName}_converted.${ext}`);
  let n = 1;
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(outDir, `${baseName}_converted_${n}.${ext}`);
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
      // -progress pipe:1 emits key=value lines, e.g. out_time_ms=1234567
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
      // Forward short status lines
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
        // Best-effort remove partial output
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
