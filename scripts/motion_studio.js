#!/usr/bin/env node
'use strict';

/*
 * qcut motion — code-drawn motion design studio.
 *
 *   init   scaffold motion-brief.json (inputs → direction → structure → build →
 *          gotchas → start), a pure-time scene and the motion kit
 *   check  storyboard-before-code gate: contiguous shots, cuts on the beat grid,
 *          banned list, dead time, one idea per shot, determinism lint
 *   probe  stills at every cut + midpoints, reverse/cold seek determinism proof,
 *          loop seam check and a contact sheet — before any full render
 *   render draft (half resolution, no blur) or final (sub-frame motion blur),
 *          music + peak-aligned SFX, loudness normalization, verification
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { captureBrowserScene, captureStills, projectPath } = require('./render_scene');
const { analyzeBeats, peakOffset } = require('./audio_beats');
const { verifyVideo } = require('./verify_video');

class UsageError extends Error {}

const SCHEMA = 'qiaocut.motion-brief.v1';
const KIT_SOURCE = path.join(__dirname, '..', 'assets', 'motion-kit', 'qiaocut-motion.js');

const BASE_BANNED = ['bouncy/elastic easing', 'particle bursts', 'lens flares', 'neon glows', 'camera shake', 'dead time with nothing changing', 'anything that looks like a template'];

const STYLES = {
  'product-promo': {
    title: '高端极简产品片',
    canvas: { width: 1920, height: 1080, fps: 60, duration: 20 },
    bpm: 120,
    direction: 'High-end minimal. One idea per shot, lots of empty space, one accent color, one clean sans with tight tracking.',
    camera: ['masked type reveals', 'match cuts measured at runtime', 'one smooth camera language', 'motion-blurred whip onto the hero', 'push cuts on stats'],
    banned: ['shockwave rings', 'particle bursts', 'RGB split', 'camera shake', 'lens flares', 'neon glows', 'grid floors', 'flashing backgrounds', 'bouncy easing', 'placeholder cards instead of real UI/footage'],
    structure: ['hook lands word by word on the beats', 'one hook word morphs into the product UI; cursor types and clicks', 'the drop: a shape opens out of the button into a new scene', 'key feature as big type', 'real UI/footage hero moment', 'proof: big stats on push cuts', 'logo reveal', 'fade to black'],
    inputs: ['product name + one-line promise', '3–5 UI moments to show', 'one accent color', 'real screenshots/clips the user owns', 'licensed song with a clear drop (optional)']
  },
  'ui-morph-loop': {
    title: 'UI 形态变换循环',
    canvas: { width: 1440, height: 1440, fps: 60, duration: 14 },
    bpm: 120,
    loop: true,
    direction: 'Dribbble-level UI motion. One shape, never cut: every state is the same element morphing size, radius and color while its content swaps with a short blur. A cursor drives every change with real clicks and drags. Springs everywhere, a tiny overshoot at most.',
    camera: ['camera zooms so each state fills the frame', 'no cuts — continuous morph', 'last frame equals first frame'],
    banned: ['bouncy easing', 'particle bursts', 'glows', 'gradients on UI chrome', 'mismatched icon strokes', 'dead time', 'anything that looks like a template'],
    structure: ['button', 'loader', 'check', 'dynamic island', 'player with play/pause morph', 'scrub → volume slider stretching past max', 'toggle on the beat', 'knob → liquid tab indicator', 'tabs → self-drawing chart', 'collapse to ⌘K → type → toast → back to button'],
    inputs: ['8–12 UI states', 'black/white or one accent color', 'licensed ~120 BPM song (optional)']
  },
  showreel: {
    title: '动态设计 Showreel',
    canvas: { width: 1920, height: 1080, fps: 60, duration: 15 },
    bpm: 128,
    direction: 'A motion designer showing range in 15 seconds: typographic, geometric and camera craft, each beat a new idea, one coherent palette.',
    camera: ['kinetic typography', 'match cuts', 'whip pans', 'dramatic cuts on downbeats', 'orbiting camera'],
    banned: BASE_BANNED,
    structure: ['cold-open typographic hit', 'geometric transformation', 'camera move through layers', 'kinetic type sequence', 'signature end card'],
    inputs: ['name/brand for the end card', 'palette or reference', 'licensed track (optional)']
  },
  'line-art-explainer': {
    title: '线稿/手绘讲解动画',
    canvas: { width: 1920, height: 1080, fps: 30, duration: 45 },
    bpm: null,
    direction: 'Light, playful line art drawn on in real time; each concept is literally drawn when the narration names it. Paper texture, one ink color plus one accent.',
    camera: ['draw-on strokes', 'slow push toward the active drawing', 'wipe-by-stroke transitions', 'callout labels drawn by hand'],
    banned: ['generic infographic look', 'stock clip-art', 'glossy 3D', 'photoreal faces', 'text walls'],
    structure: ['hook drawing', 'setup', 'mechanism step 1', 'mechanism step 2', 'mechanism step 3', 'payoff', 'outro'],
    inputs: ['topic or script / narration audio', 'subtitle language(s)', 'target platform']
  },
  'lyric-mv': {
    title: '歌词 MV / 动态排版 MV',
    canvas: { width: 1080, height: 1920, fps: 30, duration: 30 },
    bpm: 100,
    direction: 'The lyrics are the protagonist: big kinetic typography whose rhythm follows the vocal line; a strong visual hook in the first two seconds.',
    camera: ['word-by-word hits on vocal onsets', 'scale/position jumps on downbeats', 'hand-drawn texture layer', 'chorus gets the biggest visual idea'],
    banned: ['karaoke bar look', 'lyric text over busy footage without contrast', 'random effects unrelated to lyrics', 'dead time in instrumental gaps'],
    structure: ['visual hook', 'verse', 'pre-chorus build', 'chorus drop', 'outro'],
    inputs: ['song audio the user has rights to', 'lyrics with timing or a clean vocal', 'mood/reference images']
  },
  'pixel-art': {
    title: '像素动画',
    canvas: { width: 1280, height: 720, fps: 60, duration: 10 },
    bpm: null,
    loop: true,
    direction: 'Polished 16-bit sprite animation: fixed low logical resolution scaled by an integer factor, fixed palette, every coordinate snapped to the pixel grid, 8–12 fps pose feel.',
    camera: ['integer-scaled blit, imageSmoothingEnabled=false', 'state machine: idle → charge → act → recover', '1–2 px screen shake only on impact'],
    banned: ['sub-pixel positions', 'anti-aliasing', 'gradients or shadowBlur', 'colors outside the palette', 'vector shapes scaled down'],
    structure: ['idle', 'charge', 'action', 'recover → loop'],
    inputs: ['character/subject', 'palette mood', 'loop or story']
  },
  'cinematic-3d': {
    title: '代码电影 / Three.js 场景',
    canvas: { width: 1920, height: 1080, fps: 30, duration: 60 },
    bpm: null,
    direction: 'A cinematic film that happens to be rendered with code: atmosphere, scale, weather and light carry emotion; research-accurate staging; never a strategy-game or infographic look.',
    camera: ['establishing aerial', 'slow dolly through smoke/volumetrics', 'rack focus between layers', 'map inserts only when they explain'],
    banned: ['generic infographic look', 'strategy-game camera', 'primitive box figures', 'floating/sliding characters', 'unmotivated camera spins'],
    structure: ['establish world', 'stakes', 'turning point', 'climax', 'aftermath'],
    inputs: ['topic + facts to be accurate about', 'visual references (paintings, stills)', 'narration or not']
  }
};

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const equal = token.indexOf('=');
    if (equal > 2) { flags[token.slice(2, equal)] = token.slice(equal + 1); continue; }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) flags[token.slice(2)] = true;
    else { flags[token.slice(2)] = next; index += 1; }
  }
  return { positional, flags };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function readBrief(root) {
  const file = path.join(root, 'motion-brief.json');
  if (!fs.existsSync(file)) throw new Error('motion-brief.json not found. Run qcut motion init first.');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`motion-brief.json is not valid JSON: ${error.message}`); }
}

function loadGrid(root, brief) {
  const ref = brief.audio && brief.audio.beatGrid;
  if (ref) {
    const file = projectPath(root, ref, 'audio.beatGrid');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const bpm = Number(brief.audio && brief.audio.bpm);
  if (bpm > 0) {
    const duration = Number(brief.canvas.duration);
    const period = 60 / bpm;
    const first = Number(brief.audio.firstDownbeat || 0);
    const beats = [];
    for (let time = first; time <= duration + 1e-6; time += period) beats.push(round(time));
    return { bpm, beatsPerBar: 4, beats, downbeats: beats.filter((_, index) => index % 4 === 0), firstDownbeat: first, synthetic: true };
  }
  return null;
}

function storyboardSkeleton(style, canvas, bpm) {
  const beats = style.structure.length;
  const barSeconds = bpm ? (4 * 60) / bpm : null;
  const shots = [];
  let cursor = 0;
  for (let index = 0; index < beats; index += 1) {
    let end = index === beats - 1 ? canvas.duration : (canvas.duration * (index + 1)) / beats;
    if (barSeconds) end = index === beats - 1 ? canvas.duration : Math.max(cursor + barSeconds, Math.round(end / barSeconds) * barSeconds);
    end = Math.min(canvas.duration, round(end));
    if (end <= cursor) continue;
    shots.push({
      id: `s${String(index + 1).padStart(2, '0')}`,
      start: round(cursor),
      end,
      idea: `TODO: ${style.structure[index]}`,
      onScreenText: '',
      camera: 'TODO',
      transitionIn: index === 0 ? 'cold open' : 'TODO',
      events: []
    });
    cursor = end;
  }
  if (shots.length && shots[shots.length - 1].end < canvas.duration) shots[shots.length - 1].end = canvas.duration;
  return shots;
}

function sceneTemplate(brief) {
  const { width, height } = brief.canvas;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, height=${height}">
<title>${String(brief.title).replace(/</g, '&lt;')}</title>
<style>
  /* No CSS transitions/animations: every style is computed inside seek(t). */
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #f4f3f1; }
  body { font-family: "Geist", "Inter", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif; color: #0b0b0c; }
  #stage { position: absolute; inset: 0; }
  .shape { position: absolute; left: 50%; top: 50%; background: #0b0b0c; }
  .label { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); color: #f4f3f1; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap; }
</style>
</head>
<body>
<div id="stage">
  <div class="shape" id="shape"></div>
  <div class="label" id="label"></div>
</div>
<script src="../lib/qiaocut-motion.js"></script>
<script>
  // Starter scene: one element morphing between storyboard states on springs.
  // Replace freely, but keep seek(t) a pure function of t.
  const M = window.QiaoCutMotion;
  const DURATION = ${brief.canvas.duration};
  const SHOTS = ${JSON.stringify(brief.storyboard.map((shot) => ({ start: shot.start, end: shot.end, text: shot.onScreenText || '' })))};
  const shape = document.getElementById('shape');
  const label = document.getElementById('label');
  const unit = Math.min(${width}, ${height}) / 1080;
  label.style.fontSize = (56 * unit) + 'px';
  // Measure every label once at load (deterministic) so the container can
  // spring to fit its content; empty labels collapse to a dot.
  const SIZES = SHOTS.map((shot) => {
    label.textContent = shot.text;
    const w = shot.text ? label.offsetWidth + 96 * unit : 40 * unit;
    const h = shot.text ? label.offsetHeight + 56 * unit : 40 * unit;
    return { w, h, r: h / 2 };
  });
  const key = (prop) => SHOTS.map((shot, i) => ({ t: shot.start, value: SIZES[i][prop] }));
  const W = key('w'); const H = key('h'); const R = key('r');

  function seek(t) {
    const spring = { response: 0.42, damping: 0.86 };
    const w = M.springTrack(t, W, spring);
    const h = M.springTrack(t, H, spring);
    const r = M.springTrack(t, R, spring);
    shape.style.width = w + 'px';
    shape.style.height = h + 'px';
    shape.style.borderRadius = r + 'px';
    shape.style.transform = 'translate(-50%, -50%)';
    const found = SHOTS.findIndex((shot) => t >= shot.start && t < shot.end);
    const index = found < 0 ? SHOTS.length - 1 : found;
    const swapAt = SHOTS[index].start + 0.09;
    const s = M.swap(t, swapAt, 0.18);
    const incoming = t >= swapAt || index === 0;
    label.textContent = incoming ? SHOTS[index].text : SHOTS[index - 1].text;
    label.style.opacity = index === 0 && t < swapAt ? 1 : incoming ? s.incoming : s.outgoing;
    label.style.filter = 'blur(' + s.blur.toFixed(2) + 'px)';
    const fade = M.progress(t, DURATION - 0.4, DURATION);
    document.getElementById('stage').style.opacity = ${brief.loop ? '1' : '1 - fade'};
  }
  M.register(seek, { duration: DURATION });
  seek(0);
</script>
</body>
</html>
`;
}

function commandInit(root, flags) {
  const styleId = String(flags.style || 'product-promo');
  const style = STYLES[styleId];
  if (!style) throw new UsageError(`Unknown style: ${styleId}. Choose one of ${Object.keys(STYLES).join(', ')}.`);
  fs.mkdirSync(root, { recursive: true });
  const briefFile = path.join(root, 'motion-brief.json');
  if (fs.existsSync(briefFile) && !flags.force) throw new Error('motion-brief.json already exists. Re-run with --force to replace it.');
  const canvas = {
    width: Number(flags.width || style.canvas.width),
    height: Number(flags.height || style.canvas.height),
    fps: Number(flags.fps || style.canvas.fps),
    duration: Number(flags.duration || style.canvas.duration)
  };
  if (canvas.width % 2 || canvas.height % 2) throw new UsageError('width and height must be even.');
  let grid = null;
  let music = null;
  if (flags.audio) {
    const audio = projectPath(root, String(flags.audio), '--audio', true);
    music = path.relative(root, audio);
    grid = analyzeBeats(audio, { bpm: flags.bpm, displaySource: music });
    writeJson(path.join(root, 'reports', 'beat-grid.json'), grid);
  }
  const bpm = grid ? grid.bpm : (flags.bpm ? Number(flags.bpm) : style.bpm);
  const brief = {
    schema: SCHEMA,
    title: String(flags.title || style.title),
    style: styleId,
    canvas,
    loop: Boolean(flags.loop || style.loop),
    inputs: { ask: style.inputs, provided: {}, missing: [] },
    direction: {
      oneLine: String(flags.direction || style.direction),
      references: [],
      palette: [],
      typography: [],
      cameraLanguage: style.camera,
      banned: style.banned
    },
    audio: {
      music: music ? { path: music, inPoint: 0 } : null,
      bpm: bpm || null,
      firstDownbeat: grid ? 0 : 0,
      beatGrid: grid ? 'reports/beat-grid.json' : null,
      sfx: [],
      loudnessLUFS: -14
    },
    storyboard: [],
    build: { scene: 'scenes/main.html', motionBlurSubframes: 3, shutter: 0.5 },
    gotchas: [
      'Never put will-change on anything the camera scales, or text renders blurry.',
      'Never set opacity or filter on a preserve-3d element; fade its wrapper instead.',
      'Text swapping inside a morphing container needs its own enter/exit timing.',
      'Measure element positions at runtime for match cuts.',
      'A loop needs the last frame identical to the first, cursor position and speed included.'
    ],
    approval: { mode: String(flags.mode || 'ask'), storyboardApproved: false, note: 'ask: show the storyboard on the beat grid and wait for approval before final render; autopilot: one-line request, proceed after probe passes.' }
  };
  if (grid) {
    brief.audio.firstDownbeat = grid.firstDownbeat;
    brief.audio.note = `Beat grid from music: ${grid.bpm} BPM, first downbeat ${grid.firstDownbeat}s${grid.drop ? `, drop at ${grid.drop.time}s` : ''}. Set audio.music.inPoint so video t=0 lands on a downbeat.`;
  }
  const gridForSkeleton = grid ? null : bpm;
  brief.storyboard = storyboardSkeleton(style, canvas, gridForSkeleton);
  if (grid) {
    // Snap skeleton cuts to real downbeats (or beats when bars are scarce).
    const frame = 1 / canvas.fps;
    const inside = (list) => list.filter((time) => time > frame && time < canvas.duration - frame);
    let candidates = inside(grid.downbeats);
    if (candidates.length < brief.storyboard.length - 1) candidates = inside(grid.beats);
    const count = Math.min(brief.storyboard.length, candidates.length + 1);
    const cuts = [];
    for (let k = 1; k < count; k += 1) {
      const pick = candidates[Math.min(candidates.length - 1, Math.round((k * candidates.length) / count) - (k === count ? 1 : 0))];
      if (pick != null && (!cuts.length || pick > cuts[cuts.length - 1])) cuts.push(pick);
    }
    const bounds = [0, ...cuts, canvas.duration];
    brief.storyboard = brief.storyboard.slice(0, bounds.length - 1).map((shot, index) => ({ ...shot, start: round(bounds[index]), end: round(bounds[index + 1]) }));
  }
  writeJson(briefFile, brief);
  const sceneFile = path.join(root, 'scenes', 'main.html');
  if (!fs.existsSync(sceneFile) || flags.force) {
    fs.mkdirSync(path.dirname(sceneFile), { recursive: true });
    fs.writeFileSync(sceneFile, sceneTemplate(brief));
  }
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.copyFileSync(KIT_SOURCE, path.join(root, 'lib', 'qiaocut-motion.js'));
  for (const directory of ['assets', 'renders', 'reports']) fs.mkdirSync(path.join(root, directory), { recursive: true });
  return {
    ok: true,
    project: root,
    style: styleId,
    canvas,
    bpm: brief.audio.bpm,
    beatGrid: brief.audio.beatGrid,
    shots: brief.storyboard.length,
    next: 'Fill motion-brief.json (direction, references, storyboard ideas/camera/events), rewrite scenes/main.html, then run qcut motion check.'
  };
}

function commandScene(root, flags) {
  const brief = readBrief(root);
  const scene = projectPath(root, (brief.build && brief.build.scene) || 'scenes/main.html', 'build.scene');
  if (fs.existsSync(scene) && !flags.force) throw new Error(`${path.relative(root, scene)} exists. Re-run with --force to regenerate the starter scene.`);
  fs.mkdirSync(path.dirname(scene), { recursive: true });
  fs.writeFileSync(scene, sceneTemplate(brief));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.copyFileSync(KIT_SOURCE, path.join(root, 'lib', 'qiaocut-motion.js'));
  return { ok: true, scene: path.relative(root, scene), shots: brief.storyboard.length };
}

const DETERMINISM_LINT = [
  { pattern: /Math\.random\s*\(/, message: 'Math.random() makes frames non-reproducible; use QiaoCutMotion.random(index, seed).' },
  { pattern: /\bset(?:Timeout|Interval)\s*\(/, message: 'Timers carry state between frames; compute from t inside seek(t).' },
  { pattern: /\bDate\.now\s*\(|\bperformance\.now\s*\(/, message: 'Wall-clock time breaks seeking; use the t passed to seek(t).' },
  { pattern: /requestAnimationFrame\s*\(/, message: 'requestAnimationFrame loops are not seekable; register seek(t) with QiaoCutMotion.register.' },
  { pattern: /transition\s*:\s*(?!none)[^;]*\d/, message: 'CSS transitions animate outside the seek clock; compute styles from t instead.' }
];

function lintScene(file) {
  const errors = [];
  const warnings = [];
  const text = fs.readFileSync(file, 'utf8');
  const stripped = text.replace(/<script[^>]+src=[^>]+><\/script>/g, '');
  for (const rule of DETERMINISM_LINT) if (rule.pattern.test(stripped)) errors.push(rule.message);
  if (/will-change/.test(text)) warnings.push('will-change found: never put it on anything the camera scales (blurry text).');
  if (/preserve-3d/.test(text) && /(opacity|filter)\s*:/.test(text)) warnings.push('preserve-3d plus opacity/filter found: fade a wrapper, not the preserve-3d element.');
  if (/cubic-bezier\([^)]*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*(1\.[1-9]|[2-9])/.test(text)) warnings.push('Overshooting cubic-bezier found: overshoot should come from springs only.');
  if (!/__QIAOCUT_SET_TIME__|QiaoCutMotion\.register|M\.register|\.register\(/.test(text) && !/@keyframes/.test(text)) {
    errors.push('Scene exposes no seek clock: call QiaoCutMotion.register(seek) or define window.__QIAOCUT_SET_TIME__.');
  }
  return { errors, warnings };
}

function nearest(values, target) {
  let best = null;
  for (const value of values) if (best == null || Math.abs(value - target) < Math.abs(best - target)) best = value;
  return best;
}

function cjkAwareLength(text) {
  const value = String(text || '');
  const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const words = value.replace(/[\u3400-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length;
  return { cjk, words };
}

function checkBrief(root, brief) {
  const errors = [];
  const warnings = [];
  const add = (list, code, message, extra = {}) => list.push({ code, message, ...extra });
  if (brief.schema !== SCHEMA) add(errors, 'schema', `schema must be ${SCHEMA}.`);
  const canvas = brief.canvas || {};
  const fps = Number(canvas.fps);
  const duration = Number(canvas.duration);
  if (!(canvas.width > 0 && canvas.height > 0 && fps > 0 && duration > 0)) add(errors, 'canvas', 'canvas needs width, height, fps and duration.');
  const frame = fps > 0 ? 1 / fps : 1 / 30;
  const direction = brief.direction || {};
  if (!String(direction.oneLine || '').trim()) add(errors, 'direction', 'direction.oneLine must state the look in one sentence.');
  if (!Array.isArray(direction.banned) || direction.banned.length < 3) add(errors, 'banned-list', 'direction.banned needs at least 3 explicit bans to suppress template look.');
  if (!Array.isArray(direction.references) || direction.references.length === 0) {
    add(warnings, 'references', 'No reference image/video: references beat adjectives. Add one or record {kind:"none", why}.');
  }
  const approval = brief.approval || {};
  const missing = (brief.inputs && brief.inputs.missing) || [];
  if (approval.mode === 'ask' && missing.length) add(errors, 'inputs-missing', `Ask the user for: ${missing.join('; ')}.`);
  const shots = Array.isArray(brief.storyboard) ? brief.storyboard : [];
  if (!shots.length) add(errors, 'storyboard-empty', 'Write the storyboard before any scene code.');
  const grid = loadGrid(root, brief);
  const beats = grid ? grid.beats.map((time) => time - Number((brief.audio && brief.audio.music && brief.audio.music.inPoint) || 0)).filter((time) => time >= -frame) : null;
  const downbeats = grid ? grid.downbeats.map((time) => time - Number((brief.audio && brief.audio.music && brief.audio.music.inPoint) || 0)) : null;
  const barSeconds = grid ? (4 * 60) / grid.bpm : null;
  const ids = new Set();
  let cursor = 0;
  shots.forEach((shot, index) => {
    const label = shot.id || `storyboard[${index}]`;
    if (!shot.id) add(errors, 'shot-id', `${label} needs an id.`);
    else if (ids.has(shot.id)) add(errors, 'shot-id', `Duplicate shot id ${shot.id}.`);
    ids.add(shot.id);
    const start = Number(shot.start);
    const end = Number(shot.end);
    if (!(end > start)) add(errors, 'shot-time', `${label} needs start < end.`);
    if (Math.abs(start - cursor) > frame + 1e-6) add(errors, 'shot-contiguity', `${label} starts at ${start}s but the previous shot ended at ${round(cursor)}s (gap/overlap).`);
    cursor = end;
    for (const field of ['idea', 'camera']) {
      const value = String(shot[field] || '').trim();
      if (!value || /^todo\b/i.test(value)) add(errors, 'shot-unwritten', `${label}.${field} is not written yet.`);
    }
    if (index > 0 && !String(shot.transitionIn || '').trim()) add(warnings, 'transition', `${label} has no transitionIn; name the cut (match cut, whip, push, hard cut on downbeat…).`);
    const { cjk, words } = cjkAwareLength(shot.onScreenText);
    if (cjk > 18 || words > 12) add(warnings, 'one-idea', `${label} on-screen text is long (${cjk} CJK / ${words} words); one idea per shot.`);
    if (beats && index > 0) {
      const near = nearest(beats, start);
      if (near == null || Math.abs(near - start) > frame + 1e-6) add(errors, 'off-grid', `${label} cut at ${start}s is off the beat grid (nearest beat ${near == null ? 'n/a' : round(near)}s).`);
      else if (downbeats && Math.abs(nearest(downbeats, start) - start) > frame + 1e-6) add(warnings, 'not-downbeat', `${label} cut at ${start}s is on a beat but not a downbeat.`);
    }
    const events = Array.isArray(shot.events) ? shot.events : [];
    const limit = barSeconds ? barSeconds * 2 : 4;
    if (end - start > limit + frame && events.length === 0) add(warnings, 'dead-time', `${label} lasts ${round(end - start)}s with no events[]; something should happen on every beat or bar.`);
    for (const event of events) {
      const at = Number(event && event.at);
      if (!(at >= start && at <= end)) add(errors, 'event-time', `${label} event at ${event && event.at} is outside the shot.`);
    }
  });
  if (shots.length && Math.abs(cursor - duration) > frame + 1e-6) add(errors, 'storyboard-duration', `Storyboard ends at ${round(cursor)}s but canvas.duration is ${duration}s.`);
  const audio = brief.audio || {};
  if (audio.music && audio.music.path) {
    try { projectPath(root, audio.music.path, 'audio.music.path', true); }
    catch (error) { add(errors, 'music', error.message); }
    if (!audio.music.license) add(warnings, 'music-license', 'audio.music.license is empty; only use music whose license allows the intended (commercial) use.');
  }
  for (const [index, cue] of (audio.sfx || []).entries()) {
    try { projectPath(root, cue.path, `audio.sfx[${index}].path`, true); }
    catch (error) { add(errors, 'sfx', error.message); }
    if (!(Number(cue.at) >= 0 && Number(cue.at) < duration)) add(errors, 'sfx-time', `audio.sfx[${index}].at must be inside the video.`);
  }
  let lint = { errors: [], warnings: [] };
  const build = brief.build || {};
  try {
    const scene = projectPath(root, build.scene || 'scenes/main.html', 'build.scene', true);
    lint = lintScene(scene);
  } catch (error) {
    add(errors, 'scene', error.message);
  }
  for (const message of lint.errors) add(errors, 'determinism', message);
  for (const message of lint.warnings) add(warnings, 'gotcha', message);
  const awaitingApproval = approval.mode !== 'autopilot' && approval.storyboardApproved !== true;
  return {
    ok: errors.length === 0,
    status: errors.length ? 'blocked' : awaitingApproval ? 'awaiting-storyboard-approval' : 'ready',
    errors,
    warnings,
    grid: grid ? { bpm: grid.bpm, beats: grid.beats.length, synthetic: Boolean(grid.synthetic) } : null,
    shots: shots.length,
    storyboard: shots.map((shot) => ({ id: shot.id, start: shot.start, end: shot.end, idea: shot.idea, camera: shot.camera, transitionIn: shot.transitionIn }))
  };
}

function commandCheck(root) {
  const brief = readBrief(root);
  const result = checkBrief(root, brief);
  writeJson(path.join(root, 'reports', 'motion-check.json'), { checkedAt: new Date().toISOString(), ...result });
  return result;
}

function ffmpegPath() {
  const candidates = [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', 'ffmpeg'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!candidate.includes('/')) {
      const found = spawnSync('which', [candidate], { encoding: 'utf8' });
      if (found.status === 0) return found.stdout.trim();
    } else if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('ffmpeg is required.');
}

function runFfmpeg(args, cwd) {
  const result = spawnSync(ffmpegPath(), args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${String(result.stderr || '').slice(-1500)}`);
  return result;
}

function psnr(root, a, b) {
  const result = spawnSync(ffmpegPath(), ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { cwd: root, encoding: 'utf8' });
  const match = /average:(inf|[\d.]+)/.exec(result.stderr || '');
  if (!match) return null;
  return match[1] === 'inf' ? Infinity : Number(match[1]);
}

async function commandProbe(root, flags) {
  const brief = readBrief(root);
  const check = checkBrief(root, brief);
  if (!check.ok) return { ok: false, stage: 'check', errors: check.errors };
  const { width, height, duration } = brief.canvas;
  let times = [];
  if (flags.times) times = String(flags.times).split(',').map(Number).filter((value) => value >= 0 && value <= duration);
  else {
    for (const shot of brief.storyboard) {
      times.push(Number(shot.start) + 0.001, (Number(shot.start) + Number(shot.end)) / 2);
      for (const event of shot.events || []) times.push(Number(event.at));
    }
    times.push(Math.max(0, duration - 1 / brief.canvas.fps));
  }
  times = [...new Set(times.map((time) => round(Math.min(duration, Math.max(0, time)))))].sort((a, b) => a - b);
  const limit = Number(flags.max || 32);
  if (times.length > limit) times = times.filter((_, index) => index % Math.ceil(times.length / limit) === 0);
  if (brief.loop) times = [...new Set([0, ...times, duration])].sort((a, b) => a - b);
  const outDir = path.join(root, 'reports', 'motion-probe');
  fs.rmSync(outDir, { recursive: true, force: true });
  const scene = projectPath(root, brief.build.scene, 'build.scene', true);
  const capture = await captureStills({ projectRoot: root, source: scene, width, height, times, outDir, scale: Number(flags.scale || (width > 1280 ? 0.5 : 1)) });
  // Byte mismatches from Chrome raster history (layer promotion changes text
  // antialiasing by one level on a few pixels) are noise; real state leaks are not.
  if (capture.determinism) {
    const nameFor = (time) => `t${time.toFixed(3).replace('.', '_')}.png`;
    for (const item of capture.determinism.mismatches) {
      const value = item.file ? psnr(root, path.join('reports', 'motion-probe', nameFor(item.time)), item.file) : null;
      item.psnr = value === Infinity ? 'inf' : value;
      item.rasterNoise = value === Infinity || (value != null && value >= 50);
    }
    const real = capture.determinism.mismatches.filter((item) => !item.rasterNoise);
    capture.determinism.deterministic = real.length === 0;
    capture.determinism.rasterNoiseOnly = capture.determinism.mismatches.length - real.length;
    capture.determinism.rule = 'frames must match byte-for-byte, or differ only by raster noise (PSNR >= 50 dB)';
  }
  let loop = null;
  if (brief.loop) {
    const first = capture.stills.find((item) => item.time === 0);
    const last = capture.stills.find((item) => item.time === round(duration));
    const value = first && last ? psnr(root, first.file, last.file) : null;
    loop = { firstFrame: first && first.file, lastFrame: last && last.file, psnr: value === Infinity ? 'inf' : value, seamless: value === Infinity || (value != null && value >= 40) };
  }
  const columns = Math.min(6, capture.stills.length);
  const sheet = path.join(outDir, 'contact-sheet.jpg');
  const inputs = capture.stills.map((item) => item.file);
  const rows = Math.ceil(inputs.length / columns);
  const listFile = path.join(outDir, 'frames.txt');
  fs.writeFileSync(listFile, inputs.map((file) => `file '${path.resolve(root, file).replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', `scale=480:-2,tile=${columns}x${rows}:padding=6:color=0x202020`, '-frames:v', '1', sheet], root);
  } catch (_) { /* contact sheet is a convenience */ }
  const report = {
    ok: Boolean(capture.determinism ? capture.determinism.deterministic : true) && (!loop || loop.seamless),
    probedAt: new Date().toISOString(),
    sceneSha256: sha256File(scene),
    briefSha256: sha256File(path.join(root, 'motion-brief.json')),
    frames: capture.stills.length,
    stills: capture.stills.map((item) => ({ time: item.time, file: item.file })),
    determinism: capture.determinism,
    loop,
    contactSheet: fs.existsSync(sheet) ? path.relative(root, sheet) : null,
    review: 'Open the contact sheet and every cut frame. Fix anything cluttered, overlapping, off-grid or hard to read before rendering.'
  };
  writeJson(path.join(root, 'reports', 'motion-probe.json'), report);
  return report;
}

function mixAudio(root, brief, videoFile, output, profile) {
  const audio = brief.audio || {};
  const duration = Number(brief.canvas.duration);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoFile];
  const graph = [];
  const labels = [];
  const cues = [];
  let input = 1;
  if (audio.music && audio.music.path) {
    const music = projectPath(root, audio.music.path, 'audio.music.path', true);
    const inPoint = Number(audio.music.inPoint || 0);
    args.push('-i', music);
    const fadeOut = brief.loop ? 0 : Math.min(1.2, duration / 4);
    graph.push(`[${input}:a]atrim=start=${inPoint}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${Number(audio.music.gain || 1)}${fadeOut ? `,afade=t=out:st=${duration - fadeOut}:d=${fadeOut}` : ''}[m]`);
    labels.push('[m]');
    input += 1;
  }
  for (const [index, cue] of (audio.sfx || []).entries()) {
    const file = projectPath(root, cue.path, `audio.sfx[${index}].path`, true);
    const trim = Number(cue.trim || 0);
    const align = cue.alignPeak !== false;
    const peak = align ? peakOffset(file, { trim }) : { peakMs: 0 };
    let start = Number(cue.at) - peak.peakMs / 1000;
    let extraTrim = 0;
    if (start < 0) { extraTrim = -start; start = 0; }
    args.push('-i', file);
    const gain = cue.gain == null ? 0.5 : Number(cue.gain);
    graph.push(`[${input}:a]atrim=start=${trim + extraTrim},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${gain},adelay=${Math.round(start * 1000)}:all=1[s${index}]`);
    labels.push(`[s${index}]`);
    cues.push({ id: cue.id || `sfx${index + 1}`, path: cue.path, eventAt: Number(cue.at), peakMs: peak.peakMs, placedAt: round(start), gain });
    input += 1;
  }
  if (!labels.length) {
    fs.copyFileSync(videoFile, output);
    return { audio: false, cues };
  }
  const lufs = Number(audio.loudnessLUFS || -14);
  // Master in two passes: mix → measure integrated loudness → gain to target →
  // true-peak-safe limiter. Single-pass loudnorm undershoots on peaky material.
  const premix = output.replace(/\.mp4$/, '.premix.wav');
  graph.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,apad,atrim=0:${duration}[a]`);
  runFfmpeg([...args, '-filter_complex', graph.join(';'), '-map', '[a]', '-c:a', 'pcm_s24le', '-ar', '48000', premix], root);
  const measured = measureLoudness(root, premix);
  let gainDb = measured.integratedLUFS == null || !Number.isFinite(measured.integratedLUFS) ? 0 : lufs - measured.integratedLUFS;
  const mastered = output.replace(/\.mp4$/, '.master.wav');
  let achieved = null;
  for (let pass = 0; pass < 5; pass += 1) {
    gainDb = Math.max(-30, Math.min(30, gainDb));
    runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', premix,
      '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.8:attack=3:release=60:level=false`,
      '-c:a', 'pcm_s24le', '-ar', '48000', mastered], root);
    achieved = measureLoudness(root, mastered).integratedLUFS;
    if (achieved == null || Math.abs(achieved - lufs) <= 0.7) break;
    gainDb += lufs - achieved;
  }
  runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', videoFile, '-i', mastered,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', profile === 'final' ? '256k' : '160k',
    '-t', String(duration), '-movflags', '+faststart', output], root);
  fs.rmSync(mastered, { force: true });
  fs.rmSync(premix, { force: true });
  return { audio: true, loudnessTargetLUFS: lufs, premixLUFS: measured.integratedLUFS, gainDb: round(gainDb, 2), cues };
}

function measureLoudness(root, file) {
  const result = spawnSync(ffmpegPath(), ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = String(result.stderr || '');
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const integrated = /I:\s+(-?[\d.]+) LUFS/.exec(summary);
  const peak = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary);
  return { integratedLUFS: integrated ? Number(integrated[1]) : null, truePeakDbfs: peak ? Number(peak[1]) : null };
}

function verifyMotion(root, output, brief, mix, profile) {
  const base = verifyVideo(output);
  const errors = [...(base.errors || [])];
  const warnings = [...(base.warnings || [])]
    .filter((item) => !(mix.audio === false && /No audio stream/.test(item)))
    .filter((item) => !(profile === 'draft' && /width is low/.test(item)));
  const duration = base.format && base.format.duration;
  const frame = 1 / brief.canvas.fps;
  if (duration != null && Math.abs(duration - brief.canvas.duration) > frame * 2 + 0.05) errors.push(`Duration ${duration}s differs from canvas.duration ${brief.canvas.duration}s.`);
  let loudness = null;
  if (mix.audio) {
    loudness = measureLoudness(root, output);
    const target = Number((brief.audio && brief.audio.loudnessLUFS) || -14);
    if (loudness.integratedLUFS != null && Math.abs(loudness.integratedLUFS - target) > 1.5) warnings.push(`Integrated loudness ${loudness.integratedLUFS} LUFS is off target ${target} LUFS.`);
    if (loudness.truePeakDbfs != null && loudness.truePeakDbfs > -1) warnings.push(`Peak ${loudness.truePeakDbfs} dBFS is above -1 dBFS.`);
  }
  return { ...base, ok: errors.length === 0, errors, warnings, loudness };
}

async function commandRender(root, flags) {
  const brief = readBrief(root);
  const profile = String(flags.profile || 'draft');
  if (!['draft', 'final'].includes(profile)) throw new UsageError('--profile must be draft or final.');
  const check = checkBrief(root, brief);
  if (!check.ok) return { ok: false, stage: 'check', errors: check.errors };
  const scene = projectPath(root, brief.build.scene, 'build.scene', true);
  if (profile === 'final') {
    const probeFile = path.join(root, 'reports', 'motion-probe.json');
    const probe = fs.existsSync(probeFile) ? JSON.parse(fs.readFileSync(probeFile, 'utf8')) : null;
    const blockers = [];
    if (!probe) blockers.push('Run qcut motion probe before the final render.');
    else {
      if (!probe.ok) blockers.push('The last probe failed (non-deterministic frames or loop seam). Fix and re-probe.');
      if (probe.sceneSha256 !== sha256File(scene)) blockers.push('Scene changed since the last probe. Re-run qcut motion probe.');
    }
    if (check.status === 'awaiting-storyboard-approval') blockers.push('approval.mode is ask and the storyboard is not approved. Show the storyboard on the beat grid, then set approval.storyboardApproved=true.');
    if (blockers.length) return { ok: false, stage: 'final-gate', errors: blockers };
  }
  const { width, height, fps, duration } = brief.canvas;
  const build = brief.build || {};
  const videoOnly = projectPath(root, `renders/motion.${profile}.video.mp4`, 'render output');
  const output = projectPath(root, `renders/motion.${profile}.mp4`, 'render output');
  for (const file of [videoOnly, output]) {
    if (fs.existsSync(file)) {
      if (!flags.force) throw new Error(`${path.relative(root, file)} exists. Re-run with --force to replace it.`);
      fs.unlinkSync(file);
    }
  }
  const started = Date.now();
  const capture = await captureBrowserScene({
    projectRoot: root,
    source: scene,
    output: videoOnly,
    width, height, fps, duration,
    transparent: false,
    allowLarge: true,
    motionBlur: profile === 'final' ? Number(build.motionBlurSubframes || 3) : 1,
    shutter: build.shutter,
    scale: profile === 'final' ? 1 : Number(flags.scale || 0.5)
  });
  const captureSeconds = (Date.now() - started) / 1000;
  const mix = mixAudio(root, brief, videoOnly, output, profile);
  const verification = verifyMotion(root, output, brief, mix, profile);
  const report = {
    ok: Boolean(verification && verification.ok !== false),
    profile,
    output: path.relative(root, output),
    videoOnly: path.relative(root, videoOnly),
    canvas: brief.canvas,
    capture: { frames: capture.frames, motionBlur: capture.motionBlur, scale: capture.scale, seconds: round(captureSeconds, 1) },
    audio: mix,
    verification,
    releaseReady: profile === 'final' && Boolean(verification && verification.ok !== false)
  };
  writeJson(path.join(root, 'reports', `motion-render-${profile}.json`), report);
  return report;
}

function usage() {
  return `Usage:
  qcut motion styles [--json]
  qcut motion init <project> [--style ${Object.keys(STYLES).join('|')}] [--title T]
                   [--audio assets/song.mp3] [--bpm 120] [--width W --height H --fps F --duration S]
                   [--loop] [--mode ask|autopilot] [--force] [--json]
  qcut motion scene  <project> [--force]      regenerate the starter scene from the storyboard
  qcut motion check  <project> [--json]
  qcut motion probe  <project> [--times 0,1.5,3] [--max 32] [--json]
  qcut motion render <project> [--profile draft|final] [--force] [--json]
`;
}

async function cli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const [command, project] = positional;
  if (command === 'styles') {
    const list = Object.entries(STYLES).map(([id, style]) => ({ id, title: style.title, canvas: style.canvas, bpm: style.bpm, loop: Boolean(style.loop) }));
    process.stdout.write(flags.json ? `${JSON.stringify(list, null, 2)}\n` : `${list.map((item) => `${item.id}\t${item.title}`).join('\n')}\n`);
    return 0;
  }
  if (!['init', 'scene', 'check', 'probe', 'render'].includes(command) || !project) throw new UsageError(usage());
  const root = path.resolve(project);
  if (command !== 'init' && !fs.existsSync(root)) throw new Error('Project directory not found.');
  let result;
  if (command === 'init') result = commandInit(root, flags);
  else if (command === 'scene') result = commandScene(root, flags);
  else if (command === 'check') result = commandCheck(root);
  else if (command === 'probe') result = await commandProbe(root, flags);
  else result = await commandRender(root, flags);
  if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${command}: ${result.ok ? 'ok' : 'blocked'}${result.status ? ` (${result.status})` : ''}\n${(result.errors || []).map((item) => `  ✗ ${item.message || item}`).join('\n')}\n`);
  return result.ok ? 0 : 1;
}

module.exports = { STYLES, checkBrief, lintScene, storyboardSkeleton };

if (require.main === module) {
  cli().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
