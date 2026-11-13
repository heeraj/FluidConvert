(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const svg = (n) => window.FCIcons.svg(n);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac']);
  const LOSSY_AUDIO = new Set(['mp3', 'm4a', 'aac']);
  const LEVEL_LABELS = { low: 'Low', balanced: 'Balanced', high: 'High', max: 'Max', original: 'Original', custom: 'Custom' };
  const LEVEL_FILL = { low: 22, balanced: 50, high: 75, max: 96, original: 6, custom: 50 };
  const AUDIO_LABELS = { keep: 'Keep', strip: 'Removed', aac128: '128k', aac96: '96k' };
  const HW_LABELS = { nvenc: 'NVIDIA NVENC', qsv: 'Intel Quick Sync', amf: 'AMD AMF' };

  const ACCENTS = {
    blue: { d: ['#7aa2ff', '#a48bff'], l: ['#2f62e6', '#6a4fe0'] },
    violet: { d: ['#a78bfa', '#d08bfa'], l: ['#6d4fe0', '#9b3fd6'] },
    teal: { d: ['#2dd4bf', '#5ab8f5'], l: ['#0d8577', '#0e74a8'] },
    green: { d: ['#5ecf8e', '#3fd2c0'], l: ['#178a4f', '#0d8577'] },
    amber: { d: ['#f5b13d', '#f68a5c'], l: ['#b06400', '#c24a2b'] },
    rose: { d: ['#f47ba5', '#c58bfa'], l: ['#c23a6b', '#9b3fd6'] },
  };
  const LIGHT_THEMES = new Set(['light', 'sand']);

  const PRESETS = {
    small: { label: 'Smaller file', format: 'mp4', compress: 'high', resolution: 'original', fps: 'original', audio: 'aac96' },
    share: { label: 'Share · 720p', format: 'mp4', compress: 'balanced', resolution: '720p', fps: '30', audio: 'aac128' },
    hq: { label: 'High quality', format: 'mp4', compress: 'low', resolution: 'original', fps: 'original', audio: 'keep' },
    mp3: { label: 'Extract MP3', format: 'mp3', audioBitrate: '192' },
    gif: { label: 'GIF', format: 'gif', resolution: '480p', fps: 'original' },
  };

  // Estimate heuristics
  const COMPRESS_FACTOR = { original: 1.0, low: 0.8, balanced: 0.5, high: 0.3, max: 0.12, custom: 0.5 };
  const FORMAT_FACTOR = { mp4: 1.0, mov: 1.02, mkv: 0.99, webm: 0.8, avi: 1.12, gif: 1 };
  const FPS_FACTOR = { original: 1.0, '60': 1.1, '30': 0.85, '24': 0.72 };
  const RES_TARGET = { '1080p': 1920, '720p': 1280, '480p': 854 };

  const state = {
    items: [],
    seq: 0,
    selectedId: null,
    format: 'mp4',
    compress: 'balanced',
    customBitrate: '',
    resolution: 'original',
    customWidth: '',
    fps: 'original',
    audio: 'keep',
    audioBitrate: '192',
    trimStart: '',
    trimEnd: '',
    outputDir: null,
    hwEncoding: 'off',
    hwList: null,
    settings: {},
    running: false,
    cancelAll: false,
    batch: null,
    lastOutputPath: null,
    lastOutputDir: null,
    logOpen: false,
    openPop: null,
    theme: 'dark',
    resolvedTheme: 'dark',
  };

  // ---------- helpers ----------
  const isExtract = () => AUDIO_FORMATS.has(state.format);
  const isLossy = () => LOSSY_AUDIO.has(state.format);

  function parseTime(value) {
    const s = String(value == null ? '' : value).trim();
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
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n.toFixed(i === 0 ? 0 : n < 10 ? 1 : 0)} ${units[i]}`;
  }
  function fmtClock(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function parseBitrateKbps(raw) {
    const s = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;
    const m = /^(\d+(?:\.\d+)?)(k|kbps|m|mbps)?$/.exec(s);
    if (!m) return null;
    const num = parseFloat(m[1]);
    if (!Number.isFinite(num) || num <= 0) return null;
    const unit = m[2] || '';
    if (unit === 'm' || unit === 'mbps') return Math.round(num * 1000);
    if (unit === 'k' || unit === 'kbps') return Math.round(num);
    return num <= 50 ? Math.round(num * 1000) : Math.round(num);
  }
  function plural(n, w) { return `${n} ${w}${n === 1 ? '' : 's'}`; }
  function dirOf(p) { return String(p || '').replace(/[/\\][^/\\]*$/, ''); }
  function baseOf(p) { return String(p || '').split(/[/\\]/).pop(); }

  // ---------- log / toast ----------
  function log(line) {
    const el = $('log');
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent += `[${stamp}] ${line}\n`;
    if (el.textContent.length > 120000) el.textContent = el.textContent.slice(-80000);
    el.scrollTop = el.scrollHeight;
  }
  function setLogOpen(open) {
    state.logOpen = open;
    $('log-wrap').classList.toggle('hidden', !open);
    $('btn-log').classList.toggle('on', open);
  }
  function toast(text, kind = 'info', action = null, ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const icon = kind === 'ok' ? 'check' : kind === 'bad' ? 'alert' : 'sparkle';
    el.innerHTML = `<span class="t-ico">${svg(icon)}</span><span>${esc(text)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-mini'; b.textContent = action.label;
      b.addEventListener('click', () => { action.run(); dismiss(); });
      el.appendChild(b);
    }
    const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    $('toasts').appendChild(el);
    setTimeout(dismiss, ms);
  }

  // ---------- theme / accent ----------
  function applyTheme(resolved) {
    state.resolvedTheme = resolved || 'dark';
    document.documentElement.setAttribute('data-theme', state.resolvedTheme);
    applyAccent(state.settings.accent || 'blue');
  }
  function applyAccent(key) {
    const a = ACCENTS[key] || ACCENTS.blue;
    const light = LIGHT_THEMES.has(state.resolvedTheme);
    const [c1, c2] = light ? a.l : a.d;
    const root = document.documentElement.style;
    root.setProperty('--accent', c1);
    root.setProperty('--accent-2', c2);
    root.setProperty('--on-accent', light ? '#ffffff' : '#0b0f1a');
    document.querySelectorAll('.swatch').forEach((s) => {
      const sa = ACCENTS[s.dataset.accent];
      const [x, y] = light ? sa.l : sa.d;
      s.style.background = `linear-gradient(135deg, ${x}, ${y})`;
      s.classList.toggle('active', s.dataset.accent === key);
    });
  }

  // ---------- estimates ----------
  function trimmedDuration(info) {
    const dur = info.duration || 0;
    const start = parseTime(state.trimStart) || 0;
    let end = parseTime(state.trimEnd);
    if (!dur) return 0;
    if (end === null || end <= 0) end = dur;
    const s = Math.max(0, Math.min(start, dur));
    return Math.max(0, Math.min(end, dur) - s);
  }
  function resFactor(info) {
    const srcW = info.width;
    let tw = null;
    if (state.resolution === 'custom') tw = parseInt(state.customWidth, 10) || null;
    else tw = RES_TARGET[state.resolution] || null;
    if (!tw || !srcW) return state.resolution === 'original' ? 1 : 0.6;
    return Math.max(0.04, (Math.min(tw, srcW) / srcW) ** 2);
  }
  function estimateFor(item) {
    const info = item.info;
    if (!info || !info.ok) return null;
    const src = info.size || 0;
    const fullDur = info.duration || 0;
    const dur = trimmedDuration(info) || fullDur;
    const ratio = fullDur > 0 ? Math.min(1, dur / fullDur) : 1;
    if (isExtract()) {
      if (!info.hasAudio) return null;
      if (!dur) return null;
      if (state.format === 'wav') return dur * 176.4 * 1000;
      if (state.format === 'flac') return dur * 95 * 1000;
      return dur * ((parseInt(state.audioBitrate, 10) || 192) / 8) * 1000;
    }
    if (!info.hasVideo) return null;
    if (state.format === 'gif') {
      const w = Math.min(info.width || 480, state.resolution === 'original' ? 480 : (RES_TARGET[state.resolution] || parseInt(state.customWidth, 10) || 480));
      const fps = state.fps === 'original' ? 12 : Math.min(30, parseInt(state.fps, 10) || 12);
      return Math.max(40 * 1024, dur * fps * (w * w * 0.5625) * 0.12);
    }
    if (state.compress === 'custom') {
      const v = parseBitrateKbps(state.customBitrate);
      if (v && dur) {
        const a = state.audio === 'strip' ? 0 : state.audio === 'aac96' ? 96 : state.audio === 'aac128' ? 128 : 160;
        return dur * ((v + a) / 8) * 1000;
      }
    }
    // Normalise against a sane bitrate so tiny/huge sources estimate reasonably.
    let factor = COMPRESS_FACTOR[state.compress] ?? 0.5;
    if (state.compress === 'max') factor *= 0.6;
    factor *= FORMAT_FACTOR[state.format] || 1;
    factor *= resFactor(info);
    factor *= FPS_FACTOR[state.fps] || 1;
    if (state.audio === 'strip') factor *= 0.9;
    return Math.max(16 * 1024, src * factor * ratio);
  }

  // ---------- option UI ----------
  function setChips(rootId, attr, value) {
    const root = $(rootId);
    if (!root) return;
    root.querySelectorAll('.chip').forEach((b) => b.classList.toggle('active', b.dataset[attr] === value));
  }
  function syncChips() {
    setChips('format-chips', 'format', state.format);
    setChips('format-chips-audio', 'format', state.format);
    setChips('compress-chips', 'compress', state.compress);
    setChips('resolution-chips', 'resolution', state.resolution);
    setChips('fps-chips', 'fps', state.fps);
    setChips('audio-chips', 'audio', state.audio);
    setChips('audio-bitrate-chips', 'abitrate', state.audioBitrate);
    setChips('hw-chips', 'hw', state.hwEncoding);
    setChips('settings-hw', 'hw', state.hwEncoding);
    setChips('output-chips', 'out', state.outputDir ? 'custom' : 'same');
    $('level-fill').style.width = `${LEVEL_FILL[state.compress] || 50}%`;
    $('custom-bitrate-wrap').classList.toggle('hidden', state.compress !== 'custom');
    $('custom-width-wrap').classList.toggle('hidden', state.resolution !== 'custom');
    if ($('custom-bitrate').value !== state.customBitrate) $('custom-bitrate').value = state.customBitrate;
    if ($('custom-width').value !== state.customWidth) $('custom-width').value = state.customWidth;
    if ($('trim-start').value !== state.trimStart) $('trim-start').value = state.trimStart;
    if ($('trim-end').value !== state.trimEnd) $('trim-end').value = state.trimEnd;
  }

  function hwHintText() {
    if (state.hwList === null) return 'Checking your GPU…';
    if (!state.hwList.length) return 'No working GPU encoder found — software x264 will be used.';
    return `${HW_LABELS[state.hwList[0]]} available. Falls back to software automatically if it fails.`;
  }

  function updatePills() {
    const extract = isExtract();
    const gif = state.format === 'gif';
    $('pv-format').textContent = extract ? `${state.format.toUpperCase()} · audio` : state.format.toUpperCase();
    const icon = $('pill-format-icon');
    const want = extract ? 'music' : gif ? 'gif' : 'film';
    if (icon.dataset.cur !== want) { icon.innerHTML = svg(want); icon.dataset.cur = want; }

    $('pill-level').classList.toggle('hidden', extract || gif);
    $('pill-video').classList.toggle('hidden', extract);
    $('pill-audio').classList.toggle('hidden', gif);

    $('pv-level').textContent = state.compress === 'custom'
      ? `Custom ${state.customBitrate || '…'}` : LEVEL_LABELS[state.compress] || state.compress;
    $('pill-level').classList.toggle('changed', state.compress !== 'balanced');

    const res = state.resolution === 'custom' ? (state.customWidth ? `${state.customWidth}w` : 'Custom') : state.resolution;
    const vParts = [];
    if (state.resolution !== 'original') vParts.push(res);
    if (state.fps !== 'original') vParts.push(`${state.fps} fps`);
    if (state.hwEncoding === 'auto' && !gif && state.format !== 'webm') vParts.push('GPU');
    $('pv-video').textContent = vParts.length ? vParts.join(' · ') : 'Original';
    $('pill-video').classList.toggle('changed', vParts.length > 0);

    let a;
    if (extract) a = isLossy() ? `${state.audioBitrate} kbps` : 'Lossless';
    else a = AUDIO_LABELS[state.audio] || state.audio;
    $('pv-audio').textContent = a;
    $('pill-audio').classList.toggle('changed', !extract && state.audio !== 'keep');

    const ts = state.trimStart.trim(); const te = state.trimEnd.trim();
    $('pv-trim').textContent = ts || te ? `${ts || '0:00'} – ${te || 'end'}` : 'Full';
    $('pill-trim').classList.toggle('changed', Boolean(ts || te));

    $('pv-output').textContent = state.outputDir ? baseOf(state.outputDir) || state.outputDir : 'Same folder';
    $('pill-output').title = state.outputDir || 'Same folder as each source file';
    $('out-path').textContent = state.outputDir || 'Each file is saved next to its original.';
    $('btn-out-open').classList.toggle('hidden', !state.outputDir);

    // popover sections
    $('audio-video-opts').classList.toggle('hidden', extract);
    $('audio-bitrate-opts').classList.toggle('hidden', !extract || !isLossy());
    $('audio-lossless-hint').classList.toggle('hidden', !extract || isLossy());
    $('hw-hint').textContent = state.hwEncoding === 'auto' ? hwHintText() : 'Software x264 — best compatibility.';
    $('settings-hw-hint').textContent = state.hwEncoding === 'auto' ? hwHintText() : 'Use your GPU for faster MP4/MOV/MKV/AVI encodes.';

    // active preset
    const activeKey = Object.keys(PRESETS).find((k) => presetMatches(PRESETS[k]));
    document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', b.dataset.preset === activeKey));
  }

  function presetMatches(p) {
    if (p.format !== state.format) return false;
    if (AUDIO_FORMATS.has(p.format)) return !p.audioBitrate || p.audioBitrate === state.audioBitrate;
    if (p.format === 'gif') return p.resolution === state.resolution && p.fps === state.fps;
    return ['compress', 'resolution', 'fps', 'audio'].every((k) => p[k] === state[k]);
  }

  function summaryParts() {
    const parts = [state.format.toUpperCase()];
    if (isExtract()) parts.push(isLossy() ? `${state.audioBitrate} kbps` : 'lossless');
    else {
      if (state.format !== 'gif') parts.push(state.compress === 'custom' ? `Custom ${state.customBitrate || '…'}` : `${LEVEL_LABELS[state.compress]} level`);
      if (state.resolution !== 'original') parts.push(state.resolution === 'custom' ? `${state.customWidth || '?'}w` : state.resolution);
      if (state.fps !== 'original') parts.push(`${state.fps} fps`);
      if (state.format !== 'gif' && state.audio !== 'keep') parts.push(state.audio === 'strip' ? 'no audio' : `audio ${AUDIO_LABELS[state.audio]}`);
    }
    if (state.trimStart.trim() || state.trimEnd.trim()) parts.push('trimmed');
    parts.push(state.outputDir ? `→ ${baseOf(state.outputDir)}` : '→ same folder');
    return parts;
  }

  function refreshAll() {
    syncChips();
    updatePills();
    renderQueueMeta();
    updateFooter();
  }

  // ---------- queue ----------
  const pendingStatuses = new Set(['ready', 'failed', 'cancelled']);
  const validItems = () => state.items.filter((i) => i.info && i.info.ok);
  const pendingItems = () => state.items.filter((i) => pendingStatuses.has(i.status));

  function itemTag(item) {
    const info = item.info;
    if (item.status === 'invalid' && info && info.reason === 'partial') return '<span class="qtag warn">partial</span>';
    if (!info || !info.ok) return '';
    if (info.noExtension) return '<span class="qtag warn" title="No file extension — detected by content">no ext</span>';
    return info.container ? `<span class="qtag">${esc(info.container)}</span>` : '';
  }

  function itemMeta(item) {
    const info = item.info;
    if (item.status === 'probing') return '<span>Reading file…</span>';
    if (!info) return '';
    if (!info.ok) return `<span class="err">${esc(info.message || 'Not a media file')}</span>${info.sizeLabel ? `<span class="sep">·</span>${esc(info.sizeLabel)}` : ''}`;
    const bits = [];
    if (info.detected) bits.push(esc(info.detected));
    if (info.width && info.height) bits.push(`${info.width}×${info.height}`);
    else if (!info.hasVideo) bits.push('audio');
    if (info.durationLabel) bits.push(esc(info.durationLabel));
    bits.push(esc(info.sizeLabel));
    let html = bits.join('<span class="sep">·</span>');
    if (item.status === 'done' && item.outSize != null) {
      const pct = info.size ? Math.round((1 - item.outSize / info.size) * 100) : null;
      html += `<span class="sep">→</span><span class="est">${esc(formatBytes(item.outSize))}${pct != null && pct > 0 ? ` (−${pct}%)` : ''}</span>`;
    } else if (item.status === 'failed' && item.error) {
      html = `<span class="err">${esc(item.error)}</span>`;
    } else {
      const est = estimateFor(item);
      if (est) html += `<span class="sep">→</span><span class="est">~${esc(formatBytes(est))}</span>`;
    }
    return html;
  }

  function stateText(item) {
    switch (item.status) {
      case 'probing': return 'Reading…';
      case 'ready': return 'Waiting';
      case 'converting': return item.percent != null ? `${Math.floor(item.percent)}%` : 'Starting…';
      case 'done': return 'Done';
      case 'failed': return 'Failed';
      case 'cancelled': return 'Cancelled';
      case 'invalid': return item.info && item.info.reason === 'partial' ? 'Download not finished' : 'Skipped';
      default: return '';
    }
  }
  function timeText(item) {
    if (item.status === 'converting') {
      const el = item.elapsed != null ? fmtClock(item.elapsed) : '';
      const eta = item.eta != null && item.eta > 0 ? `${fmtClock(item.eta)} left` : '';
      return [el, eta].filter(Boolean).join(' · ');
    }
    if (item.status === 'done' && item.elapsed != null) return `took ${fmtClock(item.elapsed)}`;
    return '';
  }
  function thumbIcon(item) {
    if (item.status === 'probing') return 'spinner';
    if (item.status === 'done') return 'check';
    if (item.status === 'failed' || item.status === 'invalid') return 'alert';
    if (item.info && item.info.ok && !item.info.hasVideo) return 'wave';
    return 'film';
  }

  function itemHTML(item) {
    const conv = item.status === 'converting';
    const thumb = svg(thumbIcon(item)).replace('<svg ', item.status === 'probing' ? '<svg class="spin" ' : '<svg ');
    return `
      <div class="qthumb">${thumb}</div>
      <div class="qmain">
        <div class="qtop"><span class="qname" title="${esc(item.path)}">${esc(item.name)}</span>${itemTag(item)}</div>
        <div class="qmeta">${itemMeta(item)}</div>
        ${conv ? `<div class="qbar${item.percent == null ? ' indet' : ''}"><i style="width:${item.percent || 0}%"></i></div>` : ''}
      </div>
      <div class="qside">
        <div class="qstatus"><div class="qstate">${esc(stateText(item))}</div><div class="qtime">${esc(timeText(item))}</div></div>
        ${item.status === 'done' ? `<button type="button" class="qbtn open" data-act="open" title="Show in folder" aria-label="Show in folder">${svg('folder-open')}</button>` : ''}
        ${conv ? `<button type="button" class="qbtn" data-act="cancel" title="Cancel this file" aria-label="Cancel this file">${svg('x')}</button>`
    : `<button type="button" class="qbtn rm" data-act="remove" title="Remove" aria-label="Remove from queue">${svg('x')}</button>`}
      </div>`;
  }

  function renderItem(item) {
    let li = document.querySelector(`.qitem[data-id="${item.id}"]`);
    if (!li) return;
    li.className = `qitem s-${item.status}${state.selectedId === item.id ? ' selected' : ''}`;
    li.innerHTML = itemHTML(item);
  }

  function renderQueue() {
    const list = $('queue-list');
    const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
    const frag = document.createDocumentFragment();
    state.items.forEach((item) => {
      let li = existing.get(String(item.id));
      if (!li) {
        li = document.createElement('li');
        li.dataset.id = item.id;
        li.tabIndex = 0;
        li.setAttribute('role', 'option');
      }
      li.className = `qitem s-${item.status}${state.selectedId === item.id ? ' selected' : ''}`;
      li.innerHTML = itemHTML(item);
      frag.appendChild(li);
      existing.delete(String(item.id));
    });
    list.innerHTML = '';
    list.appendChild(frag);
    const has = state.items.length > 0;
    $('empty').classList.toggle('hidden', has);
    $('queue').classList.toggle('hidden', !has);
    renderQueueHead();
    updateFooter();
  }

  function renderQueueMeta() {
    // Re-render metadata lines (estimates change with options) without rebuilding nodes.
    state.items.forEach((item) => {
      if (item.status === 'converting') return;
      const li = document.querySelector(`.qitem[data-id="${item.id}"] .qmeta`);
      if (li) li.innerHTML = itemMeta(item);
    });
    renderQueueHead();
  }

  function renderQueueHead() {
    const n = state.items.length;
    $('queue-count').textContent = plural(n, 'file');
    const valid = validItems();
    const totalIn = valid.reduce((s, i) => s + (i.info.size || 0), 0);
    const totalDur = valid.reduce((s, i) => s + (i.info.duration || 0), 0);
    const probing = state.items.filter((i) => i.status === 'probing').length;
    const invalid = state.items.filter((i) => i.status === 'invalid').length;
    const parts = [];
    if (totalIn) parts.push(formatBytes(totalIn));
    if (totalDur) parts.push(fmtClock(totalDur));
    if (probing) parts.push(`reading ${probing}…`);
    if (invalid) parts.push(`${invalid} skipped`);
    $('queue-sub').textContent = parts.join(' · ');
    const finished = state.items.some((i) => ['done', 'failed', 'cancelled', 'invalid'].includes(i.status));
    $('btn-clear-done').classList.toggle('hidden', !finished);
  }

  function updateFooter() {
    const pending = pendingItems();
    const doneCount = state.items.filter((i) => i.status === 'done').length;
    const verb = isExtract() ? 'Extract' : 'Convert';
    let label;
    let n = pending.length;
    if (state.running) label = 'Converting…';
    else if (n === 0 && doneCount > 0) { label = `${verb} again (${doneCount})`; n = doneCount; }
    else label = n > 1 ? `${verb} ${n} files` : n === 1 ? `${verb} 1 file` : verb;
    $('convert-label').textContent = label;
    let ok = !state.running && n > 0;
    if (ok && !isExtract() && state.format !== 'gif' && state.compress === 'custom' && !parseBitrateKbps(state.customBitrate)) ok = false;
    $('btn-convert').disabled = !ok;
    $('btn-cancel').classList.toggle('hidden', !state.running);
    $('btn-cancel-all').classList.toggle('hidden', !state.running || !state.batch || state.batch.total < 2);

    // estimate
    let est;
    if (state.running && state.batch) {
      est = state.items.filter((i) => state.batch.ids.has(i.id))
        .reduce((s, i) => s + (i.status === 'done' ? (i.outSize || 0) : (estimateFor(i) || 0)), 0);
    } else {
      const estTargets = pending.length ? pending : validItems();
      est = estTargets.reduce((s, i) => s + (estimateFor(i) || 0), 0);
    }
    $('overall-est').textContent = est > 0 ? `≈ ${formatBytes(est)} output` : '';

    // summary
    $('job-summary').innerHTML = state.items.length
      ? summaryParts().map((p, i) => (i ? `<span class="sep">·</span>${esc(p)}` : esc(p))).join('') : '';

    if (state.running && state.batch) {
      const b = state.batch;
      const items = state.items.filter((i) => b.ids.has(i.id));
      const finished = items.filter((i) => ['done', 'failed', 'cancelled'].includes(i.status)).length;
      const active = items.filter((i) => i.status === 'converting');
      const frac = items.length ? (finished + active.reduce((s, i) => s + (i.percent || 0) / 100, 0)) / items.length : 0;
      const idx = Math.min(items.length, finished + 1);
      $('overall-status').textContent = `Converting ${idx} of ${items.length} · ${Math.floor(frac * 100)}%`;
      $('overall-bar').style.width = `${(frac * 100).toFixed(1)}%`;
    } else if (!state.items.length) {
      $('overall-status').textContent = 'Ready when you are';
      $('overall-bar').style.width = '0%';
    } else if (!state.batchFinished) {
      const probing = state.items.some((i) => i.status === 'probing');
      $('overall-status').textContent = probing ? 'Reading files…' : n ? `${plural(n, 'file')} ready` : 'Nothing to convert';
      $('overall-bar').style.width = '0%';
    }
  }

  // ---------- adding files ----------
  async function addPaths(paths) {
    if (!paths || !paths.length) return;
    let expanded = paths;
    try { expanded = await window.fluid.expand(paths); } catch (_) { /* use raw */ }
    const have = new Set(state.items.map((i) => i.path.toLowerCase()));
    const fresh = expanded.filter((p) => p && !have.has(p.toLowerCase()));
    if (!fresh.length) {
      if (expanded.length) toast('Already in the queue');
      else toast('No files found in that folder', 'bad');
      return;
    }
    state.batchFinished = false;
    const newItems = fresh.map((p) => ({ id: ++state.seq, path: p, name: baseOf(p), status: 'probing', info: null, percent: null }));
    state.items.push(...newItems);
    if (!state.selectedId) state.selectedId = newItems[0].id;
    renderQueue();
    log(`Added ${plural(newItems.length, 'file')}`);
    probeAll(newItems);
  }

  async function probeAll(items) {
    const queue = items.slice();
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!state.items.includes(item)) continue;
        let info;
        try { info = await window.fluid.probe(item.path); } catch (err) { info = { ok: false, reason: 'error', message: String(err.message || err) }; }
        item.info = info;
        if (info && info.ok) item.status = 'ready';
        else { item.status = 'invalid'; log(`${item.name}: ${info && info.message}`); }
        renderItem(item);
        renderQueueHead();
        updateFooter();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  function removeItem(id) {
    const idx = state.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const item = state.items[idx];
    if (item.status === 'converting') return;
    state.items.splice(idx, 1);
    if (state.selectedId === id) {
      const next = state.items[idx] || state.items[idx - 1];
      state.selectedId = next ? next.id : null;
    }
    renderQueue();
    if (state.selectedId) document.querySelector(`.qitem[data-id="${state.selectedId}"]`)?.focus();
  }

  // ---------- batch run ----------
  function jobOptions(item) {
    return {
      jobId: `job-${item.id}-${Date.now()}`,
      inputPath: item.path,
      outputDir: state.outputDir || null,
      format: state.format,
      compress: state.compress,
      customBitrate: state.customBitrate,
      resolution: state.resolution,
      customWidth: state.customWidth,
      fps: state.fps,
      audio: state.audio,
      audioBitrate: state.audioBitrate,
      trimStart: state.trimStart.trim(),
      trimEnd: state.trimEnd.trim(),
      hwEncoding: state.hwEncoding,
      source: item.info,
    };
  }

  const jobToItem = new Map();

  async function runItem(item) {
    const opts = jobOptions(item);
    item.status = 'converting';
    item.percent = null; item.elapsed = 0; item.eta = null; item.error = null; item.jobId = opts.jobId;
    jobToItem.set(opts.jobId, item);
    renderItem(item);
    log(`▶ ${item.name}`);
    const t0 = Date.now();
    let res;
    try { res = await window.fluid.convert(opts); } catch (err) { res = { ok: false, error: String(err.message || err) }; }
    jobToItem.delete(opts.jobId);
    item.elapsed = (Date.now() - t0) / 1000;
    if (res.ok) {
      item.status = 'done';
      item.outputPath = res.outputPath;
      item.outSize = res.size;
      state.lastOutputPath = res.outputPath;
      state.lastOutputDir = res.outputDir;
      state.batch && state.batch.outDirs.add(res.outputDir);
      log(`✓ ${item.name} → ${res.outputPath} (${res.sizeLabel})`);
    } else if (res.cancelled) {
      item.status = 'cancelled';
      log(`■ ${item.name} cancelled`);
    } else {
      item.status = 'failed';
      item.error = res.error || 'Conversion failed';
      log(`✗ ${item.name}: ${item.error}`);
    }
    renderItem(item);
    renderQueueHead();
    updateFooter();
  }

  async function runBatch() {
    if (state.running) return;
    closePop();
    let targets = pendingItems();
    if (!targets.length) {
      const done = state.items.filter((i) => i.status === 'done');
      if (!done.length) return;
      done.forEach((i) => { i.status = 'ready'; i.outSize = null; i.outputPath = null; });
      targets = done;
    }
    if (!isExtract() && state.format !== 'gif' && state.compress === 'custom' && !parseBitrateKbps(state.customBitrate)) {
      toast('Enter a custom bitrate like 2500k or 2.5', 'bad');
      openPop('level');
      return;
    }
    targets.forEach((i) => { i.status = 'ready'; i.error = null; });
    state.running = true;
    state.cancelAll = false;
    state.batchFinished = false;
    state.batch = { ids: new Set(targets.map((i) => i.id)), total: targets.length, outDirs: new Set(), started: Date.now() };
    $('btn-open-out').classList.add('hidden');
    renderQueue();
    persistLastUsed();
    log(`Batch: ${plural(targets.length, 'file')} · ${summaryParts().join(' · ')}`);

    const concurrency = Number(state.settings.concurrency) === 2 ? 2 : 1;
    await new Promise((resolve) => {
      let active = 0;
      const pump = () => {
        while (!state.cancelAll && active < concurrency) {
          const next = state.items.find((i) => i.status === 'ready' && (state.batch.ids.has(i.id) || !i.batchSeen));
          if (!next) break;
          state.batch.ids.add(next.id);
          state.batch.total = state.batch.ids.size;
          active += 1;
          runItem(next).finally(() => { active -= 1; pump(); });
        }
        if (active === 0) resolve();
      };
      pump();
    });

    state.running = false;
    finishBatch();
  }

  function finishBatch() {
    const b = state.batch;
    const items = state.items.filter((i) => b.ids.has(i.id));
    const done = items.filter((i) => i.status === 'done');
    const failed = items.filter((i) => i.status === 'failed');
    const cancelled = items.filter((i) => i.status === 'cancelled');
    const secs = (Date.now() - b.started) / 1000;
    state.batchFinished = true;
    let msg;
    let kind = 'ok';
    if (done.length === items.length) msg = items.length === 1 ? `Done in ${fmtClock(secs)} · saved ${formatBytes(done[0].outSize)}` : `All ${items.length} files done in ${fmtClock(secs)}`;
    else if (!done.length && cancelled.length) { msg = 'Cancelled'; kind = 'info'; }
    else {
      msg = `${done.length} of ${items.length} done${failed.length ? ` · ${failed.length} failed` : ''}${cancelled.length ? ` · ${cancelled.length} cancelled` : ''}`;
      kind = failed.length ? 'bad' : 'info';
    }
    $('overall-status').textContent = msg;
    $('overall-bar').style.width = done.length ? '100%' : '0%';
    const openTarget = () => openOutput();
    if (done.length) $('btn-open-out').classList.remove('hidden');
    toast(msg, kind, done.length ? { label: 'Open folder', run: openTarget } : null, 6000);
    if (failed.length) setLogOpen(true);
    if (state.settings.notifyOnFinish !== false && (done.length || failed.length)) {
      window.fluid.notify({ title: 'FluidConvert', body: msg }).catch(() => {});
    }
    updateFooter();
    $('overall-status').textContent = msg;
  }

  function openOutput() {
    const b = state.batch;
    if (b && b.outDirs.size === 1 && state.lastOutputPath) window.fluid.showItem(state.lastOutputPath);
    else if (state.outputDir) window.fluid.openPath(state.outputDir);
    else if (state.lastOutputPath) window.fluid.showItem(state.lastOutputPath);
  }

  async function cancelCurrent() {
    const active = state.items.filter((i) => i.status === 'converting');
    for (const i of active) await window.fluid.cancel(i.jobId);
  }
  async function cancelAll() {
    state.cancelAll = true;
    state.items.forEach((i) => { if (i.status === 'ready' && state.batch && state.batch.ids.has(i.id)) i.status = 'cancelled'; });
    renderQueue();
    await window.fluid.cancel(null);
  }

  // ---------- popovers ----------
  function openPop(name, viaKeyboard) {
    const pop = $(`pop-${name}`);
    const anchor = document.querySelector(`.pill[data-pop="${name}"]`);
    if (!pop || !anchor) return;
    if (state.openPop === name) { closePop(); return; }
    closePop(true);
    state.openPop = name;
    anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect();
    pop.style.visibility = 'hidden';
    pop.classList.add('measuring');
    const w = Math.max(pop.offsetWidth, 240);
    let left = r.left;
    if (left + w > window.innerWidth - 12) left = Math.max(12, window.innerWidth - 12 - w);
    pop.style.left = `${left}px`;
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.transformOrigin = `${Math.max(12, r.left - left + 20)}px top`;
    pop.style.visibility = '';
    pop.classList.remove('measuring');
    void pop.offsetWidth; // commit start state so the fade/scale transition runs
    pop.classList.add('open');
    if (viaKeyboard) setTimeout(() => (pop.querySelector('.chip.active') || pop.querySelector('button, input'))?.focus(), 30);
  }
  function closePop(silent) {
    if (!state.openPop) return;
    const name = state.openPop;
    $(`pop-${name}`).classList.remove('open');
    const anchor = document.querySelector(`.pill[data-pop="${name}"]`);
    anchor?.setAttribute('aria-expanded', 'false');
    state.openPop = null;
    if (!silent && anchor && document.activeElement && $(`pop-${name}`).contains(document.activeElement)) anchor.focus();
  }

  document.querySelectorAll('.pill[data-pop]').forEach((p) => {
    p.addEventListener('click', (e) => openPop(p.dataset.pop, e.detail === 0));
  });
  document.addEventListener('mousedown', (e) => {
    if (!state.openPop) return;
    if (e.target.closest('.popover') || e.target.closest('.pill[data-pop]')) return;
    closePop(true);
  });
  window.addEventListener('resize', () => closePop(true));

  // ---------- option handlers ----------
  function changed(persist = true) {
    refreshAll();
    if (persist) persistLastUsed();
  }
  function chipGroup(id, attr, apply) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      apply(b.dataset[attr]);
      changed();
    });
  }
  chipGroup('format-chips', 'format', (v) => { state.format = v; setTimeout(() => closePop(), 120); });
  chipGroup('format-chips-audio', 'format', (v) => { state.format = v; setTimeout(() => closePop(), 120); });
  chipGroup('compress-chips', 'compress', (v) => {
    state.compress = v;
    if (v === 'custom') setTimeout(() => $('custom-bitrate').focus(), 30);
  });
  chipGroup('resolution-chips', 'resolution', (v) => {
    state.resolution = v;
    if (v === 'custom') setTimeout(() => $('custom-width').focus(), 30);
  });
  chipGroup('fps-chips', 'fps', (v) => { state.fps = v; });
  chipGroup('audio-chips', 'audio', (v) => { state.audio = v; });
  chipGroup('audio-bitrate-chips', 'abitrate', (v) => { state.audioBitrate = v; });
  const setHw = async (v) => {
    state.hwEncoding = v;
    state.settings = await window.fluid.setSettings({ hwEncoding: v });
    if (v === 'auto' && state.hwList === null) detectHw();
    refreshAll();
  };
  $('hw-chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) setHw(b.dataset.hw); });
  $('settings-hw').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) setHw(b.dataset.hw); });

  $('custom-bitrate').addEventListener('input', () => { state.customBitrate = $('custom-bitrate').value.trim(); changed(false); });
  $('custom-bitrate').addEventListener('change', () => persistLastUsed());
  $('custom-width').addEventListener('input', () => { state.customWidth = $('custom-width').value.replace(/\D/g, ''); changed(false); });
  ['trim-start', 'trim-end'].forEach((id) => {
    $(id).addEventListener('input', () => {
      state.trimStart = $('trim-start').value; state.trimEnd = $('trim-end').value; changed(false);
    });
  });
  $('btn-trim-reset').addEventListener('click', () => { state.trimStart = ''; state.trimEnd = ''; changed(false); });

  $('output-chips').addEventListener('click', async (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.dataset.out === 'same') {
      state.outputDir = null;
      if (state.settings.rememberOutputFolder !== false) state.settings = await window.fluid.setSettings({ lastOutputFolder: null });
    } else {
      const first = state.items[0];
      const chosen = await window.fluid.chooseOutputDir(state.outputDir || (first ? dirOf(first.path) : null));
      if (!chosen) return;
      state.outputDir = chosen;
      if (state.settings.rememberOutputFolder !== false) state.settings = await window.fluid.setSettings({ lastOutputFolder: chosen });
    }
    changed(false);
  });
  $('btn-out-open').addEventListener('click', () => { if (state.outputDir) window.fluid.openPath(state.outputDir); });

  document.querySelectorAll('.preset').forEach((b) => {
    b.addEventListener('click', () => {
      const p = PRESETS[b.dataset.preset];
      if (!p) return;
      ['format', 'compress', 'resolution', 'fps', 'audio', 'audioBitrate'].forEach((k) => { if (p[k] != null) state[k] = p[k]; });
      changed();
      toast(`Preset: ${p.label}`, 'info', null, 1800);
    });
  });

  async function persistLastUsed() {
    if (state.settings.rememberLastUsed === false) return;
    try {
      state.settings = await window.fluid.setSettings({
        lastFormat: state.format, lastCompress: state.compress, lastResolution: state.resolution, lastFps: state.fps,
        lastAudio: state.audio, lastAudioBitrate: state.audioBitrate, lastCustomBitrate: state.customBitrate,
      });
    } catch (_) { /* ignore */ }
  }

  async function detectHw(force) {
    state.hwList = null;
    updatePills();
    try { state.hwList = await window.fluid.detectHw(force); } catch (_) { state.hwList = []; }
    if (state.hwList.length) log(`GPU encoder: ${state.hwList.map((k) => HW_LABELS[k]).join(', ')}`);
    else log('No hardware H.264 encoder available — using software');
    updatePills();
  }

  // ---------- queue interactions ----------
  $('queue-list').addEventListener('click', (e) => {
    const li = e.target.closest('.qitem');
    if (!li) return;
    const id = Number(li.dataset.id);
    const item = state.items.find((i) => i.id === id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'remove') { removeItem(id); return; }
    if (act === 'open' && item?.outputPath) { window.fluid.showItem(item.outputPath); return; }
    if (act === 'cancel' && item?.jobId) { window.fluid.cancel(item.jobId); return; }
    state.selectedId = id;
    document.querySelectorAll('.qitem').forEach((el) => el.classList.toggle('selected', Number(el.dataset.id) === id));
  });
  $('queue-list').addEventListener('dblclick', (e) => {
    const li = e.target.closest('.qitem');
    const item = li && state.items.find((i) => i.id === Number(li.dataset.id));
    if (item?.outputPath) window.fluid.showItem(item.outputPath);
  });
  $('queue-list').addEventListener('focusin', (e) => {
    const li = e.target.closest('.qitem');
    if (!li) return;
    state.selectedId = Number(li.dataset.id);
    document.querySelectorAll('.qitem').forEach((el) => el.classList.toggle('selected', el === li));
  });

  async function browseFiles() {
    const paths = await window.fluid.openFiles();
    if (paths && paths.length) addPaths(paths);
  }
  async function browseFolder() {
    const paths = await window.fluid.openFolder();
    if (paths && paths.length) addPaths(paths);
    else if (paths) toast('No media files found in that folder', 'bad');
  }
  $('btn-browse').addEventListener('click', (e) => { e.stopPropagation(); browseFiles(); });
  $('btn-folder').addEventListener('click', (e) => { e.stopPropagation(); browseFolder(); });
  $('empty').addEventListener('click', (e) => { if (!e.target.closest('button')) browseFiles(); });
  $('empty').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browseFiles(); } });
  $('btn-add').addEventListener('click', browseFiles);
  $('btn-add-folder').addEventListener('click', browseFolder);
  $('btn-clear-done').addEventListener('click', () => {
    state.items = state.items.filter((i) => !['done', 'failed', 'cancelled', 'invalid'].includes(i.status));
    if (!state.items.some((i) => i.id === state.selectedId)) state.selectedId = state.items[0]?.id || null;
    state.batchFinished = false;
    renderQueue();
  });
  $('btn-clear-all').addEventListener('click', () => {
    if (state.running) { toast('Cancel the batch first', 'bad'); return; }
    state.items = []; state.selectedId = null; state.batchFinished = false;
    $('btn-open-out').classList.add('hidden');
    renderQueue();
  });

  // ---------- drag & drop (whole window) ----------
  let dragDepth = 0;
  const overlay = $('drag-overlay');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    overlay.classList.add('show');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) overlay.classList.remove('show');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('show');
    const files = [...(e.dataTransfer?.files || [])];
    const paths = files.map((f) => window.fluid.pathForFile(f)).filter(Boolean);
    if (paths.length) addPaths(paths);
    else if (files.length) toast('Could not read the dropped items', 'bad');
  });

  // ---------- actions ----------
  $('btn-convert').addEventListener('click', runBatch);
  $('btn-cancel').addEventListener('click', cancelCurrent);
  $('btn-cancel-all').addEventListener('click', cancelAll);
  $('btn-open-out').addEventListener('click', openOutput);
  $('btn-log').addEventListener('click', () => setLogOpen(!state.logOpen));
  $('btn-log-copy').addEventListener('click', () => { navigator.clipboard?.writeText($('log').textContent).then(() => toast('Log copied', 'ok', null, 1500)).catch(() => {}); });

  // ---------- settings ----------
  function openSettings() {
    closePop(true);
    const s = state.settings;
    document.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('active', c.dataset.theme === (s.theme || 'dark')));
    applyAccent(s.accent || 'blue');
    $('settings-out-dir').textContent = s.defaultOutputFolder || 'Same as source';
    $('settings-format').value = s.defaultFormat || 'mp4';
    $('settings-compress').value = s.defaultCompress || 'balanced';
    $('settings-audio-bitrate').value = s.defaultAudioBitrate || '192';
    $('settings-concurrency').value = String(s.concurrency === 2 ? 2 : 1);
    $('settings-notify').checked = s.notifyOnFinish !== false;
    $('settings-remember').checked = s.rememberLastUsed !== false;
    $('settings-remember-out').checked = s.rememberOutputFolder !== false;
    syncChips();
    updatePills();
    $('settings-backdrop').classList.add('open');
    $('settings-panel').classList.add('open');
    setTimeout(() => $('btn-settings-close').focus(), 50);
  }
  function closeSettings() {
    $('settings-backdrop').classList.remove('open');
    $('settings-panel').classList.remove('open');
  }
  const settingsOpen = () => $('settings-panel').classList.contains('open');
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings-close').addEventListener('click', closeSettings);
  $('settings-backdrop').addEventListener('click', closeSettings);

  $('theme-grid').addEventListener('click', async (e) => {
    const c = e.target.closest('.theme-card');
    if (!c) return;
    document.querySelectorAll('.theme-card').forEach((x) => x.classList.toggle('active', x === c));
    state.settings = await window.fluid.setSettings({ theme: c.dataset.theme });
    const r = await window.fluid.resolveTheme();
    applyTheme(r.resolved);
  });
  $('accent-swatches').addEventListener('click', async (e) => {
    const s = e.target.closest('.swatch');
    if (!s) return;
    state.settings = await window.fluid.setSettings({ accent: s.dataset.accent });
    applyAccent(s.dataset.accent);
  });
  $('btn-settings-out').addEventListener('click', async () => {
    const chosen = await window.fluid.chooseOutputDir(state.settings.defaultOutputFolder || null);
    if (!chosen) return;
    state.settings = await window.fluid.setSettings({ defaultOutputFolder: chosen });
    $('settings-out-dir').textContent = chosen;
    state.outputDir = chosen;
    refreshAll();
  });
  $('btn-settings-out-clear').addEventListener('click', async () => {
    state.settings = await window.fluid.setSettings({ defaultOutputFolder: null });
    $('settings-out-dir').textContent = 'Same as source';
  });
  const bindSelect = (id, key, map = (v) => v) => $(id).addEventListener('change', async () => {
    state.settings = await window.fluid.setSettings({ [key]: map($(id).value) });
  });
  bindSelect('settings-format', 'defaultFormat');
  bindSelect('settings-compress', 'defaultCompress');
  bindSelect('settings-audio-bitrate', 'defaultAudioBitrate');
  bindSelect('settings-concurrency', 'concurrency', (v) => Number(v));
  const bindCheck = (id, key) => $(id).addEventListener('change', async () => {
    state.settings = await window.fluid.setSettings({ [key]: $(id).checked });
  });
  bindCheck('settings-notify', 'notifyOnFinish');
  bindCheck('settings-remember', 'rememberLastUsed');
  bindCheck('settings-remember-out', 'rememberOutputFolder');

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      if (e.shiftKey) browseFolder(); else browseFiles();
      return;
    }
    if (e.key === 'Escape') {
      if (state.openPop) { e.preventDefault(); closePop(); return; }
      if (settingsOpen()) { e.preventDefault(); closeSettings(); $('btn-settings').focus(); return; }
      if (state.running) { e.preventDefault(); cancelAll(); return; }
      return;
    }
    if (e.key === 'Enter' && typing && state.openPop) { e.preventDefault(); closePop(); return; }
    if (typing) return;
    if (e.key === 'Enter') {
      if (e.target.closest && e.target.closest('button, .popover, .sheet')) return;
      if (!$('btn-convert').disabled) { e.preventDefault(); runBatch(); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId && !settingsOpen() && !state.openPop) {
      e.preventDefault();
      removeItem(state.selectedId);
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.closest && e.target.closest('.qitem')) {
      e.preventDefault();
      const idx = state.items.findIndex((i) => i.id === state.selectedId);
      const next = state.items[Math.max(0, Math.min(state.items.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) document.querySelector(`.qitem[data-id="${next.id}"]`)?.focus();
    }
  });

  // ---------- IPC events ----------
  let progressRaf = null;
  const dirty = new Set();
  window.fluid.onProgress((p) => {
    const item = jobToItem.get(p.jobId);
    if (!item) return;
    item.percent = p.percent != null ? p.percent : null;
    item.elapsed = p.elapsedSec;
    item.eta = p.etaSec;
    dirty.add(item);
    if (!progressRaf) {
      progressRaf = requestAnimationFrame(() => {
        progressRaf = null;
        dirty.forEach((it) => {
          const li = document.querySelector(`.qitem[data-id="${it.id}"]`);
          if (!li) return;
          const bar = li.querySelector('.qbar');
          if (bar) {
            bar.classList.toggle('indet', it.percent == null);
            bar.firstElementChild.style.width = `${it.percent || 0}%`;
          }
          li.querySelector('.qstate').textContent = stateText(it);
          li.querySelector('.qtime').textContent = timeText(it);
        });
        dirty.clear();
        updateFooter();
      });
    }
  });
  window.fluid.onLog((d) => { if (d && d.line) log(d.line); });
  window.fluid.onThemeChanged((d) => { if (d && d.resolved) applyTheme(d.resolved); });

  // ---------- init ----------
  async function init() {
    try {
      const s = await window.fluid.getSettings();
      state.settings = s;
      const t = await window.fluid.resolveTheme();
      applyTheme(t.resolved);
      const remember = s.rememberLastUsed !== false;
      state.format = (remember && s.lastFormat) || s.defaultFormat || 'mp4';
      state.compress = (remember && s.lastCompress) || s.defaultCompress || 'balanced';
      if (!LEVEL_LABELS[state.compress]) state.compress = 'balanced';
      state.resolution = (remember && s.lastResolution) || 'original';
      state.fps = (remember && s.lastFps) || 'original';
      state.audio = (remember && s.lastAudio) || 'keep';
      state.audioBitrate = String((remember && s.lastAudioBitrate) || s.defaultAudioBitrate || '192');
      state.customBitrate = (remember && s.lastCustomBitrate) || '';
      state.hwEncoding = s.hwEncoding === 'auto' ? 'auto' : 'off';
      state.outputDir = s.defaultOutputFolder || (s.rememberOutputFolder !== false ? s.lastOutputFolder : null) || null;
      try { $('about-version').textContent = await window.fluid.version(); } catch (_) { /* ignore */ }
    } catch (err) {
      applyTheme('dark');
      log(`Settings load: ${err.message || err}`);
    }
    refreshAll();
    renderQueue();
    if (state.hwEncoding === 'auto') detectHw();
    else state.hwList = null;
  }
  // QA hook used by the screenshot smoke run (no effect in normal use).
  window.FluidConvertQA = { addPaths, runBatch, openPop, closePop, state };
  init();
})();
