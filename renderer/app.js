(() => {
  const $ = (id) => document.getElementById(id);

  const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac']);

  const state = {
    file: null,
    format: 'mp4',
    compress: 'balanced',
    resolution: 'original',
    customWidth: '',
    fps: 'original',
    audio: 'keep',
    outputDir: null,
    lastOutputPath: null,
    running: false,
    settings: null,
  };

  const COMPRESS_FACTOR = {
    original: 1.0,
    high: 0.85,
    balanced: 0.55,
    small: 0.32,
    tiny: 0.14,
  };

  const FORMAT_FACTOR = {
    mp4: 1.0,
    mov: 1.05,
    mkv: 0.98,
    webm: 0.75,
    avi: 1.15,
    gif: 1.8,
  };

  const RES_FACTOR = {
    original: 1.0,
    '1080p': 1.0,
    '720p': 0.55,
    '480p': 0.28,
    custom: 0.7,
  };

  const FPS_FACTOR = {
    original: 1.0,
    '60': 1.15,
    '30': 0.85,
    '24': 0.72,
  };

  function isExtract() {
    return AUDIO_FORMATS.has(state.format);
  }

  function parseTimeToSeconds(value) {
    if (value === null || value === undefined) return null;
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
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function trimRatio() {
    if (!state.file || !state.file.duration) return 1;
    const dur = state.file.duration;
    const start = parseTimeToSeconds($('trim-start').value) || 0;
    let end = parseTimeToSeconds($('trim-end').value);
    if (end === null || end <= 0) end = dur;
    const clippedStart = Math.max(0, Math.min(start, dur));
    const clippedEnd = Math.max(clippedStart, Math.min(end, dur));
    const len = clippedEnd - clippedStart;
    if (len <= 0 || dur <= 0) return 1;
    return Math.min(1, len / dur);
  }

  function resolutionFactor() {
    if (state.resolution === 'custom') {
      const w = parseInt(state.customWidth || $('custom-width').value, 10);
      const srcW = state.file?.width;
      if (w > 0 && srcW > 0) {
        const clamped = Math.min(w, srcW);
        return Math.max(0.05, (clamped / srcW) ** 2);
      }
      return RES_FACTOR.custom;
    }
    if (state.resolution !== 'original' && state.file?.width) {
      const targets = { '1080p': 1920, '720p': 1280, '480p': 854 };
      const tw = targets[state.resolution];
      if (tw) {
        const clamped = Math.min(tw, state.file.width);
        return Math.max(0.05, (clamped / state.file.width) ** 2);
      }
    }
    return RES_FACTOR[state.resolution] || 1;
  }

  function estimateOutputBytes() {
    if (!state.file) return null;
    const src = state.file.size || 0;
    if (!src) return null;
    const ratio = trimRatio();
    const dur = (state.file.duration || 10) * ratio;

    if (isExtract()) {
      const rates = { mp3: 24, m4a: 24, aac: 24, wav: 176, flac: 90 }; // KB/s rough
      const kbps = rates[state.format] || 24;
      return Math.max(16 * 1024, dur * kbps * 1024);
    }

    if (state.format === 'gif') {
      const scale = resolutionFactor();
      const fpsMul = state.fps === 'original' ? 1 : (parseInt(state.fps, 10) || 12) / 12;
      const gifEst = dur * 180 * 1024 * scale * Math.min(2, fpsMul);
      return Math.max(50 * 1024, gifEst);
    }

    let factor = (COMPRESS_FACTOR[state.compress] || 0.55) * (FORMAT_FACTOR[state.format] || 1);
    factor *= resolutionFactor();
    factor *= FPS_FACTOR[state.fps] || 1;

    if (state.audio === 'strip') factor *= 0.88;
    else if (state.audio === 'aac96') factor *= 0.95;
    else if (state.audio === 'aac128') factor *= 0.97;

    if (state.compress === 'original') {
      factor = 1.0 * (FORMAT_FACTOR[state.format] || 1) * resolutionFactor() * (FPS_FACTOR[state.fps] || 1);
      if (state.format === 'webm') factor *= 0.9;
      if (state.resolution !== 'original' || state.fps !== 'original') {
        factor *= 0.85; // re-encode
      }
    }

    return Math.max(32 * 1024, src * factor * ratio);
  }

  function updateEstimate() {
    const el = $('est-size');
    if (!state.file) {
      el.textContent = 'Est. —';
      return;
    }
    const bytes = estimateOutputBytes();
    el.textContent = `Est. ~${formatBytes(bytes)}`;
  }

  function setChips(containerId, attr, value) {
    const root = $(containerId);
    if (!root) return;
    root.querySelectorAll('.chip').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset[attr] === value);
    });
  }

  function updateModeUI() {
    const extract = isExtract();
    document.querySelectorAll('.video-only').forEach((el) => {
      el.classList.toggle('hidden', extract);
    });
    // GIF: hide audio row (already video-only); resolution/fps still useful
    if (!extract && state.format === 'gif') {
      $('row-audio')?.classList.add('hidden');
      $('row-compress')?.classList.remove('hidden');
    }
    $('custom-width-wrap').classList.toggle('hidden', extract || state.resolution !== 'custom');
    $('btn-convert').textContent = extract ? 'Extract' : 'Convert';
  }

  function applyTheme(resolved) {
    document.documentElement.setAttribute('data-theme', resolved === 'light' ? 'light' : 'dark');
  }

  function setRunning(running) {
    state.running = running;
    $('btn-convert').disabled = running || !state.file;
    $('btn-cancel').classList.toggle('hidden', !running);
    $('btn-browse').disabled = running;
    $('btn-clear').disabled = running;
  }

  function showFile(probe) {
    state.file = probe;
    $('drop-empty').classList.add('hidden');
    $('drop-file').classList.remove('hidden');
    $('file-name').textContent = probe.name;
    $('file-duration').textContent = probe.durationLabel || '—';
    $('file-size').textContent = probe.sizeLabel || '—';
    const res = probe.width && probe.height ? `${probe.width}×${probe.height}` : (probe.hasAudio && !probe.hasVideo ? 'audio' : '—');
    $('file-res').textContent = res;
    if (!state.outputDir) {
      $('output-dir').value = '';
      $('output-dir').placeholder = 'Same as source';
    }
    $('btn-convert').disabled = state.running;
    updateEstimate();
    appendLog(`Loaded ${probe.name} (${probe.durationLabel}, ${probe.sizeLabel})`);
  }

  function clearFile() {
    state.file = null;
    state.lastOutputPath = null;
    $('drop-empty').classList.remove('hidden');
    $('drop-file').classList.add('hidden');
    $('btn-convert').disabled = true;
    $('btn-open-out').classList.add('hidden');
    $('trim-start').value = '';
    $('trim-end').value = '';
    updateEstimate();
    setProgress({ percent: 0, indeterminate: false, status: 'Ready' });
  }

  function appendLog(line) {
    const log = $('log');
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    log.textContent += `[${stamp}] ${line}\n`;
    log.scrollTop = log.scrollHeight;
  }

  function setProgress({ percent, indeterminate, status }) {
    const bar = $('progress-bar');
    $('progress-status').textContent = status || 'Ready';
    if (indeterminate) {
      bar.classList.add('indeterminate');
      $('progress-pct').textContent = '';
    } else {
      bar.classList.remove('indeterminate');
      const p = Math.max(0, Math.min(100, percent || 0));
      bar.style.width = `${p}%`;
      $('progress-pct').textContent = p > 0 ? `${p.toFixed(0)}%` : '';
    }
  }

  async function loadPath(filePath) {
    if (!filePath || state.running) return;
    try {
      setProgress({ percent: 0, indeterminate: true, status: 'Probing…' });
      const probe = await window.fluid.probe(filePath);
      showFile(probe);
      setProgress({ percent: 0, indeterminate: false, status: 'Ready' });
    } catch (err) {
      clearFile();
      setProgress({ percent: 0, indeterminate: false, status: 'Probe failed' });
      appendLog(`Error: ${err.message || err}`);
    }
  }

  async function persistLastUsed() {
    if (!state.settings?.rememberLastUsed) return;
    try {
      await window.fluid.setSettings({
        lastFormat: state.format,
        lastCompress: state.compress,
        lastResolution: state.resolution,
        lastFps: state.fps,
        lastAudio: state.audio,
      });
    } catch (_) { /* ignore */ }
  }

  function openSettings() {
    const s = state.settings || {};
    setChips('theme-chips', 'theme', s.theme || 'dark');
    $('settings-out-dir').value = s.defaultOutputFolder || '';
    $('settings-out-dir').placeholder = 'Same as source';
    $('settings-format').value = s.defaultFormat || 'mp4';
    $('settings-compress').value = s.defaultCompress || 'balanced';
    $('settings-remember').checked = s.rememberLastUsed !== false;
    $('settings-backdrop').classList.remove('hidden');
    $('settings-panel').classList.remove('hidden');
  }

  function closeSettings() {
    $('settings-backdrop').classList.add('hidden');
    $('settings-panel').classList.add('hidden');
  }

  // —— Chip handlers ——
  $('format-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.format = btn.dataset.format;
    setChips('format-chips', 'format', state.format);
    updateModeUI();
    updateEstimate();
    persistLastUsed();
  });

  $('compress-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.compress = btn.dataset.compress;
    setChips('compress-chips', 'compress', state.compress);
    updateEstimate();
    persistLastUsed();
  });

  $('resolution-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.resolution = btn.dataset.resolution;
    setChips('resolution-chips', 'resolution', state.resolution);
    updateModeUI();
    updateEstimate();
    persistLastUsed();
  });

  $('custom-width').addEventListener('input', () => {
    state.customWidth = $('custom-width').value.trim();
    updateEstimate();
  });

  $('fps-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.fps = btn.dataset.fps;
    setChips('fps-chips', 'fps', state.fps);
    updateEstimate();
    persistLastUsed();
  });

  $('audio-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.audio = btn.dataset.audio;
    setChips('audio-chips', 'audio', state.audio);
    updateEstimate();
    persistLastUsed();
  });

  ['trim-start', 'trim-end'].forEach((id) => {
    $(id).addEventListener('input', updateEstimate);
    $(id).addEventListener('change', updateEstimate);
  });

  // —— Drop / browse ——
  const dropzone = $('dropzone');

  $('btn-browse').addEventListener('click', async (e) => {
    e.stopPropagation();
    const p = await window.fluid.openVideo();
    if (p) loadPath(p);
  });

  dropzone.addEventListener('click', async (e) => {
    if (e.target.closest('#btn-clear') || e.target.closest('#btn-browse')) return;
    if (state.file) return;
    const p = await window.fluid.openVideo();
    if (p) loadPath(p);
  });

  $('btn-clear').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.running) clearFile();
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file?.path) loadPath(file.path);
  });

  // —— Output folder ——
  $('btn-out-dir').addEventListener('click', async () => {
    const desktop = await window.fluid.getDesktop();
    const def = state.outputDir
      || (state.file ? state.file.path.replace(/[/\\][^/\\]+$/, '') : desktop);
    const chosen = await window.fluid.chooseOutputDir(def);
    if (chosen) {
      state.outputDir = chosen;
      $('output-dir').value = chosen;
    }
  });

  $('btn-out-clear').addEventListener('click', () => {
    state.outputDir = null;
    $('output-dir').value = '';
    $('output-dir').placeholder = 'Same as source';
  });

  // —— Settings ——
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings-close').addEventListener('click', closeSettings);
  $('settings-backdrop').addEventListener('click', closeSettings);

  $('theme-chips').addEventListener('click', async (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    const theme = btn.dataset.theme;
    setChips('theme-chips', 'theme', theme);
    const next = await window.fluid.setSettings({ theme });
    state.settings = next;
    const resolved = await window.fluid.resolveTheme();
    applyTheme(resolved.resolved);
  });

  $('btn-settings-out').addEventListener('click', async () => {
    const desktop = await window.fluid.getDesktop();
    const chosen = await window.fluid.chooseOutputDir(state.settings?.defaultOutputFolder || desktop);
    if (chosen) {
      $('settings-out-dir').value = chosen;
      state.settings = await window.fluid.setSettings({ defaultOutputFolder: chosen });
      if (!state.outputDir) {
        state.outputDir = chosen;
        $('output-dir').value = chosen;
      }
    }
  });

  $('btn-settings-out-clear').addEventListener('click', async () => {
    $('settings-out-dir').value = '';
    state.settings = await window.fluid.setSettings({ defaultOutputFolder: null });
  });

  $('settings-format').addEventListener('change', async () => {
    state.settings = await window.fluid.setSettings({ defaultFormat: $('settings-format').value });
  });

  $('settings-compress').addEventListener('change', async () => {
    state.settings = await window.fluid.setSettings({ defaultCompress: $('settings-compress').value });
  });

  $('settings-remember').addEventListener('change', async () => {
    state.settings = await window.fluid.setSettings({ rememberLastUsed: $('settings-remember').checked });
  });

  // —— Convert / cancel ——
  $('btn-convert').addEventListener('click', async () => {
    if (!state.file || state.running) return;
    setRunning(true);
    $('btn-open-out').classList.add('hidden');
    setProgress({ percent: 0, indeterminate: true, status: 'Starting…' });
    const label = isExtract()
      ? `Extract → ${state.format.toUpperCase()}`
      : `Convert → ${state.format.toUpperCase()} / ${state.compress} / ${state.resolution} / ${state.fps}fps / ${state.audio}`;
    appendLog(label);

    try {
      const result = await window.fluid.convert({
        inputPath: state.file.path,
        outputDir: state.outputDir || null,
        format: state.format,
        compress: state.compress,
        trimStart: $('trim-start').value.trim(),
        trimEnd: $('trim-end').value.trim(),
        duration: state.file.duration,
        resolution: state.resolution,
        customWidth: state.customWidth || $('custom-width').value.trim(),
        fps: state.fps,
        audio: state.audio,
        sourceWidth: state.file.width || null,
      });

      if (result.cancelled) {
        appendLog('Cancelled');
        setProgress({ percent: 0, indeterminate: false, status: 'Cancelled' });
      } else {
        state.lastOutputPath = result.outputPath;
        appendLog(`Done → ${result.outputPath} (${result.sizeLabel})`);
        setProgress({ percent: 100, indeterminate: false, status: 'Done' });
        $('btn-open-out').classList.remove('hidden');
      }
      await persistLastUsed();
    } catch (err) {
      appendLog(`Error: ${err.message || err}`);
      setProgress({ percent: 0, indeterminate: false, status: 'Failed' });
    } finally {
      setRunning(false);
    }
  });

  $('btn-cancel').addEventListener('click', async () => {
    appendLog('Cancelling…');
    await window.fluid.cancel();
  });

  $('btn-open-out').addEventListener('click', async () => {
    if (state.lastOutputPath) {
      await window.fluid.showItem(state.lastOutputPath);
    } else if (state.outputDir) {
      await window.fluid.openPath(state.outputDir);
    }
  });

  window.fluid.onProgress((data) => setProgress(data));
  window.fluid.onLog((data) => {
    if (data?.line) appendLog(data.line);
  });
  window.fluid.onThemeChanged((data) => {
    if (data?.resolved) applyTheme(data.resolved);
  });

  async function init() {
    try {
      const settings = await window.fluid.getSettings();
      state.settings = settings;

      const themeInfo = await window.fluid.resolveTheme();
      applyTheme(themeInfo.resolved);

      const remember = settings.rememberLastUsed !== false;
      const format = (remember && settings.lastFormat) || settings.defaultFormat || 'mp4';
      const compress = (remember && settings.lastCompress) || settings.defaultCompress || 'balanced';
      const resolution = (remember && settings.lastResolution) || 'original';
      const fps = (remember && settings.lastFps) || 'original';
      const audio = (remember && settings.lastAudio) || 'keep';

      state.format = format;
      state.compress = compress;
      state.resolution = resolution;
      state.fps = fps;
      state.audio = audio;

      setChips('format-chips', 'format', state.format);
      setChips('compress-chips', 'compress', state.compress);
      setChips('resolution-chips', 'resolution', state.resolution);
      setChips('fps-chips', 'fps', state.fps);
      setChips('audio-chips', 'audio', state.audio);

      if (settings.defaultOutputFolder) {
        state.outputDir = settings.defaultOutputFolder;
        $('output-dir').value = settings.defaultOutputFolder;
      }

      updateModeUI();
    } catch (err) {
      appendLog(`Settings load: ${err.message || err}`);
      applyTheme('dark');
      updateModeUI();
    }
    updateEstimate();
  }

  init();
})();
