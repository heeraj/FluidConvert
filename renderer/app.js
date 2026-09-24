(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    file: null, // probe result
    format: 'mp4',
    compress: 'balanced',
    outputDir: null,
    lastOutputPath: null,
    running: false,
  };

  // Rough size multipliers vs source size (before trim ratio).
  // Tuned for typical H.264/AAC sources — estimates only.
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
    gif: 1.8, // can balloon; capped later relative to duration
  };

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

  function estimateOutputBytes() {
    if (!state.file) return null;
    const src = state.file.size || 0;
    if (!src) return null;

    let factor = (COMPRESS_FACTOR[state.compress] || 0.55) * (FORMAT_FACTOR[state.format] || 1);
    // GIF: base on duration more than source codec size
    if (state.format === 'gif') {
      const dur = (state.file.duration || 10) * trimRatio();
      // ~180 KB/s rough for 480p 12fps gif
      const gifEst = dur * 180 * 1024;
      return Math.max(50 * 1024, gifEst);
    }

    // Original + same-ish container ≈ remux, near source * trim
    if (state.compress === 'original') {
      factor = 1.0 * (FORMAT_FACTOR[state.format] || 1);
      if (state.format === 'webm') factor = 0.9; // copy rarely possible → slight reencode guess
    }

    const est = src * factor * trimRatio();
    return Math.max(32 * 1024, est);
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
    root.querySelectorAll('.chip').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset[attr] === value);
    });
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
    const res = probe.width && probe.height ? `${probe.width}×${probe.height}` : '—';
    $('file-res').textContent = res;
    if (!state.outputDir) {
      // default: same folder as source (shown as placeholder); leave input empty meaning "same as source"
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

  // —— Chip handlers ——
  $('format-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.format = btn.dataset.format;
    setChips('format-chips', 'format', state.format);
    updateEstimate();
  });

  $('compress-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.compress = btn.dataset.compress;
    setChips('compress-chips', 'compress', state.compress);
    updateEstimate();
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

  // —— Convert / cancel ——
  $('btn-convert').addEventListener('click', async () => {
    if (!state.file || state.running) return;
    setRunning(true);
    $('btn-open-out').classList.add('hidden');
    setProgress({ percent: 0, indeterminate: true, status: 'Starting…' });
    appendLog(`Convert → ${state.format.toUpperCase()} / ${state.compress}`);

    try {
      const result = await window.fluid.convert({
        inputPath: state.file.path,
        outputDir: state.outputDir || null,
        format: state.format,
        compress: state.compress,
        trimStart: $('trim-start').value.trim(),
        trimEnd: $('trim-end').value.trim(),
        duration: state.file.duration,
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

  updateEstimate();
})();
