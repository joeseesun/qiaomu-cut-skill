#!/usr/bin/env node
'use strict';

/* explainer beats 冒烟：合成带两处静音间隙的音频，验证 beats 落在分句点上。 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { deriveBeats, processBeats, stateBeats, silenceMidpoints } = require('./explainer_beats');

const ffmpeg = [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', 'ffmpeg']
  .find((binary) => binary && spawnSync(binary, ['-v', 'error', '-version'], { stdio: 'ignore' }).status === 0);
assert.ok(ffmpeg, 'ffmpeg 不可用');

// 纯函数兜底逻辑
{
  const beats = processBeats([], 10, 3);
  assert.equal(beats.length, 3);
  assert.ok(beats[1].at > beats[0].at && beats[2].at > beats[1].at, '激活时刻应递增');
  const state = stateBeats([2.0, 3.4], 8);
  assert.equal(state[0].action, 'swap');
  assert.ok(Math.abs(state[0].at - 3.4) < 0.01, `swap 应落在最接近 55% 的分句点，实际 ${state[0].at}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-beats-'));
try {
  // 5 秒音频：1.6–2.0s 与 3.4–3.8s 两处静音 → 分句点 ≈1.8 / 3.6
  const audio = path.join(root, 'voice.wav');
  const synth = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
    '-af', "volume=enable='between(t,1.6,2.0)':volume=0,volume=enable='between(t,3.4,3.8)':volume=0",
    audio
  ], { encoding: 'utf8' });
  assert.equal(synth.status, 0, synth.stderr);

  const mid = silenceMidpoints(ffmpeg, audio, 0, 5000);
  assert.ok(mid.midpoints.length >= 2, `应检出至少 2 个分句点，实际 ${JSON.stringify(mid.midpoints)}`);
  assert.ok(Math.abs(mid.midpoints[0] - 1.8) < 0.25, `分句点 1 应≈1.8，实际 ${mid.midpoints[0]}`);
  assert.ok(Math.abs(mid.midpoints[1] - 3.6) < 0.25, `分句点 2 应≈3.6，实际 ${mid.midpoints[1]}`);

  // 最小项目：spec + timing contract
  fs.writeFileSync(path.join(root, 'narration-timing.json'), `${JSON.stringify({
    schema: 'qiaocut.narration-timing.v1',
    audio: { path: 'voice.wav', sha256: 'x'.repeat(64), durationMs: 10000 },
    timingLevel: 'phrase',
    phrases: [
      { id: 's_a', sceneId: 's_a', startMs: 0, endMs: 5000 },
      { id: 's_b', sceneId: 's_b', startMs: 5000, endMs: 10000 }
    ]
  }, null, 2)}\n`);
  const spec = {
    schema: 'qiaocut.explainer-production.v1',
    timing: { contract: 'narration-timing.json', level: 'phrase', audioSha256: 'x'.repeat(64), durationMs: 10000 },
    scenes: [
      { id: 's_a', component: 'pipeline', duration: 5, items: ['一', '二', '三'], visibleChange: { kind: 'process', from: '甲', to: '乙' } },
      { id: 's_b', component: 'comparison', duration: 5, visibleChange: { kind: 'state', from: '甲', to: '乙' } },
      { id: 's_c', component: 'outro', duration: 5, visibleChange: { kind: 'none', from: '', to: '' } }
    ]
  };
  fs.writeFileSync(path.join(root, 'production-spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
  // s_b 的 phrase 窗口也指向前 5 秒音频（fixture 只合成了 5 秒，窗口裁剪由 ffmpeg -t 容忍）
  const timing = JSON.parse(fs.readFileSync(path.join(root, 'narration-timing.json'), 'utf8'));
  timing.phrases[1].startMs = 0;
  timing.phrases[1].endMs = 5000;
  fs.writeFileSync(path.join(root, 'narration-timing.json'), `${JSON.stringify(timing, null, 2)}\n`);

  const dry = deriveBeats(root, { apply: false });
  assert.equal(dry.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'production-spec.json'), 'utf8').includes('"beats"'), false, 'dry run 不应写文件');

  const applied = deriveBeats(root, { apply: true });
  assert.equal(applied.ok, true);
  assert.equal(applied.applied, true);
  const written = JSON.parse(fs.readFileSync(path.join(root, 'production-spec.json'), 'utf8'));
  const pa = written.scenes.find((s) => s.id === 's_a');
  const pb = written.scenes.find((s) => s.id === 's_b');
  const pc = written.scenes.find((s) => s.id === 's_c');
  assert.equal(pa.beats.length, 3);
  assert.equal(pa.beats[1].action, 'activate');
  assert.ok(Math.abs(pa.beats[1].at - 1.95) < 0.35, `步骤 2 激活应≈1.95，实际 ${pa.beats[1].at}`);
  assert.ok(Math.abs(pa.beats[2].at - 3.75) < 0.35, `步骤 3 激活应≈3.75，实际 ${pa.beats[2].at}`);
  assert.equal(pb.beats[0].action, 'swap');
  assert.ok(pb.beats[0].at > 1.5 && pb.beats[0].at < 4.0, `swap 应在分句点上，实际 ${pb.beats[0].at}`);
  assert.equal(pc.beats, undefined, 'kind=none 场景不应有 beats');
  assert.equal(applied.scenes.find((s) => s.id === 's_a').source, 'silence-aligned');

  process.stdout.write(`${JSON.stringify({ ok: true, checks: ['fallback', 'silence-detect', 'dry-run', 'apply'] }, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
