#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { auditProject, initProject, paceProject, reviewProject } = require('./english_mix');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaomu-cut-english-mix-'));
const project = path.join(temp, 'project');
const ffmpeg = fs.existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg')
  ? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg'
  : 'ffmpeg';

function run(args) {
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'ffmpeg fixture failed');
}

function makeClip(file, color, frequency, duration = 2) {
  run([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=320x568:r=24:d=${duration}`,
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file
  ]);
}

try {
  const initialized = initProject(project, { phrases: 'That makes sense.|I see what you mean.', 'clips-per-phrase': 2 });
  assert.equal(initialized.targetCount, 4);
  const makes = path.join(project, 'assets/source/makes-01.mp4');
  const see = path.join(project, 'assets/source/see-01.mp4');
  makeClip(makes, 'red', 440);
  makeClip(see, 'blue', 550);
  fs.writeFileSync(path.join(project, 'assets/source/makes-01.srt'), '1\n00:00:00,200 --> 00:00:00,800\nThat makes sense.\n有道理。\n');
  fs.writeFileSync(path.join(project, 'assets/source/see-01.srt'), '1\n00:00:00,200 --> 00:00:00,900\nI see what you mean.\n我懂你的意思。\n');

  const selectionFile = path.join(project, 'source-selection.json');
  const selection = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
  assert.equal(selection.rangePolicy.introMaxMs, 700);
  assert.equal(selection.rangePolicy.groupCardDurationMs, 2000);
  assert.equal(selection.rangePolicy.groupCardMaxMs, 2200);
  assert.equal(selection.rangePolicy.firstAudioMaxMs, 2600);
  selection.selectedCount = 2;
  selection.groups[0].clips.push({
    id: 'makes-01', videoId: 1, sourceStartMs: 0, sourceEndMs: 1600,
    trimStartMs: 100, trimEndMs: 1700,
    english: 'That makes sense.', contextBefore: 0,
    subtitleWindow: { current: { start: 0.2, end: 0.8, content: 'That makes sense.' } }
  });
  selection.groups[1].clips.push({
    id: 'see-01', videoId: 2, sourceStartMs: 0, sourceEndMs: 1700,
    english: 'I see what you mean.', contextBefore: 0,
    subtitleWindow: { current: { start: 0.2, end: 0.9, content: 'I see what you mean.' } }
  });
  fs.writeFileSync(selectionFile, `${JSON.stringify(selection, null, 2)}\n`);

  const audit = auditProject(project, { 'require-media': true, 'strict-boundaries': true });
  assert.equal(audit.ok, true);
  assert.equal(audit.selectedCount, 2);
  assert.equal(audit.uniqueSha256, 2);

  const pacing = paceProject(project, { force: true, apply: true });
  assert.equal(pacing.ok, true);
  assert.equal(pacing.count, 2);
  assert(pacing.items.every((item) => item.edgeSilenceVerified));
  assert.equal(pacing.trimmedLeadingFragments, 1);
  assert.equal(pacing.trimmedTrailingFragments, 1);
  assert.equal(pacing.items[0].trimStartMs, 100);
  assert.equal(pacing.items[0].trimEndMs, 1700);
  assert(pacing.items[0].processedDuration >= 2.15 && pacing.items[0].processedDuration <= 2.18);
  const pacedSelection = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
  assert.equal(pacedSelection.rangePolicy.leadHoldMs, 60);
  assert.equal(pacedSelection.rangePolicy.tailHoldMs, 500);
  assert.equal(pacedSelection.rangePolicy.crossfadeMs, 200);
  assert.equal(pacedSelection.groups[0].clips[0].processedPath, 'assets/processed/makes-01.mp4');

  const timeline = {
    schema: 'qiaocut.timeline.v1',
    output: { width: 320, height: 568, fps: 24, duration: 2, file: 'renders/final.mp4' },
    captionSource: 'captions/captions.json',
    shots: [
      { id: 'makes-01', kind: 'video', path: 'assets/source/makes-01.mp4', duration: 1, sourceAudio: true },
      { id: 'see-01', kind: 'video', path: 'assets/source/see-01.mp4', duration: 1, sourceAudio: true }
    ]
  };
  fs.writeFileSync(path.join(project, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  fs.writeFileSync(path.join(project, 'captions/captions.json'), `${JSON.stringify({
    events: [
      { start: 0.1, end: 0.8, style: 'English', text: 'That makes sense.' },
      { start: 1.1, end: 1.9, style: 'English', text: 'I see what you mean, and this intentionally tests the longest mobile caption.' }
    ]
  }, null, 2)}\n`);
  makeClip(path.join(project, 'renders/final.preview.mp4'), 'black', 660, 2);
  const review = reviewProject(project, { frames: '8' });
  assert.equal(review.ok, true);
  assert.equal(review.frameCount, 2);
  assert(fs.statSync(path.join(project, review.contactSheet)).size > 0);
  assert(fs.statSync(path.join(project, review.phoneLongCaption.path)).size > 0);

  selection.groups[1].clips[0].localPath = 'assets/source/makes-01.mp4';
  fs.writeFileSync(selectionFile, `${JSON.stringify(selection, null, 2)}\n`);
  const duplicateAudit = auditProject(project, { 'require-media': true, 'strict-boundaries': true });
  assert.equal(duplicateAudit.ok, false);
  assert(duplicateAudit.errors.some((error) => String(error.message || '').includes('duplicate-sha256')));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    initTargetCount: initialized.targetCount,
    strictAudit: true,
    duplicateHashBlocked: true,
    pacedClips: pacing.count,
    edgeSilenceVerified: true,
    reviewFrames: review.frameCount,
    phoneFrame: true
  })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
