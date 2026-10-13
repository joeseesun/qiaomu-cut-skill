#!/usr/bin/env node
'use strict';

// Smoke test for the frame-0 cover gate: black opens fail, a held cover passes,
// the motion storyboard scaffolds s00, and checkBrief enforces brief.cover.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { checkCover, exportThumbnails, LIMITS } = require('./cover');
const { checkBrief, storyboardSkeleton, coverSeconds, STYLES } = require('./motion_studio');

const checks = [];
const ok = (name) => checks.push(name);

function ffmpeg() {
  for (const candidate of [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return 'ffmpeg';
}

function make(file, filter) {
  const result = spawnSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', filter, '-pix_fmt', 'yuv420p', file]);
  assert.equal(result.status, 0, String(result.stderr));
  return file;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qcut-cover-smoke-'));
try {
  // 1. A film that opens on black is blocked.
  const black = make(path.join(tmp, 'black.mp4'), 'color=black:s=1280x720:d=1.2');
  const blackReport = checkCover(black);
  assert.equal(blackReport.ok, false);
  assert.ok(blackReport.errors.some((item) => item.code === 'frame0-not-black'));
  ok('black open is blocked');

  // 2. A held, high-contrast cover passes and produces feed previews.
  const held = make(path.join(tmp, 'held.mp4'), 'testsrc2=s=1280x720:d=1.2:r=30,trim=0:0.04,loop=40:1:0,setpts=N/30/TB');
  const heldReport = checkCover(held, { outDir: path.join(tmp, 'out') });
  assert.equal(heldReport.ok, true, JSON.stringify(heldReport.errors));
  assert.ok(heldReport.frame0.mean >= LIMITS.blackMean);
  assert.equal(heldReport.hold.held, true, JSON.stringify(heldReport.hold));
  for (const file of [heldReport.previews.jpg, ...heldReport.previews.previews]) assert.ok(fs.existsSync(file), file);
  ok('held cover passes with 1280 JPG + 360/168 previews');

  // 3. A moving first second is flagged as not holding.
  const moving = make(path.join(tmp, 'moving.mp4'), 'testsrc2=s=1280x720:d=1.2:r=30');
  assert.ok(checkCover(moving).warnings.some((item) => item.code === 'cover-hold'));
  ok('non-holding opening warns');

  // 4. Small or oversize thumbnails are blocked.
  const small = make(path.join(tmp, 'small.png'), 'testsrc2=s=640x360:d=0.04');
  assert.ok(checkCover(small).errors.some((item) => item.code === 'resolution'));
  const thumbs = exportThumbnails(held, path.join(tmp, 'thumbs'), 'cover');
  assert.ok(fs.statSync(thumbs.jpg).size <= LIMITS.jpgBytes);
  ok('resolution gate and JPG size limit');

  // 5. Storyboard scaffold opens on s00 lasting two beats.
  const style = STYLES['product-promo'];
  const canvas = { width: 1920, height: 1080, fps: 30, duration: 20 };
  const shots = storyboardSkeleton(style, canvas, 120, { cover: true, title: 'Demo' });
  assert.equal(shots[0].id, 's00');
  assert.equal(shots[0].cover, true);
  assert.equal(shots[0].end, coverSeconds(120));
  assert.equal(coverSeconds(120), 1);
  for (let i = 1; i < shots.length; i += 1) assert.equal(shots[i].start, shots[i - 1].end);
  assert.equal(shots[shots.length - 1].end, 20);
  assert.equal(storyboardSkeleton(style, canvas, 120, { cover: false })[0].start, 0);
  ok('skeleton opens on a two-beat cover shot and stays contiguous');

  // 6. checkBrief enforces brief.cover for non-loop films only.
  const root = path.join(tmp, 'project');
  fs.mkdirSync(path.join(root, 'scenes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scenes', 'main.html'), '<script>function seek(t){document.body.style.opacity=1}</script>');
  const filled = shots.map((shot) => ({ ...shot, idea: 'written', camera: 'locked', transitionIn: shot.transitionIn || 'cut' }));
  const base = {
    schema: 'qiaocut.motion-brief.v1',
    canvas,
    loop: false,
    direction: { oneLine: 'x', references: [{ kind: 'none', why: 'test' }], banned: ['a', 'b', 'c'] },
    audio: { bpm: 120, sfx: [] },
    storyboard: filled,
    build: { scene: 'scenes/main.html' },
    approval: { mode: 'autopilot' }
  };
  const codes = (brief) => checkBrief(root, brief).errors.map((item) => item.code);
  assert.ok(codes(base).includes('cover-missing'));
  assert.ok(codes({ ...base, cover: { frame: 0, holdSeconds: 0.7, promise: 'TODO', archetype: 'before-after' } }).includes('cover-unwritten'));
  assert.ok(!codes({ ...base, cover: { frame: 0, holdSeconds: 0.7, promise: 'p', archetype: 'before-after' } }).some((code) => code.startsWith('cover')));
  assert.ok(!codes({ ...base, loop: true }).includes('cover-missing'));
  const warn = checkBrief(root, { ...base, cover: { frame: 0, holdSeconds: 1.5, promise: 'p', archetype: 'x' } }).warnings.map((item) => item.code);
  assert.ok(warn.includes('cover-hold'));
  ok('checkBrief: cover-missing / cover-unwritten / loop exemption / hold warning');

  process.stdout.write(`${JSON.stringify({ ok: true, checks }, null, 2)}\n`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
