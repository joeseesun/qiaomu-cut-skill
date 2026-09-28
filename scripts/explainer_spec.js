#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SPEC_SCHEMA = 'qiaocut.explainer-production.v1';
/** Bump when production-spec gate rules change so stale per-hash caches are ignored. */
const PRODUCTION_SPEC_GATE_VERSION = 5;
const COMPONENTS = new Set([
  'definition', 'teacher-student-transfer', 'reward-loop', 'comparison',
  'pipeline', 'benefit-risk', 'outro',
  'prediction-field', 'segmentation-flow', 'optimization-loop',
  'filter-conveyor', 'balance-system', 'state-morph', 'risk-dashboard',
  'evidence-photo', 'timeline-story', 'relationship-map'
]);
const PURPOSES = ['hook', 'definition', 'mechanism', 'modern-practice', 'benefits', 'limits', 'outro'];
const COMPONENT_DEFAULTS = [
  'prediction-field', 'segmentation-flow', 'optimization-loop',
  'filter-conveyor', 'balance-system', 'risk-dashboard', 'outro'
];
const DURATIONS = [7, 16, 16, 11, 8, 9, 8];
const COGNITIVE_CONTRACT_VERSION = 2;
const EXPLANATION_CONTRACT_VERSION = 3;
const VISUAL_EVIDENCE_CONTRACT_VERSION = 4;
const PHOTO_MOTION_CONTRACT_VERSION = 5;
const CHANGE_KINDS = new Set(['none', 'state', 'process']);
const VISUAL_MECHANISM_KINDS = new Set([
  'prediction', 'segmentation', 'optimization', 'filtering',
  'balance', 'transformation', 'tradeoff', 'evidence', 'timeline', 'relationship', 'brand'
]);
const EXPLANATORY_COMPONENTS = new Set([
  'prediction-field', 'segmentation-flow', 'optimization-loop',
  'filter-conveyor', 'balance-system', 'state-morph', 'risk-dashboard',
  'evidence-photo', 'timeline-story', 'relationship-map'
]);
const GENERIC_CARD_COMPONENTS = new Set([
  'definition', 'teacher-student-transfer', 'reward-loop',
  'comparison', 'pipeline', 'benefit-risk'
]);
const VISUAL_MECHANISM_DEFAULTS = [
  'prediction', 'segmentation', 'optimization', 'filtering',
  'balance', 'tradeoff', 'brand'
];
const REAL_WORLD_COMPONENT_DEFAULTS = [
  'evidence-photo', 'timeline-story', 'relationship-map',
  'evidence-photo', 'relationship-map', 'state-morph', 'outro'
];
const REAL_WORLD_MECHANISM_DEFAULTS = [
  'evidence', 'timeline', 'relationship', 'evidence',
  'relationship', 'transformation', 'brand'
];
const VISUAL_FORMS = new Set(['photo', 'chart', 'diagram', 'hybrid', 'text']);
const VISUAL_RELATIONS = new Set([
  'ranking', 'time', 'comparison', 'composition', 'relationship', 'distribution',
  'flow', 'hierarchy', 'geography', 'transformation', 'balance', 'none'
]);
const EVIDENCE_TYPES = new Set(['source-fact', 'computed', 'interpretation', 'illustrative']);
const PHOTO_MOTIONS = new Set(['hold', 'reveal-left', 'reveal-right', 'pan-up', 'pan-down', 'rack-focus']);
const PHOTO_MOTION_DEFAULTS = ['reveal-left', 'pan-up', 'rack-focus', 'pan-down'];
const QUANTITATIVE_COMPONENTS = new Set(['prediction-field', 'balance-system', 'risk-dashboard']);
const COMPONENT_FOCUS_IDS = Object.freeze({
  definition: new Set(['focus-title', 'focus-stage', 'focus-keyword', 'focus-sequence']),
  'teacher-student-transfer': new Set(['focus-title', 'focus-stage', 'focus-left', 'focus-right', 'focus-relationship']),
  'reward-loop': new Set(['focus-title', 'focus-stage', 'focus-sequence']),
  comparison: new Set(['focus-title', 'focus-stage', 'focus-left', 'focus-right', 'focus-relationship']),
  pipeline: new Set(['focus-title', 'focus-stage', 'focus-sequence']),
  'benefit-risk': new Set(['focus-title', 'focus-stage', 'focus-left', 'focus-right']),
  'prediction-field': new Set(['focus-title', 'focus-stage', 'focus-prompt', 'focus-candidates', 'focus-winner']),
  'segmentation-flow': new Set(['focus-title', 'focus-stage', 'focus-source', 'focus-tokens', 'focus-embedding']),
  'optimization-loop': new Set(['focus-title', 'focus-stage', 'focus-forward', 'focus-loss', 'focus-gradient', 'focus-weights']),
  'filter-conveyor': new Set(['focus-title', 'focus-stage', 'focus-input', 'focus-gates', 'focus-clean']),
  'balance-system': new Set(['focus-title', 'focus-stage', 'focus-balance', 'focus-params', 'focus-data', 'focus-compute']),
  'state-morph': new Set(['focus-title', 'focus-stage', 'focus-before', 'focus-after', 'focus-transition']),
  'risk-dashboard': new Set(['focus-title', 'focus-stage', 'focus-risk', 'focus-hallucination', 'focus-bias', 'focus-cost']),
  'evidence-photo': new Set(['focus-title', 'focus-stage', 'focus-photo', 'focus-caption']),
  'timeline-story': new Set(['focus-title', 'focus-stage', 'focus-timeline', 'focus-sequence']),
  'relationship-map': new Set(['focus-title', 'focus-stage', 'focus-network', 'focus-core', 'focus-sequence']),
  outro: new Set(['focus-title', 'focus-stage', 'focus-brand'])
});

function defaultPrimaryFocus(component) {
  if (['reward-loop', 'pipeline'].includes(component)) return 'focus-sequence';
  if (['comparison', 'teacher-student-transfer'].includes(component)) return 'focus-relationship';
  if (component === 'prediction-field') return 'focus-winner';
  if (component === 'segmentation-flow') return 'focus-tokens';
  if (component === 'optimization-loop') return 'focus-gradient';
  if (component === 'filter-conveyor') return 'focus-gates';
  if (component === 'balance-system') return 'focus-balance';
  if (component === 'state-morph') return 'focus-transition';
  if (component === 'risk-dashboard') return 'focus-risk';
  if (component === 'evidence-photo') return 'focus-photo';
  if (component === 'timeline-story') return 'focus-timeline';
  if (component === 'relationship-map') return 'focus-network';
  if (component === 'outro') return 'focus-brand';
  return 'focus-stage';
}

function defaultEyebrow(topic) {
  return /(?:LLM|大模型|语言模型|token|transformer|注意力|RLHF)/i.test(String(topic || '')) ? 'LLM 关键词' : '概念科普';
}

function defaultTopicKind(topic) {
  return /(?:大学|学校|学院|公司|品牌|城市|国家|博物馆|历史人物|作家|科学家|企业家)/i.test(String(topic || ''))
    ? 'real-world'
    : 'abstract';
}

function defaultVisualRelation(component, purpose) {
  if (component === 'evidence-photo') return { kind: 'none', evidenceType: 'source-fact', encoding: '真实图像证据', unit: '不适用', sourceUrl: '' };
  if (component === 'timeline-story') return { kind: 'time', evidenceType: 'source-fact', encoding: '时间位置与节点', unit: '年', sourceUrl: '' };
  if (component === 'segmentation-flow') return { kind: 'time', evidenceType: 'illustrative', encoding: '顺序位置与切分节点', unit: '示意', sourceUrl: '' };
  if (component === 'relationship-map') return { kind: 'relationship', evidenceType: 'interpretation', encoding: '节点与连线', unit: '不适用', sourceUrl: '' };
  if (component === 'state-morph') return { kind: 'transformation', evidenceType: 'illustrative', encoding: '前后状态转换', unit: '不适用', sourceUrl: '' };
  if (component === 'prediction-field') return { kind: 'ranking', evidenceType: 'illustrative', encoding: '候选项长度', unit: '示意', sourceUrl: '' };
  if (component === 'balance-system') return { kind: 'balance', evidenceType: 'illustrative', encoding: '多维节点平衡', unit: '示意', sourceUrl: '' };
  if (component === 'risk-dashboard') return { kind: 'comparison', evidenceType: 'illustrative', encoding: '多项风险刻度', unit: '示意', sourceUrl: '' };
  if (purpose === 'outro') return { kind: 'none', evidenceType: 'illustrative', encoding: '品牌收束', unit: '不适用', sourceUrl: '' };
  return { kind: 'flow', evidenceType: 'illustrative', encoding: '过程节点与连接', unit: '不适用', sourceUrl: '' };
}

function normalize(value) {
  return String(value || '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
}

/** Spoken/branded outro must invite follow-up with brand identity. */
function hasSpokenBrandCta(text) {
  const value = String(text || '');
  const hasBrand = /向阳乔木/.test(value);
  const hasHandle = /@?vista8/i.test(value);
  const hasFollow = /关注/.test(value);
  return hasBrand && (hasFollow || hasHandle);
}

function hasVisualBrandCta(scene) {
  if (!scene || typeof scene !== 'object') return false;
  const parts = [
    scene.title,
    scene.keyword,
    scene.body,
    scene.captionText,
    ...(Array.isArray(scene.onScreenText) ? scene.onScreenText : []),
    ...(Array.isArray(scene.items) ? scene.items : [])
  ];
  const blob = parts.filter(Boolean).join(' ');
  return /向阳乔木/.test(blob) && (/关注/.test(blob) || /@?vista8/i.test(blob));
}

function pickOutroNarration(segments) {
  const list = Array.isArray(segments) ? segments : [];
  return list.find((item) => item && item.purpose === 'outro') || list[list.length - 1] || null;
}

function pickOutroScene(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  return list.find((item) => item && item.purpose === 'outro') || list[list.length - 1] || null;
}

function hashValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function readJson(file, label = path.basename(file)) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
}

function defaultProductionSpec(topic, duration = 75) {
  const coverDuration = 1.5;
  const bodyDuration = Math.max(1, duration - coverDuration);
  const ratio = bodyDuration / 75;
  const eyebrow = defaultEyebrow(topic);
  const topicKind = defaultTopicKind(topic);
  const componentDefaults = topicKind === 'real-world' ? REAL_WORLD_COMPONENT_DEFAULTS : COMPONENT_DEFAULTS;
  const mechanismDefaults = topicKind === 'real-world' ? REAL_WORLD_MECHANISM_DEFAULTS : VISUAL_MECHANISM_DEFAULTS;
  return {
    schema: SPEC_SCHEMA,
    contractVersion: PHOTO_MOTION_CONTRACT_VERSION,
    topic,
    contentLocked: false,
    output: { targetDuration: duration, duration: bodyDuration, width: 1080, height: 1920, fps: 24 },
    claims: [],
    visualEvidence: {
      topicKind,
      imageSearchRequired: topicKind === 'real-world',
      minimumSourceImages: topicKind === 'real-world' ? 3 : 0,
      imageQueries: [],
      sourceImages: []
    },
    narrationSegments: PURPOSES.map((purpose, index) => ({
      id: `s0${index + 1}_${purpose.replace(/-/g, '_')}`,
      purpose,
      text: '',
      duration: Number((DURATIONS[index] * ratio).toFixed(3))
    })),
    scenes: PURPOSES.map((purpose, index) => ({
      id: `s0${index + 1}_${purpose.replace(/-/g, '_')}`,
      purpose,
      component: componentDefaults[index],
      cognitiveTask: '',
      primaryFocus: defaultPrimaryFocus(componentDefaults[index]),
      visibleChange: { kind: 'none', from: '', to: '' },
      visualMechanism: {
        kind: mechanismDefaults[index],
        input: '',
        process: '',
        output: ''
      },
      visualOwner: 'scene',
      visualQuestion: `这个场景如何解释${purpose}？`,
      visualForm: componentDefaults[index] === 'evidence-photo' ? 'photo' : 'diagram',
      visualRelation: defaultVisualRelation(componentDefaults[index], purpose),
      assetId: '',
      photoMotion: componentDefaults[index] === 'evidence-photo' ? PHOTO_MOTION_DEFAULTS[index % PHOTO_MOTION_DEFAULTS.length] : '',
      assetPath: '',
      assetSourceUrl: '',
      assetCredit: '',
      eyebrow,
      title: '',
      keyword: '',
      body: '',
      items: [],
      onScreenText: [],
      captionText: '',
      duration: Number((DURATIONS[index] * ratio).toFixed(3))
    })),
    generation: {
      parallelAfterSpecLock: ['listenhub-narration', 'component-materialization', 'optional-image-assets'],
      paidRetryLimit: 0
    },
    cover: {
      enabled: true,
      duration: coverDuration,
      eyebrow,
      title: '',
      highlight: '',
      teaser: '',
      brand: '向阳乔木',
      handle: '@vista8',
      cta: ''
    }
  };
}

function gateCacheFile(projectRoot, hash) {
  return path.join(projectRoot, '.qiaocut', 'gates', `production-spec-v${PRODUCTION_SPEC_GATE_VERSION}-${hash}.json`);
}

function checkProductionSpec(projectRoot, options = {}) {
  const file = path.join(projectRoot, 'production-spec.json');
  if (!fs.existsSync(file)) {
    return { ok: false, cacheHit: false, specHash: null, errors: [{ rule: 'spec-missing', message: 'production-spec.json is missing.' }], warnings: [], repairPlan: [] };
  }
  const spec = readJson(file, 'production-spec.json');
  const specHash = hashValue(spec);
  const cacheFile = gateCacheFile(projectRoot, specHash);
  if (!options.noCache && fs.existsSync(cacheFile)) {
    const cached = readJson(cacheFile, 'production spec gate cache');
    if (Number(cached.gateVersion) === PRODUCTION_SPEC_GATE_VERSION) {
      return { ...cached, cacheHit: true };
    }
  }
  const errors = [];
  const warnings = [];
  const repairPlan = [];
  const fail = (rule, message, node, invalidates = []) => {
    errors.push({ rule, message, node });
    repairPlan.push({ rule, node, action: message, invalidates, preserves: ['unrelated-scenes', 'existing-paid-assets'] });
  };
  if (spec.schema !== SPEC_SCHEMA) fail('schema', `production-spec.json schema must be ${SPEC_SCHEMA}.`, 'production-spec', ['production-spec']);
  if (spec.contentLocked !== true) fail('content-lock', 'Set contentLocked=true only after claims, narration, captions and scene ownership are complete.', 'production-spec', ['production-spec']);
  if (!Array.isArray(spec.claims) || spec.claims.length < 2) fail('claims', 'Add at least two verified claims.', 'claims', ['production-spec', 'research']);
  for (const [index, claim] of (spec.claims || []).entries()) {
    if (!claim || String(claim.text || '').trim().length < 8 || !/^https?:\/\//.test(String(claim.sourceUrl || ''))) {
      fail('claim-source', `Claim ${index + 1} needs substantive text and a primary-source URL.`, `claims[${index}]`, ['production-spec', 'research']);
    }
  }
  const segments = Array.isArray(spec.narrationSegments) ? spec.narrationSegments : [];
  const scenes = Array.isArray(spec.scenes) ? spec.scenes : [];
  const cognitiveContractEnabled = Number(spec.contractVersion || 0) >= COGNITIVE_CONTRACT_VERSION;
  const explanationContractEnabled = Number(spec.contractVersion || 0) >= EXPLANATION_CONTRACT_VERSION;
  const visualEvidenceContractEnabled = Number(spec.contractVersion || 0) >= VISUAL_EVIDENCE_CONTRACT_VERSION;
  const photoMotionContractEnabled = Number(spec.contractVersion || 0) >= PHOTO_MOTION_CONTRACT_VERSION;
  if (!cognitiveContractEnabled) {
    warnings.push({ rule: 'legacy-cognitive-contract', message: `Legacy production spec has no contractVersion=${COGNITIVE_CONTRACT_VERSION}; it remains compatible, but cognitive scene gates are not enforced until upgraded.` });
  } else if (!explanationContractEnabled) {
    warnings.push({ rule: 'legacy-explanation-contract', message: `Legacy production spec has no contractVersion=${EXPLANATION_CONTRACT_VERSION}; it remains compatible, but visual mechanism and component-diversity gates are not enforced until upgraded.` });
  } else if (!visualEvidenceContractEnabled) {
    warnings.push({ rule: 'legacy-visual-evidence-contract', message: `Legacy production spec has no contractVersion=${VISUAL_EVIDENCE_CONTRACT_VERSION}; it remains compatible, but real-world image coverage and chart-semantics gates are not enforced until upgraded.` });
  } else if (!photoMotionContractEnabled) {
    warnings.push({ rule: 'legacy-photo-motion-contract', message: `Legacy production spec has no contractVersion=${PHOTO_MOTION_CONTRACT_VERSION}; it remains compatible, but composition-driven photo-motion gates are not enforced until upgraded.` });
  }

  const visualEvidence = spec.visualEvidence && typeof spec.visualEvidence === 'object' ? spec.visualEvidence : null;
  const topicKind = String(visualEvidence && visualEvidence.topicKind || '');
  const sourceImages = Array.isArray(visualEvidence && visualEvidence.sourceImages) ? visualEvidence.sourceImages : [];
  const sourceImageIds = new Set(sourceImages.map((item) => item && item.id).filter(Boolean));
  if (visualEvidenceContractEnabled) {
    if (!visualEvidence || !['abstract', 'real-world', 'mixed'].includes(topicKind)) {
      fail('topic-kind', 'visualEvidence.topicKind must be abstract, real-world, or mixed.', 'visualEvidence', ['production-spec', 'image-research']);
    }
    if (['real-world', 'mixed'].includes(topicKind)) {
      const queries = Array.isArray(visualEvidence.imageQueries) ? visualEvidence.imageQueries.filter((item) => String(item || '').trim().length >= 3) : [];
      const minimum = Math.max(3, Number(visualEvidence.minimumSourceImages) || 0);
      if (visualEvidence.imageSearchRequired !== true) {
        fail('image-search-required', 'Real-world and mixed topics must explicitly require source-image discovery.', 'visualEvidence.imageSearchRequired', ['production-spec', 'image-research']);
      }
      if (queries.length < 2) {
        fail('image-search-queries', 'Add at least two concrete image queries for a real-world topic (subject/landmark and historical/contextual evidence).', 'visualEvidence.imageQueries', ['production-spec', 'image-research']);
      }
      if (sourceImages.length < minimum) {
        fail('source-image-coverage', `Add at least ${minimum} downloaded, rights-checked source images for a real-world topic.`, 'visualEvidence.sourceImages', ['production-spec', 'image-research', 'image-assets']);
      }
    }
    const allowedRights = new Set(['public-domain', 'cc-by', 'cc-by-sa', 'official-permission', 'user-provided', 'ai-generated']);
    for (const [index, image] of sourceImages.entries()) {
      const node = `visualEvidence.sourceImages[${index}]`;
      if (!image || !String(image.id || '').trim() || !/^https?:\/\//.test(String(image.sourceUrl || ''))) {
        fail('source-image-record', 'Each source image needs an id and direct source page URL.', node, ['production-spec', 'image-research']);
        continue;
      }
      if (!allowedRights.has(String(image.licenseStatus || ''))) {
        fail('source-image-license', 'Each source image needs a verified licenseStatus: public-domain, cc-by, cc-by-sa, official-permission, user-provided, or ai-generated.', node, ['production-spec', 'image-research']);
      }
      const localPath = String(image.localPath || '');
      const absolute = path.resolve(projectRoot, localPath);
      const relative = path.relative(projectRoot, absolute);
      if (!localPath || path.isAbsolute(localPath) || relative === '..' || relative.startsWith(`..${path.sep}`) || !fs.existsSync(absolute)) {
        fail('source-image-local', 'Each source image must be downloaded to an existing project-relative localPath before the spec is locked.', node, ['production-spec', 'image-assets']);
      }
    }
  }
  if (segments.length < 5 || segments.length > 9) fail('narration-count', 'Use 5–9 narration segments.', 'narrationSegments', ['production-spec', 'tts']);
  if (scenes.length < 5 || scenes.length > 9) fail('scene-count', 'Use 5–9 purposeful scenes.', 'scenes', ['production-spec', 'scene-specs']);
  const ids = new Set();
  for (const [index, segment] of segments.entries()) {
    if (!segment || !segment.id || ids.has(segment.id)) fail('segment-id', `Narration segment ${index + 1} needs a unique id.`, `narrationSegments[${index}]`, ['production-spec']);
    if (segment && segment.id) ids.add(segment.id);
    if (!segment || String(segment.text || '').trim().length < 8 || !(Number(segment.duration) > 0)) {
      fail('segment-content', `Narration segment ${index + 1} needs text and a positive duration.`, `narrationSegments[${index}]`, ['production-spec', `tts:${segment && segment.id || index}`]);
    }
  }
  const outroNarration = pickOutroNarration(segments);
  if (outroNarration && !hasSpokenBrandCta(outroNarration.text)) {
    fail(
      'outro-spoken-brand-cta',
      'Outro narration must include a spoken follow CTA that names 向阳乔木 and invites 关注 (optionally @vista8). Do not end on a pure knowledge takeaway without brand voiceover.',
      outroNarration.id || 'narrationSegments[outro]',
      ['production-spec', 'tts', 'narration', `tts:${outroNarration.id || 'outro'}`]
    );
  }
  for (const [index, scene] of scenes.entries()) {
    const node = `scenes[${index}]`;
    if (!scene || !scene.id || !scene.purpose || !(Number(scene.duration) > 0)) fail('scene-contract', `Scene ${index + 1} needs id, purpose and duration.`, node, ['production-spec', `scene:${scene && scene.id || index}`]);
    if (!scene || !COMPONENTS.has(scene.component)) fail('scene-component', `Scene ${index + 1} uses an unsupported component.`, node, ['production-spec', `scene:${scene && scene.id || index}`]);
    if (!scene || !['scene', 'caption'].includes(scene.visualOwner)) fail('visual-owner', `Scene ${index + 1} must assign visualOwner to scene or caption.`, node, ['production-spec']);
    if (visualEvidenceContractEnabled && scene) {
      const question = String(scene.visualQuestion || '').trim();
      if (question.length < 6 || question.length > 100) {
        fail('visual-question', `Scene ${scene.id} needs one visualQuestion between 6 and 100 characters.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      const visualForm = String(scene.visualForm || '');
      if (!VISUAL_FORMS.has(visualForm)) {
        fail('visual-form', `Scene ${scene.id} visualForm must be photo, chart, diagram, hybrid, or text.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      const relation = scene.visualRelation && typeof scene.visualRelation === 'object' ? scene.visualRelation : null;
      const relationKind = String(relation && relation.kind || '');
      const evidenceType = String(relation && relation.evidenceType || '');
      if (!relation || !VISUAL_RELATIONS.has(relationKind) || !EVIDENCE_TYPES.has(evidenceType)) {
        fail('visual-relation', `Scene ${scene.id} must declare a valid visualRelation.kind and evidenceType.`, node, ['production-spec', `scene:${scene.id}`]);
      } else {
        if (String(relation.encoding || '').trim().length < 2 || String(relation.unit || '').trim().length < 1) {
          fail('visual-encoding', `Scene ${scene.id} visualRelation needs explicit encoding and unit/"not applicable".`, node, ['production-spec', `scene:${scene.id}`]);
        }
        const grounded = /^https?:\/\//.test(String(relation.sourceUrl || '')) || Number.isInteger(relation.claimIndex);
        if (['source-fact', 'computed', 'interpretation'].includes(evidenceType) && !grounded) {
          fail('visual-evidence-basis', `Scene ${scene.id} must link its visual relation to a sourceUrl or claimIndex.`, node, ['production-spec', `scene:${scene.id}`, 'research']);
        }
      }
      if (visualForm === 'chart') {
        if (!relation || !['source-fact', 'computed'].includes(String(relation.evidenceType || ''))) {
          fail('chart-evidence', `Scene ${scene.id} uses a chart but has no source-fact or computed evidence; use a diagram instead of invented metrics.`, node, ['production-spec', `scene:${scene.id}`]);
        }
        if (relationKind === 'none') fail('chart-relation', `Scene ${scene.id} chart must answer a real comparison, time, distribution, flow, hierarchy, geography, or composition question.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      if (['real-world', 'mixed'].includes(topicKind) && QUANTITATIVE_COMPONENTS.has(scene.component) && visualForm !== 'chart') {
        fail('pseudo-metric-component', `Scene ${scene.id} uses ${scene.component}, which displays quantitative-looking values. For a real-world topic it must be a sourced chart; otherwise choose photo, timeline-story, relationship-map, or state-morph.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      if (scene.component === 'timeline-story' && relationKind !== 'time') {
        fail('timeline-relation', `Scene ${scene.id} timeline-story must use visualRelation.kind=time.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      if (scene.component === 'relationship-map' && !['relationship', 'hierarchy', 'flow'].includes(relationKind)) {
        fail('relationship-relation', `Scene ${scene.id} relationship-map must express relationship, hierarchy, or flow.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      if (['photo', 'hybrid'].includes(visualForm)) {
        if (!scene.assetId || !sourceImageIds.has(scene.assetId)) {
          fail('scene-image-asset', `Scene ${scene.id} uses ${visualForm} but assetId does not reference visualEvidence.sourceImages.`, node, ['production-spec', `scene:${scene.id}`, 'image-assets']);
        }
      }
      if (scene.component === 'evidence-photo' && !['photo', 'hybrid'].includes(visualForm)) {
        fail('photo-component-form', `Scene ${scene.id} evidence-photo must use visualForm=photo or hybrid.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      if (photoMotionContractEnabled && scene.component === 'evidence-photo' && String(scene.photoMotion || '') === 'push-in') {
        fail('photo-scale-forbidden', `Scene ${scene.id} uses push-in. Scaling evidence photos is forbidden; use hold, reveal, pan, or rack-focus.`, node, ['production-spec', `scene:${scene.id}`, 'photo-direction']);
      } else if (photoMotionContractEnabled && scene.component === 'evidence-photo' && !PHOTO_MOTIONS.has(String(scene.photoMotion || ''))) {
        fail('photo-motion', `Scene ${scene.id} evidence-photo must declare photoMotion: ${[...PHOTO_MOTIONS].join(', ')}.`, node, ['production-spec', `scene:${scene.id}`, 'photo-direction']);
      }
    }
    if (cognitiveContractEnabled && scene) {
      const task = String(scene.cognitiveTask || '').trim();
      if (task.length < 6 || task.length > 80) {
        fail('cognitive-task', `Scene ${scene.id} needs one concrete cognitiveTask between 6 and 80 characters.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      const focus = String(scene.primaryFocus || '').trim();
      const supportedFocus = COMPONENT_FOCUS_IDS[scene.component] || new Set();
      if (!supportedFocus.has(focus)) {
        fail('primary-focus', `Scene ${scene.id} primaryFocus must map to a real ${scene.component} focus id: ${[...supportedFocus].join(', ')}.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      const change = scene.visibleChange && typeof scene.visibleChange === 'object' ? scene.visibleChange : null;
      const kind = String(change && change.kind || '');
      if (!change || !CHANGE_KINDS.has(kind)) {
        fail('visible-change', `Scene ${scene.id} visibleChange.kind must be none, state, or process.`, node, ['production-spec', `scene:${scene.id}`]);
      } else if (kind !== 'none') {
        const from = String(change.from || '').trim();
        const to = String(change.to || '').trim();
        if (from.length < 2 || to.length < 2 || normalize(from) === normalize(to)) {
          fail('visible-change-states', `Scene ${scene.id} must declare distinct visibleChange.from and visibleChange.to states.`, node, ['production-spec', `scene:${scene.id}`]);
        }
      }
      if (scene.purpose === 'mechanism' && kind === 'none') {
        fail('mechanism-without-change', `Scene ${scene.id} explains a mechanism but declares no visible state or process change.`, node, ['production-spec', `scene:${scene.id}`]);
      }
      if (explanationContractEnabled) {
        const mechanism = scene.visualMechanism && typeof scene.visualMechanism === 'object'
          ? scene.visualMechanism
          : null;
        const mechanismKind = String(mechanism && mechanism.kind || '');
        if (!mechanism || !VISUAL_MECHANISM_KINDS.has(mechanismKind)) {
          fail('visual-mechanism-kind', `Scene ${scene.id} visualMechanism.kind must name a supported explanatory grammar.`, node, ['production-spec', `scene:${scene.id}`]);
        } else {
          for (const field of ['input', 'process', 'output']) {
            if (String(mechanism[field] || '').trim().length < 2) {
              fail('visual-mechanism-flow', `Scene ${scene.id} visualMechanism.${field} must describe a visible input, process, or output state.`, node, ['production-spec', `scene:${scene.id}`]);
            }
          }
        }
      }
    }
    const screenTexts = Array.isArray(scene && scene.onScreenText) ? scene.onScreenText : [];
    const caption = normalize(scene && scene.captionText);
    const actualVisible = [scene && scene.title, scene && scene.keyword, scene && scene.body, ...(scene && scene.items || []), scene && scene.leftLabel, scene && scene.leftValue, scene && scene.rightLabel, scene && scene.rightValue].filter(Boolean);
    if (caption.length >= 4 && [...screenTexts, ...actualVisible].some((text) => normalize(text) === caption)) {
      fail('simultaneous-caption-echo', `Scene ${scene.id} repeats the same copy in the component and caption.`, node, ['production-spec', `scene:${scene.id}`, `caption:${scene.id}`]);
    }
    for (const text of screenTexts) {
      if (!actualVisible.some((value) => normalize(value).includes(normalize(text)) || normalize(text).includes(normalize(value)))) {
        fail('onscreen-declaration-drift', `Scene ${scene.id} declares onScreenText that is not represented by its component parameters.`, node, ['production-spec']);
        break;
      }
    }
    if (scene && scene.visualOwner === 'scene' && screenTexts.length === 0) fail('visual-owner-empty', `Scene ${scene.id} owns the visual message but has no onScreenText.`, node, ['production-spec']);
    if (scene && scene.visualOwner === 'caption' && !String(scene.captionText || '').trim()) fail('caption-owner-empty', `Scene ${scene.id} assigns ownership to caption but captionText is empty.`, node, ['production-spec']);
  }
  if (explanationContractEnabled) {
    const contentScenes = scenes.filter((scene) => scene && scene.purpose !== 'outro');
    const distinctComponents = new Set(contentScenes.map((scene) => scene.component));
    const minimumDistinct = Math.min(4, contentScenes.length);
    if (distinctComponents.size < minimumDistinct) {
      fail('component-diversity', `Use at least ${minimumDistinct} distinct visual components across non-outro scenes; repeating one card grammar makes the explanation visually monotonous.`, 'scenes', ['production-spec', 'scene-specs']);
    }
    const explanatoryCount = contentScenes.filter((scene) => EXPLANATORY_COMPONENTS.has(scene.component)).length;
    const minimumExplanatory = Math.min(4, contentScenes.length);
    if (explanatoryCount < minimumExplanatory) {
      fail('explanatory-component-coverage', `Use mechanism-native components in at least ${minimumExplanatory} non-outro scenes so principles are shown as motion, not narrated over cards.`, 'scenes', ['production-spec', 'scene-specs']);
    }
    const genericCount = contentScenes.filter((scene) => GENERIC_CARD_COMPONENTS.has(scene.component)).length;
    if (genericCount > 1) {
      fail('generic-card-overuse', 'At most one non-outro scene may use a generic card/list component; the rest must use mechanism-native visual grammars.', 'scenes', ['production-spec', 'scene-specs']);
    }
  }
  if (visualEvidenceContractEnabled) {
    const contentScenes = scenes.filter((scene) => scene && scene.purpose !== 'outro');
    const relationKinds = new Set(contentScenes.map((scene) => scene.visualRelation && scene.visualRelation.kind).filter((kind) => kind && kind !== 'none'));
    const minimumRelations = Math.min(3, contentScenes.length);
    if (relationKinds.size < minimumRelations) {
      fail('visual-relation-diversity', `Use at least ${minimumRelations} distinct information relationships across non-outro scenes; variety must come from semantics, not different skins on one dashboard.`, 'scenes', ['production-spec', 'scene-specs']);
    }
    if (['real-world', 'mixed'].includes(topicKind)) {
      const imageScenes = contentScenes.filter((scene) => ['photo', 'hybrid'].includes(String(scene.visualForm || '')));
      if (imageScenes.length < 2) {
        fail('real-world-image-scenes', 'Real-world and mixed topics need source-backed photo or hybrid evidence in at least two non-outro scenes.', 'scenes', ['production-spec', 'scene-specs', 'image-assets']);
      }
    }
  }
  if (photoMotionContractEnabled) {
    const photoScenes = scenes.filter((scene) => scene && scene.purpose !== 'outro' && scene.component === 'evidence-photo');
    const motionKinds = new Set(photoScenes.map((scene) => scene.photoMotion).filter((motion) => PHOTO_MOTIONS.has(motion)));
    const minimumMotions = Math.min(2, photoScenes.length);
    if (motionKinds.size < minimumMotions) {
      fail('photo-motion-diversity', `Use at least ${minimumMotions} distinct photo motion grammars across evidence-photo scenes; do not apply the same Ken Burns move to every image.`, 'scenes', ['production-spec', 'scene-specs', 'photo-direction']);
    }
  }
  const outroScene = pickOutroScene(scenes);
  if (outroScene && !hasVisualBrandCta(outroScene)) {
    fail(
      'outro-visual-brand-cta',
      `Outro scene ${outroScene.id} must show 向阳乔木 plus a follow CTA (@vista8 and/or 关注…) on screen. Pure knowledge ending without brand invite is not allowed.`,
      outroScene.id || 'scenes[outro]',
      ['production-spec', `scene:${outroScene.id || 'outro'}`]
    );
  }
  const expected = Number(spec.output && spec.output.duration);
  const total = scenes.reduce((sum, scene) => sum + Number(scene && scene.duration || 0), 0);
  if (Number.isFinite(expected) && Math.abs(total - expected) > 0.05) fail('duration-total', `Scene durations total ${total.toFixed(3)} but output.duration is ${expected.toFixed(3)}.`, 'scenes', ['production-spec', 'scene-plan', 'timeline']);
  const cover = spec.cover && typeof spec.cover === 'object' ? spec.cover : null;
  if (!cover || cover.enabled !== false) {
    const coverDuration = cover && Number(cover.duration) > 0 ? Number(cover.duration) : 1.5;
    if (coverDuration < 0.8 || coverDuration > 2.5) fail('cover-duration', 'Cover duration must be 0.8–2.5 seconds.', 'cover', ['production-spec', 'scene-plan', 'timeline']);
  }
  const coverDuration = !cover || cover.enabled !== false ? Number(cover && cover.duration) > 0 ? Number(cover.duration) : 1.5 : 0;
  const targetDuration = Number(spec.output && spec.output.targetDuration);
  if (Number.isFinite(targetDuration) && Math.abs(total + coverDuration - targetDuration) > 0.05) {
    fail('target-duration', `Scene durations plus cover total ${(total + coverDuration).toFixed(3)} but output.targetDuration is ${targetDuration.toFixed(3)}.`, 'output', ['production-spec', 'scene-plan', 'timeline']);
  }
  const narrationChars = segments.reduce((sum, item) => sum + String(item && item.text || '').length, 0);
  const narrationMin = Math.max(20, Math.round(Math.max(1, expected) * 3));
  const narrationMax = Math.max(narrationMin + 20, Math.round(Math.max(1, expected) * 8));
  if (narrationChars < narrationMin || narrationChars > narrationMax) warnings.push({ rule: 'narration-length', message: `${narrationChars} narration characters; the duration-scaled range for ${expected.toFixed(1)} seconds is ${narrationMin}–${narrationMax}.` });
  if (spec.timing && typeof spec.timing === 'object') {
    if (!['duration', 'phrase', 'word'].includes(String(spec.timing.level || ''))) {
      fail('timing-level', 'timing.level must be duration, phrase, or word.', 'timing', ['production-spec', 'captions', 'scene-plan', 'timeline']);
    }
    if (!/^[a-f0-9]{64}$/.test(String(spec.timing.audioSha256 || ''))) {
      fail('timing-audio-hash', 'timing.audioSha256 must be a SHA-256 digest.', 'timing', ['production-spec', 'timeline']);
    }
    if (!(Number(spec.timing.durationMs) > 0)) {
      fail('timing-duration', 'timing.durationMs must be a positive measured audio duration.', 'timing', ['production-spec', 'captions', 'scene-plan', 'timeline']);
    }
    if (Number(spec.timing.durationMs) > 0 && Number.isFinite(expected) && Math.abs(expected * 1000 - Number(spec.timing.durationMs)) > 50) {
      fail('timing-output-drift', 'output.duration must match timing.durationMs within 50 ms after timing is applied.', 'timing', ['production-spec', 'captions', 'scene-plan', 'timeline']);
    }
    const contractName = String(spec.timing.contract || '');
    const contractFile = path.resolve(projectRoot, contractName);
    const relativeContract = path.relative(projectRoot, contractFile);
    if (!contractName || path.isAbsolute(contractName) || relativeContract === '..' || relativeContract.startsWith(`..${path.sep}`) || !fs.existsSync(contractFile)) {
      fail('timing-contract', 'timing.contract must reference an existing project-relative narration timing contract.', 'timing', ['production-spec', 'captions', 'scene-plan', 'timeline']);
    } else {
      const timing = readJson(contractFile, contractName);
      if (timing.schema !== 'qiaocut.narration-timing.v1' || timing.audio && timing.audio.sha256 !== spec.timing.audioSha256) {
        fail('timing-contract-drift', 'The timing contract schema or audio SHA-256 does not match production-spec.json.', 'timing', ['production-spec', 'captions', 'scene-plan', 'timeline']);
      }
    }
  } else if (cognitiveContractEnabled) {
    warnings.push({ rule: 'timing-not-locked', message: 'Narration timing is not locked yet; treat authored scene durations as budgets until qcut explainer timing measures the real audio.' });
  }
  const result = {
    ok: errors.length === 0,
    cacheHit: false,
    gateVersion: PRODUCTION_SPEC_GATE_VERSION,
    specHash,
    errors,
    warnings,
    repairPlan
  };
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, `${JSON.stringify(result, null, 2)}\n`);
  } catch (_) {}
  return result;
}

// 画布尺寸来自 production spec 的 output，横屏项目不必手写 CSS 覆盖层。
function canvasVars(spec) {
  const w = Math.round(Number(spec?.output?.width) || 1080);
  const h = Math.round(Number(spec?.output?.height) || 1920);
  return { w, h, landscape: w > h };
}

function componentHtml(scene, spec) {
  const { w, h, landscape } = canvasVars(spec);
  const sourceImages = Array.isArray(spec.visualEvidence && spec.visualEvidence.sourceImages)
    ? spec.visualEvidence.sourceImages
    : [];
  const asset = sourceImages.find((item) => item && item.id === scene.assetId) || null;
  const localAssetPath = asset && String(asset.localPath || '').split(path.sep).join('/');
  const payload = {
    sceneId: scene.id,
    component: scene.component,
    cognitiveTask: scene.cognitiveTask,
    primaryFocus: scene.primaryFocus,
    visibleChange: scene.visibleChange,
    visualMechanism: scene.visualMechanism,
    visualQuestion: scene.visualQuestion,
    visualForm: scene.visualForm,
    visualRelation: scene.visualRelation,
    eyebrow: scene.eyebrow,
    title: scene.title,
    keyword: scene.keyword,
    body: scene.body,
    items: scene.items,
    leftLabel: scene.leftLabel,
    leftValue: scene.leftValue,
    rightLabel: scene.rightLabel,
    rightValue: scene.rightValue,
    assetId: scene.assetId || null,
    assetPath: localAssetPath ? `../${localAssetPath}` : null,
    assetObjectPosition: scene.assetObjectPosition || null,
    photoMotion: scene.photoMotion || null,
    assetSourceUrl: asset && asset.sourceUrl || scene.assetSourceUrl || null,
    assetCredit: asset && (asset.credit || asset.attribution) || scene.assetCredit || null,
    assetLicenseStatus: asset && asset.licenseStatus || null,
    durationMs: Math.round(Number(scene.duration) * 1000),
    // 可选动作节拍 [{at: 秒, action: 'activate'|'swap'|'pulse', target?: 步骤序号}]，
    // 缺省时运行时按 progress 自动均铺；gate 不校验内容细节。
    beats: Array.isArray(scene.beats) ? scene.beats : undefined
  };
  const styleVars = `<style>:root{--canvas-w:${w}px;--canvas-h:${h}px}</style>`;
  const orientation = landscape ? ' data-orientation="landscape"' : '';
  return `<!doctype html>\n<!-- qiaocut-generated-from-production-spec -->\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=${w}, initial-scale=1"><link rel="stylesheet" href="base.css">${styleVars}<title>${String(scene.title || scene.id).replace(/[<>&]/g, '')}</title></head><body${orientation}><main class="frame" data-qiaocut-component></main><script>window.__QIAOCUT_SCENE__=${JSON.stringify(payload).replace(/<\//g, '<\\/')};</script><script src="component-runtime.js"></script></body></html>\n`;
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function coverHtml(spec, cover) {
  const eyebrow = escapeHtml(cover.eyebrow || defaultEyebrow(spec.topic));
  const title = escapeHtml(cover.title || spec.topic || '');
  const highlight = escapeHtml(cover.highlight || '');
  const teaser = escapeHtml(cover.teaser || '');
  const brand = escapeHtml(cover.brand || '向阳乔木');
  const handle = escapeHtml(cover.handle || '@vista8');
  const cta = escapeHtml(cover.cta || '');
  const { w, h, landscape } = canvasVars(spec);
  // 竖版按高度铺陈；横屏画面矮而宽，需要更小的纵向留白、更窄的文本列和更靠上的水印。
  const L = landscape
    ? { pad: '76px 96px 72px', maxW: 1180, titleTop: 54, titleSize: 84, hlTop: 34, hlSize: 58, teaserSize: 36, markTop: 236, markSize: 420, markRight: 130, brandBottom: 72 }
    : { pad: '150px 84px 120px', maxW: 912, titleTop: 220, titleSize: 104, hlTop: 40, hlSize: 76, teaserSize: 42, markTop: 640, markSize: 300, markRight: 84, brandBottom: 120 };
  return `<!doctype html>
<!-- qiaocut-generated-cover-from-production-spec -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${w}, initial-scale=1">
<link rel="stylesheet" href="base.css">
<title>${title.replace(/[<>&]/g, '') || 'cover'}</title>
<style>
  :root { --canvas-w: ${w}px; --canvas-h: ${h}px; }
  .cover { position: relative; width: ${w}px; height: ${h}px; padding: ${L.pad}; }
  .cover-title { margin: ${L.titleTop}px 0 0; max-width: ${L.maxW}px; font-size: ${L.titleSize}px; font-weight: 800; line-height: 1.1; letter-spacing: -0.035em; color: var(--paper); }
  .cover-highlight { margin: ${L.hlTop}px 0 0; max-width: ${L.maxW}px; font-size: ${L.hlSize}px; font-weight: 780; line-height: 1.18; letter-spacing: -0.02em; color: var(--teacher); }
  .cover-teaser { ${landscape ? `position: absolute; left: 96px; bottom: 178px;` : 'margin: 120px 0 0;'} max-width: ${L.maxW}px; font-size: ${L.teaserSize}px; line-height: 1.5; color: rgba(241,234,223,0.9); }
  .cover-mark { position: absolute; right: ${L.markRight}px; top: ${L.markTop}px; font-size: ${L.markSize}px; font-weight: 800; color: transparent; -webkit-text-stroke: 3px rgba(242,191,75,0.55); line-height: 1; }
  .cover-brand { position: absolute; left: ${landscape ? 96 : 84}px; right: ${landscape ? 96 : 84}px; bottom: ${L.brandBottom}px; display: flex; align-items: baseline; gap: 24px; color: var(--muted); font-size: 34px; letter-spacing: 0.03em; }
  .cover-brand b { color: var(--paper); font-size: 40px; font-weight: 750; }
</style>
</head>
<body${landscape ? ' data-orientation="landscape"' : ''}>
<main class="cover">
  <div class="eyebrow">${eyebrow}</div>
  <h1 class="cover-title">${title}</h1>
  ${highlight ? `<div class="cover-highlight">${highlight}</div>` : ''}
  <div class="cover-mark" id="mark">?</div>
  ${teaser ? `<div class="cover-teaser">${teaser}</div>` : ''}
  <div class="cover-brand"><b>${brand}</b>${handle ? `<span>${handle}</span>` : ''}${cta ? `<span>· ${cta}</span>` : ''}</div>
</main>
<script>
(function(){
  var mark = document.getElementById('mark');
  window.__QIAOCUT_SET_TIME__ = function(ms){
    var t = ms / 1000;
    var pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    mark.style.webkitTextStroke = '3px rgba(242,191,75,' + (0.35 + 0.3 * pulse).toFixed(3) + ')';
    mark.style.transform = 'scale(' + (1 + 0.02 * pulse).toFixed(4) + ')';
  };
  window.__QIAOCUT_SET_TIME__(0);
})();
</script>
</body>
</html>
`;

}

function writeDerived(file, content, changed) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  fs.writeFileSync(file, content);
  changed.push(file);
}

function materializeProductionSpec(projectRoot) {
  const gate = checkProductionSpec(projectRoot);
  if (!gate.ok) throw new Error(`Production spec gate failed:\n${gate.errors.map((item) => `${item.rule}: ${item.message}`).join('\n')}`);
  const spec = readJson(path.join(projectRoot, 'production-spec.json'));
  const rawCover = spec.cover && typeof spec.cover === 'object' ? spec.cover : {};
  const cover = rawCover.enabled === false ? null : {
    duration: Number(rawCover.duration) > 0 ? Number(rawCover.duration) : 1.5,
    eyebrow: rawCover.eyebrow, title: rawCover.title, highlight: rawCover.highlight,
    teaser: rawCover.teaser, brand: rawCover.brand, handle: rawCover.handle, cta: rawCover.cta
  };
  const coverDuration = cover ? cover.duration : 0;
  const changed = [];
  const relativeChanged = () => changed.map((file) => path.relative(projectRoot, file).split(path.sep).join('/'));
  writeDerived(path.join(projectRoot, 'narration.txt'), `${spec.narrationSegments.map((item) => item.text.trim()).join('\n\n')}\n`, changed);
  const sourceImages = Array.isArray(spec.visualEvidence && spec.visualEvidence.sourceImages) ? spec.visualEvidence.sourceImages : [];
  const imageLedger = sourceImages.length
    ? `\n\n## 图像证据\n\n${sourceImages.map((image, index) => `${index + 1}. ${image.id} · ${image.localPath}\n   - 来源：${image.sourceUrl}\n   - 权利：${image.licenseStatus}${image.credit ? `\n   - 署名：${image.credit}` : ''}`).join('\n\n')}`
    : '';
  writeDerived(path.join(projectRoot, 'research.md'), `# ${spec.topic}：事实核验\n\n${spec.claims.map((claim, index) => `${index + 1}. ${claim.text}\n   - ${claim.sourceUrl}${claim.sourceStatus ? `\n   - 状态：${claim.sourceStatus}` : ''}`).join('\n\n')}${imageLedger}\n`, changed);
  writeDerived(path.join(projectRoot, 'storyboard.md'), `# ${spec.topic}：分镜\n\n${cover ? `0. **s00_cover** · 封面镜头 · ${coverDuration}s（第 0 帧即完整封面）\n\n` : ''}${spec.scenes.map((scene, index) => `${index + 1}. **${scene.id}** · ${scene.purpose} · ${scene.component}\n   - 认知任务：${scene.cognitiveTask || '待补'}\n   - 视觉问题：${scene.visualQuestion || '待补'}\n   - 视觉语法：${scene.visualForm || '未声明'} · ${scene.visualRelation && scene.visualRelation.kind || 'none'} · ${scene.visualRelation && scene.visualRelation.evidenceType || '无证据类型'}\n   - 主焦点：${scene.primaryFocus || '待补'}\n   - 可见变化：${scene.visibleChange && scene.visibleChange.kind || 'none'} · ${scene.visibleChange && scene.visibleChange.from || '无'} → ${scene.visibleChange && scene.visibleChange.to || '无'}\n   - 可视机制：${scene.visualMechanism && scene.visualMechanism.kind || '未声明'} · ${scene.visualMechanism && scene.visualMechanism.input || '无'} → ${scene.visualMechanism && scene.visualMechanism.process || '无'} → ${scene.visualMechanism && scene.visualMechanism.output || '无'}\n   - 图像资产：${scene.assetId || '无'}${scene.photoMotion ? ` · 动效 ${scene.photoMotion}` : ''}\n   - 视觉所有者：${scene.visualOwner}\n   - 画面：${(scene.onScreenText || []).join(' / ') || '图形关系'}\n   - 字幕：${scene.captionText || '无'}`).join('\n\n')}\n`, changed);
  let cursor = coverDuration;
  const captionEvents = [];
  for (const scene of spec.scenes) {
    if (String(scene.captionText || '').trim()) captionEvents.push({ start: cursor, end: cursor + Number(scene.duration), style: 'Chinese', text: scene.captionText, animation: 'fade' });
    cursor += Number(scene.duration);
  }
  writeDerived(path.join(projectRoot, 'captions', 'captions.json'), `${JSON.stringify({ title: spec.topic, coordinateWidth: 1080, coordinateHeight: 1920, font: 'Noto Sans CJK SC', events: captionEvents }, null, 2)}\n`, changed);
  const scenePlan = {
    schema: 'qiaocut.explainer-scenes.v1',
    output: { width: Number(spec.output.width || 1080), height: Number(spec.output.height || 1920), fps: Number(spec.output.fps || 24), duration: Number((Number(spec.output.duration) + coverDuration).toFixed(3)) },
    render: { htmlTransport: 'image2pipe', browserReuse: true, sharedContentCache: true },
    scenes: [
      ...(cover ? [{ id: 's00_cover', purpose: 'cover', source: 'scenes/s00_cover.html', engine: 'html', output: 'assets/scenes/s00_cover.mp4', duration: coverDuration, dependencies: ['scenes/base.css'] }] : []),
      ...spec.scenes.map((scene) => {
        const asset = sourceImages.find((item) => item && item.id === scene.assetId);
        return { id: scene.id, purpose: scene.purpose, component: scene.component, cognitiveTask: scene.cognitiveTask, visualQuestion: scene.visualQuestion, visualForm: scene.visualForm, visualRelation: scene.visualRelation, photoMotion: scene.photoMotion || null, primaryFocus: scene.primaryFocus, visibleChange: scene.visibleChange, visualMechanism: scene.visualMechanism, source: `scenes/${scene.id}.html`, engine: 'html', output: `assets/scenes/${scene.id}.mp4`, duration: Number(scene.duration), dependencies: ['scenes/base.css', 'scenes/component-runtime.js', ...(asset && asset.localPath ? [asset.localPath] : [])] };
      })
    ]
  };
  writeDerived(path.join(projectRoot, 'scene-plan.json'), `${JSON.stringify(scenePlan, null, 2)}\n`, changed);
  if (cover) writeDerived(path.join(projectRoot, 'scenes', 's00_cover.html'), coverHtml(spec, cover), changed);
  for (const scene of spec.scenes) writeDerived(path.join(projectRoot, 'scenes', `${scene.id}.html`), componentHtml(scene, spec), changed);
  // 已接线的人工资产不可被 materialize 冲掉：narration.engine=file（音频哈希与 spec.timing 匹配时）
  // 和用户显式选择的 music（false 或 file 模式）在重新物化时保留。
  const timelineFile = path.join(projectRoot, 'timeline.json');
  let preservedNarration = null;
  let preservedMusic;
  if (fs.existsSync(timelineFile)) {
    try {
      const previous = JSON.parse(fs.readFileSync(timelineFile, 'utf8'));
      if (previous && previous.narration && previous.narration.engine === 'file'
          && (!spec.timing || !spec.timing.audioSha256 || previous.narration.audioSha256 === spec.timing.audioSha256)) {
        preservedNarration = { ...previous.narration, start: coverDuration };
      }
      if (previous && (previous.music === false || (previous.music && typeof previous.music === 'object' && previous.music.mode === 'file'))) {
        preservedMusic = previous.music;
      }
    } catch (_) {}
  }
  const timeline = {
    schema: 'qiaocut.timeline.v1', title: spec.topic,
    output: { width: scenePlan.output.width, height: scenePlan.output.height, fps: scenePlan.output.fps, duration: scenePlan.output.duration, file: 'renders/final.mp4' },
    narration: preservedNarration || { engine: 'none', start: coverDuration, ...(spec.timing && spec.timing.contract ? { timingContract: spec.timing.contract, audioSha256: spec.timing.audioSha256, timingLevel: spec.timing.level } : {}) },
    // 知识讲解片默认无配乐：程序化合成垫音质不佳（用户反馈），需要配乐时由用户明确要求后改 file 模式。
    music: preservedMusic !== undefined ? preservedMusic : false,
    captionSource: 'captions/captions.json', captions: 'captions/final.ass',
    reports: { contactSheet: 'reports/contact-sheet.jpg', renderReport: 'reports/render-report.json' },
    shots: scenePlan.scenes.map((scene) => ({ id: scene.id, kind: 'video', path: scene.output, duration: scene.duration, fit: 'cover', sourceAudio: false }))
  };
  writeDerived(path.join(projectRoot, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`, changed);
  return { ok: true, specHash: gate.specHash, changed: relativeChanged(), reused: changed.length === 0, generatedScenes: spec.scenes.length, cover: cover ? { id: 's00_cover', duration: coverDuration } : null };
}

module.exports = {
  CHANGE_KINDS,
  COGNITIVE_CONTRACT_VERSION,
  EXPLANATION_CONTRACT_VERSION,
  EXPLANATORY_COMPONENTS,
  COMPONENTS,
  COMPONENT_FOCUS_IDS,
  PRODUCTION_SPEC_GATE_VERSION,
  VISUAL_MECHANISM_KINDS,
  SPEC_SCHEMA,
  checkProductionSpec,
  defaultEyebrow,
  defaultProductionSpec,
  hasSpokenBrandCta,
  hasVisualBrandCta,
  materializeProductionSpec
};
