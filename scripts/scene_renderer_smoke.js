#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

if (!process.env.QIAOMU_PLAYWRIGHT_CORE) {
  const shared = path.join(os.homedir(), '.agents', 'skills', 'qiaomu-ai-access', 'node_modules', 'playwright-core');
  if (fs.existsSync(shared)) process.env.QIAOMU_PLAYWRIGHT_CORE = shared;
}

function run(args) {
  const cli = path.join(__dirname, 'qcut.js');
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) throw new Error(`qcut ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-scene-renderer-'));
try {
  fs.mkdirSync(path.join(root, 'scenes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scenes', 'concept.html'), `<!doctype html>
<meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#09090b}
.token{position:absolute;left:20px;top:180px;width:90px;height:44px;border-radius:12px;background:#facc15;
animation:move 1s linear both}@keyframes move{to{transform:translateX(170px);background:#38bdf8}}
</style><div class="token"></div>`);
  fs.writeFileSync(path.join(root, 'scenes', 'concept.py'), `from manim import *
class Concept(Scene):
    def construct(self):
        dot = Dot(color=YELLOW)
        self.play(dot.animate.shift(RIGHT), run_time=0.25)
`);
  const html = run([
    'scene', 'render', root, 'scenes/concept.html', '--engine', 'html',
    '--output', 'assets/html.mp4', '--duration', '0.3', '--width', '320', '--height', '480', '--fps', '6', '--json'
  ]);
  const { inspectSceneEngines } = require('./render_scene');
  const manimAvailable = inspectSceneEngines().manim.available;
  const manim = !manimAvailable ? null : run([
    'scene', 'render', root, 'scenes/concept.py', '--engine', 'manim', '--scene-class', 'Concept',
    '--output', 'assets/manim.mp4', '--duration', '0.3', '--width', '320', '--height', '480', '--fps', '12', '--json'
  ]);
  assert.equal(html.ok, true);
  if (manim) assert.equal(manim.ok, true);
  assert.equal(html.transport, 'image2pipe');
  assert.equal(html.browserMode, 'headless-only');
  assert.equal(html.intermediateFrameFiles, 0);
  assert.ok(fs.statSync(path.join(root, html.output)).size > 1024);
  if (manim) assert.ok(fs.statSync(path.join(root, manim.output)).size > 1024);
  process.stdout.write(`${JSON.stringify({ ok: true, engines: manim ? ['html', 'manim'] : ['html'], skipped: manim ? [] : ['manim: not installed (missing evidence)'] }, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
