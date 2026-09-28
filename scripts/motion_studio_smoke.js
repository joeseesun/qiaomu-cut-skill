#!/usr/bin/env node
'use strict';

// Smoke test for the code-motion studio: motion kit math, beat grid, SFX peak
// alignment, storyboard gate, determinism probe and a tiny blurred final render.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const M = require('../assets/motion-kit/qiaocut-motion.js');
const { analyzeBeats, peakOffset } = require('./audio_beats');
const { inspectSceneEngines } = require('./render_scene');
const { prepareSoundEffects } = require('./render_project');

const QCUT = path.join(__dirname, 'qcut.js');
const checks = [];

function ffmpeg() {
  for (const candidate of [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return 'ffmpeg';
}

function ffprobe() {
  const sibling = path.join(path.dirname(ffmpeg()), 'ffprobe');
  return fs.existsSync(sibling) ? sibling : 'ffprobe';
}

function synth(file, expression, seconds, rate = 44100) {
  const result = spawnSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${expression}':s=${rate}:d=${seconds}`, file]);
  assert.equal(result.status, 0, String(result.stderr));
}

function qcut(args) {
  const result = spawnSync(process.execPath, [QCUT, ...args, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch (_) {}
  return { status: result.status, json, stderr: result.stderr };
}

// 1. Motion kit: closed-form springs equal a numerically simulated spring.
{
  assert.equal(M.spring(0), 0);
  assert.ok(Math.abs(M.spring(5) - 1) < 1e-6);
  for (const damping of [0.6, 1, 1.4]) {
    const options = { response: 0.4, damping };
    const keys = [{ t: 0, value: 0 }, { t: 0.2, value: 100 }, { t: 0.55, value: 40 }, { t: 0.9, value: 180 }];
    const w0 = (2 * Math.PI) / options.response;
    let x = 0; let v = 0; let t = 0; const dt = 1 / 20000;
    let maxError = 0;
    while (t < 2) {
      const target = keys.filter((key) => key.t <= t + 1e-12).pop().value;
      const a = -w0 * w0 * (x - target) - 2 * damping * w0 * v;
      v += a * dt; x += v * dt; t += dt;
      if (Math.round(t * 20000) % 400 === 0) maxError = Math.max(maxError, Math.abs(M.springTrack(t, keys, options) - x));
    }
    assert.ok(maxError < 0.2, `springTrack superposition error ${maxError} (damping ${damping})`);
  }
  const pointer = (time) => 50 + 200 * time;
  const before = M.dragRelease(0.9999, 0, 1, pointer, 0, { response: 0.4, damping: 0.8 });
  const after = M.dragRelease(1.0001, 0, 1, pointer, 0, { response: 0.4, damping: 0.8 });
  assert.ok(Math.abs(before - after) < 0.2, 'drag release is continuous');
  assert.equal(M.random(7, 3), M.random(7, 3));
  assert.notEqual(M.random(7, 3), M.random(8, 3));
  assert.ok(!('outBounce' in M.ease) && !('outElastic' in M.ease), 'no bouncy easing offered');
  checks.push('motion-kit springs/superposition/drag/random');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-motion-'));
try {
  // 2. Beat grid on a 128 BPM kick track starting at 0.2 s with accented downbeats.
  const song = path.join(root, 'song.wav');
  const period = 60 / 128;
  synth(song, `gt(t,0.2)*((0.5*sin(2*PI*60*mod(t-0.2,${period}))+0.2*(random(0)-0.5))*exp(-30*mod(t-0.2,${period}))*(1+eq(mod(floor((t-0.2)/${period}+0.001),4),0)))+0.04*sin(2*PI*220*t)`, 20);
  const grid = analyzeBeats(song);
  assert.ok(Math.abs(grid.bpm - 128) < 0.2, `bpm ${grid.bpm}`);
  assert.ok(Math.abs(grid.firstBeat - 0.2) < 0.01, `first beat ${grid.firstBeat}`);
  assert.ok(Math.abs(grid.firstDownbeat - 0.2) < 0.01, `first downbeat ${grid.firstDownbeat}`);
  checks.push(`beat grid ${grid.bpm} BPM @ ${grid.firstBeat}s`);

  // 2b. Bright off-beat hats from t=2, kicks only from the drop at t=4: the grid
  // must lock to the kicks (on-beat), not the hats, and find the drop.
  const hats = path.join(root, 'hats.wav');
  synth(hats, '0.9*sin(2*PI*(45+90*exp(-40*mod(t,0.5)))*mod(t,0.5))*exp(-9*mod(t,0.5))*gte(t,4)+0.1*(random(0)-0.5)*exp(-70*mod(t-0.25,0.5))*gte(t,2)+0.06*sin(2*PI*220*t)', 12, 48000);
  const hatGrid = analyzeBeats(hats);
  assert.ok(Math.abs(hatGrid.bpm - 120) < 0.2, `hat-heavy bpm ${hatGrid.bpm}`);
  assert.ok(Math.min(hatGrid.firstBeat % 0.5, 0.5 - (hatGrid.firstBeat % 0.5)) < 0.02, `hat-heavy phase ${hatGrid.firstBeat}`);
  assert.ok(hatGrid.drop && Math.abs(hatGrid.drop.time - 4) < 0.03, `drop ${JSON.stringify(hatGrid.drop)}`);
  checks.push(`off-beat hats: locked to kicks, drop @ ${hatGrid.drop.time}s`);

  // 3. SFX peak offset.
  const hit = path.join(root, 'hit.wav');
  synth(hit, '0.02*sin(2*PI*800*t)*lt(t,0.12)+0.9*sin(2*PI*300*t)*exp(-30*(t-0.12))*gte(t,0.12)', 0.6, 48000);
  const peak = peakOffset(hit);
  assert.ok(Math.abs(peak.peakMs - 120) < 3, `peak ${peak.peakMs}`);
  checks.push(`sfx peak ${peak.peakMs} ms`);

  // 4. Timeline alignPeak places the file so its peak lands on the hit time.
  const build = fs.mkdtempSync(path.join(root, 'build-'));
  fs.copyFileSync(hit, path.join(root, 'hit-copy.wav'));
  const prepared = prepareSoundEffects({
    timeline: { output: { duration: 3 }, soundEffects: [{ id: 'hit', path: 'hit-copy.wav', start: 1.5, alignPeak: true }] },
    projectRoot: root,
    buildDir: build,
    tools: { ffmpeg: ffmpeg(), ffprobe: ffprobe() },
    progress: () => {}
  });
  const cue = prepared.cues[0];
  assert.equal(cue.hitAt, 1.5);
  assert.ok(Math.abs(cue.start + cue.peakMs / 1000 - 1.5) < 0.002);
  checks.push(`timeline alignPeak start ${cue.start}s for hit 1.5s`);

  // 5. Storyboard-before-code gate.
  const project = path.join(root, 'promo');
  fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
  fs.copyFileSync(song, path.join(project, 'assets', 'song.wav'));
  fs.copyFileSync(hit, path.join(project, 'assets', 'hit.wav'));
  const init = qcut(['motion', 'init', project, '--style', 'product-promo', '--audio', 'assets/song.wav', '--width', '320', '--height', '180', '--fps', '12', '--duration', '3']);
  assert.equal(init.status, 0, init.stderr);
  let check = qcut(['motion', 'check', project]);
  assert.equal(check.status, 1);
  assert.ok(check.json.errors.some((item) => item.code === 'shot-unwritten'), 'unwritten storyboard blocks');
  const briefFile = path.join(project, 'motion-brief.json');
  const brief = JSON.parse(fs.readFileSync(briefFile, 'utf8'));
  brief.storyboard.forEach((shot, index) => Object.assign(shot, { idea: `idea ${index}`, camera: 'locked', transitionIn: 'hard cut on beat', onScreenText: ['Ship', 'Faster', 'Now'][index % 3] }));
  brief.direction.references = [{ kind: 'none', why: 'smoke' }];
  brief.approval.mode = 'autopilot';
  brief.audio.music.license = 'synthetic';
  brief.audio.sfx = [{ id: 'hit', path: 'assets/hit.wav', at: brief.storyboard[1] ? brief.storyboard[1].start : 1 }];
  const offGrid = JSON.parse(JSON.stringify(brief));
  if (offGrid.storyboard.length > 1) {
    offGrid.storyboard[1].start += 0.2;
    offGrid.storyboard[0].end += 0.2;
    fs.writeFileSync(briefFile, JSON.stringify(offGrid, null, 2));
    check = qcut(['motion', 'check', project]);
    assert.ok(check.json.errors.some((item) => item.code === 'off-grid'), 'off-grid cut blocks');
  }
  fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2));
  assert.equal(qcut(['motion', 'scene', project, '--force']).status, 0);
  check = qcut(['motion', 'check', project]);
  assert.equal(check.status, 0, JSON.stringify(check.json && check.json.errors));
  assert.equal(check.json.status, 'ready');
  const scene = path.join(project, 'scenes', 'main.html');
  const clean = fs.readFileSync(scene, 'utf8');
  fs.writeFileSync(scene, clean.replace('function seek(t) {', 'function seek(t) {\n    const jitter = Math.random();'));
  check = qcut(['motion', 'check', project]);
  assert.ok(check.json.errors.some((item) => item.code === 'determinism'), 'Math.random is rejected');
  checks.push('storyboard gate: unwritten, off-grid, determinism lint, ready');

  const engines = inspectSceneEngines();
  if (!engines.html.available) {
    checks.push('SKIPPED probe/render: headless browser capture unavailable (missing evidence)');
  } else {
    // 6. Probe catches hidden per-frame state that static lint cannot see.
    fs.writeFileSync(scene, clean.replace('function seek(t) {', 'let calls = 0;\n  function seek(t) {\n    calls += 1; document.body.style.background = `rgb(${calls % 250},0,0)`;'));
    let probe = qcut(['motion', 'probe', project]);
    assert.equal(probe.json.ok, false);
    assert.equal(probe.json.determinism.deterministic, false);
    fs.writeFileSync(scene, clean);
    const blocked = qcut(['motion', 'render', project, '--profile', 'final']);
    assert.equal(blocked.json.ok, false, 'final requires a passing probe');
    probe = qcut(['motion', 'probe', project]);
    assert.equal(probe.json.ok, true, JSON.stringify(probe.json.determinism));
    assert.ok(fs.existsSync(path.join(project, probe.json.contactSheet)));
    checks.push('probe: stateful scene rejected, pure scene passes');

    // 7. Tiny final render with sub-frame motion blur, music and a peak-aligned SFX.
    const render = qcut(['motion', 'render', project, '--profile', 'final']);
    assert.equal(render.json.ok, true, JSON.stringify(render.json));
    assert.equal(render.json.capture.motionBlur.subframes, 3);
    assert.equal(render.json.verification.video.width, 320);
    assert.ok(Math.abs(render.json.verification.format.duration - 3) < 0.2);
    assert.ok(render.json.audio.cues[0].peakMs > 100);
    assert.ok(Math.abs(render.json.verification.loudness.integratedLUFS + 14) < 2, JSON.stringify(render.json.verification.loudness));
    checks.push(`final render: ${render.json.capture.frames} frames × 3 subframes, ${render.json.verification.loudness.integratedLUFS} LUFS`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, checks }, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
