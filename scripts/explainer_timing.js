#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { projectPath } = require('./render_project');

const TIMING_SCHEMA = 'qiaocut.narration-timing.v1';

function commandAvailable(command, args = ['-version']) {
  if (!command) return false;
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.status === 0;
}

function preferredTool(name) {
  const environment = name === 'ffmpeg' ? process.env.QIAOMU_FFMPEG : process.env.QIAOMU_FFPROBE;
  const candidates = [
    environment,
    `/opt/homebrew/opt/ffmpeg-full/bin/${name}`,
    `/usr/local/opt/ffmpeg-full/bin/${name}`,
    name
  ].filter(Boolean);
  return candidates.find((candidate) => commandAvailable(candidate)) || null;
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function readJson(file, label = path.basename(file)) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
}

function measuredDurationMs(audio, ffprobe) {
  const result = spawnSync(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audio
  ], { encoding: 'utf8' });
  const seconds = Number(result.stdout);
  if (result.status !== 0 || !(seconds > 0)) throw new Error('ffprobe could not measure a positive narration duration.');
  return Math.round(seconds * 1000);
}

function silenceMidpointsMs(audio, ffmpeg) {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-nostats', '-i', audio,
    '-af', 'silencedetect=noise=-40dB:d=0.18', '-f', 'null', '-'
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) return [];
  const midpoints = [];
  let start = null;
  for (const line of String(result.stderr || '').split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) start = Number(startMatch[1]);
    const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
    if (endMatch && Number.isFinite(start)) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(end) && end > start) midpoints.push(Math.round((start + end) * 500));
      start = null;
    }
  }
  return [...new Set(midpoints)].sort((left, right) => left - right);
}

function budgetTargets(segments, durationMs) {
  const weights = segments.map((segment) => Number(segment.duration) > 0 ? Number(segment.duration) : 1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  return weights.slice(0, -1).map((weight) => {
    cursor += weight;
    return Math.round(durationMs * cursor / total);
  });
}

function chooseBoundaries(targets, silences, durationMs) {
  const selected = [];
  const sources = [];
  let previous = 0;
  let silenceIndex = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const remaining = targets.length - index;
    const minimum = previous + 400;
    const maximum = durationMs - remaining * 400;
    const target = Math.max(minimum, Math.min(maximum, targets[index]));
    const deviation = Math.max(1200, Math.round(durationMs * 0.035));
    let best = null;
    for (let candidateIndex = silenceIndex; candidateIndex < silences.length; candidateIndex += 1) {
      const value = silences[candidateIndex];
      if (value < minimum) continue;
      if (value > maximum) break;
      const distance = Math.abs(value - target);
      if (distance <= deviation && (!best || distance < best.distance)) best = { candidateIndex, value, distance };
    }
    if (best) {
      selected.push(best.value);
      sources.push('detected-silence');
      silenceIndex = best.candidateIndex + 1;
      previous = best.value;
    } else {
      selected.push(target);
      sources.push('budget-fallback');
      previous = target;
    }
  }
  return { boundaries: [0, ...selected, durationMs], sources };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function roundedDurations(phrases, totalSeconds) {
  const result = phrases.map((phrase) => Number(((phrase.endMs - phrase.startMs) / 1000).toFixed(3)));
  if (result.length) {
    const beforeLast = result.slice(0, -1).reduce((sum, value) => sum + value, 0);
    result[result.length - 1] = Number((totalSeconds - beforeLast).toFixed(3));
  }
  return result;
}

function lockNarrationTiming(projectRoot, audioRelative, options = {}) {
  const audio = projectPath(projectRoot, audioRelative, 'narration audio', { exists: true });
  const specFile = path.join(projectRoot, 'production-spec.json');
  if (!fs.existsSync(specFile)) throw new Error('production-spec.json is required before locking narration timing.');
  const spec = readJson(specFile, 'production-spec.json');
  const segments = Array.isArray(spec.narrationSegments) ? spec.narrationSegments : [];
  const scenes = Array.isArray(spec.scenes) ? spec.scenes : [];
  if (!segments.length || segments.length !== scenes.length) {
    throw new Error('narrationSegments and scenes must be non-empty and have the same length.');
  }
  const ffprobe = preferredTool('ffprobe');
  const ffmpeg = preferredTool('ffmpeg');
  if (!ffprobe || !ffmpeg) throw new Error('ffmpeg-full and ffprobe are required to lock narration timing.');
  const durationMs = measuredDurationMs(audio, ffprobe);
  const silences = silenceMidpointsMs(audio, ffmpeg).filter((value) => value > 250 && value < durationMs - 250);
  const chosen = chooseBoundaries(budgetTargets(segments, durationMs), silences, durationMs);
  const phrases = segments.map((segment, index) => ({
    id: segment.id,
    sceneId: scenes[index] && scenes[index].id || segment.id,
    text: String(segment.text || '').trim(),
    startMs: chosen.boundaries[index],
    endMs: chosen.boundaries[index + 1],
    endBoundarySource: index === segments.length - 1 ? 'audio-end' : chosen.sources[index],
    confidence: index === segments.length - 1 || chosen.sources[index] === 'detected-silence' ? 0.85 : 0.35
  }));
  const fallbackBoundaries = chosen.sources.filter((source) => source === 'budget-fallback').length;
  const timingLevel = fallbackBoundaries === 0 ? 'phrase' : 'duration';
  const audioSha256 = sha256File(audio);
  const contractRelative = 'narration-timing.json';
  const contract = {
    schema: TIMING_SCHEMA,
    audio: { path: audioRelative.split(path.sep).join('/'), sha256: audioSha256, durationMs },
    timingLevel,
    alignment: {
      method: 'silencedetect-plus-authored-budget',
      detectedSilences: silences.length,
      usedSilenceBoundaries: chosen.sources.length - fallbackBoundaries,
      fallbackBoundaries
    },
    phrases
  };
  writeJson(path.join(projectRoot, contractRelative), contract);

  let applied = false;
  if (options.apply) {
    const totalSeconds = Number((durationMs / 1000).toFixed(3));
    const durations = roundedDurations(phrases, totalSeconds);
    segments.forEach((segment, index) => { segment.duration = durations[index]; });
    scenes.forEach((scene, index) => { scene.duration = durations[index]; });
    spec.output = { ...(spec.output || {}), duration: totalSeconds };
    const cover = spec.cover && spec.cover.enabled === false ? 0 : Number(spec.cover && spec.cover.duration) > 0 ? Number(spec.cover.duration) : 1.5;
    spec.output.targetDuration = Number((totalSeconds + cover).toFixed(3));
    spec.timing = {
      contract: contractRelative,
      audioPath: contract.audio.path,
      audioSha256,
      durationMs,
      level: timingLevel
    };
    writeJson(specFile, spec);
    applied = true;
  }
  return {
    ok: true,
    contract: contractRelative,
    audio: contract.audio,
    timingLevel,
    phrases: phrases.length,
    alignment: contract.alignment,
    applied,
    warnings: fallbackBoundaries
      ? [`${fallbackBoundaries} phrase boundary/boundaries use authored-duration fallback; do not claim word-level alignment.`]
      : [],
    next: applied
      ? ['Run qcut explainer check <project> --stage spec --json, then qcut explainer materialize <project> --json.', 'Apply the existing provenance-rich timelineNarration object for this local audio; do not replace it with an unverified path-only object.']
      : ['Review narration-timing.json, then re-run with --apply to update production-spec durations.']
  };
}

module.exports = {
  TIMING_SCHEMA,
  budgetTargets,
  chooseBoundaries,
  lockNarrationTiming,
  silenceMidpointsMs
};
