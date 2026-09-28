#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const { searchClipSeek } = require('./adapters/clipseek');
const { detect33tc } = require('./adapters/33tc');
const { detectListenHub } = require('./adapters/listenhub');
const { scanLocal } = require('./adapters/local');
const { verifyVideo } = require('./verify_video');
const { generateAss, readCaptions } = require('./renderers/ass');
const { generateHtmlScene, sceneFromIr } = require('./renderers/html_scene');
const { readAssets, makeLicenseReport } = require('./license_report');
const { inspectSceneEngines } = require('./render_scene');

const VERSION = '0.13.0';

function displayPath(file) {
  if (!file || typeof file !== 'string') return file;
  const home = os.homedir();
  if (file === home || file.startsWith(`${home}${path.sep}`)) return `<HOME>${file.slice(home.length)}`;
  return file;
}

function displayText(value) {
  return String(value || '').split(os.homedir()).join('<HOME>');
}

const WORKFLOWS = {
  'english-mix': {
    title: '影视英语学习混剪',
    bestFor: ['电影台词', '英语学习', '情绪表达', '脏话/俚语教学', '原声复读'],
    defaultFormat: '16:9 or 9:16',
    engines: ['33tc', 'ffmpeg-full', 'ass-subtitles'],
    outputs: ['mp4', 'subtitle bilingual cards', 'vocabulary notes', 'source manifest']
  },
  'stock-story': {
    title: '免费素材故事片',
    bestFor: ['科普', '儿童启蒙', '行业介绍', '概念解释', 'B-roll 故事'],
    defaultFormat: '9:16',
    engines: ['clipseek', 'pexels/pixabay provider pages', 'imagegen', 'listenhub image/video/tts', 'ffmpeg-full'],
    outputs: ['mp4', 'asset license report', 'voiceover script']
  },
  'person-profile': {
    title: '人物介绍 / 档案短片',
    bestFor: ['企业家', '科学家', '艺术家', '历史人物', '公司创始人'],
    defaultFormat: '16:9 or 9:16',
    engines: ['web-info', 'local/archive images', 'html cards', 'ffmpeg-full'],
    outputs: ['timeline video', 'citation list', 'archive-style title cards']
  },
  explainer: {
    title: '知识科普 / 3Blue1Brown 风格解释动画',
    bestFor: ['数学', '算法', '物理', '抽象概念', '流程机制'],
    defaultFormat: '16:9',
    engines: ['manim', 'svg', 'html-renderer', 'ffmpeg-full'],
    outputs: ['animated explainer', 'scene source files', 'formula captions']
  },
  'explainer-social': {
    title: '竖屏知识科普 / 概念动画短视频',
    bestFor: ['AI 知识点', '抽象概念', '抖音/小红书科普', '信息图动画', '强字幕解说'],
    defaultFormat: '9:16',
    engines: ['html/svg/manim scene render', 'kinetic ass captions', 'sfx timeline', 'ffmpeg transitions', 'ffmpeg-full'],
    outputs: ['vertical animated explainer', 'scene source files', 'caption file', 'sfx map', 'cover frame']
  },
  'cinematic-short': {
    title: '电影感短片 / AI 视觉叙事',
    bestFor: ['氛围片', '概念片', '故事预告', '诗性短片', '城市/自然主题'],
    defaultFormat: '21:9, 16:9, or 9:16',
    engines: ['imagegen', 'listenhub image/video/music', 'clipseek', 'camera moves', 'color grade', 'ffmpeg-full'],
    outputs: ['cinematic mp4', 'shot list', 'look bible']
  },
  'product-launch': {
    title: '产品发布 / SaaS Launch 视频',
    bestFor: ['网站', 'App', '插件', 'AI 工具', '功能发布'],
    defaultFormat: '16:9',
    engines: ['html-renderer', 'motion', 'screen capture', 'ffmpeg-full'],
    outputs: ['launch video', 'feature cards', 'UI motion scenes']
  },
  'social-short': {
    title: '短视频平台强节奏视频',
    bestFor: ['抖音', '小红书', 'TikTok', 'Reels', '快节奏观点'],
    defaultFormat: '9:16',
    engines: ['kinetic captions', 'jump cuts', 'sound design', 'ffmpeg-full'],
    outputs: ['vertical mp4', 'caption file', 'cover frame']
  },
  'talking-head': {
    title: '口播精剪 + 字幕包装',
    bestFor: ['访谈', '课程', '播客切片', '个人观点', '直播回放'],
    defaultFormat: '9:16 or 16:9',
    engines: ['baocut optional', 'coli asr', 'listenhub tts/voice', 'b-roll', 'ffmpeg-full'],
    outputs: ['clean cut', 'subtitle track', 'chapter clips']
  },
  'data-story': {
    title: '数据故事 / 图表动画',
    bestFor: ['报告解读', '商业分析', '排行榜', '趋势变化', '仪表盘讲解'],
    defaultFormat: '16:9',
    engines: ['html charts', 'svg animation', 'motion', 'ffmpeg-full'],
    outputs: ['data video', 'chart scenes', 'source data notes']
  },
  'motion-design': {
    title: '代码动态图形 / Motion Design',
    bestFor: ['UI 形态变换', '产品卡点片', 'Showreel', '线稿/手绘动画', '歌词 MV', '像素动画', 'Three.js 代码电影'],
    defaultFormat: '16:9, 1:1, or 9:16',
    engines: ['qcut motion (brief → storyboard gate → probe → render)', 'qcut audio beats/peak', 'html/canvas/p5/three.js scene capture', 'sub-frame motion blur', 'ffmpeg-full'],
    outputs: ['motion-brief.json', 'beat-grid storyboard', 'pure-time scene source', 'probe contact sheet', 'mp4 with peak-aligned sfx']
  },
  'hybrid-studio': {
    title: '复杂混合项目',
    bestFor: ['多素材源', '多风格', '长视频', '系列视频', '客户级成片'],
    defaultFormat: 'project-defined',
    engines: ['all available adapters', 'multiple renderers', 'manual review gates'],
    outputs: ['project folder', 'IR', 'renders', 'reports']
  }
};

const TECHNIQUES = [
  'match_cut', 'jump_cut', 'j_cut', 'l_cut', 'smash_cut', 'montage',
  'slow_push_in', 'dolly_zoom_sim', 'parallax_photo', 'ken_burns',
  'whip_pan', 'speed_ramp', 'time_remap', 'mask_reveal', 'luma_matte',
  'split_screen', 'picture_in_picture', 'kinetic_typography', 'word_follow',
  'subtitle_highlight', 'lower_third', 'film_grain', 'letterbox',
  'sound_ducking', 'beat_cut', 'chapter_card', 'archive_card'
];

const VISUAL_DIRECTIONS = {
  'english-mix': 'cinematic editorial frames that preserve the source film mood, with restrained language-learning annotations',
  'stock-story': 'clear documentary editorial imagery whose subject, setting, age range, and emotional tone come from the brief',
  'person-profile': 'credible archival-documentary portraiture with period-aware materials, lighting, typography, and color',
  explainer: 'clean geometric explanatory visuals with a limited palette, legible hierarchy, and concept-first composition',
  'explainer-social': 'vertical-first geometric explanatory visuals with a limited palette, strong information hierarchy, caption-safe negative space, and platform-native pacing',
  'cinematic-short': 'cinematic, story-specific imagery with coherent lens language, production design, lighting, and grade',
  'product-launch': 'premium product visualization with precise UI hierarchy, controlled reflections, and brand-consistent color',
  'social-short': 'platform-native editorial imagery with an immediate focal point, bold crop, and caption-safe negative space',
  'talking-head': 'natural editorial B-roll that supports the speaker without competing with faces or captions',
  'data-story': 'information-led editorial imagery that supports charts and labels instead of adding decorative noise',
  'motion-design': 'high-end minimal motion graphics: one idea per shot, generous negative space, one accent color, one clean sans, springs and one coherent camera language',
  'hybrid-studio': 'a content-derived visual language selected from the subject, audience, era, emotion, platform, and medium'
};

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const equals = token.indexOf('=');
      if (equals > 2) {
        flags[token.slice(2, equals)] = token.slice(equals + 1);
        continue;
      }
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

function commandPath(command) {
  try {
    const result = childProcess.spawnSync('which', [command], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function writeOutput(file, content, flags, label = 'Output') {
  const absolute = path.resolve(file);
  if (fs.existsSync(absolute) && !flags.force) {
    throw new Error(`${label} already exists: ${displayPath(absolute)}. Re-run with --force to replace it.`);
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const extension = path.extname(absolute);
  const stem = path.basename(absolute, extension);
  const temporary = path.join(path.dirname(absolute), `.${stem}.qcut-${process.pid}-${Date.now()}${extension}`);
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, absolute);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    throw error;
  }
  return absolute;
}

function assertDistinctInputOutput(input, output, label) {
  const source = path.resolve(input);
  const target = path.resolve(output);
  let aliases = source === target;
  if (!aliases && fs.existsSync(source) && fs.existsSync(target)) {
    aliases = fs.realpathSync(source) === fs.realpathSync(target);
  }
  if (aliases) throw new Error(`${label} must not overwrite its input file.`);
}

function preferredFfmpeg() {
  const candidates = [
    process.env.QIAOMU_FFMPEG,
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
    commandPath('ffmpeg')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate) || !candidate.includes('/')) || null;
}

function inspectFfmpeg() {
  const ffmpeg = preferredFfmpeg();
  if (!ffmpeg) {
    return {
      available: false,
      ok: false,
      message: 'ffmpeg not found. Run: qcut setup --only ffmpeg'
    };
  }
  const version = run(ffmpeg, ['-version']);
  const filters = run(ffmpeg, ['-hide_banner', '-filters']);
  const encoders = run(ffmpeg, ['-hide_banner', '-encoders']);
  const versionText = version.stdout + version.stderr;
  const filterText = filters.stdout + filters.stderr;
  const encoderText = encoders.stdout + encoders.stderr;
  const capabilities = {
    libass: versionText.includes('--enable-libass') || filterText.includes(' ass '),
    drawtext: filterText.includes('drawtext'),
    subtitles: filterText.includes('subtitles'),
    overlay: filterText.includes('overlay'),
    zscale: filterText.includes('zscale'),
    loudnorm: filterText.includes('loudnorm'),
    sidechaincompress: filterText.includes('sidechaincompress'),
    zoompan: filterText.includes('zoompan'),
    xfade: filterText.includes('xfade'),
    libx264: encoderText.includes('libx264')
  };
  const missing = Object.entries(capabilities).filter(([, value]) => !value).map(([key]) => key);
  return {
    available: true,
    ok: missing.length === 0,
    path: displayPath(ffmpeg),
    firstLine: versionText.split(/\r?\n/)[0],
    capabilities,
    missing,
    recommendation: missing.length
      ? 'Run: qcut setup --only ffmpeg (installs ffmpeg-full).'
      : 'Ready for ASS subtitles, overlays, and professional composition.'
  };
}

function inferWorkflow(brief, explicit) {
  if (explicit && WORKFLOWS[explicit]) return explicit;
  const text = String(brief || '').toLowerCase();
  const explainerWords = ['科普', '解释', '数学', '算法', '原理', '知识点', '概念', '3blue1brown', 'manim'];
  const socialWords = ['抖音', '小红书', 'tiktok', 'reels', '竖屏', '短视频'];
  const oneShotExplainerWords = ['科普视频', '制作一个科普', '做一个科普', '介绍llm中的', '介绍大模型中的', 'explainer video'];
  if (oneShotExplainerWords.some((word) => text.includes(word))) return 'explainer-social';
  if (explainerWords.some((word) => text.includes(word)) && socialWords.some((word) => text.includes(word))) {
    return 'explainer-social';
  }
  const motionWords = ['动态图形', '动效视频', 'motion graphic', 'motion design', 'showreel', '卡点', '歌词mv', '歌词 mv', '线稿动画', '手绘动画', '水彩动画', '像素动画', 'pixel art', 'ui 动效', 'ui动效', '形态变换', 'kinetic typography', '代码动画', '代码生成视频', 'p5.js', 'three.js', 'canvas 动画', '用 js 做', '用js做'];
  if (motionWords.some((word) => text.includes(word)) && !['台词', '英语学习'].some((word) => text.includes(word))) return 'motion-design';
  const tests = [
    ['english-mix', ['英语', '台词', '电影', '剧集', '俚语', '脏话', 'subtitle', 'english']],
    ['person-profile', ['人物', '介绍', '传记', 'profile', 'founder', '创始人']],
    ['explainer', explainerWords],
    ['product-launch', ['产品', '发布', '网站', 'app', 'saas', '插件', 'launch']],
    ['talking-head', ['口播', '访谈', '播客', '字幕', '精剪', '直播']],
    ['data-story', ['数据', '图表', '排行榜', '趋势', '报告']],
    ['cinematic-short', ['电影感', '预告', '氛围', '大片', 'cinematic']],
    ['social-short', socialWords],
    ['stock-story', ['免费素材', '素材库', '挖掘机', 'pexels', 'pixabay', 'clipseek']]
  ];
  const matched = tests.find(([, words]) => words.some((word) => text.includes(word)));
  return matched ? matched[0] : 'hybrid-studio';
}

function makeScene(index, purpose, visual, technique, text) {
  return {
    id: `s${String(index).padStart(2, '0')}`,
    purpose,
    visual,
    sourceStrategy: ['local', 'clipseek', 'imagegen', 'listenhub'],
    motion: technique,
    transition: index === 1 ? 'cold_open' : 'match_cut_or_soft_cut',
    text: {
      type: 'kinetic_caption',
      content: text
    },
    audio: {
      role: index === 1 ? 'hook_hit' : 'voiceover_or_original_sound',
      ducking: true
    },
    verification: ['source recorded', 'caption safe-area checked']
  };
}

function explainerSocialScenes() {
  return [
    makeScene(1, 'hook', '用一个反直觉问题或强对比在 3 秒内提出概念', 'smash_cut', '提出观众真正想知道的问题。'),
    makeScene(2, 'definition', '先定义角色、对象和输入输出，不急着堆术语', 'match_cut', '用一句话建立最小正确模型。'),
    makeScene(3, 'mechanism', '用 Manim/SVG/HTML 展示关键机制、状态变化或因果链', 'montage', '让抽象机制变成可以看见的变化。'),
    makeScene(4, 'modern-practice', '连接到今天的 LLM 实践、训练数据或真实应用', 'match_cut', '说明它在现代大模型里如何使用。'),
    makeScene(5, 'benefits', '用并列比较展示它解决了什么问题', 'beat_cut', '把收益压缩成三个以内的清晰结果。'),
    makeScene(6, 'limits', '明确误区、代价和不能保证的能力', 'smash_cut', '告诉观众它不是什么。'),
    makeScene(7, 'outro', '一句话复述本质，并显示向阳乔木、@vista8 和关注 CTA', 'soft_cut', '用可复述的定义完成收束。')
  ];
}

function firstMatchingDirection(text, entries, fallback) {
  const match = entries.find(([words]) => words.some((word) => text.includes(word)));
  return match ? match[1] : fallback;
}

function deriveVisualBible(brief, workflowId, format) {
  const text = String(brief || '').toLowerCase();
  const medium = firstMatchingDirection(text, [
    [['水墨', 'ink wash', 'ink-wash'], 'Chinese ink-wash painting with expressive dry-brush texture and disciplined negative space'],
    [['油画', 'oil paint'], 'period-aware oil painting with visible brushwork and restrained museum color'],
    [['插画', 'illustration', '绘本'], 'editorial illustration with shape-led composition and controlled texture'],
    [['3d', '三维', 'c4d'], 'cinematic 3D visualization with physically plausible materials and lighting'],
    [['档案', 'archive', '历史照片', '老照片'], 'archival documentary treatment using era-authentic photographic materials'],
    [['网页', 'ui', 'app', '产品'], 'premium product/UI visualization with crisp hierarchy and controlled reflections']
  ], VISUAL_DIRECTIONS[workflowId]);
  const era = firstMatchingDirection(text, [
    [['唐代', '唐朝', '李白'], 'Tang-dynasty China; historically plausible clothing, architecture, paper, tools, and landscape'],
    [['宋代', '宋朝'], 'Song-dynasty China; historically plausible material culture and restrained literati taste'],
    [['古代', '历史', 'ancient'], 'period-specific historical world; avoid modern objects and generic fantasy'],
    [['民国', '1920', '1930'], 'Republican-era China with period-authentic streets, print, tailoring, and photography'],
    [['未来', '科幻', 'future', 'sci-fi'], 'near-future world grounded in coherent industrial design rather than neon cliché'],
    [['复古', 'retro', 'vintage'], 'era-aware vintage treatment whose typography and materials match the named period']
  ], 'contemporary and subject-authentic; do not invent an unrelated historical period');
  const emotion = firstMatchingDirection(text, [
    [['忧郁', '悲伤', 'melancholy', 'sad'], text.includes('希望') || text.includes('hope')
      ? 'melancholic but hopeful, moving from solitude toward a restrained warm release'
      : 'quietly melancholic, reflective, and emotionally restrained'],
    [['希望', '治愈', 'hope', 'healing'], 'hopeful and humane without sentimental excess'],
    [['紧张', '悬疑', 'thriller', 'suspense'], 'tense and investigative with controlled visual uncertainty'],
    [['热血', '激昂', 'epic'], 'energetic and expansive with earned heroic scale'],
    [['幽默', '搞笑', 'funny', 'comedy'], 'witty and playful with clear visual timing rather than random exaggeration']
  ], 'clear, intelligent, and emotionally appropriate to the subject');
  const palette = emotion.includes('melancholic but hopeful')
    ? ['ink black', 'mist blue-gray', 'aged paper', 'one restrained warm amber accent']
    : workflowId === 'product-launch'
      ? ['brand-led neutral base', 'one functional accent', 'controlled highlight color']
      : workflowId === 'explainer' || workflowId === 'explainer-social' || workflowId === 'data-story'
        ? ['deep neutral background', 'high-legibility foreground', 'two semantic accent colors']
        : ['subject-derived dominant', 'supporting neutral', 'single emotional accent'];
  const lighting = emotion.includes('melancholic but hopeful')
    ? 'soft overcast key with a subtle warm break in the distance; preserve detail in shadows'
    : workflowId === 'cinematic-short'
      ? 'motivated cinematic lighting with coherent direction and controlled contrast'
      : 'clear motivated light that supports subject readability and continuity';
  const composition = String(format).includes('9:16')
    ? 'vertical-first composition, immediate focal point, layered depth, upper/lower caption-safe negative space'
    : String(format).includes('21:9')
      ? 'widescreen cinematic blocking, strong horizontal depth, protected subtitle-safe lower third'
      : 'balanced cinematic 16:9 framing, clear subject hierarchy, protected title and subtitle safe areas';
  const bible = {
    strategy: 'content-derived',
    subject: String(brief).trim(),
    medium,
    era,
    emotion,
    palette,
    lighting,
    composition,
    texture: medium.includes('ink-wash') ? 'fibrous xuan paper, ink bloom, dry-brush edges; no plastic digital sheen' : 'content-appropriate, restrained, and consistent across scenes',
    typography: workflowId === 'person-profile' ? 'period-aware editorial titling with modern subtitle legibility' : 'legible editorial typography matched to the delivery platform',
    continuity: ['subject identity', 'palette', 'lighting direction', 'lens/composition', 'texture', 'typography'],
    negativePrompt: [
      'generic stock-photo look', 'style drift', 'unmotivated neon', 'anachronisms',
      'watermarks', 'garbled text', 'extra limbs or duplicate subjects',
      'colored vertical accent stripe on the left edge of a card or callout',
      'left-border blockquote used as a visual hierarchy shortcut'
    ],
    rule: 'Every generated image prompt must include this bible ID and preserve all locked fields; only scene action, shot size, and composition may vary.'
  };
  bible.id = `vb-${crypto.createHash('sha256').update(JSON.stringify(bible)).digest('hex').slice(0, 16)}`;
  bible.promptPrefix = [bible.subject, bible.medium, bible.era, bible.emotion, `palette: ${bible.palette.join(', ')}`, bible.lighting, bible.composition].join('; ');
  return bible;
}

function buildPlan(brief, options = {}) {
  const workflowId = inferWorkflow(brief, options.workflow);
  const workflow = WORKFLOWS[workflowId];
  const duration = Number(options.duration || (workflowId === 'social-short' ? 45 : workflowId === 'explainer-social' ? 75 : 60));
  const format = options.format || workflow.defaultFormat || '16:9';
  const visualBible = deriveVisualBible(brief, workflowId, format);
  const scenes = workflowId === 'explainer-social' ? explainerSocialScenes() : [
    makeScene(1, 'hook', '最强视觉或最有情绪的一句话/画面，3 秒内抓住注意力', 'smash_cut', '先让观众停下来。'),
    makeScene(2, 'context', '用信息卡或旁白说明主题、人物、概念或问题', 'slow_push_in', '告诉观众这条视频要解决什么。'),
    makeScene(3, 'development', '主体素材、B-roll、台词、数据或动画展开', 'montage', '把信息变成连续镜头。'),
    makeScene(4, 'turn', '加入对比、冲突、转折或关键洞察', 'match_cut', '制造记忆点。'),
    makeScene(5, 'payoff', '最高价值片段、结论或情绪释放', 'beat_cut', '给观众一个值得转发的瞬间。'),
    makeScene(6, 'outro', '收束、复读、CTA、来源或片尾', 'soft_cut', '把视频关得干净。')
  ];
  return {
    schema: 'qiaocut.ir.v0',
    createdAt: new Date().toISOString(),
    brief,
    workflow: {
      id: workflowId,
      title: workflow.title,
      bestFor: workflow.bestFor
    },
    output: {
      durationSeconds: duration,
      aspect: format,
      deliverables: ['final.mp4', 'qiaocut-ir.json', 'assets-manifest.json', 'license-report.md', 'quality-report.json']
    },
    style: {
      level: 'professional',
      pacing: workflowId === 'social-short' || workflowId === 'explainer-social'
        ? 'fast hook-heavy educational'
        : 'cinematic educational',
      typography: ['kinetic captions', 'safe-area subtitles', 'title cards'],
      color: ['clean contrast', 'subtle film grain only when the subject and era support it'],
      aestheticGuards: workflowId === 'explainer-social' ? [
        'Do not use a colored vertical line on the left edge of a card, block, quote, takeaway, or callout.',
        'Build hierarchy with spacing, scale, alignment, complete outlines, tonal surfaces, and motion—not decorative left stripes.',
        'Do not duplicate narration as both a large scene card and a burned subtitle in the same region.'
      ] : [],
      visualBible
    },
    sources: {
      preferred: workflow.engines,
      fallback: ['local files', 'imagegen', 'listenhub generated media', 'html-renderer'],
      licenseRule: 'Record sourcePage/license/attribution for every non-local asset.'
    },
    scenes,
    generation: {
      narration: {
        providerPriority: ['listenhub', 'project-file', 'macos-say'],
        preferredVoiceName: '向阳乔木 v1.1',
        language: 'zh',
        resolutionRule: 'Resolve an exact speaker-name match to a current speaker ID; never silently substitute another voice.',
        timelineRule: 'Fetch and ingest generated audio before using narration.engine=file; never place a provider URL in timeline.'
      },
      images: {
        styleStrategy: 'content-derived',
        visualBibleRequired: true,
        visualBibleId: visualBible.id,
        promptPrefix: visualBible.promptPrefix,
        negativePrompt: visualBible.negativePrompt,
        consistencyRule: 'Keep the visual bible stable across scenes and vary only scene content, shot size, action, and composition.'
      }
    },
    render: {
      primary: 'ffmpeg-full',
      optional: ['html-renderer', 'motion', 'manim', 'slides-renderer', 'imagegen'],
      audio: {
        loudnessTarget: '-14 LUFS for social, -16 LUFS for longform',
        ducking: true
      }
    },
    gates: ['doctor', 'source manifest', 'license report', 'video verify'],
    missingEvidence: [
      'No actual assets downloaded yet.',
      'No final render verified yet.',
      'Provider-specific license must be checked after resolving source pages.'
    ]
  };
}

function print(data, flags) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(`${item.mediaType || ''}\t${item.provider || ''}\t${item.title || item.id}\t${item.sourcePage || item.localPath || ''}\n`);
    }
    return;
  }
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

async function commandDoctor(flags) {
  const ffmpeg = inspectFfmpeg();
  const report = {
    ok: ffmpeg.ok,
    version: VERSION,
    node: process.version,
    cwd: '.',
    ffmpeg,
    adapters: {
      '33tc': detect33tc(),
      clipseek: {
        available: true,
        api: 'https://clip-seek-api.agilestudio.cn/search',
        role: 'free-media discovery; provider license must be verified on sourcePage'
      },
      local: {
        available: true,
        role: 'user-provided files'
      },
      imagegen: {
        available: 'agent-tool-dependent',
        role: 'generate missing stills, covers, illustrations, background plates'
      },
      listenhub: detectListenHub({ capabilities: true })
    },
    sceneEngines: inspectSceneEngines(),
    setup: (() => {
      const { STATUS } = require('./setup_deps');
      const missing = ['ffmpeg', 'font', 'browser', 'manim'].filter((name) => { try { return !STATUS[name]().ok; } catch (_) { return true; } });
      return { missing, command: missing.length ? `qcut setup --only ${missing.join(',')}` : null, policy: 'Install missing dependencies with qcut setup and continue; do not skip or downgrade.' };
    })(),
    optionalTools: {
      python3: displayPath(commandPath('python3')),
      manim: displayPath(commandPath('manim')),
      brew: displayPath(commandPath('brew')),
      gh: displayPath(commandPath('gh'))
    }
  };
  print(report, flags);
  process.exit(report.ok ? 0 : 1);
}

async function commandClipSeek(positional, flags) {
  const text = positional.join(' ').trim();
  const items = await searchClipSeek({
    text,
    type: flags.type || 'video',
    page: flags.page || 1,
    limit: flags.limit,
    debug: Boolean(flags.debug)
  });
  print(items, flags);
}

async function commandLocal(positional, flags) {
  const dir = positional[0] || process.cwd();
  const items = scanLocal(dir, { recursive: flags.recursive, limit: flags.limit || 100 });
  print(items, flags);
}

async function commandPlan(positional, flags) {
  const brief = positional.join(' ').trim();
  if (!brief) throw new Error('Usage: qcut plan "一句话视频需求" [--workflow english-mix] [--json]');
  const plan = buildPlan(brief, flags);
  print(plan, flags);
}

async function commandWorkflow(positional, flags) {
  const action = positional[0] || 'list';
  if (action === 'list') {
    const items = Object.entries(WORKFLOWS).map(([id, workflow]) => ({ id, ...workflow }));
    print(items, flags);
    return;
  }
  if (action === 'show') {
    const id = positional[1];
    if (!WORKFLOWS[id]) throw new Error(`Unknown workflow: ${id}`);
    print({ id, ...WORKFLOWS[id] }, flags);
    return;
  }
  throw new Error('Usage: qcut workflow list|show <workflow-id>');
}

async function commandVerify(positional, flags) {
  const file = positional[0];
  if (!file) throw new Error('Usage: qcut verify /path/to/video.mp4 --json');
  const report = verifyVideo(file);
  print(report, flags);
  process.exit(report.ok ? 0 : 1);
}

async function commandLicense(positional, flags) {
  const file = positional[0];
  if (!file) throw new Error('Usage: qcut license assets.json [--output license-report.md]');
  const report = makeLicenseReport(readAssets(file));
  if (flags.output) {
    assertDistinctInputOutput(file, flags.output, 'License report');
    const output = writeOutput(flags.output, report, flags, 'License report');
    print({ ok: true, output }, flags);
    return;
  }
  process.stdout.write(report);
}

async function commandAss(positional, flags) {
  const file = positional[0];
  if (!file) throw new Error('Usage: qcut ass captions.json --output subtitles.ass');
  const ass = generateAss(readCaptions(file), flags);
  if (flags.output) {
    assertDistinctInputOutput(file, flags.output, 'ASS subtitle');
    const output = writeOutput(flags.output, ass, flags, 'ASS subtitle');
    print({ ok: true, output }, flags);
    return;
  }
  process.stdout.write(ass);
}

async function commandHtmlScene(positional, flags) {
  const file = positional[0];
  if (!file) throw new Error('Usage: qcut html-scene qiaocut-ir.json --scene s01 --output scene.html');
  const scene = sceneFromIr(file, flags.scene);
  if (!scene) throw new Error(`Scene not found: ${flags.scene || 'first scene'}`);
  const html = generateHtmlScene(scene, { aspect: flags.aspect });
  if (flags.output) {
    assertDistinctInputOutput(file, flags.output, 'HTML scene');
    const output = writeOutput(flags.output, html, flags, 'HTML scene');
    print({ ok: true, output, scene: scene.id }, flags);
    return;
  }
  process.stdout.write(html);
}

async function commandScaffold(positional, flags) {
  const dir = positional[0];
  const brief = flags.brief || positional.slice(1).join(' ');
  if (!dir || !brief) throw new Error('Usage: qcut scaffold ./project --brief "一句话视频需求"');
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'renders'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scenes'), { recursive: true });
  const ir = buildPlan(brief, flags);
  const irPath = path.join(root, 'qiaocut-ir.json');
  const assetsPath = path.join(root, 'assets-manifest.json');
  const licensePath = path.join(root, 'license-report.md');
  const readmePath = path.join(root, 'README.md');
  const plannedOutputs = [irPath, assetsPath, licensePath, readmePath];
  const existing = plannedOutputs.filter((file) => fs.existsSync(file));
  if (existing.length && !flags.force) {
    throw new Error(`Scaffold would replace existing files: ${existing.join(', ')}. Re-run with --force to replace generated scaffold files.`);
  }
  writeOutput(irPath, JSON.stringify(ir, null, 2) + '\n', { force: Boolean(flags.force) }, 'QiaoCut IR');
  writeOutput(assetsPath, JSON.stringify({ assets: [] }, null, 2) + '\n', { force: Boolean(flags.force) }, 'Asset manifest');
  writeOutput(licensePath, makeLicenseReport([]), { force: Boolean(flags.force) }, 'License report');
  writeOutput(readmePath, `# QiaoCut Project\n\nBrief: ${brief}\n\n## Commands\n\nAfter adding a project-relative timeline.json and its assets:\n\n\`\`\`bash\nnode ~/.agents/skills/qiaomu-cut/scripts/qcut.js doctor --json\nnode ~/.agents/skills/qiaomu-cut/scripts/qcut.js render . --profile preview --json\nnode ~/.agents/skills/qiaomu-cut/scripts/qcut.js render . --profile final --json\n\`\`\`\n`, { force: Boolean(flags.force) }, 'Project README');
  print({
    ok: true,
    project: root,
    files: [irPath, assetsPath, licensePath, readmePath],
    next: 'Add licensed assets, refine qiaocut-ir.json, author timeline.json, iterate with preview, then render final once.'
  }, flags);
}

async function commandRender(rawArgs) {
  const renderer = path.join(__dirname, 'render_project.js');
  if (!fs.existsSync(renderer)) {
    throw new Error(`Project renderer not found: ${renderer}`);
  }

  const result = childProcess.spawnSync(process.execPath, [renderer, ...rawArgs], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

async function command33tc(rawArgs) {
  const adapter = path.join(__dirname, 'adapters', '33tc_cli.js');
  if (!fs.existsSync(adapter)) {
    throw new Error(`33tc adapter not found: ${adapter}`);
  }
  const result = childProcess.spawnSync(process.execPath, [adapter, ...rawArgs], {
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

async function delegateNodeScript(scriptName, rawArgs) {
  const script = path.join(__dirname, scriptName);
  if (!fs.existsSync(script)) throw new Error(`QiaoCut command implementation not found: ${scriptName}`);
  const result = childProcess.spawnSync(process.execPath, [script, ...rawArgs], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

async function commandListenHub(rawArgs) {
  return delegateNodeScript(path.join('adapters', 'listenhub_cli.js'), rawArgs);
}

async function commandIngest(rawArgs) {
  return delegateNodeScript('ingest_asset.js', rawArgs);
}

async function commandFetch(rawArgs) {
  return delegateNodeScript('fetch_generated.js', rawArgs);
}

async function commandScene(rawArgs) {
  return delegateNodeScript('render_scene.js', rawArgs);
}

async function commandExplainer(rawArgs) {
  return delegateNodeScript('explainer_pipeline.js', rawArgs);
}

async function commandEnglishMix(rawArgs) {
  return delegateNodeScript('english_mix.js', rawArgs);
}

async function commandSetup(rawArgs) {
  return delegateNodeScript('setup_deps.js', rawArgs);
}

async function commandMotion(rawArgs) {
  return delegateNodeScript('motion_studio.js', rawArgs);
}

async function commandAudio(rawArgs) {
  return delegateNodeScript('audio_beats.js', rawArgs);
}

async function commandTechniques(flags) {
  print(TECHNIQUES.map((id) => ({ id })), flags);
}

function help() {
  process.stdout.write(`qcut ${VERSION}

乔木智能剪辑导演 CLI

Usage:
  qcut doctor [--json]
  qcut setup [--check] [--only ffmpeg,font,browser,manim,listenhub] [--json]   install missing dependencies
  qcut 33tc <search|pick|cut|tasks|download|me> [...args]
  qcut listenhub doctor|capabilities [--json]
  qcut listenhub narration --text <text>|--text-file <project-relative.txt>
              --qcut-project <dir> [--voice-name "向阳乔木 v1.1"] --yes [--json]
  qcut listenhub asr <file> --model sensevoice --json [--qcut-project <dir>]
  qcut listenhub <upstream args...> --qcut-project <dir> [--allow-upload] [--yes]
  qcut clipseek "挖掘机" --type video|photo|illustration [--limit 5] [--json]
  qcut local /path/to/assets [--recursive] [--json]
  qcut plan "一句话视频需求" [--workflow english-mix] [--duration 60] [--format 9:16] [--json]
  qcut workflow list|show <id> [--json]
  qcut techniques [--json]
  qcut explainer init <project-dir> --topic "LLM 中的 RL" [--duration 75] [--json]
  qcut explainer check <project-dir> [--stage init|spec|author|scenes|preview|final] [--json]
  qcut explainer materialize <project-dir> [--json]
  qcut explainer timing <project-dir> --audio assets/generated/narration.mp3 [--apply] [--json]
  qcut explainer render-scenes <project-dir> [--force] [--json]
  qcut explainer preview|final <project-dir> [--force] [--json]
  qcut english-mix init <project-dir> --phrases "A|B|C" [--clips-per-phrase 4] [--json]
  qcut english-mix audit <project-dir> [--require-media] [--strict-boundaries] [--json]
  qcut english-mix pace <project-dir> [--lead-ms 60] [--tail-ms 500] [--crossfade-ms 200] [--apply] [--force] [--json]
  qcut english-mix review <project-dir> [--video renders/file.preview.mp4] [--frames 8] [--force] [--json]
  qcut motion styles|init|check|probe|render <project-dir> [...]   code-drawn motion design studio
  qcut audio beats <song> [--bpm 120] [--output reports/beat-grid.json] [--json]
  qcut audio peak <sfx> [--json]
  qcut scene render <project-dir> <source> --engine html|svg|manim
             --output assets/scenes/scene.mp4 [--duration 4] [--width 1080] [--height 1920]
             [--fps 30] [--scene-class SceneName] [--motion-blur 3] [--shutter 0.5]
             [--scale 0.5] [--force] [--json]
  qcut scene batch <project-dir> <batch-spec.json> [--force] [--json]
  qcut scaffold ./project --brief "一句话视频需求" [--force] [--json]
  qcut ingest <project-dir> <local-file> --kind image|video|audio --provider listenhub [--json]
  qcut fetch <project-dir> --result <private-capture.json> --field result.videoUrl
             --kind image|video|audio [--output assets/generated/...]
  qcut render <project-dir> [--profile preview|standard|final] [--validation basic|standard|full]
              [--timeline timeline.json] [--output renders/file.mp4] [--no-cache]
              [--keep-build] [--force] [--allow-large] [--json]
  qcut license assets.json [--output license-report.md] [--force]
  qcut ass captions.json [--output subtitles.ass] [--force]
  qcut html-scene qiaocut-ir.json [--scene s01] [--output scene.html] [--force]
  qcut verify /path/to/video.mp4 [--json]

Notes:
  - ClipSeek is a discovery adapter. Verify license on provider source pages.
  - 33tc reads only local app/CLI presence and never prints tokens.
  - 33tc pick/cut may consume account credits. Review the range first; --yes is explicit confirmation.
  - 33tc media downloads use bounded ffmpeg reconnect/retry. If a task already exists, recover it; never resubmit only to fix a download.
  - ListenHub remote creation requires --yes and --qcut-project; local uploads also require --allow-upload.
  - ListenHub credentials are read only from LISTENHUB_API_KEY or its own local credential store.
  - Remote task output is captured under project-local .qiaocut/jobs; fetch downloads it before timeline use.
  - Prefer ffmpeg-full for ASS subtitles, overlays, and professional composition.
  - Render paths in timeline.json must stay inside the project directory.
  - Preview is for fast iteration; only final+full is release-ready.
  - Segment cache is project-local under .qiaocut/cache and can be bypassed with --no-cache.
  - Explainer scenes use a cross-project SHA-256 cache; set QIAOMU_CUT_SHARED_CACHE=off to disable it.
  - After production-spec lock, run the one paid TTS request in parallel with local explainer materialization and asset authoring.
  - Existing generated outputs are preserved unless --force is explicit.
  - Motion scenes must be pure functions of time; motion probe proves it before any full render.
`);
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  if (command === '33tc') return command33tc(rest);
  if (command === 'listenhub') return commandListenHub(rest);
  if (command === 'ingest') return commandIngest(rest);
  if (command === 'fetch') return commandFetch(rest);
  if (command === 'scene') return commandScene(rest);
  if (command === 'explainer') return commandExplainer(rest);
  if (command === 'english-mix') return commandEnglishMix(rest);
  if (command === 'motion') return commandMotion(rest);
  if (command === 'setup') return commandSetup(rest);
  if (command === 'audio') return commandAudio(rest);
  if (command === 'render') return commandRender(rest);
  const { flags, positional } = parseArgs(rest);
  if (command === 'help' || command === '--help' || command === '-h') return help();
  if (command === 'doctor') return commandDoctor(flags);
  if (command === 'clipseek') return commandClipSeek(positional, flags);
  if (command === 'local') return commandLocal(positional, flags);
  if (command === 'plan') return commandPlan(positional, flags);
  if (command === 'workflow') return commandWorkflow(positional, flags);
  if (command === 'techniques') return commandTechniques(flags);
  if (command === 'scaffold') return commandScaffold(positional, flags);
  if (command === 'license') return commandLicense(positional, flags);
  if (command === 'ass') return commandAss(positional, flags);
  if (command === 'html-scene') return commandHtmlScene(positional, flags);
  if (command === 'verify') return commandVerify(positional, flags);
  if (command === 'version' || command === '--version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  throw new Error(`Unknown command: ${command}. Run qcut help.`);
}

main().catch((error) => {
  console.error(displayText(error.message));
  process.exit(1);
});
