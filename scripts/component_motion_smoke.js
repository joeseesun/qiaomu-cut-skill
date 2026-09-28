#!/usr/bin/env node
'use strict';

/* component-runtime 动效冒烟：纯函数单测 + headless 浏览器行为断言 + 渲染帧差验证。 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const M = require('../assets/explainer-social/component-runtime.js');

// —— 1. 纯函数单测 ——
assert.equal(M.clamp01(2), 1);
assert.equal(M.clamp01(-1), 0);
assert.equal(M.easeOutExpo(0), 0);
assert.equal(M.easeOutExpo(1), 1);
assert.ok(M.easeOutExpo(0.3) > 0.85, 'easeOutExpo 应快速上升');
assert.ok(Math.abs(M.easeOutBack(0)) < 1e-9);
assert.ok(Math.abs(M.easeOutBack(1) - 1) < 1e-9);
assert.ok(M.easeOutBack(0.7) > 1, 'easeOutBack 应有回弹过冲');
assert.equal(M.smoothstep(0), 0);
assert.equal(M.smoothstep(0.5), 0.5);
assert.equal(M.smoothstep(1), 1);
assert.ok(Math.abs(M.seg(0.5, 0.3, 0.7) - 0.5) < 1e-9);
assert.equal(M.seg(0.1, 0.3, 0.7), 0);
assert.equal(M.seg(0.9, 0.3, 0.7), 1);

{
  const beats = M.parseBeats([
    { at: 1.2, action: 'activate', target: 2 },
    { at: 2.4, action: 'swap' },
    { at: 3.0, action: 'pulse' },
    { at: -1, action: 'pulse' },
    'garbage'
  ], 4000);
  assert.equal(beats.activate.get('2'), 0.3);
  assert.equal(beats.swapAt, 0.6);
  assert.deepEqual(beats.pulses, [0.75]);
  assert.deepEqual(M.parseBeats(null, 4000).pulses, []);
}
{
  const auto = M.activationWindow(1, 4, new Map());
  assert.ok(Math.abs(auto.start - (0.15 + 0.72 / 4)) < 1e-9);
  const override = M.activationWindow(1, 4, new Map([['1', 0.5]]));
  assert.equal(override.start, 0.5);
  assert.equal(override.span, 0.08);
  const swap = M.swapWindow(null);
  assert.equal(swap.start, 0.45);
  assert.equal(swap.end, 0.65);
  assert.equal(M.swapWindow(0.9).end, 0.95);
  assert.equal(M.pulseBoost(0.75, [0.75]), 1);
  assert.equal(M.pulseBoost(0.5, [0.75]), 0);
}
{
  // settle 磁吸微振：负值/超时为 0，峰值在动作完成后约 70ms 处
  assert.equal(M.settle(0), 0);
  assert.equal(M.settle(-10), 0);
  assert.equal(M.settle(1000), 0);
  assert.ok(M.settle(70) > 0.4, `settle(70) 应有明显振幅，实际 ${M.settle(70)}`);
  assert.ok(Math.abs(M.settle(300)) < 0.2, 'settle 应快速衰减');
}

// —— 2. 浏览器行为 + 渲染帧差 ——
if (!process.env.QIAOMU_PLAYWRIGHT_CORE) {
  const shared = path.join(os.homedir(), '.agents', 'skills', 'qiaomu-ai-access', 'node_modules', 'playwright-core');
  if (fs.existsSync(shared)) process.env.QIAOMU_PLAYWRIGHT_CORE = shared;
}

function resolvePlaywright() {
  const candidates = [
    process.env.QIAOMU_PLAYWRIGHT_CORE,
    'playwright-core',
    'playwright'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const loaded = require(candidate);
      if (loaded && loaded.chromium) return loaded;
    } catch (_) {}
  }
  return null;
}

function preferredBrowser() {
  const root = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (fs.existsSync(root)) {
    const directories = fs.readdirSync(root)
      .filter((name) => /^chromium_headless_shell-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
    for (const directory of directories) {
      for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell']) {
        const file = path.join(root, directory, rel);
        if (fs.existsSync(file)) return file;
      }
    }
  }
  for (const candidate of [process.env.QIAOMU_CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function fixtureHtml(payload) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=320, initial-scale=1"><link rel="stylesheet" href="base.css"><style>:root{--canvas-w:320px;--canvas-h:480px}</style><title>fixture</title></head><body><main class="frame" data-qiaocut-component></main><script>window.__QIAOCUT_SCENE__=${JSON.stringify(payload)};</script><script src="component-runtime.js"></script></body></html>
`;
}

function ffmpegDiff(ffmpeg, frameA, frameB) {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-nostats', '-i', frameA, '-i', frameB,
    '-filter_complex', 'blend=all_mode=difference,signalstats,metadata=mode=print', '-f', 'null', '-'
  ], { encoding: 'utf8' });
  const matches = [...`${result.stdout || ''}\n${result.stderr || ''}`.matchAll(/YAVG[=:]([\d.]+)/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

async function main() {
  const playwright = resolvePlaywright();
  const browserPath = preferredBrowser();
  assert.ok(playwright, 'playwright-core 不可用');
  assert.ok(browserPath, 'chrome-headless-shell 不可用');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaocut-motion-'));
  try {
    const assetsDir = path.join(__dirname, '..', 'assets', 'explainer-social');
    fs.mkdirSync(path.join(root, 'scenes'), { recursive: true });
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.copyFileSync(path.join(assetsDir, 'base.css'), path.join(root, 'scenes', 'base.css'));
    fs.copyFileSync(path.join(assetsDir, 'component-runtime.js'), path.join(root, 'scenes', 'component-runtime.js'));
    fs.writeFileSync(path.join(root, 'assets', 'photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><defs><linearGradient id="g"><stop stop-color="#143b44"/><stop offset="1" stop-color="#e1b64a"/></linearGradient></defs><rect width="800" height="1200" fill="url(#g)"/><circle cx="420" cy="760" r="180" fill="#f5efe3"/></svg>');

    const statePayload = {
      sceneId: 's_state', component: 'comparison', cognitiveTask: '看清前后状态差异',
      primaryFocus: 'focus-right', visibleChange: { kind: 'state', from: '随机噪声', to: '清晰图像' },
      eyebrow: '测试', title: '状态变形', leftLabel: '之前', leftValue: '随机噪声', rightLabel: '之后', rightValue: '清晰图像',
      durationMs: 2000
    };
    const processPayload = {
      sceneId: 's_process', component: 'pipeline', cognitiveTask: '理解分步处理流程',
      primaryFocus: 'focus-sequence', visibleChange: { kind: 'process', from: '原始输入', to: '最终结果' },
      eyebrow: '测试', title: '流程激活', items: ['输入', '编码', '注意力', '输出'],
      durationMs: 2000
    };
    const predictionPayload = {
      sceneId: 's_prediction', component: 'prediction-field', cognitiveTask: '看懂下一词概率竞争',
      primaryFocus: 'focus-stage', visibleChange: { kind: 'process', from: '多个候选 token', to: '最高概率 token 被选中' },
      visualMechanism: { kind: 'prediction', input: '上文', process: '候选概率竞争', output: '下一个 token' },
      eyebrow: '测试', title: '下一词预测', body: '大模型会继续说', keyword: '模型', items: ['模型|62', '世界|24', '答案|9'],
      durationMs: 2000
    };
    const optimizationPayload = {
      sceneId: 's_optimization', component: 'optimization-loop', cognitiveTask: '看懂损失如何驱动参数更新',
      primaryFocus: 'focus-stage', visibleChange: { kind: 'process', from: '预测误差', to: '损失下降' },
      visualMechanism: { kind: 'optimization', input: 'Token 批次', process: '前向与梯度回流', output: '更新后的参数' },
      eyebrow: '测试', title: '训练循环', keyword: '参数更新', items: ['Token', 'Embedding', 'Transformer', 'Logits', '预测'],
      durationMs: 2000
    };
    const refineryPayload = {
      sceneId: 's_refinery', component: 'filter-conveyor', cognitiveTask: '看懂混杂语料如何变成可训练数据',
      primaryFocus: 'focus-stage', visibleChange: { kind: 'process', from: '混杂语料', to: '干净语料' },
      visualMechanism: { kind: 'filtering', input: '原始网页', process: '去重过滤配比', output: '可训练语料' },
      eyebrow: '测试', title: '数据炼化', items: ['优质文本|keep', '重复网页|drop', '垃圾内容|drop', '代码文档|keep', '多语言|keep'],
      durationMs: 2000
    };
    const timelinePayload = {
      sceneId: 's_timeline', component: 'timeline-story', cognitiveTask: '看懂时间节点如何推进历史',
      primaryFocus: 'focus-timeline', visibleChange: { kind: 'process', from: '零散年份', to: '可读时间轴' },
      visualMechanism: { kind: 'timeline', input: '历史事件', process: '按时间排列', output: '发展路径' },
      eyebrow: '测试', title: '时间轴', body: '从起点到今天', items: ['1898|京师大学堂', '1912|改称北京大学', '2000|学科融合', '今天|继续生长'],
      durationMs: 2000
    };
    const relationshipPayload = {
      sceneId: 's_relationship', component: 'relationship-map', cognitiveTask: '看懂多学科如何围绕共同问题连接',
      primaryFocus: 'focus-network', visibleChange: { kind: 'process', from: '孤立学科', to: '交叉网络' },
      visualMechanism: { kind: 'relationship', input: '多个学科', process: '建立关系', output: '交叉创新' },
      eyebrow: '测试', title: '学科网络', keyword: '交叉创新', items: ['人文', '社科', '理学', '工学', '医学'],
      durationMs: 2000
    };
    const photoRevealPayload = {
      sceneId: 's_photo_reveal', component: 'evidence-photo', cognitiveTask: '通过方向性揭幕识别现场证据',
      primaryFocus: 'focus-photo', visibleChange: { kind: 'state', from: '照片隐藏', to: '照片完整显现' },
      visualMechanism: { kind: 'evidence', input: '现场照片', process: '从左向右揭幕', output: '完整证据' },
      eyebrow: '测试', title: '方向性揭幕', keyword: '现场证据', assetPath: '../assets/photo.svg', photoMotion: 'reveal-left',
      durationMs: 2000
    };
    const photoPanPayload = {
      ...photoRevealPayload, sceneId: 's_photo_pan', title: '纵向浏览', photoMotion: 'pan-up', assetObjectPosition: 'center bottom'
    };
    const photoFocusPayload = {
      ...photoRevealPayload, sceneId: 's_photo_focus', title: '焦点显现', photoMotion: 'rack-focus'
    };
    fs.writeFileSync(path.join(root, 'scenes', 'state.html'), fixtureHtml(statePayload));
    fs.writeFileSync(path.join(root, 'scenes', 'process.html'), fixtureHtml(processPayload));
    fs.writeFileSync(path.join(root, 'scenes', 'prediction.html'), fixtureHtml(predictionPayload));
    fs.writeFileSync(path.join(root, 'scenes', 'optimization.html'), fixtureHtml(optimizationPayload));
    fs.writeFileSync(path.join(root, 'scenes', 'refinery.html'), fixtureHtml(refineryPayload));
    fs.writeFileSync(path.join(root, 'scenes', 'timeline.html'), fixtureHtml(timelinePayload));
    fs.writeFileSync(path.join(root, 'scenes', 'relationship.html'), fixtureHtml(relationshipPayload));
    fs.writeFileSync(path.join(root, 'scenes', 'photo-reveal.html'), fixtureHtml(photoRevealPayload));
    fs.writeFileSync(path.join(root, 'scenes', 'photo-pan.html'), fixtureHtml(photoPanPayload));
    fs.writeFileSync(path.join(root, 'scenes', 'photo-focus.html'), fixtureHtml(photoFocusPayload));

    const browser = await playwright.chromium.launch({ executablePath: browserPath, headless: true });
    const pageErrors = [];
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 480 } });
      page.on('pageerror', (error) => pageErrors.push(String(error)));

      // state 场景：聚光压暗 + from→to 变形进度
      await page.goto(`file://${path.join(root, 'scenes', 'state.html')}`);
      const stateEarly = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(200); // progress 0.1
        return window.__QIAOCUT_REVIEW_STATE__;
      });
      assert.equal(stateEarly.focusFound, true);
      assert.equal(stateEarly.spotlight, true);
      const stateMid = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(800); // progress 0.4：swap 未开始
        return { review: window.__QIAOCUT_REVIEW_STATE__ };
      });
      assert.ok(stateMid.review.swapProgress === 0, 'swap 窗口前应未完成变形');
      const stateDim = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(1000); // progress 0.5：聚光完成
        const left = document.getElementById('focus-left');
        return Number(left.style.opacity);
      });
      assert.ok(stateDim < 0.35, `非焦点元素应被压暗，实际 ${stateDim}`);
      const stateLate = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(1600); // progress 0.8：swap 完成
        const to = document.querySelector('.state-to');
        return {
          review: window.__QIAOCUT_REVIEW_STATE__,
          toOpacity: Number(to.style.opacity),
          toText: to.textContent
        };
      });
      assert.ok(stateLate.review.swapProgress > 0.95, `swap 应接近完成，实际 ${stateLate.review.swapProgress}`);
      assert.ok(stateLate.toOpacity > 0.9, 'to 状态文本应可见');
      assert.equal(stateLate.toText, '清晰图像');

      // process 场景：步骤全程逐个激活，无死时间
      await page.goto(`file://${path.join(root, 'scenes', 'process.html')}`);
      const processEarly = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(400); // progress 0.2
        return window.__QIAOCUT_REVIEW_STATE__;
      });
      assert.equal(processEarly.focusFound, true);
      assert.ok(processEarly.activeSteps < processEarly.totalSteps, '早期不应全部激活');
      const processLate = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(1900); // progress 0.95
        return window.__QIAOCUT_REVIEW_STATE__;
      });
      assert.equal(processLate.activeSteps, processLate.totalSteps, '尾段应全部激活');
      const processMotion = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(1000);
        const a = document.querySelectorAll('.component-card')[2].style.opacity;
        window.__QIAOCUT_SET_TIME__(1700);
        const b = document.querySelectorAll('.component-card')[2].style.opacity;
        return { a: Number(a), b: Number(b) };
      });
      assert.ok(processMotion.b > processMotion.a, '中后段仍应有步骤激活变化（无死时间）');

      await page.goto(`file://${path.join(root, 'scenes', 'prediction.html')}`);
      const predictionLate = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(1700);
        return {
          review: window.__QIAOCUT_REVIEW_STATE__,
          answerOpacity: Number(document.querySelector('.prediction-answer').style.opacity),
          winner: document.getElementById('focus-winner').textContent
        };
      });
      assert.equal(predictionLate.review.componentMotionState.phase, 'winner-selected');
      assert.ok(predictionLate.answerOpacity > 0.9, '获胜 token 应填入上下文空位');
      assert.equal(predictionLate.winner, '模型');

      await page.goto(`file://${path.join(root, 'scenes', 'optimization.html')}`);
      const optimizationLate = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(1900);
        return window.__QIAOCUT_REVIEW_STATE__;
      });
      assert.equal(optimizationLate.componentMotionState.phase, 'loss-reduced');
      assert.ok(Number(optimizationLate.componentMotionState.loss) < 1, '梯度回流后损失应显著下降');

      await page.goto(`file://${path.join(root, 'scenes', 'refinery.html')}`);
      const refineryLate = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(1900);
        return window.__QIAOCUT_REVIEW_STATE__;
      });
      assert.equal(refineryLate.componentMotionState.phase, 'clean-corpus-ready');
      assert.ok(refineryLate.componentMotionState.kept > 0, '数据炼化后应有保留语料');

      await page.goto(`file://${path.join(root, 'scenes', 'timeline.html')}`);
      const timelineLate = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(1900);
        return window.__QIAOCUT_REVIEW_STATE__;
      });
      assert.equal(timelineLate.componentMotionState.phase, 'timeline-complete');
      assert.equal(timelineLate.componentMotionState.active, timelineLate.componentMotionState.total);

      await page.goto(`file://${path.join(root, 'scenes', 'relationship.html')}`);
      const relationshipLate = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(1900);
        return window.__QIAOCUT_REVIEW_STATE__;
      });
      assert.equal(relationshipLate.componentMotionState.phase, 'relationships-visible');
      assert.equal(relationshipLate.componentMotionState.nodes, 5);

      await page.goto(`file://${path.join(root, 'scenes', 'photo-reveal.html')}`);
      const revealMotion = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(200);
        const early = { clip: document.querySelector('.evidence-photo-image').style.clipPath, transform: document.querySelector('.evidence-photo-image').style.transform };
        window.__QIAOCUT_SET_TIME__(1800);
        const late = { clip: document.querySelector('.evidence-photo-image').style.clipPath, transform: document.querySelector('.evidence-photo-image').style.transform, focusTransform: document.getElementById('focus-photo').style.transform, motion: window.__QIAOCUT_REVIEW_STATE__.componentMotionState.motion };
        return { early, late };
      });
      assert.notEqual(revealMotion.early.clip, revealMotion.late.clip, 'reveal-left 应改变裁切范围');
      assert.equal(revealMotion.late.motion, 'reveal-left');
      assert(!/scale/.test(revealMotion.late.transform), 'reveal-left 不应偷偷缩放');
      assert(!/scale/.test(revealMotion.late.focusTransform), '图片外层焦点也不应缩放');

      await page.goto(`file://${path.join(root, 'scenes', 'photo-pan.html')}`);
      const panMotion = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(200);
        const early = document.querySelector('.evidence-photo-image').style.objectPosition;
        window.__QIAOCUT_SET_TIME__(1800);
        const image = document.querySelector('.evidence-photo-image');
        return { early, late: image.style.objectPosition, transform: image.style.transform, focusTransform: document.getElementById('focus-photo').style.transform };
      });
      assert.notEqual(panMotion.early, panMotion.late, 'pan-up 应改变 object-position');
      assert(!/scale/.test(panMotion.transform), 'pan-up 不应偷偷缩放');
      assert(!/scale/.test(panMotion.focusTransform), 'pan-up 图片外层焦点也不应缩放');

      await page.goto(`file://${path.join(root, 'scenes', 'photo-focus.html')}`);
      const focusMotion = await page.evaluate(() => {
        window.__QIAOCUT_SET_TIME__(200);
        const early = document.querySelector('.evidence-photo-image').style.filter;
        window.__QIAOCUT_SET_TIME__(1800);
        return { early, late: document.querySelector('.evidence-photo-image').style.filter };
      });
      assert.notEqual(focusMotion.early, focusMotion.late, 'rack-focus 应由虚到实');
    } finally {
      await browser.close();
    }
    assert.deepEqual(pageErrors, [], `页面错误: ${pageErrors.join('; ')}`);

    // 端到端渲染 + 帧差：start/mid/end 两两可分辨
    const run = (args) => {
      const result = spawnSync(process.execPath, [path.join(__dirname, 'qcut.js'), ...args], { env: process.env, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`qcut ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
      return JSON.parse(result.stdout);
    };
    const ffmpeg = [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', 'ffmpeg']
      .find((binary) => binary && spawnSync(binary, ['-v', 'error', '-version'], { stdio: 'ignore' }).status === 0);
    assert.ok(ffmpeg, 'ffmpeg 不可用');

    for (const name of ['state', 'process', 'prediction', 'optimization', 'refinery', 'timeline', 'relationship', 'photo-reveal', 'photo-pan', 'photo-focus']) {
      const rendered = run(['scene', 'render', root, `scenes/${name}.html`, '--engine', 'html', '--output', `assets/${name}.mp4`, '--duration', '1', '--width', '320', '--height', '480', '--fps', '8', '--json']);
      assert.equal(rendered.ok, true);
      const frames = [];
      for (const [label, seconds] of [['start', 0.05], ['mid', 0.5], ['end', 0.8]]) {
        const target = path.join(root, 'assets', `${name}-${label}.png`);
        const shot = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(root, rendered.output), '-ss', String(seconds), '-frames:v', '1', target], { encoding: 'utf8' });
        assert.equal(shot.status, 0, shot.stderr);
        frames.push(target);
      }
      const startEnd = ffmpegDiff(ffmpeg, frames[0], frames[2]);
      const startMid = ffmpegDiff(ffmpeg, frames[0], frames[1]);
      assert.ok(startEnd != null && startEnd > 2.0, `${name} 首尾帧差应 > 2.0，实际 ${startEnd}`);
      assert.ok(startMid != null && startMid > 1.0, `${name} 首中帧差应 > 1.0，实际 ${startMid}`);
    }

    process.stdout.write(`${JSON.stringify({ ok: true, unit: 'motion-math', scenes: ['comparison+state', 'pipeline+process', 'prediction-field', 'optimization-loop', 'filter-conveyor', 'timeline-story', 'relationship-map', 'photo-reveal', 'photo-pan', 'photo-focus'] }, null, 2)}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
