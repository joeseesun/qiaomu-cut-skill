#!/usr/bin/env node
'use strict';

/*
 * qcut audio beats|peak — dependency-free music analysis for beat-synced edits.
 *
 * beats: tempo, calibrated beat grid, downbeats (4/4 assumption), per-bar energy
 *        and the most likely drop. Cuts belong on downbeats, UI hits on beats.
 * peak:  offset of a sound effect's measured peak so the peak — not the file
 *        start — lands on the visual event.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

class UsageError extends Error {}

const SAMPLE_RATE = 22050;
const HOP = 512;
const WINDOW = 1024;

function executable(candidate) {
  if (!candidate) return null;
  if (!candidate.includes('/')) {
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    return found.status === 0 ? found.stdout.trim() : null;
  }
  try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { return null; }
}

function ffmpegPath() {
  return [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', 'ffmpeg']
    .map(executable).find(Boolean) || null;
}

function decodeMono(file, sampleRate = SAMPLE_RATE, trim = 0, maxSeconds = 900) {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) throw new Error('ffmpeg is required for audio analysis.');
  if (!fs.existsSync(file)) throw new Error(`Audio not found: ${file}`);
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (trim > 0) args.push('-ss', String(trim));
  args.push('-i', file, '-t', String(maxSeconds), '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1');
  const result = spawnSync(ffmpeg, args, { maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`ffmpeg could not decode ${path.basename(file)}: ${String(result.stderr || '').slice(-400)}`);
  const buffer = result.stdout;
  return new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 4));
}

function fftMagnitudes(frame) {
  const n = frame.length;
  const re = Float64Array.from(frame);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k += 1) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  const half = n / 2;
  const mags = new Float64Array(half);
  for (let k = 0; k < half; k += 1) mags[k] = Math.hypot(re[k], im[k]);
  return mags;
}

function onsetEnvelope(samples, sampleRate = SAMPLE_RATE) {
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  const hann = new Float64Array(WINDOW);
  for (let i = 0; i < WINDOW; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1));
  const lowBin = Math.max(2, Math.round((150 * WINDOW) / sampleRate));
  const flux = new Float64Array(frames);
  const low = new Float64Array(frames);
  let previous = null;
  const frame = new Float64Array(WINDOW);
  for (let f = 0; f < frames; f += 1) {
    const offset = f * HOP;
    for (let i = 0; i < WINDOW; i += 1) frame[i] = samples[offset + i] * hann[i];
    const mags = fftMagnitudes(frame);
    const logMags = mags.map((value) => Math.log1p(100 * value));
    let sum = 0;
    if (previous) for (let k = 1; k < logMags.length; k += 1) sum += Math.max(0, logMags[k] - previous[k]);
    flux[f] = sum;
    let energy = 0;
    for (let k = 1; k <= lowBin; k += 1) energy += mags[k] * mags[k];
    low[f] = energy;
    previous = logMags;
  }
  // Remove slow trends so sustained pads do not look like onsets.
  const radius = 8;
  const envelope = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, f - radius); k <= Math.min(frames - 1, f + radius); k += 1) { sum += flux[k]; count += 1; }
    envelope[f] = Math.max(0, flux[f] - sum / count);
  }
  const max = envelope.reduce((best, value) => Math.max(best, value), 0) || 1;
  for (let f = 0; f < frames; f += 1) envelope[f] /= max;
  // Low-band (kick/bass) onset envelope: positive change of log low energy.
  const lowOnset = new Float64Array(frames);
  for (let f = 1; f < frames; f += 1) lowOnset[f] = Math.max(0, Math.log1p(1000 * low[f]) - Math.log1p(1000 * low[f - 1]));
  const lowMax = lowOnset.reduce((best, value) => Math.max(best, value), 0) || 1;
  for (let f = 0; f < frames; f += 1) lowOnset[f] /= lowMax;
  return { envelope, low, lowOnset, frameRate: sampleRate / HOP };
}

function estimateTempo(envelope, frameRate, options = {}) {
  const minBpm = options.minBpm || 60;
  const maxBpm = options.maxBpm || 200;
  const center = options.bpmHint || 120;
  const minLag = Math.floor((60 * frameRate) / maxBpm);
  const maxLag = Math.ceil((60 * frameRate) / minBpm);
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let f = lag; f < envelope.length; f += 1) sum += envelope[f] * envelope[f - lag];
    const bpm = (60 * frameRate) / lag;
    const octaves = Math.log2(bpm / center);
    const width = options.bpmHint ? 0.15 : 1.0;
    scores.push({ lag, bpm, raw: sum, score: sum * Math.exp(-0.5 * (octaves / width) ** 2) });
  }
  const bestIndex = scores.reduce((best, item, index) => (item.score > scores[best].score ? index : best), 0);
  let lag = scores[bestIndex].lag;
  if (bestIndex > 0 && bestIndex < scores.length - 1) {
    const a = scores[bestIndex - 1].raw;
    const b = scores[bestIndex].raw;
    const c = scores[bestIndex + 1].raw;
    const denominator = a - 2 * b + c;
    if (denominator !== 0) lag += Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator));
  }
  const bpm = (60 * frameRate) / lag;
  const sorted = scores.map((item) => item.raw).sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] || 1e-9;
  return { bpm, periodFrames: lag, confidence: Math.min(1, scores[bestIndex].raw / (median * 4 || 1)) };
}

function alignPhase(envelope, periodFrames) {
  let best = { offset: 0, score: -1 };
  const steps = Math.ceil(periodFrames);
  for (let offset = 0; offset < steps; offset += 1) {
    let score = 0;
    for (let position = offset; position < envelope.length; position += periodFrames) score += envelope[Math.round(position)] || 0;
    if (score > best.score) best = { offset, score };
  }
  return best.offset;
}

function snapToPeaks(envelope, frames, radius) {
  return frames.map((frame) => {
    let best = Math.round(frame);
    for (let f = Math.max(0, Math.round(frame) - radius); f <= Math.min(envelope.length - 1, Math.round(frame) + radius); f += 1) {
      if (envelope[f] > envelope[best]) best = f;
    }
    return envelope[best] > 0.08 ? best : null;
  });
}

// Steepest short-block energy rise near `center`, at ~3 ms resolution.
function refineAttack(samples, center, radius) {
  const block = 256;
  const hop = 64;
  const from = Math.max(0, Math.floor((center - radius) * SAMPLE_RATE));
  const to = Math.min(samples.length - block, Math.floor((center + radius) * SAMPLE_RATE));
  if (to - from < block * 2) return null;
  let previous = null;
  let best = { rise: 0, time: null };
  let floor = Infinity;
  for (let start = from; start <= to; start += hop) {
    let energy = 0;
    for (let i = start; i < start + block; i += 1) energy += samples[i] * samples[i];
    const db = 10 * Math.log10(energy / block + 1e-12);
    floor = Math.min(floor, db);
    if (previous != null && db - previous > best.rise) best = { rise: db - previous, time: (start + block - hop / 2) / SAMPLE_RATE };
    previous = db;
  }
  return best.rise >= 3 ? best.time : null;
}

function linearFit(points) {
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.index, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.time, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) { sxx += (p.index - meanX) ** 2; sxy += (p.index - meanX) * (p.time - meanY); }
  const b = sxx > 0 ? sxy / sxx : 0.5;
  return { a: meanY - b * meanX, b };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function analyzeBeats(file, options = {}) {
  const samples = decodeMono(file);
  const durationSeconds = samples.length / SAMPLE_RATE;
  if (durationSeconds < 2) throw new Error('Audio is shorter than 2 seconds; not enough material for a beat grid.');
  const { envelope, low, lowOnset, frameRate } = onsetEnvelope(samples);
  const tempo = options.bpm
    ? { bpm: Number(options.bpm), periodFrames: (60 * frameRate) / Number(options.bpm), confidence: null }
    : estimateTempo(envelope, frameRate, { bpmHint: options.bpmHint ? Number(options.bpmHint) : undefined });
  const period = tempo.periodFrames;
  // Count like a drummer: beats sit on kicks/bass, so weight low-band onsets
  // above bright off-beat hats when choosing the grid phase.
  const phaseEnvelope = envelope.map((value, index) => value + 2 * lowOnset[index]);
  const offset = alignPhase(phaseEnvelope, period);
  const gridFrames = [];
  for (let position = offset; position < envelope.length; position += period) gridFrames.push(position);
  // Calibrate the whole grid to real transients (kick hits): refine each beat to
  // a sample-level attack, then fit beat_n = firstBeat + n * period robustly.
  const toSeconds = (frame) => Math.max(0, (frame * HOP + WINDOW / 2) / SAMPLE_RATE);
  const approxPeriod = (period * HOP) / SAMPLE_RATE;
  const attacks = gridFrames.map((frame, index) => ({ index, time: refineAttack(samples, toSeconds(frame), approxPeriod * 0.3) }))
    .filter((item) => item.time != null);
  let fit = { a: toSeconds(gridFrames[0] || 0), b: approxPeriod };
  let used = attacks;
  for (let pass = 0; pass < 3 && used.length >= 4; pass += 1) {
    fit = linearFit(used);
    const tolerance = pass === 0 ? 0.035 : 0.015;
    const kept = attacks.filter((item) => Math.abs(item.time - (fit.a + fit.b * item.index)) <= tolerance);
    if (kept.length < 4) break;
    used = kept;
  }
  if (used.length >= 4) fit = linearFit(used);
  if (options.bpm) fit.b = 60 / Number(options.bpm);
  while (fit.a - fit.b >= 0) fit.a -= fit.b;
  while (fit.a < 0) fit.a += fit.b;
  const correction = ((fit.a - toSeconds(gridFrames[0] || 0)) * SAMPLE_RATE) / HOP;
  tempo.bpm = 60 / fit.b;
  const beats = [];
  for (let time = fit.a; time < durationSeconds; time += fit.b) beats.push(round(time));
  const beatFrames = beats.map((time) => (time * SAMPLE_RATE - WINDOW / 2) / HOP);
  const attackCoverage = attacks.length ? used.length / beats.length : 0;
  // Downbeat: the 4-beat phase with most low-frequency (kick/bass) energy.
  const beatsPerBar = Number(options.beatsPerBar || 4);
  const phaseScores = Array.from({ length: beatsPerBar }, (_, phase) => {
    let score = 0;
    for (let index = phase; index < beatFrames.length; index += beatsPerBar) {
      const frame = Math.round(beatFrames[index]);
      for (let k = Math.max(0, frame - 1); k <= Math.min(low.length - 1, frame + 1); k += 1) score += low[k];
    }
    return score;
  });
  let downbeatPhase = phaseScores.reduce((best, value, index) => (value > phaseScores[best] ? index : best), 0);
  const meanPhase = phaseScores.reduce((sum, value) => sum + value, 0) / beatsPerBar || 1;
  let downbeatMethod = 'low-band accent';
  if (phaseScores[downbeatPhase] / meanPhase < 1.15) {
    // No clear accent: a drop/entry (largest 2-beat RMS rise) lands on a downbeat.
    const beatRms = (index) => {
      const from = Math.floor((beats[index] || 0) * SAMPLE_RATE);
      const to = Math.min(samples.length, Math.floor((beats[index + 2] || durationSeconds) * SAMPLE_RATE));
      let sum = 0;
      for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
      return 10 * Math.log10(sum / Math.max(1, to - from) + 1e-12);
    };
    let best = { rise: 0, index: -1 };
    for (let index = 2; index < beats.length - 2; index += 1) {
      const rise = beatRms(index) - beatRms(index - 2);
      if (rise > best.rise) best = { rise, index };
    }
    if (best.rise >= 6) { downbeatPhase = best.index % beatsPerBar; downbeatMethod = 'energy entry'; }
  }
  const downbeats = beats.filter((_, index) => index >= downbeatPhase && (index - downbeatPhase) % beatsPerBar === 0);
  const bars = downbeats.map((start, index) => {
    const end = downbeats[index + 1] || Math.min(durationSeconds, start + (beatsPerBar * 60) / tempo.bpm);
    const from = Math.floor(start * SAMPLE_RATE);
    const to = Math.min(samples.length, Math.floor(end * SAMPLE_RATE));
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, to - from));
    return { index, start, end: round(end), rmsDb: round(20 * Math.log10(rms + 1e-9), 1) };
  });
  let drop = null;
  const barLength = (beatsPerBar * 60) / tempo.bpm;
  for (let index = 2; index < bars.length; index += 1) {
    if (bars[index].end - bars[index].start < barLength * 0.75) continue;
    const before = (bars[index - 1].rmsDb + bars[index - 2].rmsDb) / 2;
    const rise = bars[index].rmsDb - before;
    if (rise >= 3 && (!drop || rise > drop.riseDb)) drop = { bar: index, time: bars[index].start, riseDb: round(rise, 1) };
  }
  return {
    schema: 'qiaocut.beat-grid.v1',
    source: options.displaySource || path.basename(file),
    durationSeconds: round(durationSeconds),
    bpm: round(tempo.bpm, 2),
    beatPeriod: round(60 / tempo.bpm, 4),
    tempoConfidence: tempo.confidence == null ? null : round(tempo.confidence, 2),
    beatsPerBar,
    firstBeat: beats[0] ?? 0,
    firstDownbeat: downbeats[0] ?? beats[0] ?? 0,
    downbeatMethod,
    gridCalibrationMs: round((correction * HOP * 1000) / SAMPLE_RATE, 1),
    attackCoverage: round(Math.min(1, attackCoverage), 2),
    beats,
    downbeats,
    bars,
    drop,
    method: 'spectral-flux onset envelope, tempo-weighted autocorrelation, phase alignment, sample-level attack refinement with robust linear grid fit, low-band downbeat phase; 4/4 assumed',
    caveat: 'Beat tracking is an estimate. Probe cut frames against the music and override bpm/firstDownbeat when the grid drifts.'
  };
}

function peakOffset(file, options = {}) {
  const sampleRate = 48000;
  const samples = decodeMono(file, sampleRate, Number(options.trim || 0), 30);
  if (!samples.length) throw new Error('Sound effect has no audio samples.');
  let peakIndex = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i]);
    if (value > peak) { peak = value; peakIndex = i; }
  }
  let onsetIndex = peakIndex;
  for (let i = 0; i <= peakIndex; i += 1) {
    if (Math.abs(samples[i]) >= peak * 0.25) { onsetIndex = i; break; }
  }
  return {
    peakMs: round((peakIndex * 1000) / sampleRate, 1),
    onsetMs: round((onsetIndex * 1000) / sampleRate, 1),
    peakDbfs: round(20 * Math.log10(peak + 1e-12), 1),
    durationMs: round((samples.length * 1000) / sampleRate, 1)
  };
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const equal = token.indexOf('=');
    if (equal > 2) { flags[token.slice(2, equal)] = token.slice(equal + 1); continue; }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) flags[token.slice(2)] = true;
    else { flags[token.slice(2)] = next; index += 1; }
  }
  return { positional, flags };
}

function usage() {
  return `Usage:
  qcut audio beats <audio> [--bpm 120 | --bpm-hint 120] [--output reports/beat-grid.json] [--force] [--json]
  qcut audio peak <sfx> [--trim 0] [--json]
`;
}

function cli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const [command, file] = positional;
  if (!['beats', 'peak'].includes(command) || !file) throw new UsageError(usage());
  const absolute = path.resolve(file);
  if (command === 'peak') {
    const result = { ok: true, file: path.basename(absolute), ...peakOffset(absolute, { trim: flags.trim }) };
    process.stdout.write(flags.json ? `${JSON.stringify(result, null, 2)}\n` : `peak at ${result.peakMs} ms\n`);
    return 0;
  }
  const grid = analyzeBeats(absolute, { bpm: flags.bpm, bpmHint: flags['bpm-hint'], displaySource: file });
  if (flags.output) {
    const output = path.resolve(String(flags.output));
    if (fs.existsSync(output) && !flags.force) throw new Error(`Output exists: ${flags.output}. Re-run with --force.`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(grid, null, 2)}\n`);
  }
  const summary = { ok: true, bpm: grid.bpm, firstDownbeat: grid.firstDownbeat, beats: grid.beats.length, bars: grid.bars.length, drop: grid.drop, output: flags.output || null };
  process.stdout.write(flags.json ? `${JSON.stringify(flags.output ? summary : grid, null, 2)}\n` : `${grid.bpm} BPM, first downbeat ${grid.firstDownbeat}s, drop ${grid.drop ? `${grid.drop.time}s` : 'none'}\n`);
  return 0;
}

module.exports = { analyzeBeats, peakOffset, onsetEnvelope, estimateTempo };

if (require.main === module) {
  try { process.exitCode = cli(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
