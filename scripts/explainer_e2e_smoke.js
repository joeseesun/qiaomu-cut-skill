#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { initProject } = require('./explainer_pipeline');

function run(args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'qcut.js'), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-explainer-e2e-'));
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-explainer-e2e-shared-'));
const sharedCache = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-shared-scenes-'));
process.env.QIAOMU_CUT_SHARED_CACHE = sharedCache;
function lockSpec(project) {
  const file = path.join(project, 'production-spec.json');
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  spec.contentLocked = true;
  spec.claims = [
    { text: '强化学习根据奖励更新策略。', sourceUrl: 'https://example.test/a' },
    { text: '语言模型使用可观测反馈信号。', sourceUrl: 'https://example.test/b' }
  ];
  spec.narrationSegments.forEach((item, index) => { item.text = `第${index + 1}段说明强化学习从反馈中更新策略，并解释语言模型训练中的使用边界。`; });
  spec.scenes.forEach((scene, index) => {
    scene.cognitiveTask = `让观众理解第${index + 1}段机制的核心作用`;
    scene.title = `场景 ${index + 1}`;
    scene.keyword = `机制 ${index + 1}`;
    scene.onScreenText = [`机制 ${index + 1}`];
    scene.captionText = `补充第${index + 1}个机制的条件`;
    scene.visibleChange = scene.purpose === 'mechanism'
      ? { kind: 'process', from: '反馈尚未进入更新环路', to: '反馈驱动策略更新' }
      : { kind: 'none', from: '', to: '' };
    scene.visualMechanism = {
      kind: scene.visualMechanism.kind,
      input: `第${index + 1}段输入`,
      process: `第${index + 1}段处理`,
      output: `第${index + 1}段结果`
    };
  });
  const outroNarration = spec.narrationSegments.find((item) => item.purpose === 'outro')
    || spec.narrationSegments[spec.narrationSegments.length - 1];
  const outroScene = spec.scenes.find((scene) => scene.purpose === 'outro')
    || spec.scenes[spec.scenes.length - 1];
  outroNarration.text = '所以看懂反馈循环，就看懂了对齐新闻。关注向阳乔木，继续拆解大模型关键词。';
  outroScene.keyword = '向阳乔木';
  outroScene.body = '@vista8 · 关注我，继续拆解大模型关键词';
  outroScene.onScreenText = ['向阳乔木', '@vista8 · 关注我，继续拆解大模型关键词'];
  outroScene.captionText = '看懂反馈循环，就看懂了对齐新闻';
  fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
}
function writeFixture(project) {
  initProject(project, { topic: 'LLM 中的 RL', duration: 75 });
  lockSpec(project);
  run(['explainer', 'materialize', project, '--json']);
  fs.writeFileSync(path.join(project, 'narration.txt'), '强化学习从环境反馈中更新策略，而不是复制一个固定答案。'.repeat(12));
  fs.writeFileSync(path.join(project, 'research.md'), '# Research\n\n原始资料：https://example.test/primary\n'.repeat(4));
  fs.writeFileSync(path.join(project, 'storyboard.md'), '# Storyboard\n\n状态、动作、奖励和策略逐步出现。\n'.repeat(6));
  fs.writeFileSync(path.join(project, 'captions', 'captions.json'), '{"events":[]}\n');

  const colors = ['#0d0f12', '#101313', '#20252a', '#28332f', '#342b28', '#162d32'];
  const scenes = colors.map((color, index) => {
    const id = index === 0 ? 's00_cover' : `s0${index}`;
    const label = index === 0 ? 'COVER' : `SCENE ${index}`;
    const source = `scenes/${id}.html`;
    fs.writeFileSync(path.join(project, source), `<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${color};color:white;font-family:sans-serif}.t{padding:28px;font-size:34px}</style><div class="t">${label}</div>`);
    return { id, purpose: index === 0 ? 'cover' : 'fixture', source, engine: 'html', output: `assets/scenes/${id}.mp4`, duration: 0.5, dependencies: [] };
  });
  fs.writeFileSync(path.join(project, 'scene-plan.json'), JSON.stringify({ schema: 'qiaocut.explainer-scenes.v1', output: { width: 320, height: 480, fps: 6, duration: 3.0 }, scenes }, null, 2));
  fs.writeFileSync(path.join(project, 'timeline.json'), JSON.stringify({
    schema: 'qiaocut.timeline.v1', title: 'Explainer autopilot E2E',
    output: { width: 320, height: 480, fps: 6, duration: 3.0, file: 'renders/final.mp4' },
    narration: { engine: 'none' }, music: { mode: 'procedural', path: 'assets/audio/original-score.wav', bpm: 88, seed: 606, energy: 0.2 },
    reports: { contactSheet: false, renderReport: 'reports/render-report.json' },
    shots: scenes.map((scene) => ({ id: scene.id, kind: 'video', path: scene.output, duration: 0.5, fit: 'cover', sourceAudio: false }))
  }, null, 2));
}
try {
  writeFixture(root);

  const preview = run(['explainer', 'preview', root, '--json']);
  assert.equal(preview.ok, true);
  assert.equal(preview.scenes.rendered.length, 6);
  assert(preview.scenes.rendered.every((scene) => scene.transport === 'image2pipe'));
  assert.equal(preview.scenes.browserBatches, 1);
  assert.equal(preview.scenes.browserLaunches, 1);
  assert.equal(preview.report.profile, 'preview');
  assert.equal(preview.sceneReview.pending, 6);
  assert.equal(preview.sceneReview.generatedFrames, 18);
  assert.equal(fs.existsSync(path.join(root, 'reports', 'scene-review.json')), true);
  const repeatedPreview = run(['explainer', 'preview', root, '--json']);
  assert.equal(repeatedPreview.reportReused, true);
  assert.equal(repeatedPreview.validationReused, true);

  writeFixture(root2);
  const shared = run(['explainer', 'render-scenes', root2, '--json']);
  assert.equal(shared.shared.length, 6);
  assert.equal(shared.browserLaunches, 0);

  fs.writeFileSync(path.join(root, 'reports', 'autopilot-review.json'), JSON.stringify({
    content: true,
    narrationSync: true,
    captionSafety: true,
    noCaptionEcho: true,
    composition: true,
    audioBalance: true,
    contactSheetReviewed: true
  }));
  const final = run(['explainer', 'final', root, '--json']);
  assert.equal(final.ok, true);
  assert.equal(final.scenes.cached.length, 6);
  assert.equal(final.report.releaseReady, true);
  assert.equal(fs.existsSync(path.join(root, 'renders', 'final.mp4')), true);
  assert.equal(final.coverPng, 'cover.png');
  assert.equal(fs.existsSync(path.join(root, 'cover.png')), true);
  const repeatedFinal = run(['explainer', 'final', root, '--json']);
  assert.equal(repeatedFinal.reportReused, true);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    previewProfile: preview.report.profile,
    finalReleaseReady: final.report.releaseReady,
    sceneTransport: 'image2pipe',
    finalSceneCacheHits: final.scenes.cached.length,
    browserLaunchesForSixScenes: preview.scenes.browserLaunches,
    crossProjectSceneHits: shared.shared.length,
    coverPngExported: final.coverPng === 'cover.png',
    unchangedValidationReused: repeatedFinal.validationReused
  }, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(root2, { recursive: true, force: true });
  fs.rmSync(sharedCache, { recursive: true, force: true });
}
