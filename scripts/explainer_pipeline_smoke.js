#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  checkProject,
  duplicateCaptionFindings,
  initProject,
  lintAesthetics,
  materializeProductionSpec
} = require('./explainer_pipeline');
const { checkProductionSpec, defaultProductionSpec } = require('./explainer_spec');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-explainer-autopilot-'));
const realWorldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-real-world-visual-'));
try {
  const genericThirtySecondSpec = defaultProductionSpec('先进先出', 30);
  assert.equal(genericThirtySecondSpec.output.targetDuration, 30);
  assert.equal(genericThirtySecondSpec.output.duration, 28.5);
  assert.equal(genericThirtySecondSpec.cover.eyebrow, '概念科普');
  assert.equal(genericThirtySecondSpec.contractVersion, 5);
  assert.equal(genericThirtySecondSpec.visualEvidence.topicKind, 'abstract');
  const realWorldSpec = defaultProductionSpec('北京大学', 60);
  assert.equal(realWorldSpec.visualEvidence.topicKind, 'real-world');
  assert.equal(realWorldSpec.visualEvidence.imageSearchRequired, true);
  assert.equal(realWorldSpec.visualEvidence.minimumSourceImages, 3);
  assert.equal(realWorldSpec.scenes[0].component, 'evidence-photo');
  assert.equal(realWorldSpec.scenes[0].photoMotion, 'reveal-left');
  assert.equal(realWorldSpec.scenes[1].component, 'timeline-story');
  assert.equal(realWorldSpec.scenes[2].component, 'relationship-map');
  realWorldSpec.contentLocked = true;
  fs.writeFileSync(path.join(realWorldRoot, 'production-spec.json'), `${JSON.stringify(realWorldSpec, null, 2)}\n`);
  const missingRealWorldEvidence = checkProductionSpec(realWorldRoot, { noCache: true });
  assert.equal(missingRealWorldEvidence.ok, false);
  assert(missingRealWorldEvidence.repairPlan.some((item) => item.rule === 'image-search-queries'));
  assert(missingRealWorldEvidence.repairPlan.some((item) => item.rule === 'source-image-coverage'));
  assert(missingRealWorldEvidence.repairPlan.some((item) => item.rule === 'scene-image-asset'));
  realWorldSpec.scenes.filter((scene) => scene.component === 'evidence-photo').forEach((scene) => { scene.photoMotion = 'push-in'; });
  fs.writeFileSync(path.join(realWorldRoot, 'production-spec.json'), `${JSON.stringify(realWorldSpec, null, 2)}\n`);
  const monotonousPhotoMotion = checkProductionSpec(realWorldRoot, { noCache: true });
  assert.equal(monotonousPhotoMotion.ok, false);
  assert(monotonousPhotoMotion.repairPlan.some((item) => item.rule === 'photo-motion-diversity'));
  assert(monotonousPhotoMotion.repairPlan.some((item) => item.rule === 'photo-scale-forbidden'));
  const result = initProject(root, { topic: 'LLM 中的 RL', duration: 75 });
  assert.equal(result.ok, true);
  assert.equal(result.workflow, 'explainer-social');
  assert.equal(result.voiceName, '向阳乔木 v1.1');
  assert.equal(checkProject(root, 'init').ok, true);

  const plan = JSON.parse(fs.readFileSync(path.join(root, 'explainer-plan.json'), 'utf8'));
  assert.equal(plan.aesthetics.forbidLeftAccentBars, true);
  assert.equal(plan.aesthetics.forbidSimultaneousSceneCaptionEcho, true);
  assert.equal(plan.execution.renderHtmlViaImage2Pipe, true);
  assert.equal(plan.execution.reuseOneBrowserPerBatch, true);
  assert.equal(plan.execution.sharedContentAddressedSceneCache, true);
  assert.deepEqual(plan.execution.parallelAfterSpecLock, ['listenhub-narration', 'component-materialization', 'optional-image-assets']);
  assert.equal(plan.narration.format, 'mp3');
  const ir = JSON.parse(fs.readFileSync(path.join(root, 'qiaocut-ir.json'), 'utf8'));
  assert.equal(ir.workflow.id, 'explainer-social');
  assert.equal(ir.output.durationSeconds, 75);
  assert.equal(ir.generation.narration.preferredVoiceName, '向阳乔木 v1.1');
  assert(ir.style.visualBible.negativePrompt.some((item) => item.includes('vertical accent stripe')));
  fs.writeFileSync(path.join(root, 'narration.txt'), '作者内容不得被 init 覆盖');
  initProject(root, { topic: '另一个标题也不应覆盖已有工程' });
  assert.equal(fs.readFileSync(path.join(root, 'narration.txt'), 'utf8'), '作者内容不得被 init 覆盖');

  const productionSpecFile = path.join(root, 'production-spec.json');
  const productionSpec = JSON.parse(fs.readFileSync(productionSpecFile, 'utf8'));
  productionSpec.contentLocked = true;
  productionSpec.claims = [
    { text: '强化学习通过奖励信号优化策略。', sourceUrl: 'https://example.test/primary-source-1' },
    { text: '语言模型训练中的奖励来自可观测反馈。', sourceUrl: 'https://example.test/primary-source-2' }
  ];
  productionSpec.narrationSegments.forEach((segment, index) => {
    segment.text = `第${index + 1}段解释强化学习如何从环境反馈中调整策略，并说明它在语言模型中的作用边界。`;
  });
  productionSpec.scenes.forEach((scene, index) => {
    scene.cognitiveTask = `让观众理解第${index + 1}个概念在整体机制中的作用`;
    scene.title = `场景 ${index + 1}`;
    scene.keyword = `概念 ${index + 1}`;
    scene.body = '用图形关系解释机制。';
    scene.onScreenText = [`概念 ${index + 1}`];
    scene.captionText = `这一段补充第${index + 1}个机制的条件和原因`;
    scene.items = ['输入', '反馈', '更新'];
    scene.visibleChange = scene.purpose === 'mechanism'
      ? { kind: 'process', from: '输入与反馈彼此分离', to: '反馈驱动策略更新' }
      : { kind: 'none', from: '', to: '' };
    scene.visualMechanism = {
      kind: scene.visualMechanism.kind,
      input: `第${index + 1}段输入状态`,
      process: `第${index + 1}段因果过程`,
      output: `第${index + 1}段可见结果`
    };
  });
  const outroNarration = productionSpec.narrationSegments.find((segment) => segment.purpose === 'outro')
    || productionSpec.narrationSegments[productionSpec.narrationSegments.length - 1];
  const outroScene = productionSpec.scenes.find((scene) => scene.purpose === 'outro')
    || productionSpec.scenes[productionSpec.scenes.length - 1];
  // Intentional incomplete brand CTA for negative gate tests below.
  const mechanism = productionSpec.scenes.find((scene) => scene.purpose === 'mechanism');
  mechanism.visibleChange = { kind: 'none', from: '', to: '' };
  fs.writeFileSync(productionSpecFile, `${JSON.stringify(productionSpec, null, 2)}\n`);
  const missingChange = checkProject(root, 'spec');
  assert.equal(missingChange.ok, false);
  assert(missingChange.repairPlan.some((item) => item.rule === 'mechanism-without-change'));
  mechanism.visibleChange = { kind: 'process', from: '输入与反馈彼此分离', to: '反馈驱动策略更新' };
  fs.writeFileSync(productionSpecFile, `${JSON.stringify(productionSpec, null, 2)}\n`);
  const missingSpokenBrand = checkProject(root, 'spec');
  assert.equal(missingSpokenBrand.ok, false);
  assert(missingSpokenBrand.repairPlan.some((item) => item.rule === 'outro-spoken-brand-cta'));
  assert(missingSpokenBrand.repairPlan.some((item) => item.rule === 'outro-visual-brand-cta'));
  outroNarration.text = '所以看懂反馈循环，就看懂了大半对齐新闻。关注向阳乔木，继续拆解大模型关键词。';
  outroScene.keyword = '向阳乔木';
  outroScene.body = '@vista8 · 关注我，继续拆解大模型关键词';
  outroScene.onScreenText = ['向阳乔木', '@vista8 · 关注我，继续拆解大模型关键词'];
  outroScene.captionText = '看懂反馈循环，就看懂了对齐新闻的一半';
  fs.writeFileSync(productionSpecFile, `${JSON.stringify(productionSpec, null, 2)}\n`);
  const firstSpecCheck = checkProject(root, 'spec');
  assert.equal(firstSpecCheck.ok, true);
  assert.equal(firstSpecCheck.productionSpec.cacheHit, false);
  const secondSpecCheck = checkProject(root, 'spec');
  assert.equal(secondSpecCheck.productionSpec.cacheHit, true);
  const originalComponents = productionSpec.scenes.map((scene) => ({ component: scene.component, primaryFocus: scene.primaryFocus }));
  productionSpec.scenes.filter((scene) => scene.purpose !== 'outro').forEach((scene) => {
    scene.component = 'definition';
    scene.primaryFocus = 'focus-stage';
  });
  fs.writeFileSync(productionSpecFile, `${JSON.stringify(productionSpec, null, 2)}\n`);
  const monotonousSpec = checkProject(root, 'spec');
  assert.equal(monotonousSpec.ok, false);
  assert(monotonousSpec.repairPlan.some((item) => item.rule === 'component-diversity'));
  assert(monotonousSpec.repairPlan.some((item) => item.rule === 'explanatory-component-coverage'));
  assert(monotonousSpec.repairPlan.some((item) => item.rule === 'generic-card-overuse'));
  productionSpec.scenes.forEach((scene, index) => Object.assign(scene, originalComponents[index]));
  fs.writeFileSync(productionSpecFile, `${JSON.stringify(productionSpec, null, 2)}\n`);
  const materialized = materializeProductionSpec(root);
  assert.equal(materialized.generatedScenes, 7);
  assert(materialized.changed.includes('timeline.json'));
  assert.equal(materialized.cover && materialized.cover.id, 's00_cover');
  const coverScenePlan = JSON.parse(fs.readFileSync(path.join(root, 'scene-plan.json'), 'utf8'));
  assert.equal(coverScenePlan.scenes[0].id, 's00_cover');
  assert.equal(coverScenePlan.scenes[0].duration, 1.5);
  assert.equal(coverScenePlan.scenes.length, 8);
  assert.equal(coverScenePlan.scenes[3].cognitiveTask, '让观众理解第3个概念在整体机制中的作用');
  assert.equal(coverScenePlan.scenes[3].visibleChange.kind, 'process');
  const coverTimeline = JSON.parse(fs.readFileSync(path.join(root, 'timeline.json'), 'utf8'));
  assert.equal(coverTimeline.shots[0].id, 's00_cover');
  assert.equal(coverTimeline.narration.start, 1.5);
  assert.equal(coverTimeline.output.duration, 75);
  const coverCaptions = JSON.parse(fs.readFileSync(path.join(root, 'captions', 'captions.json'), 'utf8'));
  assert.equal(coverCaptions.events[0].start, 1.5);
  assert(fs.existsSync(path.join(root, 'scenes', 's00_cover.html')));
  const reusedMaterialization = materializeProductionSpec(root);
  assert.equal(reusedMaterialization.changed.length, 0);
  assert.equal(reusedMaterialization.reused, true);
  const scenePlan = JSON.parse(fs.readFileSync(path.join(root, 'scene-plan.json'), 'utf8'));
  assert.equal(checkProject(root, 'author').ok, true);

  const firstScene = path.join(root, scenePlan.scenes[0].source);
  fs.appendFileSync(firstScene, '<style>.callout{border-left:6px solid red}</style>');
  const aesthetics = lintAesthetics(root);
  assert(aesthetics.some((finding) => finding.rule === 'left-border-accent'));
  assert.equal(checkProject(root, 'author').ok, false);

  fs.writeFileSync(firstScene, '<!doctype html><meta charset="utf-8"><main class="card"><span>答案叫：</span><strong>知识蒸馏</strong></main>\n');
  fs.writeFileSync(path.join(root, 'captions', 'captions.json'), JSON.stringify({
    events: [{ start: 0, end: 2, style: 'Chinese', text: '答案叫：知识蒸馏' }]
  }));
  let duplicates = duplicateCaptionFindings(root);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].matchMode, 'visible-dom');
  const duplicateGate = checkProject(root, 'author');
  assert.equal(duplicateGate.ok, false);
  assert(duplicateGate.repairPlan.some((item) => item.rule === 'simultaneous-caption-echo'));

  fs.writeFileSync(firstScene, '<!doctype html><meta charset="utf-8"><main id="answer"></main><script>answer.innerHTML = `<span>答案叫：</span><strong>知识蒸馏</strong>`;</script>\n');
  duplicates = duplicateCaptionFindings(root);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].matchMode, 'dynamic-source');

  fs.writeFileSync(path.join(root, 'captions', 'captions.json'), JSON.stringify({
    events: [{ start: 70, end: 72, style: 'Chinese', text: '答案叫：知识蒸馏' }]
  }));
  assert.equal(duplicateCaptionFindings(root).length, 0);

  fs.writeFileSync(path.join(root, 'captions', 'captions.json'), JSON.stringify({
    events: [{ start: 0, end: 2, style: 'Chinese', text: '答案叫：知识蒸馏，它把能力迁移给学生模型' }]
  }));
  assert.equal(duplicateCaptionFindings(root).length, 0);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: ['target-duration-includes-cover', 'generic-topic-label', 'one-shot-init', 'production-spec-gate-cache', 'cognitive-contract-gate', 'visual-mechanism-contract', 'component-diversity-gate', 'generic-card-overuse-gate', 'real-world-image-discovery-gate', 'chart-semantics-contract', 'photo-motion-diversity-gate', 'deterministic-materialization', 'default-cover-shot', 'parallel-lanes-contract', 'left-accent-ban', 'short-split-copy-block', 'dynamic-copy-block', 'time-aware-copy-check', 'structured-repair-plan']
  }, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(realWorldRoot, { recursive: true, force: true });
}
