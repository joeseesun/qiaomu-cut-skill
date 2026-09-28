#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  checkProductionSpec,
  defaultProductionSpec,
  materializeProductionSpec
} = require('./explainer_spec');
const { lockNarrationTiming } = require('./explainer_timing');
const {
  readManifest,
  restore: restoreSharedScene,
  sceneContentKey,
  sharedCacheRoot,
  store: storeSharedScene,
  writeManifest
} = require('./scene_content_cache');

class UsageError extends Error {}

const SKILL_ROOT = path.resolve(__dirname, '..');
const QCUT = path.join(__dirname, 'qcut.js');
const SCENE_RENDERER = path.join(__dirname, 'render_scene.js');
const PROJECT_RENDERER = path.join(__dirname, 'render_project.js');
const TEMPLATE_ROOT = path.join(SKILL_ROOT, 'assets', 'explainer-social');
const DEFAULT_VOICE = '向阳乔木 v1.1';
const DEFAULT_DURATION = 75;
const STAGES = ['init', 'spec', 'author', 'scenes', 'preview', 'final'];

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const booleans = new Set(['apply', 'force', 'json']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const equal = token.indexOf('=');
    const key = token.slice(2, equal > 2 ? equal : undefined);
    if (booleans.has(key)) {
      if (equal > 2) throw new UsageError(`--${key} is a bare boolean flag.`);
      flags[key] = true;
      continue;
    }
    if (equal > 2) {
      flags[key] = token.slice(equal + 1);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new UsageError(`--${key} requires a value.`);
    flags[key] = value;
    index += 1;
  }
  return { positional, flags };
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function projectPath(root, relative, label, exists = false) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a non-empty project-relative path.`);
  }
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute)) throw new Error(`${label} escapes the project directory.`);
  if (exists && !fs.existsSync(absolute)) throw new Error(`${label} not found: ${relative}`);
  return absolute;
}

function relative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function writeGenerated(file, content, force = false) {
  if (fs.existsSync(file) && !force) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

function readJson(file, label = path.basename(file)) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function runNodeJson(script, args, label) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${label} failed.${detail ? `\n${detail.slice(-12000)}` : ''}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} did not return valid JSON.${result.stdout ? `\n${result.stdout.slice(-4000)}` : ''}`);
  }
}

function defaultScenePlan(duration) {
  const ratio = duration / DEFAULT_DURATION;
  const scene = (id, purpose, source, engine, seconds, sceneClass) => ({
    id,
    purpose,
    source,
    engine,
    output: `assets/scenes/${id}.mp4`,
    duration: Number((seconds * ratio).toFixed(3)),
    dependencies: engine === 'html' || engine === 'svg' ? ['scenes/base.css'] : [],
    ...(sceneClass ? { sceneClass } : {})
  });
  return {
    schema: 'qiaocut.explainer-scenes.v1',
    output: { width: 1080, height: 1920, fps: 24, duration },
    render: { htmlTransport: 'image2pipe', sequential: true, cacheUnchangedScenes: true },
    scenes: [
      scene('s01_hook', 'hook', 'scenes/s01_hook.html', 'html', 7),
      scene('s02_definition', 'definition', 'scenes/s02_definition.html', 'html', 16),
      scene('s03_mechanism', 'mechanism', 'scenes/s03_mechanism.py', 'manim', 16, 'Mechanism'),
      scene('s04_practice', 'modern-practice', 'scenes/s04_practice.html', 'html', 11),
      scene('s05_benefits', 'benefits', 'scenes/s05_benefits.html', 'html', 8),
      scene('s06_limits', 'limits', 'scenes/s06_limits.html', 'html', 9),
      scene('s07_outro', 'outro', 'scenes/s07_outro.html', 'html', 8)
    ]
  };
}

function initProject(projectRoot, flags) {
  const topic = String(flags.topic || flags.brief || '').trim();
  if (!topic) throw new UsageError('explainer init requires --topic "主题".');
  const duration = Number(flags.duration || DEFAULT_DURATION);
  if (!Number.isFinite(duration) || duration < 30 || duration > 180) {
    throw new UsageError('--duration must be between 30 and 180 seconds.');
  }
  const voiceName = String(flags['voice-name'] || DEFAULT_VOICE).trim();
  const brief = String(flags.brief || `制作一个科普视频：介绍${topic}`).trim();
  fs.mkdirSync(projectRoot, { recursive: true });

  const ir = path.join(projectRoot, 'qiaocut-ir.json');
  if (!fs.existsSync(ir)) {
    runNodeJson(QCUT, [
      'scaffold', projectRoot, '--brief', brief, '--workflow', 'explainer-social',
      '--duration', String(duration), '--format', '9:16', '--json'
    ], 'explainer scaffold');
  }

  for (const directory of ['assets/audio', 'assets/scenes', 'captions', 'reports', 'renders', 'scenes']) {
    fs.mkdirSync(path.join(projectRoot, directory), { recursive: true });
  }
  const created = [];
  const copyTemplate = (name, destination) => {
    const target = path.join(projectRoot, destination);
    if (fs.existsSync(target)) return;
    fs.copyFileSync(path.join(TEMPLATE_ROOT, name), target);
    created.push(destination);
  };
  copyTemplate('base.css', 'scenes/base.css');
  copyTemplate('scene-shell.html', 'scenes/scene-shell.html');
  copyTemplate('component-runtime.js', 'scenes/component-runtime.js');

  const plan = {
    schema: 'qiaocut.explainer-autopilot.v1',
    createdAt: new Date().toISOString(),
    topic,
    brief,
    workflow: 'explainer-social',
    output: { aspect: '9:16', width: 1080, height: 1920, fps: 24, targetDuration: duration },
    narration: { provider: 'listenhub', voiceName, format: 'mp3', exactMatchRequired: true },
    content: {
      structure: ['hook', 'definition', 'mechanism', 'modern-practice', 'benefits', 'limits', 'outro'],
      requirePrimarySources: true,
      requireCognitiveSceneContract: true,
      cognitiveContractFields: ['cognitiveTask', 'primaryFocus', 'visibleChange'],
      doNotEquateHiddenReasoningWithAvailableTrainingSignals: true
    },
    aesthetics: {
      forbidLeftAccentBars: true,
      hierarchyMethods: ['spacing', 'scale', 'alignment', 'complete outlines', 'tonal surfaces', 'motion'],
      forbidNarrationCardSubtitleDuplication: true,
      forbidSimultaneousSceneCaptionEcho: true,
      copyOwnership: 'one visual owner per information unit'
    },
    execution: {
      productionSpecBeforePaidGeneration: true,
      parallelAfterSpecLock: ['listenhub-narration', 'component-materialization', 'optional-image-assets'],
      renderHtmlViaImage2Pipe: true,
      reuseOneBrowserPerBatch: true,
      sharedContentAddressedSceneCache: true,
      cacheUnchangedValidation: true,
      renderScenesSequentially: true,
      measureNarrationBeforeFinalTiming: true,
      generateStartEndSceneReview: true,
      previewBeforeFinal: true,
      requireManualContactSheetReview: true,
      finalValidation: 'full'
    }
  };
  const files = {
    'explainer-plan.json': `${JSON.stringify(plan, null, 2)}\n`,
    'production-spec.json': `${JSON.stringify(defaultProductionSpec(topic, duration), null, 2)}\n`,
    'scene-plan.json': `${JSON.stringify(defaultScenePlan(duration), null, 2)}\n`,
    'narration.txt': '',
    'research.md': `# ${topic}：事实核验\n\n## 核心事实\n\n- 待写。\n\n## 一手来源\n\n1. 待加入论文、官方文档或原始资料链接。\n`,
    'storyboard.md': `# ${topic}：分镜\n\n按 hook → definition → mechanism → modern practice → benefits → limits → outro 展开。\n`,
    'captions/captions.json': `${JSON.stringify({ title: topic, font: 'Noto Sans CJK SC', events: [] }, null, 2)}\n`,
    'reports/autopilot-review.template.json': `${JSON.stringify({
      content: false,
      narrationSync: false,
      captionSafety: false,
      noCaptionEcho: false,
      composition: false,
      audioBalance: false,
      contactSheetReviewed: false,
      notes: 'Use reports/scene-review.json start/mid/end evidence before approving content and composition.'
    }, null, 2)}\n`
  };
  for (const [name, content] of Object.entries(files)) {
    if (writeGenerated(path.join(projectRoot, name), content, false)) created.push(name);
  }
  return {
    ok: true,
    project: projectRoot,
    topic,
    workflow: 'explainer-social',
    voiceName,
    created,
    next: [
      'Complete production-spec.json and set contentLocked=true.',
      'Run qcut explainer check <project> --stage spec --json before paid generation.',
      'Start ListenHub narration and qcut explainer materialize in parallel.',
      'Run qcut explainer timing <project> --audio <project-relative-audio> --apply, then materialize timing-dependent files.',
      'Run qcut explainer preview <project> --json.'
    ]
  };
}

function walkFiles(directory, extensions, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, extensions, result);
    else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) result.push(absolute);
  }
  return result;
}

function normalizeVisibleText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\[\[|\]\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function normalizeSceneSourceText(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\[\[|\]\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function lintAesthetics(projectRoot) {
  const findings = [];
  const sources = walkFiles(path.join(projectRoot, 'scenes'), new Set(['.html', '.htm', '.css', '.svg']));
  const rules = [
    { id: 'left-border-accent', pattern: /border-left\s*:/gi, message: 'Do not use border-left as a colored block/card accent.' },
    { id: 'logical-left-border-accent', pattern: /border-inline-start\s*:/gi, message: 'Do not use border-inline-start as a block/card accent.' },
    { id: 'named-left-accent', pattern: /(?:left[-_ ]?(?:accent|stripe|rail)|accent[-_ ]?bar|vertical[-_ ]?accent)/gi, message: 'Do not create a named left accent/stripe component.' }
  ];
  for (const file of sources) {
    const content = fs.readFileSync(file, 'utf8');
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(content))) {
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        findings.push({ rule: rule.id, file: relative(projectRoot, file), line, message: rule.message });
      }
    }
  }
  return findings;
}

function captionEvents(projectRoot) {
  const file = path.join(projectRoot, 'captions', 'captions.json');
  if (!fs.existsSync(file)) return [];
  const document = readJson(file, 'captions/captions.json');
  const events = [];
  const add = (text, item, track) => {
    if (!text) return;
    events.push({
      text,
      start: Number(item && item.start),
      end: Number(item && item.end),
      track
    });
  };
  for (const event of document.events || []) {
    const text = event && (event.text || (Array.isArray(event.segments)
      ? event.segments.map((segment) => segment && segment.text || '').join('')
      : ''));
    add(text, event, 'events');
  }
  for (const cue of document.cues || []) {
    for (const key of ['english', 'chinese', 'note']) if (cue && cue[key]) add(cue[key], cue, `cues.${key}`);
  }
  return events;
}

function meaningfulDuplicateText(normalized) {
  const hanCount = (normalized.match(/\p{Script=Han}/gu) || []).length;
  if (hanCount >= 4) return true;
  return (normalized.match(/[\p{L}\p{N}]/gu) || []).length >= 10;
}

function intervalsOverlap(caption, scene) {
  if (![caption.start, caption.end, scene.start, scene.end].every(Number.isFinite)) return true;
  return caption.start < scene.end && scene.start < caption.end;
}

function sceneTextWindows(projectRoot) {
  const sceneDirectory = path.join(projectRoot, 'scenes');
  const sourceFiles = walkFiles(sceneDirectory, new Set(['.html', '.htm', '.svg']));
  const planned = new Set();
  const windows = [];
  const scenePlanFile = path.join(projectRoot, 'scene-plan.json');
  if (fs.existsSync(scenePlanFile)) {
    const plan = readJson(scenePlanFile, 'scene-plan.json');
    let cursor = 0;
    for (const scene of plan.scenes || []) {
      const duration = Number(scene.duration);
      const explicitStart = Number(scene.start);
      const start = Number.isFinite(explicitStart) ? explicitStart : cursor;
      const end = Number.isFinite(duration) && duration > 0 ? start + duration : NaN;
      cursor = Number.isFinite(end) ? end : cursor;
      if (!scene.source || !['.html', '.htm', '.svg'].includes(path.extname(scene.source).toLowerCase())) continue;
      const file = projectPath(projectRoot, scene.source, `${scene.id || 'scene'} source`);
      if (!fs.existsSync(file)) continue;
      planned.add(path.resolve(file));
      const content = fs.readFileSync(file, 'utf8');
      windows.push({
        id: scene.id || null,
        file,
        start,
        end,
        visibleText: normalizeVisibleText(content),
        sourceText: normalizeSceneSourceText(content)
      });
    }
  }
  for (const file of sourceFiles) {
    if (planned.has(path.resolve(file))) continue;
    const content = fs.readFileSync(file, 'utf8');
    windows.push({
      id: null,
      file,
      start: NaN,
      end: NaN,
      visibleText: normalizeVisibleText(content),
      sourceText: normalizeSceneSourceText(content)
    });
  }
  return windows;
}

function duplicateCaptionFindings(projectRoot) {
  const scenes = sceneTextWindows(projectRoot);
  const ignored = new Set(['向阳乔木', '关注我', 'llm关键词', '概念科普']);
  const findings = [];
  for (const caption of captionEvents(projectRoot)) {
    const normalized = normalizeVisibleText(caption.text);
    if (!meaningfulDuplicateText(normalized) || ignored.has(normalized)) continue;
    for (const scene of scenes) {
      if (!intervalsOverlap(caption, scene)) continue;
      const matchMode = scene.visibleText.includes(normalized)
        ? 'visible-dom'
        : scene.sourceText.includes(normalized) ? 'dynamic-source' : null;
      if (matchMode) {
        findings.push({
          caption: caption.text,
          captionStart: Number.isFinite(caption.start) ? caption.start : null,
          captionEnd: Number.isFinite(caption.end) ? caption.end : null,
          sceneId: scene.id,
          sceneStart: Number.isFinite(scene.start) ? scene.start : null,
          sceneEnd: Number.isFinite(scene.end) ? scene.end : null,
          matchMode,
          file: relative(projectRoot, scene.file),
          message: 'The same on-screen copy and burned caption appear at the same time; assign this information to one visual owner.'
        });
      }
    }
  }
  return findings;
}

function freeDiskBytes(projectRoot) {
  if (typeof fs.statfsSync !== 'function') return null;
  const stat = fs.statfsSync(projectRoot);
  return Number(stat.bavail) * Number(stat.bsize);
}

function reviewPassed(projectRoot) {
  const file = path.join(projectRoot, 'reports', 'autopilot-review.json');
  if (!fs.existsSync(file)) return false;
  const review = readJson(file, 'reports/autopilot-review.json');
  return ['content', 'narrationSync', 'captionSafety', 'noCaptionEcho', 'composition', 'audioBalance', 'contactSheetReviewed']
    .every((key) => review[key] === true);
}

function sceneReviewStatus(projectRoot) {
  const file = path.join(projectRoot, 'reports', 'scene-review.json');
  if (!fs.existsSync(file)) return { exists: false, approved: false, pending: 0, file: 'reports/scene-review.json' };
  const report = readJson(file, 'reports/scene-review.json');
  const pending = (report.scenes || []).filter((scene) => !Object.values(scene.checks || {}).every((value) => value === true)).length;
  return { exists: true, approved: pending === 0 && (report.scenes || []).length > 0, pending, file: 'reports/scene-review.json' };
}

function lockedNarrationVoiceContract(projectRoot, specDoc) {
  const errors = [];
  const repairs = [];
  const hasLockedNarration = specDoc.timing && specDoc.timing.contract
    && Array.isArray(specDoc.narrationSegments)
    && specDoc.narrationSegments.some((segment) => String(segment && segment.text || '').trim().length >= 8);
  if (!hasLockedNarration) return { errors, repairs };

  const timelineFile = path.join(projectRoot, 'timeline.json');
  if (!fs.existsSync(timelineFile)) return { errors, repairs };
  const timelineDoc = readJson(timelineFile, 'timeline.json');
  const narration = timelineDoc.narration || {};
  const planFile = path.join(projectRoot, 'explainer-plan.json');
  const plan = fs.existsSync(planFile) ? readJson(planFile, 'explainer-plan.json') : {};
  const contract = plan.narration || {};
  const expectedProvider = String(contract.provider || 'listenhub');
  const expectedVoice = String(contract.voiceName || DEFAULT_VOICE).normalize('NFKC').trim();
  const exactMatchRequired = contract.exactMatchRequired !== false;

  let repairAdded = false;
  const fail = (message) => {
    errors.push(`timeline.json: ${message}`);
    if (!repairAdded) {
      repairs.push({
        rule: 'narration-voice-contract',
        node: 'timeline.narration',
        action: `Generate narration through qcut listenhub narration with the exact voice ${expectedVoice}, then apply its provenance-rich timelineNarration object. Do not silently substitute macOS say or another voice.`,
        invalidates: ['narration', 'narration-timing', 'captions', 'scene-durations', 'timeline', 'preview', 'final'],
        preserves: ['research', 'scene-sources', 'paid-assets-unrelated-to-narration']
      });
      repairAdded = true;
    }
  };

  if (narration.engine === 'none') {
    fail('narration.engine is still "none" although production-spec narration is timing-locked.');
    return { errors, repairs };
  }
  if (!exactMatchRequired) return { errors, repairs };
  if (narration.engine !== 'file') {
    fail(`the exact ${expectedVoice} contract requires narration.engine="file".`);
    return { errors, repairs };
  }
  if (String(narration.provider || '') !== expectedProvider) {
    fail(`expected provider ${expectedProvider}, got ${narration.provider || 'missing'}.`);
  }
  if (String(narration.speakerName || '').normalize('NFKC').trim() !== expectedVoice) {
    fail(`expected exact speakerName ${expectedVoice}, got ${narration.speakerName || 'missing'}.`);
  }
  if (!narration.assetId || !narration.speakerId || !narration.narrationTextSha256) {
    fail('exact ListenHub narration requires assetId, speakerId, and narrationTextSha256 provenance.');
  }
  return { errors, repairs };
}

function checkProject(projectRoot, stage = 'author') {
  if (!STAGES.includes(stage)) throw new UsageError(`--stage must be one of ${STAGES.join(', ')}.`);
  const errors = [];
  const warnings = [];
  const requireFile = (name, minimumBytes = 1) => {
    const file = path.join(projectRoot, name);
    if (!fs.existsSync(file)) errors.push(`${name}: missing`);
    else if (fs.statSync(file).size < minimumBytes) errors.push(`${name}: empty or incomplete`);
    return file;
  };
  const repairPlan = [];
  for (const name of ['qiaocut-ir.json', 'explainer-plan.json', 'scene-plan.json', 'assets-manifest.json', 'scenes/base.css', 'scenes/component-runtime.js', 'production-spec.json']) {
    requireFile(name);
  }
  const stageIndex = STAGES.indexOf(stage);
  const specDoc = readJson(path.join(projectRoot, 'production-spec.json'), 'production-spec.json');
  const coverEnabled = !specDoc.cover || specDoc.cover.enabled !== false;
  let productionSpec = null;
  if (stageIndex >= STAGES.indexOf('spec')) {
    productionSpec = checkProductionSpec(projectRoot);
    errors.push(...productionSpec.errors.map((item) => `production-spec.json: ${item.rule}: ${item.message}`));
    warnings.push(...productionSpec.warnings.map((item) => `production-spec.json: ${item.rule}: ${item.message}`));
    repairPlan.push(...productionSpec.repairPlan);
  }
  if (stageIndex >= STAGES.indexOf('author')) {
    const narration = requireFile('narration.txt', 120);
    const research = requireFile('research.md', 120);
    requireFile('storyboard.md', 120);
    const scenePlanFile = requireFile('scene-plan.json', 20);
    if (fs.existsSync(narration)) {
      const text = fs.readFileSync(narration, 'utf8').trim();
      const bodyDuration = Number(specDoc.output && specDoc.output.duration) || DEFAULT_DURATION;
      const minimum = Math.max(20, Math.round(bodyDuration * 3));
      const maximum = Math.max(minimum + 20, Math.round(bodyDuration * 8));
      if (text.length < minimum || text.length > maximum) warnings.push(`narration.txt: ${text.length} characters; the duration-scaled range for ${bodyDuration.toFixed(1)} seconds is ${minimum}–${maximum}.`);
    }
    if (fs.existsSync(research)) {
      const links = fs.readFileSync(research, 'utf8').match(/https?:\/\/\S+/g) || [];
      if (!links.length) errors.push('research.md: add at least one primary-source URL before production.');
    }
    if (fs.existsSync(scenePlanFile)) {
      const scenePlan = readJson(scenePlanFile, 'scene-plan.json');
      if (!Array.isArray(scenePlan.scenes) || scenePlan.scenes.length < 5 || scenePlan.scenes.length > 9) {
        errors.push('scene-plan.json: use 5–9 purposeful scenes.');
      }
      const duration = (scenePlan.scenes || []).reduce((sum, scene) => sum + Number(scene.duration || 0), 0);
      const expected = Number(scenePlan.output && scenePlan.output.duration);
      if (Number.isFinite(expected) && Math.abs(duration - expected) > 0.05) {
        errors.push(`scene-plan.json: scene durations total ${duration.toFixed(3)} but output.duration is ${expected.toFixed(3)}.`);
      }
      for (const scene of scenePlan.scenes || []) {
        if (!scene.id || !scene.source || !scene.output || !scene.engine || !(Number(scene.duration) > 0)) {
          errors.push('scene-plan.json: every scene requires id/source/output/engine/duration.');
          break;
        }
        if (!['html', 'svg', 'manim'].includes(String(scene.engine))) errors.push(`${scene.id}: unsupported engine ${scene.engine}.`);
        const source = projectPath(projectRoot, scene.source, `${scene.id} source`);
        if (!fs.existsSync(source)) errors.push(`${scene.source}: missing scene source.`);
      }
    }
    if (coverEnabled && fs.existsSync(scenePlanFile)) {
      const scenePlan = readJson(scenePlanFile, 'scene-plan.json');
      const first = (scenePlan.scenes || [])[0];
      if (!first || first.id !== 's00_cover') {
        errors.push('scene-plan.json: first scene must be s00_cover so frame 0 is a designed cover (set spec.cover.enabled=false to opt out).');
        repairPlan.push({ rule: 'cover-missing', node: 'scene-plan', action: 'Run explainer materialize to generate the default cover scene, or hand-author scenes/s00_cover.html as the first scene.', invalidates: ['scene-plan', 'timeline'], preserves: ['tts', 'other-scenes', 'paid-assets'] });
      } else if (!(Number(first.duration) > 0 && Number(first.duration) <= 2.5)) {
        errors.push('scene-plan.json: s00_cover duration must be within 0–2.5 seconds.');
      }
    }
    const aestheticFindings = lintAesthetics(projectRoot);
    const duplicateFindings = duplicateCaptionFindings(projectRoot);
    errors.push(...aestheticFindings.map((item) => `${item.file}:${item.line}: ${item.message}`));
    errors.push(...duplicateFindings.map((item) => `${item.file}: ${item.message} Caption: ${item.caption}`));
    repairPlan.push(...aestheticFindings.map((item) => ({ rule: item.rule, node: item.file, action: item.message, invalidates: [`scene-source:${item.file}`, `scene-render:${item.file}`], preserves: ['tts', 'captions', 'other-scenes'] })));
    repairPlan.push(...duplicateFindings.map((item) => ({ rule: 'simultaneous-caption-echo', node: item.sceneId || item.file, action: 'Keep the complete sentence in one visual owner; patch only this scene or caption cue.', invalidates: [`scene:${item.sceneId || item.file}`, `caption:${item.sceneId || item.file}`], preserves: ['tts', 'other-scenes', 'paid-assets'] })));
    const voiceContract = lockedNarrationVoiceContract(projectRoot, specDoc);
    errors.push(...voiceContract.errors);
    repairPlan.push(...voiceContract.repairs);
  }
  if (stageIndex >= STAGES.indexOf('scenes')) {
    requireFile('timeline.json', 50);
    const scenePlan = readJson(path.join(projectRoot, 'scene-plan.json'), 'scene-plan.json');
    for (const scene of scenePlan.scenes || []) requireFile(scene.output, 1024);
    if (coverEnabled) {
      const timelineDoc = readJson(path.join(projectRoot, 'timeline.json'), 'timeline.json');
      const firstShot = (timelineDoc.shots || [])[0];
      if (!firstShot || firstShot.id !== 's00_cover') errors.push('timeline.json: first shot must be s00_cover so frame 0 is the designed cover.');
      if (timelineDoc.narration && timelineDoc.narration.engine === 'file') {
        const coverScene = (scenePlan.scenes || [])[0] || {};
        const coverDuration = Number(coverScene.duration) || 0;
        if (!(Number(timelineDoc.narration.start) >= coverDuration - 0.01)) errors.push('timeline.json: narration.start must be at least the cover duration so narration starts after the cover.');
      }
    }
  }
  if (stageIndex >= STAGES.indexOf('preview')) {
    const reports = fs.existsSync(path.join(projectRoot, 'reports'))
      ? fs.readdirSync(path.join(projectRoot, 'reports')).filter((name) => /render-report\.preview\.json$/.test(name))
      : [];
    if (!reports.length) errors.push('Preview render report is missing.');
    const sceneReview = sceneReviewStatus(projectRoot);
    if (!sceneReview.exists) warnings.push('reports/scene-review.json is missing; preview should generate start/end cognitive evidence for every scene.');
    else if (!sceneReview.approved) warnings.push(`reports/scene-review.json: ${sceneReview.pending} scene review(s) remain pending; this is a soft warning in v0.8.`);
    if (!reviewPassed(projectRoot)) errors.push('reports/autopilot-review.json is missing or not fully approved.');
  }
  if (stageIndex >= STAGES.indexOf('final')) {
    const reportFile = requireFile('reports/render-report.json', 100);
    if (fs.existsSync(reportFile)) {
      const report = readJson(reportFile, 'reports/render-report.json');
      if (report.releaseReady !== true) errors.push('Final render report is not releaseReady.');
    }
    if (coverEnabled) requireFile('cover.png', 1024);
    // 成片抽听：声明了 file 旁白时，中段 RMS 过低说明旁白很可能没混进成片。
    const timelineDoc = readJson(path.join(projectRoot, 'timeline.json'), 'timeline.json');
    if (timelineDoc.narration && timelineDoc.narration.engine === 'file') {
      const outputFile = path.join(projectRoot, (timelineDoc.output && timelineDoc.output.file) || 'renders/final.mp4');
      const rms = probeMidAudioRms(preferredFfmpeg(), outputFile);
      if (rms != null && rms < NARRATION_MIN_RMS_DB) {
        errors.push(`Final output mid-section audio is too quiet (RMS ${rms.toFixed(1)} dB < ${NARRATION_MIN_RMS_DB} dB): narration may not be mixed in; listen to the master before delivering.`);
      }
    }
  }
  const free = freeDiskBytes(projectRoot);
  if (free != null && free < 256 * 1024 * 1024) errors.push('Less than 256 MiB free disk remains.');
  else if (free != null && free < 1024 * 1024 * 1024) warnings.push('Less than 1 GiB free disk remains; image2pipe avoids PNG frame accumulation, but final caches still need space.');
  return {
    ok: errors.length === 0,
    stage,
    errors,
    warnings,
    aesthetic: { forbidLeftAccentBars: true, findings: lintAesthetics(projectRoot) },
    duplicateCaptions: duplicateCaptionFindings(projectRoot),
    productionSpec: productionSpec ? { cacheHit: productionSpec.cacheHit, specHash: productionSpec.specHash } : null,
    repairPlan,
    freeDiskBytes: free,
    htmlTransport: 'image2pipe'
  };
}

function renderScenes(projectRoot, force = false) {
  const check = checkProject(projectRoot, 'author');
  if (!check.ok) throw new Error(`Explainer author gate failed:\n${check.errors.join('\n')}`);
  const plan = readJson(path.join(projectRoot, 'scene-plan.json'), 'scene-plan.json');
  const output = plan.output || {};
  const rendered = [];
  const cached = [];
  const shared = [];
  const pendingBrowser = [];
  const pendingManim = [];
  const manifest = readManifest(projectRoot);
  const prepared = new Map();
  for (const scene of plan.scenes) {
    const source = projectPath(projectRoot, scene.source, `${scene.id} source`, true);
    const destination = projectPath(projectRoot, scene.output, `${scene.id} output`);
    const dependencies = [source, ...(scene.dependencies || []).map((file) => projectPath(projectRoot, file, `${scene.id} dependency`, true))];
    const key = sceneContentKey(scene, output, dependencies);
    prepared.set(scene.id, { scene, source, destination, dependencies, key });
    if (!force && fs.existsSync(destination) && manifest.scenes[scene.id] && manifest.scenes[scene.id].key === key) {
      cached.push(scene.id);
      continue;
    }
    if (!force && restoreSharedScene(key, destination)) {
      shared.push(scene.id);
      cached.push(scene.id);
      manifest.scenes[scene.id] = { key, output: scene.output, source: 'shared' };
      continue;
    }
    if (['html', 'svg'].includes(scene.engine)) pendingBrowser.push(scene);
    else pendingManim.push(scene);
  }
  let browserLaunches = 0;
  if (pendingBrowser.length) {
    const batchDir = path.join(projectRoot, '.qiaocut', 'batches');
    fs.mkdirSync(batchDir, { recursive: true });
    const batchFile = path.join(batchDir, `browser-${process.pid}-${Date.now()}.json`);
    const batch = {
      scenes: pendingBrowser.map((scene) => ({
        source: scene.source,
        engine: scene.engine,
        output: scene.output,
        duration: Number(scene.duration),
        width: Number(scene.width || output.width || 1080),
        height: Number(scene.height || output.height || 1920),
        fps: Number(scene.fps || output.fps || 24),
        force: fs.existsSync(projectPath(projectRoot, scene.output, `${scene.id} output`))
      }))
    };
    fs.writeFileSync(batchFile, `${JSON.stringify(batch, null, 2)}\n`);
    try {
      const result = runNodeJson(SCENE_RENDERER, ['batch', projectRoot, relative(projectRoot, batchFile), '--json'], 'browser scene batch');
      browserLaunches = Number(result.browserLaunches || 0);
      for (let index = 0; index < pendingBrowser.length; index += 1) {
        const scene = pendingBrowser[index];
        rendered.push({ id: scene.id, ...result.results[index] });
      }
    } finally {
      try { fs.unlinkSync(batchFile); } catch (_) {}
    }
  }
  for (const scene of pendingManim) {
    const destination = projectPath(projectRoot, scene.output, `${scene.id} output`);
    const args = [
      'render', projectRoot, scene.source, '--engine', scene.engine,
      '--output', scene.output, '--duration', String(scene.duration),
      '--width', String(scene.width || output.width || 1080),
      '--height', String(scene.height || output.height || 1920),
      '--fps', String(scene.fps || output.fps || 24),
      ...(scene.sceneClass ? ['--scene-class', scene.sceneClass] : []),
      ...(fs.existsSync(destination) ? ['--force'] : []), '--json'
    ];
    rendered.push({ id: scene.id, ...runNodeJson(SCENE_RENDERER, args, `scene ${scene.id}`) });
  }
  for (const scene of [...pendingBrowser, ...pendingManim]) {
    const item = prepared.get(scene.id);
    storeSharedScene(item.key, item.destination);
    manifest.scenes[scene.id] = { key: item.key, output: scene.output, source: 'rendered' };
  }
  writeManifest(projectRoot, manifest);
  return {
    ok: true,
    project: projectRoot,
    rendered,
    cached,
    shared,
    cache: { projectHits: cached.length - shared.length, sharedHits: shared.length, misses: rendered.length, root: sharedCacheRoot() },
    transport: 'image2pipe',
    sequential: true,
    browserBatches: pendingBrowser.length ? 1 : 0,
    browserLaunches
  };
}

function suffixed(file, suffix) {
  const extension = path.extname(file);
  return `${extension ? file.slice(0, -extension.length) : file}.${suffix}${extension}`;
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function preferredFfmpeg() {
  return [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', 'ffmpeg']
    .find((binary) => binary && spawnSync(binary, ['-v', 'error', '-version'], { stdio: 'ignore' }).status === 0) || null;
}

function extractReviewFrame(ffmpeg, video, seconds, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp.jpg`;
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', video,
    '-ss', Number(seconds).toFixed(3), '-frames:v', '1', '-q:v', '2', temporary
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !fs.existsSync(temporary) || fs.statSync(temporary).size < 256) {
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw new Error(result.stderr || 'ffmpeg did not produce a review frame.');
  }
  fs.renameSync(temporary, target);
}

/** start/end 审查帧的亮度差均值（YAVG），用于客观判断声明的 visibleChange 是否真的可见。 */
function frameDiffYAvg(ffmpeg, frameA, frameB) {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-nostats', '-i', frameA, '-i', frameB,
    '-filter_complex', 'blend=all_mode=difference,signalstats,metadata=mode=print', '-f', 'null', '-'
  ], { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const matches = [...output.matchAll(/YAVG[=:]([\d.]+)/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

/** 帧差低于该值时认为声明的 state/process 变化在画面上不可见。 */
const VISIBLE_CHANGE_MIN_YAVG = 2.0;

/** 成片 40% 处起 8 秒的 RMS 电平（取较亮声道）。用于 final 前发现"旁白没混进成片"。 */
function probeMidAudioRms(ffmpeg, file) {
  if (!ffmpeg || !fs.existsSync(file)) return null;
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  const durationMatch = /Duration: (\d+):(\d+):([\d.]+)/.exec(`${probe.stderr || ''}`);
  if (!durationMatch) return null;
  const total = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  if (!(total > 4)) return null;
  const ss = Math.max(0, total * 0.4);
  const window = Math.min(8, Math.max(2, total * 0.2));
  const stats = spawnSync(ffmpeg, [
    '-hide_banner', '-ss', ss.toFixed(2), '-t', window.toFixed(2), '-i', file,
    '-af', 'astats=metadata=1', '-f', 'null', '-'
  ], { encoding: 'utf8' });
  const matches = [...`${stats.stdout || ''}\n${stats.stderr || ''}`.matchAll(/RMS level dB: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  return matches.length ? Math.max(...matches) : null;
}

/** 成片中段 RMS 低于该值（dB）时认为旁白很可能没有混入。 */
const NARRATION_MIN_RMS_DB = -40;

function generateSceneReview(projectRoot, force = false) {
  const plan = readJson(path.join(projectRoot, 'scene-plan.json'), 'scene-plan.json');
  const reportFile = path.join(projectRoot, 'reports', 'scene-review.json');
  const previous = fs.existsSync(reportFile) ? readJson(reportFile, 'reports/scene-review.json') : { scenes: [] };
  const previousById = new Map((previous.scenes || []).map((scene) => [scene.id, scene]));
  const ffmpeg = preferredFfmpeg();
  if (!ffmpeg) return { ok: false, file: 'reports/scene-review.json', approved: false, pending: (plan.scenes || []).length, warnings: ['ffmpeg-full is unavailable; scene review frames were not generated.'] };
  const directory = path.join(projectRoot, 'reports', 'scene-review');
  const warnings = [];
  let generatedFrames = 0;
  let reusedFrames = 0;
  const scenes = [];
  for (const scene of plan.scenes || []) {
    const video = projectPath(projectRoot, scene.output, `${scene.id} review source`, true);
    const duration = Number(scene.duration);
    const startMs = Math.max(0, Math.min(200, Math.round(duration * 200)));
    const endMs = Math.max(startMs + 1, Math.round(duration * 1000) - 300);
    const midMs = Math.max(startMs + 1, Math.min(endMs - 1, Math.round(duration * 500)));
    const safeId = String(scene.id || 'scene').replace(/[^a-zA-Z0-9_-]+/g, '-');
    const startRelative = `reports/scene-review/${safeId}-start.jpg`;
    const midRelative = `reports/scene-review/${safeId}-mid.jpg`;
    const endRelative = `reports/scene-review/${safeId}-end.jpg`;
    const startFrame = path.join(projectRoot, startRelative);
    const midFrame = path.join(projectRoot, midRelative);
    const endFrame = path.join(projectRoot, endRelative);
    const reviewKey = crypto.createHash('sha256').update(JSON.stringify({
      videoSha256: sha256File(video),
      cognitiveTask: scene.cognitiveTask || '',
      component: scene.component || null,
      primaryFocus: scene.primaryFocus || '',
      visibleChange: scene.visibleChange || null,
      visualMechanism: scene.visualMechanism || null,
      startMs,
      midMs,
      endMs
    })).digest('hex');
    const old = previousById.get(scene.id);
    const sameReview = Boolean(old && old.reviewKey === reviewKey);
    const reusable = !force && sameReview && fs.existsSync(startFrame) && fs.existsSync(midFrame) && fs.existsSync(endFrame);
    if (reusable) reusedFrames += 3;
    else {
      try {
        extractReviewFrame(ffmpeg, video, startMs / 1000, startFrame);
        extractReviewFrame(ffmpeg, video, midMs / 1000, midFrame);
        extractReviewFrame(ffmpeg, video, endMs / 1000, endFrame);
        generatedFrames += 3;
      } catch (error) {
        warnings.push(`${scene.id}: ${String(error.message || error).trim()}`);
      }
    }
    const contract = scene.purpose === 'cover'
      ? { component: 'cover', cognitiveTask: '建立主题并激发点击兴趣', primaryFocus: 'cover-title', visibleChange: { kind: 'none', from: '', to: '' }, visualMechanism: { kind: 'cover', input: '主题悬念', process: '首帧构图', output: '点击动机' } }
      : { component: scene.component || null, cognitiveTask: scene.cognitiveTask || '', primaryFocus: scene.primaryFocus || '', visibleChange: scene.visibleChange || { kind: 'none', from: '', to: '' }, visualMechanism: scene.visualMechanism || null };
    const checks = sameReview && old && old.checks ? old.checks : {
      singleFocus: null,
      cognitiveTaskVisible: null,
      visibleChangeVerified: null,
      explanationVisible: null,
      captionConflictFree: null
    };
    // 帧差客观证据：声明了 state/process 但首尾帧几乎无差异时，直接判 visibleChangeVerified=false。
    const declaredKind = String(contract.visibleChange && contract.visibleChange.kind || 'none');
    if (!reusable && (declaredKind === 'state' || declaredKind === 'process') && fs.existsSync(startFrame) && fs.existsSync(endFrame)) {
      const yavg = frameDiffYAvg(ffmpeg, startFrame, endFrame);
      if (yavg != null && yavg < VISIBLE_CHANGE_MIN_YAVG) {
        checks.visibleChangeVerified = false;
        warnings.push(`${scene.id}: declared visibleChange (${declaredKind}) not visible in frames (start/end YAVG=${yavg.toFixed(2)} < ${VISIBLE_CHANGE_MIN_YAVG}).`);
      }
    }
    scenes.push({
      id: scene.id,
      purpose: scene.purpose,
      ...contract,
      reviewKey,
      evidence: { startFrame: startRelative, startMs, midFrame: midRelative, midMs, endFrame: endRelative, endMs },
      checks,
      notes: sameReview && old ? String(old.notes || '') : ''
    });
  }
  const pending = scenes.filter((scene) => !Object.values(scene.checks).every((value) => value === true)).length;
  const report = {
    schema: 'qiaocut.scene-review.v1',
    mode: 'soft',
    instructions: 'Compare each start/mid/end triple. Approve only when the focus is singular, the end frame communicates cognitiveTask, declared visibleChange is evident across the motion, visualMechanism shows a readable input→process→output causal chain instead of generic card activation, and captions do not compete. visibleChangeVerified may be pre-filled false by the automatic start/end frame-diff check.',
    scenes,
    summary: { approved: pending === 0 && scenes.length > 0, pending, generatedFrames, reusedFrames }
  };
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  return { ok: warnings.length === 0, file: 'reports/scene-review.json', approved: report.summary.approved, pending, generatedFrames, reusedFrames, warnings };
}

function renderInputFingerprint(projectRoot, profile) {
  const timelineFile = path.join(projectRoot, 'timeline.json');
  const timeline = readJson(timelineFile, 'timeline.json');
  const paths = new Set(['timeline.json']);
  const add = (value) => { if (typeof value === 'string' && value && !/^https?:/.test(value)) paths.add(value); };
  if (timeline.captionSource) add(timeline.captionSource);
  else add(timeline.captions);
  for (const shot of timeline.shots || []) add(shot.path);
  if (timeline.narration) {
    add(timeline.narration.path);
    for (const cue of timeline.narration.cues || []) add(cue.path);
  }
  if (timeline.music && timeline.music.mode === 'file') add(timeline.music.path);
  for (const cue of timeline.soundEffects || []) add(cue.path);
  if (timeline.fontsDir) {
    const fonts = projectPath(projectRoot, timeline.fontsDir, 'fontsDir');
    if (fs.existsSync(fonts) && fs.statSync(fonts).isDirectory()) {
      for (const file of walkFiles(fonts, new Set(['.otf', '.ttf', '.ttc', '.woff', '.woff2']))) add(relative(projectRoot, file));
    }
  }
  const hash = crypto.createHash('sha256');
  hash.update(`qiaomu-cut-render-gate-v1\0${profile}\0`);
  for (const name of [...paths].sort()) {
    const file = projectPath(projectRoot, name, `render input ${name}`);
    hash.update(name);
    hash.update('\0');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) hash.update(fs.readFileSync(file));
    else hash.update('<missing-or-generated>');
    hash.update('\0');
  }
  return hash.digest('hex');
}

function renderGatePaths(projectRoot, profile) {
  const timeline = readJson(path.join(projectRoot, 'timeline.json'), 'timeline.json');
  const output = timeline.output && timeline.output.file || 'renders/final.mp4';
  const report = timeline.reports && timeline.reports.renderReport || 'reports/render-report.json';
  return {
    state: path.join(projectRoot, '.qiaocut', 'render-gates', `${profile}.json`),
    output: projectPath(projectRoot, profile === 'final' ? output : suffixed(output, profile), `${profile} output`),
    report: projectPath(projectRoot, profile === 'final' ? report : suffixed(report, profile), `${profile} report`)
  };
}

function maybeExportCoverPng(projectRoot, gateOutput) {
  try {
    const specDoc = readJson(path.join(projectRoot, 'production-spec.json'), 'production-spec.json');
    if (specDoc.cover && specDoc.cover.enabled === false) return null;
    const target = path.join(projectRoot, 'cover.png');
    const outMtime = fs.existsSync(gateOutput) ? fs.statSync(gateOutput).mtimeMs : 0;
    if (!outMtime) return null;
    if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= outMtime) return 'cover.png';
    const ffmpeg = [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', 'ffmpeg']
      .find((bin) => bin && spawnSync(bin, ['-v', 'error', '-version'], { stdio: 'ignore' }).status === 0);
    if (!ffmpeg) return null;
    const result = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', gateOutput, '-frames:v', '1', target], { stdio: 'ignore' });
    return result.status === 0 ? 'cover.png' : null;
  } catch (_) {
    return null;
  }
}

function renderProfile(projectRoot, profile, force = false) {
  if (!['preview', 'final'].includes(profile)) throw new UsageError('Profile must be preview or final.');
  const scenes = renderScenes(projectRoot, force);
  const sceneReview = profile === 'preview' ? generateSceneReview(projectRoot, force) : sceneReviewStatus(projectRoot);
  const stage = profile === 'final' ? 'preview' : 'scenes';
  const check = checkProject(projectRoot, stage);
  if (!check.ok) throw new Error(`Explainer ${stage} gate failed:\n${check.errors.join('\n')}`);
  const fingerprint = renderInputFingerprint(projectRoot, profile);
  const gate = renderGatePaths(projectRoot, profile);
  if (!force && fs.existsSync(gate.state) && fs.existsSync(gate.output) && fs.existsSync(gate.report)) {
    const state = readJson(gate.state, `${profile} render gate`);
    if (state.fingerprint === fingerprint && state.outputHash === sha256File(gate.output) && state.reportHash === sha256File(gate.report)) {
      const report = readJson(gate.report, `${profile} render report`);
      const coverPng = profile === 'final' ? maybeExportCoverPng(projectRoot, gate.output) : null;
      return { ok: report.ok === true, profile, scenes, sceneReview, report, reportReused: true, validationReused: true, coverPng };
    }
  }
  const report = runNodeJson(PROJECT_RENDERER, [
    projectRoot, '--profile', profile, '--force', '--json'
  ], `explainer ${profile} render`);
  fs.mkdirSync(path.dirname(gate.state), { recursive: true });
  fs.writeFileSync(gate.state, `${JSON.stringify({
    fingerprint,
    report: relative(projectRoot, gate.report),
    reportHash: sha256File(gate.report),
    output: relative(projectRoot, gate.output),
    outputHash: sha256File(gate.output),
    releaseReady: report.releaseReady === true
  }, null, 2)}\n`);
  const coverPng = profile === 'final' ? maybeExportCoverPng(projectRoot, gate.output) : null;
  return { ok: report.ok === true, profile, scenes, sceneReview, report, reportReused: false, validationReused: false, coverPng };
}

function usage() {
  return `Usage:
  qcut explainer init <project-dir> --topic "LLM 中的 RL" [--duration 75] [--voice-name "向阳乔木 v1.1"] [--json]
  qcut explainer check <project-dir> [--stage init|spec|author|scenes|preview|final] [--json]
  qcut explainer materialize <project-dir> [--json]
  qcut explainer timing <project-dir> --audio assets/generated/narration.mp3 [--apply] [--json]
  qcut explainer beats <project-dir> [--apply] [--json]
  qcut explainer render-scenes <project-dir> [--force] [--json]
  qcut explainer preview <project-dir> [--force] [--json]
  qcut explainer final <project-dir> [--force] [--json]
`;
}

function print(value, json) {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const action = positional[0];
  const project = positional[1];
  if (!action || !project) throw new UsageError(usage());
  const projectRoot = path.resolve(project);
  if (action !== 'init' && (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory())) {
    throw new Error('Project directory not found.');
  }
  let result;
  if (action === 'init') result = initProject(projectRoot, flags);
  else if (action === 'check') result = checkProject(projectRoot, String(flags.stage || 'author'));
  else if (action === 'materialize') result = materializeProductionSpec(projectRoot);
  else if (action === 'timing') {
    if (!flags.audio) throw new UsageError('explainer timing requires --audio <project-relative audio file>.');
    result = lockNarrationTiming(projectRoot, String(flags.audio), { apply: Boolean(flags.apply) });
  }
  else if (action === 'beats') result = require('./explainer_beats').deriveBeats(projectRoot, { apply: Boolean(flags.apply) });
  else if (action === 'render-scenes') result = renderScenes(projectRoot, Boolean(flags.force));
  else if (action === 'preview' || action === 'final') result = renderProfile(projectRoot, action, Boolean(flags.force));
  else throw new UsageError(usage());
  print(result, Boolean(flags.json));
  if (result.ok === false) process.exitCode = 1;
}

module.exports = {
  checkProject,
  defaultScenePlan,
  duplicateCaptionFindings,
  initProject,
  lintAesthetics,
  materializeProductionSpec,
  generateSceneReview,
  lockNarrationTiming,
  renderScenes
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
