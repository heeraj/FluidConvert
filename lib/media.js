'use strict';
/** Process helpers shared by main.js and the smoke test (no Electron imports). */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const F = require('./ffargs');

function probeFile(ffprobePath, filePath) {
  return new Promise((resolve) => {
    let stat;
    try { stat = fs.statSync(filePath); } catch (_) {
      resolve({ ok: false, reason: 'missing', message: 'File not found', path: filePath, name: path.basename(filePath) });
      return;
    }
    const base = { path: filePath, name: path.basename(filePath), size: stat.size, sizeLabel: F.formatBytes(stat.size) };
    if (stat.isDirectory()) { resolve({ ...base, ok: false, reason: 'folder', message: 'Folder' }); return; }
    if (F.isPartialDownload(filePath)) {
      resolve({ ...base, ok: false, reason: 'partial', message: 'Download not finished' });
      return;
    }
    if (stat.size === 0) { resolve({ ...base, ok: false, reason: 'empty', message: 'Empty file' }); return; }
    const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath];
    let stdout = '';
    let stderr = '';
    let done = false;
    const proc = spawn(ffprobePath, args, { windowsHide: true });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill(); } catch (_) {}
      resolve({ ...base, ok: false, reason: 'timeout', message: 'Could not read file (timeout)' });
    }, 30000);
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ ...base, ok: false, reason: 'error', message: err.message });
    });
    proc.on('close', (code) => {
      if (done) return; done = true; clearTimeout(timer);
      let data = null;
      try { data = JSON.parse(stdout || '{}'); } catch (_) { data = null; }
      if (code !== 0 || !data || !data.format) {
        resolve({ ...base, ok: false, reason: 'not-media', message: 'Not a media file', detail: stderr.slice(-300) });
        return;
      }
      const info = F.parseProbe(data, filePath, stat.size);
      resolve(info.ok ? info : { ...base, ...info });
    });
  });
}

/**
 * Run ffmpeg with -progress pipe:1 parsing.
 * onProgress({ percent, outSec, speed, elapsedSec, etaSec })
 * Returns { proc, done: Promise<{ code, stderr }> }
 */
function runFfmpeg(ffmpegPath, args, { totalDuration = 0, onProgress, onLog } = {}) {
  const started = Date.now();
  const proc = spawn(ffmpegPath, args, { windowsHide: true });
  let stderr = '';
  let speed = null;
  let lastEmit = 0;
  let buf = '';
  const emit = (outSec, force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 200) return;
    lastEmit = now;
    const elapsedSec = (now - started) / 1000;
    let percent = null;
    let etaSec = null;
    if (totalDuration > 0 && outSec != null) {
      percent = Math.min(99.5, Math.max(0, (outSec / totalDuration) * 100));
      if (speed && speed > 0) etaSec = Math.max(0, (totalDuration - outSec) / speed);
      else if (percent > 1) etaSec = elapsedSec * (100 - percent) / percent;
    }
    if (onProgress) onProgress({ percent, outSec, speed, elapsedSec, etaSec });
  };
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const [k, v] = line.split('=');
      if (k === 'speed') {
        const s = parseFloat(v);
        if (Number.isFinite(s) && s > 0) speed = s;
      } else if (k === 'out_time_us' || k === 'out_time_ms') {
        const us = parseInt(v, 10);
        if (Number.isFinite(us) && us >= 0) emit(us / 1e6, false);
      }
    }
  });
  proc.stderr.on('data', (d) => {
    const text = d.toString();
    stderr += text;
    if (stderr.length > 64000) stderr = stderr.slice(-32000);
    if (onLog) {
      text.split(/\r?\n/).forEach((l) => {
        const t = l.trim();
        if (t && /error|invalid|failed|warning/i.test(t)) onLog(t);
      });
    }
  });
  const done = new Promise((resolve) => {
    proc.on('error', (err) => resolve({ code: -1, stderr: String(err && err.message || err) }));
    proc.on('close', (code) => resolve({ code, stderr }));
  });
  return { proc, done };
}

function killProc(proc) {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch (_) {}
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    }
  } catch (_) {}
}

function runQuick(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let finished = false;
    const proc = spawn(bin, args, { windowsHide: true });
    const timer = setTimeout(() => { if (!finished) { finished = true; killProc(proc); resolve({ code: -2, out }); } }, timeoutMs);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => { if (!finished) { finished = true; clearTimeout(timer); resolve({ code: -1, out }); } });
    proc.on('close', (code) => { if (!finished) { finished = true; clearTimeout(timer); resolve({ code, out }); } });
  });
}

/** Detect working H.264 hardware encoders: listed by -encoders AND a tiny test encode succeeds. */
async function detectHwEncoders(ffmpegPath) {
  const list = await runQuick(ffmpegPath, ['-hide_banner', '-encoders'], 8000);
  const available = [];
  for (const key of ['nvenc', 'qsv', 'amf']) {
    const codec = F.HW_ENCODERS[key].codec;
    if (!list.out.includes(codec)) continue;
    const pix = key === 'nvenc' ? 'yuv420p' : 'nv12';
    const test = await runQuick(ffmpegPath, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=0.5',
      '-frames:v', '10', '-pix_fmt', pix, '-c:v', codec, '-f', 'null', '-'], 10000);
    if (test.code === 0) available.push(key);
  }
  return available;
}

/** Expand dropped paths: files as-is, folders -> media-ish files inside (non-recursive). */
function expandPaths(paths) {
  const out = [];
  const seen = new Set();
  const add = (p) => { const k = p.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(p); } };
  for (const p of paths || []) {
    if (!p) continue;
    let st;
    try { st = fs.statSync(p); } catch (_) { add(p); continue; }
    if (st.isDirectory()) {
      let entries = [];
      try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch (_) { entries = []; }
      entries
        .filter((e) => e.isFile() && F.isCandidateInFolder(e.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .forEach((e) => add(path.join(p, e.name)));
    } else {
      add(p);
    }
  }
  return out;
}

module.exports = { probeFile, runFfmpeg, killProc, detectHwEncoders, expandPaths };
