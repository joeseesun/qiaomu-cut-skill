#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { initProject, reviewProject } = require('./movie_montage');

function ffmpegPath() {
  if (process.env.QIAOMU_FFMPEG) return process.env.QIAOMU_FFMPEG;
  if (fs.existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg')) return '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return 'ffmpeg';
}

function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${path.basename(binary)} failed`);
}

function makeClip(file, source, frequency, duration = 5) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  run(ffmpegPath(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `${source}=size=320x180:rate=12:duration=${duration}`,
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file
  ]);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-movie-montage-'));
const project = path.join(temp, 'project');
try {
  const initialized = initProject(project, { target: '4', 'clip-duration': '2' });
  assert.equal(initialized.targetCount, 4);
  assert.equal(initialized.candidateLimit, 5);
  const action = path.join(project, 'assets/source/action/action.mp4');
  const ensemble = path.join(project, 'assets/source/ensemble/ensemble.mp4');
  makeClip(action, 'testsrc2', 440);
  makeClip(ensemble, 'smptebars', 550);

  const selectionFile = path.join(project, 'source-selection.json');
  const selection = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
  selection.candidates = [
    { id: 'action', videoId: 101, title: 'Action', composition: 'centered', paidAttempts: 1 },
    { id: 'ensemble', videoId: 102, title: 'Ensemble', composition: 'ensemble', paidAttempts: 2 }
  ];
  selection.finalSelection = [
    { id: 'action', videoId: 101, localPath: 'assets/source/action/action.mp4' },
    { id: 'ensemble', videoId: 102, localPath: 'assets/source/ensemble/ensemble.mp4' }
  ];
  fs.writeFileSync(selectionFile, `${JSON.stringify(selection, null, 2)}\n`);

  const report = reviewProject(project, { apply: true, samples: '5', 'motion-fps': '2' });
  assert.equal(report.ok, true);
  assert.equal(report.selectedCount, 2);
  assert.equal(report.items[0].fitRecommendation, 'cover');
  assert.equal(report.items[1].fitRecommendation, 'containBlur');
  assert(report.items[0].motion.score > report.items[1].motion.score);
  assert(report.items.every((item) => fs.statSync(path.join(project, item.evidence.denseContactSheet)).size > 0));
  assert(report.items.every((item) => fs.statSync(path.join(project, item.evidence.recommendedWindowStrip)).size > 0));
  assert(report.items.every((item) => fs.statSync(path.join(project, item.evidence.phoneCropComparison)).size > 0));
  assert(fs.statSync(path.join(project, report.overviews.motionWindows.path)).size > 0);
  assert(fs.statSync(path.join(project, report.overviews.phoneCrops.path)).size > 0);
  const applied = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
  assert.equal(applied.candidates[0].review.semanticDecision, 'pending-human-review');

  applied.finalSelection[1].localPath = 'assets/source/action/action.mp4';
  fs.writeFileSync(selectionFile, `${JSON.stringify(applied, null, 2)}\n`);
  const duplicate = reviewProject(project, { force: true, samples: '4', 'motion-fps': '2' });
  assert.equal(duplicate.ok, false);
  assert(duplicate.errors.some((error) => String(error.message || '').includes('selected-duplicate-sha256')));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    targetCount: initialized.targetCount,
    candidateLimit: initialized.candidateLimit,
    motionWindowRanked: true,
    denseEvidence: true,
    phoneCropComparison: true,
    duplicateSelectionBlocked: true
  })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
