#!/usr/bin/env node
'use strict';

/* explainer beats：从 narration-timing.json 的 phrase 边界 + 场景内静音检测推导动作节拍，
   写回 production-spec.json 的 scenes[].beats。
   原则：动作节拍落在旁白语流的分句点上，而不是按场景时长比例猜（声画对齐）。
   beats.at 为场景相对秒数，供 component-runtime.js 的 parseBeats 消费。 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function preferredFfmpeg() {
  return [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', 'ffmpeg']
    .find((binary) => binary && spawnSync(binary, ['-v', 'error', '-version'], { stdio: 'ignore' }).status === 0) || null;
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label || file}: ${error.message}`);
  }
}

/** 场景音频窗口内的静音段中点（场景相对秒，升序）。 */
function silenceMidpoints(ffmpeg, audio, startMs, endMs) {
  const duration = Math.max(0.2, (endMs - startMs) / 1000);
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-nostats',
    '-ss', (startMs / 1000).toFixed(3), '-t', duration.toFixed(3), '-i', audio,
    '-af', 'silencedetect=noise=-35dB:d=0.22', '-f', 'null', '-'
  ], { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const starts = [...output.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...output.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const midpoints = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i += 1) {
    const mid = (starts[i] + ends[i]) / 2;
    if (mid > 0.3 && mid < duration - 0.3) midpoints.push(Number(mid.toFixed(3)));
  }
  return { midpoints, duration };
}

/** process 场景：为 stepCount 个步骤挑激活时刻。优先用静音中点，不足时均匀兜底。 */
function processBeats(midpoints, duration, stepCount) {
  const beats = [];
  const usable = midpoints.filter((t) => t > 0.5);
  for (let i = 0; i < stepCount; i += 1) {
    let at;
    if (i === 0) {
      at = Math.min(1.2, Math.max(0.5, duration * 0.08));
    } else if (usable.length >= i) {
      at = usable[i - 1] + 0.15; // 分句点后稍落拍
    } else {
      at = duration * (0.15 + (0.72 * i) / stepCount); // 与运行时默认均铺一致
    }
    beats.push({ at: Number(Math.min(duration - 0.6, at).toFixed(3)), action: 'activate', target: i });
  }
  return beats;
}

/** state 场景：swap 落在 40% 之后最近的分句点；收尾前加一个 pulse 重音。 */
function stateBeats(midpoints, duration) {
  const beats = [];
  const swapCandidates = midpoints.filter((t) => t > duration * 0.3 && t < duration * 0.8);
  if (swapCandidates.length) {
    const target = duration * 0.55;
    const swapAt = swapCandidates.reduce((best, t) => (Math.abs(t - target) < Math.abs(best - target) ? t : best), swapCandidates[0]);
    beats.push({ at: Number(swapAt.toFixed(3)), action: 'swap' });
  }
  const pulseCandidates = midpoints.filter((t) => t > duration * 0.7 && t < duration - 0.5);
  if (pulseCandidates.length) {
    beats.push({ at: Number(pulseCandidates[pulseCandidates.length - 1].toFixed(3)), action: 'pulse' });
  }
  return beats;
}

function stepCountOf(scene) {
  if (['reward-loop', 'pipeline'].includes(scene.component)) return Math.min(6, (scene.items || []).length || 3);
  if (scene.component === 'definition' && Array.isArray(scene.items) && scene.items.length > 1) return Math.min(8, scene.items.length);
  return 0;
}

function deriveBeats(projectRoot, options = {}) {
  const specFile = path.join(projectRoot, 'production-spec.json');
  const spec = readJson(specFile, 'production-spec.json');
  if (!spec.timing || !spec.timing.contract) {
    return { ok: false, applied: false, error: 'timing not locked; run qcut explainer timing --apply first.', scenes: [] };
  }
  const timing = readJson(path.join(projectRoot, spec.timing.contract), spec.timing.contract);
  const audio = timing.audio && timing.audio.path;
  if (!audio || !fs.existsSync(path.join(projectRoot, audio))) {
    return { ok: false, applied: false, error: 'narration audio from timing contract is missing.', scenes: [] };
  }
  const ffmpeg = preferredFfmpeg();
  if (!ffmpeg) return { ok: false, applied: false, error: 'ffmpeg unavailable.', scenes: [] };
  const phraseByScene = new Map((timing.phrases || []).map((p) => [p.sceneId || p.id, p]));

  const summaries = [];
  for (const scene of spec.scenes || []) {
    const kind = String(scene.visibleChange && scene.visibleChange.kind || 'none');
    if (kind === 'none') { summaries.push({ id: scene.id, kind, beats: 0, source: 'skipped' }); continue; }
    const phrase = phraseByScene.get(scene.id);
    const duration = Number(scene.duration) || ((phrase ? (phrase.endMs - phrase.startMs) : 0) / 1000);
    let beats = [];
    let source = 'fallback-spread';
    if (phrase) {
      const { midpoints } = silenceMidpoints(ffmpeg, path.join(projectRoot, audio), phrase.startMs, phrase.endMs);
      const steps = stepCountOf(scene);
      if (kind === 'process' && steps > 1) beats = processBeats(midpoints, duration, steps);
      else if (kind === 'state') beats = stateBeats(midpoints, duration);
      if (beats.length && midpoints.length) source = 'silence-aligned';
    }
    if (beats.length) scene.beats = beats;
    else delete scene.beats;
    summaries.push({ id: scene.id, kind, beats: beats.length, source });
  }

  if (options.apply) {
    fs.writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`);
  }
  return {
    ok: true,
    applied: Boolean(options.apply),
    timingLevel: timing.timingLevel || null,
    scenes: summaries,
    next: options.apply
      ? 'Re-run qcut explainer materialize, then preview. Hand-authored scenes ignore spec beats; adjust their hardcoded timings manually.'
      : 'Dry run. Re-run with --apply to write beats into production-spec.json.'
  };
}

module.exports = { deriveBeats, silenceMidpoints, processBeats, stateBeats };

if (require.main === module) {
  const args = process.argv.slice(2);
  const project = args.find((a) => !a.startsWith('--'));
  if (!project) {
    process.stderr.write('Usage: explainer_beats.js <project-dir> [--apply] [--json]\n');
    process.exitCode = 2;
  } else {
    try {
      const result = deriveBeats(path.resolve(project), { apply: args.includes('--apply') });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
