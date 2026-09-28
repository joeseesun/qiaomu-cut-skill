#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkProject, initProject, lockNarrationTiming, materializeProductionSpec } = require('./explainer_pipeline');
const { generateProceduralMusic } = require('./renderers/procedural_music');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-cognitive-timing-'));
try {
  initProject(root, { topic: 'Token 如何形成', duration: 30 });
  const specFile = path.join(root, 'production-spec.json');
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  spec.contentLocked = true;
  spec.claims = [
    { text: 'Tokenizer 根据确定规则把文本映射为 token。', sourceUrl: 'https://example.test/tokenizer' },
    { text: 'Token 边界并不总等于自然语言单词边界。', sourceUrl: 'https://example.test/token-boundary' }
  ];
  spec.narrationSegments.forEach((segment, index) => {
    segment.text = `第${index + 1}段解释文本如何经过规则变成可处理的 token 序列，并指出边界条件。`;
  });
  spec.scenes.forEach((scene, index) => {
    scene.cognitiveTask = `让观众理解第${index + 1}段信息如何支持核心结论`;
    scene.title = `步骤 ${index + 1}`;
    scene.keyword = `Token ${index + 1}`;
    scene.body = '使用图形关系而不是重复字幕。';
    scene.items = ['文本', '边界', '序列'];
    scene.onScreenText = [`Token ${index + 1}`];
    scene.captionText = `补充第${index + 1}段的条件与原因`;
    scene.visibleChange = scene.purpose === 'mechanism'
      ? { kind: 'process', from: '完整文本尚未分段', to: '边界明确的 token 序列' }
      : { kind: 'none', from: '', to: '' };
    scene.visualMechanism = {
      kind: scene.visualMechanism.kind,
      input: `第${index + 1}段输入`,
      process: `第${index + 1}段处理`,
      output: `第${index + 1}段结果`
    };
  });
  const outroNarration = spec.narrationSegments.find((segment) => segment.purpose === 'outro')
    || spec.narrationSegments[spec.narrationSegments.length - 1];
  const outroScene = spec.scenes.find((scene) => scene.purpose === 'outro')
    || spec.scenes[spec.scenes.length - 1];
  outroNarration.text = '所以 token 不是单词本身。关注向阳乔木，继续拆解大模型关键词。';
  outroScene.keyword = '向阳乔木';
  outroScene.body = '@vista8 · 关注我，继续拆解大模型关键词';
  outroScene.onScreenText = ['向阳乔木', '@vista8 · 关注我，继续拆解大模型关键词'];
  outroScene.captionText = 'token 不是单词本身';
  fs.writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`);

  const audioRelative = 'assets/audio/narration.wav';
  generateProceduralMusic(path.join(root, audioRelative), { duration: 7, energy: 0.2, seed: 808 });
  const timing = lockNarrationTiming(root, audioRelative, { apply: true });
  assert.equal(timing.ok, true);
  assert.equal(timing.applied, true);
  assert.equal(timing.timingLevel, 'duration');
  assert.equal(timing.alignment.fallbackBoundaries, 6);
  assert.equal(timing.warnings.length, 1);

  const locked = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  assert.equal(locked.output.duration, 7);
  assert.equal(locked.timing.level, 'duration');
  assert.match(locked.timing.audioSha256, /^[a-f0-9]{64}$/);
  assert(Math.abs(locked.scenes.reduce((sum, scene) => sum + scene.duration, 0) - 7) < 0.001);
  assert.equal(checkProject(root, 'spec').ok, true);

  const materialized = materializeProductionSpec(root);
  assert.equal(materialized.ok, true);
  const timeline = JSON.parse(fs.readFileSync(path.join(root, 'timeline.json'), 'utf8'));
  assert.equal(timeline.narration.timingContract, 'narration-timing.json');
  assert.equal(timeline.narration.timingLevel, 'duration');
  assert.equal(timeline.output.duration, 8.5);
  timeline.narration = {
    engine: 'file',
    path: audioRelative,
    provider: 'macos-say',
    speakerName: 'Tingting'
  };
  fs.writeFileSync(path.join(root, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  const wrongVoice = checkProject(root, 'author');
  assert.equal(wrongVoice.ok, false);
  assert(wrongVoice.repairPlan.some((item) => item.rule === 'narration-voice-contract'));
  assert(wrongVoice.errors.some((item) => item.includes('expected provider listenhub')));
  assert(wrongVoice.errors.some((item) => item.includes('expected exact speakerName 向阳乔木 v1.1')));
  timeline.narration = {
    engine: 'file',
    path: audioRelative,
    provider: 'listenhub',
    assetId: 'listenhub-narration-fixture',
    speakerId: 'speaker-xiangyang-qiaomu',
    speakerName: '向阳乔木 v1.1',
    narrationTextSha256: 'a'.repeat(64)
  };
  fs.writeFileSync(path.join(root, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  assert.equal(checkProject(root, 'author').ok, true);
  const scenePlan = JSON.parse(fs.readFileSync(path.join(root, 'scene-plan.json'), 'utf8'));
  const mechanism = scenePlan.scenes.find((scene) => scene.purpose === 'mechanism');
  assert.equal(mechanism.visibleChange.kind, 'process');
  assert.equal(mechanism.primaryFocus, 'focus-gradient');
  assert.equal(mechanism.visualMechanism.kind, 'optimization');
  const mechanismHtml = fs.readFileSync(path.join(root, mechanism.source), 'utf8');
  assert.match(mechanismHtml, /cognitiveTask/);
  assert.match(mechanismHtml, /完整文本尚未分段/);
  assert.match(fs.readFileSync(path.join(root, 'scenes', 'component-runtime.js'), 'utf8'), /__QIAOCUT_REVIEW_STATE__/);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: ['cognitive-contract-materialized', 'visual-mechanism-materialized', 'real-audio-duration-measured', 'duration-level-fallback-explicit', 'timing-contract-hash', 'timeline-timing-reference', 'default-voice-contract-gate']
  }, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
