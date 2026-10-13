#!/usr/bin/env node
'use strict';

// Smoke test for "one film, one concept": the concept gate in checkBrief and the batch
// diversity check (archetype / music / structure / reference must differ across films).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { checkBrief, diversityReport, storyboardSkeleton, STYLES } = require('./motion_studio');

const checks = [];
const ok = (name) => checks.push(name);
const QCUT = path.join(__dirname, 'qcut.js');

const concept = (over = {}) => ({
  archetype: 'silhouette-dance', reference: 'Apple iPod Silhouette', device: 'six colours six dances', tempo: 128, musicStyle: 'funk-house',
  typeStyle: 'rounded', palette: ['#FFD500', '#FF2D78', '#111111'], camera: 'locked-off', structure: 'a', duration: 31, ...over
});

// 1. checkBrief: missing concept warns, TODO concept blocks, written concept passes.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qcut-concept-'));
try {
  const root = path.join(tmp, 'p');
  fs.mkdirSync(path.join(root, 'scenes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scenes', 'main.html'), '<script>function seek(t){document.body.style.opacity=1}</script>');
  const style = STYLES['product-promo'];
  const canvas = { width: 1920, height: 1080, fps: 30, duration: 20 };
  const shots = storyboardSkeleton(style, canvas, 120, { cover: true, title: 'Demo' }).map((s) => ({ ...s, idea: 'written', camera: 'locked', transitionIn: s.transitionIn || 'cut' }));
  const base = {
    schema: 'qiaocut.motion-brief.v1', canvas, loop: false, cover: { frame: 0, holdSeconds: 0.7, promise: 'p', archetype: 'before-after' },
    direction: { oneLine: 'x', references: [{ kind: 'none', why: 't' }], banned: ['a', 'b', 'c'] },
    audio: { bpm: 120, sfx: [] }, storyboard: shots, build: { scene: 'scenes/main.html' }, approval: { mode: 'autopilot' }
  };
  const res = (brief) => checkBrief(root, brief);
  assert.ok(res(base).warnings.some((w) => w.code === 'concept-missing'));
  assert.ok(!res(base).errors.some((e) => e.code.startsWith('concept')));
  const todo = res({ ...base, concept: { ...concept(), archetype: 'TODO: pick one', device: 'TODO' } });
  assert.ok(todo.errors.some((e) => e.code === 'concept-unwritten'));
  assert.ok(!res({ ...base, concept: concept() }).errors.some((e) => e.code.startsWith('concept')));
  ok('checkBrief: concept-missing warns, TODO blocks, written passes');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 2. Diversity: four different films pass; a copy of the same skeleton is blocked.
const four = [
  { name: 'reader', concept: concept({ archetype: 'manifesto-typography', reference: 'Apple Think Different', musicStyle: 'solo-piano-waltz', typeStyle: 'serif', tempo: 72, palette: ['#F3EEE3', '#F08CA8'], camera: 'slow dolly', structure: 'poem → screenshots', duration: 41 }) },
  { name: 'rss', concept: concept({ archetype: 'kinetic-typography', reference: 'Nike kinetic type', musicStyle: 'trap-808', typeStyle: 'heavy', tempo: 140, palette: ['#FF5A1F', '#0A0A0A'], camera: 'hard cuts', structure: 'slams → flood', duration: 25 }) },
  { name: 'radio', concept: concept({ archetype: 'silhouette-dance', reference: 'Apple iPod Silhouette', musicStyle: 'funk-house', typeStyle: 'rounded', tempo: 128, palette: ['#FFD500', '#FF2D78'], camera: 'locked-off', structure: 'colour bars', duration: 31 }) },
  { name: 'agent', concept: concept({ archetype: 'spatial-flight', reference: 'Apple Vision Pro launch', musicStyle: 'cinematic-ambient', typeStyle: 'ultralight', tempo: 48, palette: ['#06050D', '#8B7CF6'], camera: 'one flight', structure: 'orb → vault', duration: 36 }) }
];
const good = diversityReport(four);
assert.equal(good.ok, true, JSON.stringify(good.errors));
ok('four different concepts pass');

const clones = four.map((f, i) => ({ name: `clone${i}`, concept: concept({ archetype: 'product-hero', reference: 'Apple product film', musicStyle: 'warm-piano', structure: 'hook → four features → trust → end', tempo: 120, duration: 31 }) }));
const bad = diversityReport(clones);
assert.equal(bad.ok, false);
for (const code of ['same-archetype', 'same-music', 'same-structure', 'same-reference']) assert.ok(bad.errors.some((e) => e.code === code), code);
assert.ok(bad.warnings.some((w) => w.code === 'close-tempo') && bad.warnings.some((w) => w.code === 'same-duration'));
ok('clones are blocked: same archetype / music / structure / reference (+ tempo and duration warnings)');

assert.equal(diversityReport([{ name: 'x', concept: null }, four[0]]).ok, false);
assert.equal(diversityReport([{ name: 'x', concept: concept({ reference: 'TODO: name one' }) }, four[1]]).ok, false);
ok('missing concept / reference blocks');

// 3. CLI: qcut motion diversity <dirs> exits non-zero on clones and zero on distinct films.
const dirs = [];
try {
  const base2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qcut-div-'));
  dirs.push(base2);
  const mk = (name, c) => { const d = path.join(base2, name); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'motion-brief.json'), JSON.stringify({ concept: c })); return d; };
  const a = mk('a', four[0].concept), b = mk('b', four[1].concept), c1 = mk('c1', clones[0].concept), c2 = mk('c2', clones[1].concept);
  const run = (...ps) => spawnSync(process.execPath, [QCUT, 'motion', 'diversity', ...ps, '--json'], { encoding: 'utf8' });
  assert.equal(run(a, b).status, 0);
  assert.equal(run(c1, c2).status, 1);
  ok('qcut motion diversity: exit 0 for distinct films, 1 for clones');
} finally {
  dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
}

process.stdout.write(`${JSON.stringify({ ok: true, checks }, null, 2)}\n`);
