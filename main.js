const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const F = require('./lib/ffargs');
const M = require('./lib/media');

let mainWindow = null;
const jobs = new Map(); // jobId -> { proc, cancelled, outputPath }
const reservedOutputs = new Set();
let hwCache = null;

const THEMES = {
  dark: { bg: '#0d0f13', fg: '#eceef2', light: false },
  light: { bg: '#f3f4f7', fg: '#151821', light: true },
  midnight: { bg: '#000000', fg: '#f2f2f5', light: false },
  nord: { bg: '#242933', fg: '#eceff4', light: false },
  sand: { bg: '#f4eee4', fg: '#2b241b', light: true },
};

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: 'blue',
  defaultOutputFolder: null,
  lastOutputFolder: null,
  rememberOutputFolder: true,
  defaultFormat: 'mp4',
  defaultCompress: 'balanced',
  defaultAudioBitrate: '192',
  rememberLastUsed: true,
  concurrency: 1,
  hwEncoding: 'off', // 'off' | 'auto'
  notifyOnFinish: true,
  lastFormat: null,
  lastCompress: null,
  lastResolution: 'original',
  lastFps: 'original',
  lastAudio: 'keep',
  lastAudioBitrate: null,
  lastCustomBitrate: '',
  lastPreset: null,
};

function migrateSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  // v0.2 quality names -> v0.3 level names (v0.3 "high" already means more compression)
  const legacy = { small: 'high', tiny: 'max' };
  if (legacy[s.defaultCompress]) s.defaultCompress = legacy[s.defaultCompress];
  if (legacy[s.lastCompress]) s.lastCompress = legacy[s.lastCompress];
  if (!THEMES[s.theme] && s.theme !== 'system') s.theme = 'dark';
  s.concurrency = s.concurrency === 2 ? 2 : 1;
  if (!['off', 'auto'].includes(s.hwEncoding)) s.hwEncoding = 'off';
  delete s.sectionsOpen;
  return s;
}

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }

function loadSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_SETTINGS };
    return migrateSettings(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(partial) {
  const next = migrateSettings({ ...loadSettings(), ...(partial || {}) });
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (_) { /* ignore */ }
  return next;
}

function resolveTheme(theme) {
  if (theme === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return THEMES[theme] ? theme : 'dark';
}

function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  const t = THEMES[resolved];
  nativeTheme.themeSource = theme === 'system' ? 'system' : (t.light ? 'light' : 'dark');
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setTitleBarOverlay({ color: t.bg, symbolColor: t.fg, height: 40 });
      mainWindow.setBackgroundColor(t.bg);
    } catch (_) { /* ignore */ }
  }
  return resolved;
}

function resolveBinary(pkgName) {
  try {
    let binPath = pkgName === 'ffmpeg' ? require('ffmpeg-static') : require('ffprobe-static').path;
    if (binPath && binPath.includes('app.asar') && !binPath.includes('app.asar.unpacked')) {
      binPath = binPath.replace('app.asar', 'app.asar.unpacked');
    }
    if (binPath && fs.existsSync(binPath)) return binPath;
  } catch (_) { /* continue */ }
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
    : path.join(__dirname, 'node_modules');
  const c = pkgName === 'ffmpeg'
    ? path.join(base, 'ffmpeg-static', 'ffmpeg.exe')
    : path.join(base, 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe');
  return fs.existsSync(c) ? c : null;
}

function createWindow() {
  const settings = loadSettings();
  const resolved = resolveTheme(settings.theme);
  const t = THEMES[resolved];
  nativeTheme.themeSource = settings.theme === 'system' ? 'system' : (t.light ? 'light' : 'dark');

  mainWindow = new BrowserWindow({
    width: 940,
    height: 660,
    minWidth: 720,
    minHeight: 540,
    backgroundColor: t.bg,
    title: 'FluidConvert',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: t.bg, symbolColor: t.fg, height: 40 },
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Dev/QA only: FC_SCREENSHOT=<png path> captures the window after load, then quits.
  if (process.env.FC_SCREENSHOT) {
    mainWindow.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log(`[renderer] ${message}`); });
    mainWindow.webContents.setBackgroundThrottling(false);
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important}');
      setTimeout(async () => {
        try {
          if (process.env.FC_SCREENSHOT_JS) await mainWindow.webContents.executeJavaScript(process.env.FC_SCREENSHOT_JS);
          await new Promise((r) => setTimeout(r, Number(process.env.FC_SCREENSHOT_WAIT || 400)));
          const img = await mainWindow.webContents.capturePage();
          fs.writeFileSync(process.env.FC_SCREENSHOT, img.toPNG());
        } catch (err) { console.log(`screenshot failed: ${err.message}`); }
        app.quit();
      }, 1200);
    });
  }
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  // Never let a stray drop navigate the window away.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

if (process.platform === 'win32') app.setAppUserModelId('com.heeraj.fluidconvert');
// QA screenshot runs use a throwaway profile so they never touch real settings.
if (process.env.FC_SCREENSHOT) app.setPath('userData', path.join(app.getPath('temp'), 'fluidconvert-qa-profile'));

app.whenReady().then(createWindow);
let quitting = false;
async function abortAllJobs() {
  const list = [...jobs.values()];
  if (!list.length) return;
  const waits = list.map((job) => new Promise((resolve) => {
    job.cancelled = true;
    if (!job.proc || job.proc.exitCode !== null) { resolve(); return; }
    job.proc.once('close', resolve);
    M.killProc(job.proc);
  }));
  await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 2500))]);
  // Remove half-written outputs.
  for (const job of list) {
    try { if (job.outputPath && fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath); } catch (_) { /* ignore */ }
  }
}
app.on('before-quit', (e) => {
  if (quitting || !jobs.size) return;
  e.preventDefault();
  quitting = true;
  abortAllJobs().finally(() => app.quit());
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

nativeTheme.on('updated', () => {
  const settings = loadSettings();
  if (settings.theme !== 'system') return;
  const resolved = applyTheme('system');
  send('theme:changed', { resolved, theme: 'system' });
});

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ---------- Dialogs / shell ----------

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add media files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All files (*.*)', extensions: ['*'] },
      { name: 'Media files', extensions: F.MEDIA_EXTS },
      { name: 'Video', extensions: F.VIDEO_EXTS },
      { name: 'Audio', extensions: F.AUDIO_EXTS },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Add a folder', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return [];
  return M.expandPaths(result.filePaths);
});

ipcMain.handle('dialog:chooseOutputDir', async (_e, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultPath || app.getPath('videos'),
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('fs:expand', (_e, paths) => M.expandPaths(Array.isArray(paths) ? paths : []));
ipcMain.handle('shell:openPath', async (_e, p) => { if (p) await shell.openPath(p); });
ipcMain.handle('shell:showItem', async (_e, p) => { if (p) shell.showItemInFolder(p); });

// ---------- Settings / theme ----------

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, partial) => {
  const next = saveSettings(partial || {});
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'theme')) {
    const resolved = applyTheme(next.theme);
    send('theme:changed', { resolved, theme: next.theme });
  }
  return next;
});
ipcMain.handle('theme:resolve', () => {
  const s = loadSettings();
  return { theme: s.theme, resolved: resolveTheme(s.theme) };
});

// ---------- Window / notify ----------

ipcMain.handle('app:notify', (_e, { title, body } = {}) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return false;
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: title || 'FluidConvert', body: body || '', icon: path.join(__dirname, 'assets', 'icon.ico') });
    n.on('click', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
    n.show();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(true);
    return true;
  } catch (_) { return false; }
});
ipcMain.handle('app:version', () => app.getVersion());

// ---------- Probe / HW ----------

ipcMain.handle('media:probe', async (_e, filePath) => {
  const ffprobe = resolveBinary('ffprobe');
  if (!ffprobe) return { ok: false, reason: 'error', message: 'ffprobe missing', path: filePath, name: path.basename(String(filePath || '')) };
  return M.probeFile(ffprobe, filePath);
});

ipcMain.handle('hw:detect', async (_e, force) => {
  if (hwCache && !force) return hwCache;
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) return [];
  try { hwCache = await M.detectHwEncoders(ffmpeg); } catch (_) { hwCache = []; }
  return hwCache;
});

// ---------- Jobs ----------

ipcMain.handle('job:cancel', async (_e, jobId) => {
  const targets = jobId ? [jobs.get(jobId)].filter(Boolean) : [...jobs.values()];
  for (const job of targets) { job.cancelled = true; M.killProc(job.proc); }
  return true;
});

ipcMain.handle('job:convert', async (_e, options) => {
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) return { ok: false, error: 'ffmpeg binary not found' };
  const { jobId, inputPath, outputDir, source } = options || {};
  if (!inputPath || !fs.existsSync(inputPath)) return { ok: false, error: 'Input file not found' };

  const invalid = F.validateJob(options, source);
  if (invalid) return { ok: false, error: invalid };

  const outDir = outputDir || path.dirname(inputPath);
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (err) { return { ok: false, error: `Cannot write to ${outDir}` }; }

  const ext = F.outputExt(options.format);
  const outputPath = F.uniqueOutputPath(outDir, F.outputBaseName(inputPath), ext, reservedOutputs, inputPath);
  reservedOutputs.add(outputPath.toLowerCase());

  let hwEncoder = null;
  if (options.hwEncoding === 'auto' && ['mp4', 'mov', 'mkv', 'avi'].includes(ext)) {
    const list = hwCache || [];
    hwEncoder = list[0] || null;
  }
  const totalDuration = F.effectiveDuration(source && source.duration, options.trimStart, options.trimEnd);
  const job = { proc: null, cancelled: false, outputPath };
  jobs.set(jobId, job);

  const attempt = async (overrides) => {
    const built = F.buildFfmpegArgs({
      ...options,
      format: ext,
      inputPath,
      outputPath,
      sourceWidth: source && source.width,
      source,
      hwEncoder,
      ...overrides,
    });
    send('job:log', { jobId, line: `ffmpeg ${built.args.join(' ')}` });
    const run = M.runFfmpeg(ffmpeg, built.args, {
      totalDuration,
      onProgress: (p) => send('job:progress', { jobId, ...p }),
      onLog: (line) => send('job:log', { jobId, line }),
    });
    job.proc = run.proc;
    const res = await run.done;
    return { ...res, built };
  };

  try {
    let res = await attempt({});
    if (!job.cancelled && res.code !== 0 && (res.built.usedCopy || res.built.usedHw)) {
      send('job:log', { jobId, line: res.built.usedCopy ? 'Stream copy failed — re-encoding' : 'Hardware encoder failed — using software (x264)' });
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
      send('job:progress', { jobId, percent: 0, outSec: 0, elapsedSec: 0, etaSec: null, retry: true });
      res = await attempt({ forceEncode: true, hwEncoder: null });
    }
    if (job.cancelled) {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
      return { ok: false, cancelled: true };
    }
    if (res.code !== 0) {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
      const lines = String(res.stderr || '').trim().split(/\r?\n/).filter(Boolean);
      return { ok: false, error: lines.slice(-2).join(' ').slice(0, 300) || `ffmpeg exited with code ${res.code}` };
    }
    let size = 0;
    try { size = fs.statSync(outputPath).size; } catch (_) {}
    return { ok: true, outputPath, outputDir: outDir, size, sizeLabel: F.formatBytes(size) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    jobs.delete(jobId);
    reservedOutputs.delete(outputPath.toLowerCase());
  }
});
