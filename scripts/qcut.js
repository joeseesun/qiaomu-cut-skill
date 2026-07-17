#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { searchClipSeek } = require('./adapters/clipseek');
const { detect33tc } = require('./adapters/33tc');
const { scanLocal } = require('./adapters/local');
const { verifyVideo } = require('./verify_video');
const { generateAss, readCaptions } = require('./renderers/ass');
const { generateHtmlScene, sceneFromIr } = require('./renderers/html_scene');
const { readAssets, makeLicenseReport } = require('./license_report');

const VERSION = '0.2.0';

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
    engines: ['clipseek', 'pexels/pixabay provider pages', 'imagegen', 'ffmpeg-full'],
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
  'cinematic-short': {
    title: '电影感短片 / AI 视觉叙事',
    bestFor: ['氛围片', '概念片', '故事预告', '诗性短片', '城市/自然主题'],
    defaultFormat: '21:9, 16:9, or 9:16',
    engines: ['imagegen', 'clipseek', 'camera moves', 'color grade', 'ffmpeg-full'],
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
    engines: ['baocut optional', 'transcription', 'b-roll', 'ffmpeg-full'],
    outputs: ['clean cut', 'subtitle track', 'chapter clips']
  },
  'data-story': {
    title: '数据故事 / 图表动画',
    bestFor: ['报告解读', '商业分析', '排行榜', '趋势变化', '仪表盘讲解'],
    defaultFormat: '16:9',
    engines: ['html charts', 'svg animation', 'motion', 'ffmpeg-full'],
    outputs: ['data video', 'chart scenes', 'source data notes']
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

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
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
      message: 'ffmpeg not found. Run scripts/bootstrap_macos.sh --install on macOS.'
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
      ? 'Install ffmpeg-full and prefer /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg.'
      : 'Ready for ASS subtitles, overlays, and professional composition.'
  };
}

function inferWorkflow(brief, explicit) {
  if (explicit && WORKFLOWS[explicit]) return explicit;
  const text = String(brief || '').toLowerCase();
  const tests = [
    ['english-mix', ['英语', '台词', '电影', '剧集', '俚语', '脏话', 'subtitle', 'english']],
    ['person-profile', ['人物', '介绍', '传记', 'profile', 'founder', '创始人']],
    ['explainer', ['科普', '解释', '数学', '算法', '原理', '3blue1brown', 'manim']],
    ['product-launch', ['产品', '发布', '网站', 'app', 'saas', '插件', 'launch']],
    ['talking-head', ['口播', '访谈', '播客', '字幕', '精剪', '直播']],
    ['data-story', ['数据', '图表', '排行榜', '趋势', '报告']],
    ['cinematic-short', ['电影感', '预告', '氛围', '大片', 'cinematic']],
    ['social-short', ['抖音', '小红书', 'tiktok', '竖屏', '短视频']],
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
    sourceStrategy: ['local', 'clipseek', 'imagegen'],
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

function buildPlan(brief, options = {}) {
  const workflowId = inferWorkflow(brief, options.workflow);
  const workflow = WORKFLOWS[workflowId];
  const duration = Number(options.duration || (workflowId === 'social-short' ? 45 : 60));
  const format = options.format || workflow.defaultFormat || '16:9';
  const scenes = [
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
      pacing: workflowId === 'social-short' ? 'fast hook-heavy' : 'cinematic educational',
      typography: ['kinetic captions', 'safe-area subtitles', 'title cards'],
      color: ['clean contrast', 'subtle film grain when appropriate']
    },
    sources: {
      preferred: workflow.engines,
      fallback: ['local files', 'imagegen', 'html-renderer'],
      licenseRule: 'Record sourcePage/license/attribution for every non-local asset.'
    },
    scenes,
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
      }
    },
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
  writeOutput(readmePath, `# QiaoCut Project\n\nBrief: ${brief}\n\n## Commands\n\nAfter adding a project-relative timeline.json and its assets:\n\n\`\`\`bash\nnode ~/.agents/skills/qiaomu-cut/scripts/qcut.js doctor --json\nnode ~/.agents/skills/qiaomu-cut/scripts/qcut.js render . --json\nnode ~/.agents/skills/qiaomu-cut/scripts/qcut.js verify renders/final.mp4 --json\n\`\`\`\n`, { force: Boolean(flags.force) }, 'Project README');
  print({
    ok: true,
    project: root,
    files: [irPath, assetsPath, licensePath, readmePath],
    next: 'Add licensed assets, refine qiaocut-ir.json, author timeline.json, then render and verify.'
  }, flags);
}

async function commandRender(positional, flags) {
  const projectDir = positional[0];
  if (!projectDir) {
    throw new Error('Usage: qcut render <project-dir> [--timeline timeline.json] [--keep-build] [--force] [--allow-large] [--json]');
  }

  const renderer = path.join(__dirname, 'render_project.js');
  if (!fs.existsSync(renderer)) {
    throw new Error(`Project renderer not found: ${renderer}`);
  }

  const args = [renderer, path.resolve(projectDir)];
  if (flags.timeline) args.push('--timeline', flags.timeline);
  if (flags['keep-build']) args.push('--keep-build');
  if (flags.force) args.push('--force');
  if (flags['allow-large']) args.push('--allow-large');
  if (flags.json) args.push('--json');

  const result = childProcess.spawnSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: flags.json ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
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

async function commandTechniques(flags) {
  print(TECHNIQUES.map((id) => ({ id })), flags);
}

function help() {
  process.stdout.write(`qcut ${VERSION}

乔木智能剪辑导演 CLI

Usage:
  qcut doctor [--json]
  qcut 33tc <search|pick|cut|tasks|download|me> [...args]
  qcut clipseek "挖掘机" --type video|photo|illustration [--limit 5] [--json]
  qcut local /path/to/assets [--recursive] [--json]
  qcut plan "一句话视频需求" [--workflow english-mix] [--duration 60] [--format 9:16] [--json]
  qcut workflow list|show <id> [--json]
  qcut techniques [--json]
  qcut scaffold ./project --brief "一句话视频需求" [--force] [--json]
  qcut render <project-dir> [--timeline timeline.json] [--keep-build] [--force] [--allow-large] [--json]
  qcut license assets.json [--output license-report.md] [--force]
  qcut ass captions.json [--output subtitles.ass] [--force]
  qcut html-scene qiaocut-ir.json [--scene s01] [--output scene.html] [--force]
  qcut verify /path/to/video.mp4 [--json]

Notes:
  - ClipSeek is a discovery adapter. Verify license on provider source pages.
  - 33tc reads only local app/CLI presence and never prints tokens.
  - 33tc pick/cut may consume account credits. Review the range first; --yes is explicit confirmation.
  - Prefer ffmpeg-full for ASS subtitles, overlays, and professional composition.
  - Render paths in timeline.json must stay inside the project directory.
  - Existing generated outputs are preserved unless --force is explicit.
`);
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  if (command === '33tc') return command33tc(rest);
  const { flags, positional } = parseArgs(rest);
  if (command === 'help' || command === '--help' || command === '-h') return help();
  if (command === 'doctor') return commandDoctor(flags);
  if (command === 'clipseek') return commandClipSeek(positional, flags);
  if (command === 'local') return commandLocal(positional, flags);
  if (command === 'plan') return commandPlan(positional, flags);
  if (command === 'workflow') return commandWorkflow(positional, flags);
  if (command === 'techniques') return commandTechniques(flags);
  if (command === 'scaffold') return commandScaffold(positional, flags);
  if (command === 'render') return commandRender(positional, flags);
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
