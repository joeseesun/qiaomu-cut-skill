#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { renderProject } = require('./render_project');

function ffmpegPath() {
  for (const candidate of [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', 'ffmpeg']) {
    if (!candidate) continue;
    const result = candidate.includes('/')
      ? fs.existsSync(candidate) && candidate
      : spawnSync('which', [candidate], { encoding: 'utf8' }).stdout.trim();
    if (result) return result;
  }
  throw new Error('ffmpeg-full is required for timeline feature smoke test.');
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed:\n${result.stderr}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-timeline-features-'));
const ffmpeg = ffmpegPath();
try {
  for (const directory of ['assets', 'captions', 'renders', 'reports']) fs.mkdirSync(path.join(root, directory), { recursive: true });
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x172554:s=320x480:d=1', '-frames:v', '1', path.join(root, 'assets', 'one.png')]);
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x7c2d12:s=320x480:d=1', '-frames:v', '1', path.join(root, 'assets', 'two.png')]);
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.25', '-c:a', 'pcm_s16le', path.join(root, 'assets', 'pop.wav')]);
  fs.writeFileSync(path.join(root, 'captions', 'captions.json'), JSON.stringify({
    title: 'Feature smoke',
    events: [{
      start: 0.1,
      end: 1.5,
      style: 'BigWord',
      text: 'ONE TWO',
      animation: 'word-follow',
      segments: [{ text: 'ONE ', durationMs: 600 }, { text: 'TWO', durationMs: 800 }]
    }]
  }, null, 2));
  fs.writeFileSync(path.join(root, 'timeline.json'), JSON.stringify({
    schema: 'qiaocut.timeline.v1',
    title: 'Timeline features smoke',
    output: {
      width: 320,
      height: 480,
      fps: 12,
      duration: 2.2,
      loudnessLufs: -14,
      truePeakDb: -1.5,
      file: 'renders/final.mp4'
    },
    captionSource: 'captions/captions.json',
    captions: 'captions/final.ass',
    narration: { engine: 'none' },
    music: false,
    audio: { masteringMode: 'montage' },
    soundEffects: [{ id: 'pop', path: 'assets/pop.wav', start: 0.45, gain: 0.4, fadeOutMs: 80, alignPeak: true }],
    reports: { contactSheet: false, renderReport: 'reports/render-report.json' },
    shots: [
      { id: 's01', kind: 'image', path: 'assets/one.png', duration: 1.2, motion: 'none' },
      { id: 's02', kind: 'image', path: 'assets/two.png', duration: 1.2, motion: 'none', transition: { type: 'fade', duration: 0.2 } }
    ]
  }, null, 2));
  const report = renderProject(root, { profile: 'preview', validation: 'basic', quiet: true });
  assert.equal(report.ok, true);
  assert.equal(report.transitions.length, 1);
  assert.equal(report.transitions[0].type, 'fade');
  assert.equal(report.soundEffects.count, 1);
  assert.equal(report.soundEffects.cues[0].hitAt, 0.45);
  assert.ok(report.soundEffects.cues[0].peakMs >= 0);
  assert.ok(report.soundEffects.cues[0].start <= 0.45);
  assert.equal(report.audio.masteringMode, 'montage');
  assert.ok(fs.statSync(report.finalVideo).size > 1024);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    transitions: report.transitions,
    soundEffects: report.soundEffects.count,
    durationSeconds: report.durationSeconds
  }, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
