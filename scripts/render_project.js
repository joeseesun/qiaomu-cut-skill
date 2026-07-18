#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { generateBilingualAss, readCaptionDocument } = require('./renderers/bilingual_ass');
const { generateProceduralMusic } = require('./renderers/procedural_music');

class UsageError extends Error {}

const SEGMENT_CACHE_VERSION = 'qiaomu-cut-segment-v1';
const TTS_CACHE_VERSION = 'qiaomu-cut-macos-say-v1';
const PICTURE_CACHE_VERSION = 'qiaomu-cut-picture-v2';
const RENDER_PROFILES = Object.freeze({
  preview: Object.freeze({
    maxDimension: 960,
    maxFps: 24,
    intermediatePreset: 'ultrafast',
    intermediateCrf: 28,
    preset: 'ultrafast',
    crf: 25,
    normalization: 'single-pass',
    validation: 'basic',
    contactSheet: false
  }),
  standard: Object.freeze({
    maxDimension: 1280,
    maxFps: 30,
    intermediatePreset: 'veryfast',
    intermediateCrf: 24,
    preset: 'veryfast',
    crf: 21,
    normalization: 'single-pass',
    validation: 'standard',
    contactSheet: true
  }),
  final: Object.freeze({
    maxDimension: null,
    maxFps: null,
    normalization: 'two-pass',
    validation: 'full',
    contactSheet: true
  })
});
const VALIDATION_LEVELS = new Set(['basic', 'standard', 'full']);

function displayPath(file) {
  if (!file || typeof file !== 'string') return file;
  const home = os.homedir();
  return file === home || file.startsWith(`${home}${path.sep}`)
    ? `<HOME>${file.slice(home.length)}`
    : file;
}

function displayText(value) {
  return String(value || '').split(os.homedir()).join('<HOME>');
}

function finite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function suffixedPath(file, suffix) {
  const extension = path.extname(file);
  const stem = extension ? file.slice(0, -extension.length) : file;
  return `${stem}.${suffix}${extension}`;
}

function scaledDimensions(width, height, maxDimension) {
  if (!maxDimension || Math.max(width, height) <= maxDimension) return { width, height };
  const ratio = maxDimension / Math.max(width, height);
  const even = (value) => Math.max(2, Math.round(value * ratio / 2) * 2);
  return { width: even(width), height: even(height) };
}

function applyRenderProfile(sourceTimeline, options = {}) {
  const name = options.profile || 'final';
  const profile = RENDER_PROFILES[name];
  if (!profile) throw new UsageError(`Unknown render profile: ${name}. Expected preview, standard, or final.`);
  const validation = options.validation || profile.validation;
  if (!VALIDATION_LEVELS.has(validation)) {
    throw new UsageError(`Unknown validation level: ${validation}. Expected basic, standard, or full.`);
  }

  const timeline = JSON.parse(JSON.stringify(sourceTimeline));
  timeline.output = { ...(timeline.output || {}) };
  timeline.reports = { ...(timeline.reports || {}) };
  timeline._renderProfile = name;
  timeline._validationLevel = validation;
  timeline._normalizationMode = profile.normalization;

  if (name !== 'final') {
    const dimensions = scaledDimensions(
      finite(timeline.output.width, 0),
      finite(timeline.output.height, 0),
      profile.maxDimension
    );
    timeline.output.width = dimensions.width;
    timeline.output.height = dimensions.height;
    timeline.output.fps = Math.min(finite(timeline.output.fps, profile.maxFps), profile.maxFps);
    timeline.output.intermediatePreset = profile.intermediatePreset;
    timeline.output.intermediateCrf = profile.intermediateCrf;
    timeline.output.preset = profile.preset;
    timeline.output.crf = profile.crf;
  }

  const originalOutput = timeline.output.file || 'renders/final.mp4';
  timeline.output.file = options.output || (name === 'final' ? originalOutput : suffixedPath(originalOutput, name));
  if (name !== 'final') {
    if (timeline.captionSource) {
      timeline.captions = suffixedPath(timeline.captions || 'captions/final.ass', name);
    }
    timeline.reports.renderReport = suffixedPath(
      timeline.reports.renderReport || 'reports/render-report.json',
      name
    );
    if (profile.contactSheet === false) {
      timeline.reports.contactSheet = false;
    } else if (timeline.reports.contactSheet !== false) {
      timeline.reports.contactSheet = suffixedPath(
        timeline.reports.contactSheet || 'reports/contact-sheet.jpg',
        name
      );
      timeline.reports.contactSheetFrames = Math.min(finite(timeline.reports.contactSheetFrames, 8), 8);
      timeline.reports.contactSheetThumbWidth = Math.min(finite(timeline.reports.contactSheetThumbWidth, 240), 240);
    }
  } else if (options.output) {
    timeline.output.file = options.output;
  }
  return { timeline, name, validation, profile };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    do {
      bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function temporarySibling(file) {
  const extension = path.extname(file);
  const stem = path.basename(file, extension);
  return path.join(
    path.dirname(file),
    `.${stem}.qiaocut-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`
  );
}

function commitTemporary(temp, destination) {
  try {
    fs.renameSync(temp, destination);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    throw error;
  }
}

function atomicWriteFile(file, data, encoding = 'utf8') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = temporarySibling(file);
  try {
    fs.writeFileSync(temp, data, { encoding, mode: 0o600 });
    commitTemporary(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    throw error;
  }
}

function writeJson(file, data) {
  atomicWriteFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function entryExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function nearestExisting(target) {
  let cursor = target;
  while (!entryExists(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  return cursor;
}

function assertPhysicalPathWithin(root, target, label) {
  const rootReal = fs.realpathSync(root);
  const anchor = nearestExisting(target);
  if (!anchor) throw new Error(`${label} has no resolvable parent path.`);
  let anchorReal;
  try {
    anchorReal = fs.realpathSync(anchor);
  } catch {
    throw new Error(`${label} contains a dangling or unreadable symbolic link.`);
  }
  if (!isWithin(rootReal, anchorReal)) {
    throw new Error(`${label} escapes the project directory through a symbolic link.`);
  }
}

function ensureInternalDirectory(root, target, label) {
  assertPhysicalPathWithin(root, target, label);
  fs.mkdirSync(target, { recursive: true });
  assertPhysicalPathWithin(root, target, label);
}

function projectPath(root, relativePath, label, options = {}) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error(`${label} must be a non-empty project-relative path.`);
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be project-relative, not absolute: ${relativePath}`);
  }
  const absolute = path.resolve(root, relativePath);
  if (!isWithin(root, absolute)) {
    throw new Error(`${label} escapes the project directory: ${relativePath}`);
  }
  assertPhysicalPathWithin(root, absolute, label);
  if (options.exists && !fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${relativePath}`);
  }
  return absolute;
}

function samePath(left, right) {
  if (left === right) return true;
  try {
    const canonical = (target) => {
      const anchor = nearestExisting(target);
      if (!anchor) return path.resolve(target);
      return path.resolve(fs.realpathSync(anchor), path.relative(anchor, target));
    };
    return canonical(left) === canonical(right);
  } catch {
    return false;
  }
}

function commandPath(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function executable(candidate) {
  if (!candidate) return null;
  if (!candidate.includes(path.sep)) return commandPath(candidate);
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function preferredFfmpeg() {
  return [
    process.env.QIAOMU_FFMPEG,
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
    'ffmpeg'
  ].map(executable).find(Boolean) || null;
}

function preferredFfprobe(ffmpeg) {
  return [
    process.env.QIAOMU_FFPROBE,
    ffmpeg && path.join(path.dirname(ffmpeg), 'ffprobe'),
    '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe',
    '/usr/local/opt/ffmpeg-full/bin/ffprobe',
    'ffprobe'
  ].map(executable).find(Boolean) || null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'inherit'],
    maxBuffer: options.maxBuffer || 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const suffix = detail ? `\n${detail.slice(-6000)}` : '';
    throw new Error(`${path.basename(command)} failed with exit code ${result.status}.${suffix}`);
  }
  return result;
}

function inspectDependencies() {
  const ffmpeg = preferredFfmpeg();
  if (!ffmpeg) {
    throw new Error('ffmpeg not found. Install ffmpeg-full or set QIAOMU_FFMPEG.');
  }
  const ffprobe = preferredFfprobe(ffmpeg);
  if (!ffprobe) {
    throw new Error('ffprobe not found. Install ffmpeg-full or set QIAOMU_FFPROBE.');
  }
  const version = run(ffmpeg, ['-hide_banner', '-version'], { capture: true });
  const filters = run(ffmpeg, ['-hide_banner', '-filters'], { capture: true });
  const encoders = run(ffmpeg, ['-hide_banner', '-encoders'], { capture: true });
  const filterText = `${filters.stdout}\n${filters.stderr}`;
  const encoderText = `${encoders.stdout}\n${encoders.stderr}`;
  const requiredFilters = ['ass', 'zoompan', 'gblur', 'sidechaincompress', 'loudnorm'];
  const missing = requiredFilters.filter((name) => !new RegExp(`\\b${name}\\b`).test(filterText));
  if (!/\blibx264\b/.test(encoderText)) missing.push('encoder:libx264');
  if (missing.length) {
    throw new Error(`The selected ffmpeg is missing required capabilities: ${missing.join(', ')}. Install ffmpeg-full.`);
  }
  return {
    ffmpeg,
    ffprobe,
    version: `${version.stdout}\n${version.stderr}`.split(/\r?\n/).find(Boolean) || 'ffmpeg'
  };
}

function filterPath(file) {
  return path.resolve(file)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

function durationOf(file, ffprobe) {
  const result = run(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    file
  ], { capture: true });
  return Number(result.stdout.trim());
}

function hasAudio(file, ffprobe) {
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    file
  ], { encoding: 'utf8' });
  return result.status === 0 && Boolean(result.stdout.trim());
}

function validateTimeline(timeline, projectRoot, options = {}) {
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)) {
    throw new Error('timeline.json must contain an object.');
  }
  if (timeline.schema !== 'qiaocut.timeline.v1') {
    throw new Error(`Unsupported timeline schema: ${timeline.schema || '(missing)'}. Expected qiaocut.timeline.v1.`);
  }
  const output = timeline.output || {};
  const width = finite(output.width, NaN);
  const height = finite(output.height, NaN);
  const fps = finite(output.fps, NaN);
  const duration = finite(output.duration, NaN);
  if (![width, height, fps, duration].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('output.width, output.height, output.fps, and output.duration must be positive numbers.');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width % 2 || height % 2) {
    throw new Error('output.width and output.height must be even integers for yuv420p video.');
  }
  if (!Array.isArray(timeline.shots) || timeline.shots.length === 0) {
    throw new Error('timeline.shots must contain at least one shot.');
  }
  if (!options.allowLarge) {
    if (width > 8192 || height > 8192 || width * height > 35400000) {
      throw new Error('Output resolution exceeds the default safety limit. Re-run with --allow-large after reviewing resource cost.');
    }
    if (fps > 120 || duration > 14400 || timeline.shots.length > 1000) {
      throw new Error('Timeline exceeds default FPS, duration, or shot-count safety limits. Re-run with --allow-large after reviewing resource cost.');
    }
  }
  const ids = new Set();
  let declared = 0;
  const shotFiles = [];
  for (const [index, shot] of timeline.shots.entries()) {
    const label = `shots[${index}]`;
    if (!shot || typeof shot !== 'object') throw new Error(`${label} must be an object.`);
    if (!shot.id || typeof shot.id !== 'string') throw new Error(`${label}.id is required.`);
    if (ids.has(shot.id)) throw new Error(`Duplicate shot id: ${shot.id}`);
    ids.add(shot.id);
    if (!['image', 'video'].includes(shot.kind)) throw new Error(`${label}.kind must be image or video.`);
    const shotDuration = finite(shot.duration, NaN);
    if (!Number.isFinite(shotDuration) || shotDuration <= 0) throw new Error(`${label}.duration must be positive.`);
    if (finite(shot.in, 0) < 0) throw new Error(`${label}.in cannot be negative.`);
    shotFiles.push(projectPath(projectRoot, shot.path, `${label}.path`, { exists: true }));
    declared += shotDuration;
  }
  const tolerance = Math.max(0.01, 1 / fps);
  if (Math.abs(declared - duration) > tolerance) {
    throw new Error(`Shot duration total ${declared.toFixed(3)} does not match output.duration ${duration.toFixed(3)}.`);
  }
  const finalOutput = projectPath(projectRoot, output.file || 'renders/final.mp4', 'output.file');
  if (shotFiles.some((source) => samePath(source, finalOutput))) {
    throw new Error('output.file must not overwrite or alias a source shot asset.');
  }
  if (timeline.captionSource) projectPath(projectRoot, timeline.captionSource, 'captionSource', { exists: true });
  if (timeline.captions) projectPath(projectRoot, timeline.captions, 'captions');
  if (typeof timeline.narration === 'string') projectPath(projectRoot, timeline.narration, 'narration', { exists: true });
  const narration = narrationSpec(timeline, projectRoot);
  if (narration && !['file', 'macos-say', 'none'].includes(narration.engine)) {
    throw new Error(`Unsupported narration engine: ${narration.engine || '(missing)'}`);
  }
  if (narration && narration.engine === 'file') {
    if (!narration.path || typeof narration.path !== 'string') {
      throw new Error('narration.engine file requires a project-relative path.');
    }
    projectPath(projectRoot, narration.path, 'narration.path', { exists: true });
    for (const [field, minimum, exclusive, maximum] of [
      ['start', 0, false, duration],
      ['trim', 0, false, null],
      ['duration', 0, true, null],
      ['gain', 0, false, 4]
    ]) {
      if (narration[field] == null) continue;
      const value = Number(narration[field]);
      const below = !Number.isFinite(value) || (exclusive ? value <= minimum : value < minimum);
      const above = maximum != null && value > maximum;
      if (below || above || (field === 'start' && value >= duration)) {
        throw new Error(`narration.${field} is outside the supported timeline range.`);
      }
    }
  }
  if (narration && narration.engine === 'macos-say') {
    if (!Array.isArray(narration.cues) || narration.cues.length === 0) {
      throw new Error('narration.engine macos-say requires at least one cue.');
    }
  }
  if (typeof timeline.music === 'string') projectPath(projectRoot, timeline.music, 'music');
  if (timeline.music && typeof timeline.music === 'object' && timeline.music.path) {
    projectPath(projectRoot, timeline.music.path, 'music.path');
  }
  if (timeline.fontsDir) projectPath(projectRoot, timeline.fontsDir, 'fontsDir', { exists: true });
  return { width, height, fps, duration };
}

function collectProjectIO(timeline, projectRoot, timelineFile) {
  const reads = [{ label: 'timeline', file: timelineFile }];
  const writes = [];
  for (const shot of timeline.shots) {
    reads.push({ label: `shot ${shot.id}`, file: projectPath(projectRoot, shot.path, `shot ${shot.id}`, { exists: true }) });
  }
  if (timeline.captionSource) {
    reads.push({ label: 'captionSource', file: projectPath(projectRoot, timeline.captionSource, 'captionSource', { exists: true }) });
    writes.push({ label: 'captions', file: projectPath(projectRoot, timeline.captions || 'captions/final.ass', 'captions') });
  } else if (timeline.captions) {
    reads.push({ label: 'captions', file: projectPath(projectRoot, timeline.captions, 'captions', { exists: true }) });
  }
  if (typeof timeline.narration === 'string') {
    reads.push({ label: 'narration', file: projectPath(projectRoot, timeline.narration, 'narration', { exists: true }) });
  }
  const narration = narrationSpec(timeline, projectRoot);
  if (narration && narration.engine === 'file') {
    reads.push({ label: 'narration.path', file: projectPath(projectRoot, narration.path, 'narration.path', { exists: true }) });
  }
  if (typeof timeline.music === 'string') {
    reads.push({ label: 'music', file: projectPath(projectRoot, timeline.music, 'music', { exists: true }) });
  } else if (timeline.music && typeof timeline.music === 'object' && timeline.music.path) {
    const item = { label: 'music.path', file: projectPath(projectRoot, timeline.music.path, 'music.path') };
    if (timeline.music.mode === 'file') {
      if (!fs.existsSync(item.file)) throw new Error(`Music file not found: ${timeline.music.path}`);
      reads.push(item);
    } else if (timeline.music.mode === 'procedural') {
      writes.push(item);
    }
  }
  writes.push({ label: 'output.file', file: projectPath(projectRoot, timeline.output.file || 'renders/final.mp4', 'output.file') });
  const reports = timeline.reports || {};
  if (reports.contactSheet !== false) {
    writes.push({ label: 'reports.contactSheet', file: projectPath(projectRoot, reports.contactSheet || 'reports/contact-sheet.jpg', 'reports.contactSheet') });
  }
  writes.push({ label: 'reports.renderReport', file: projectPath(projectRoot, reports.renderReport || 'reports/render-report.json', 'reports.renderReport') });
  return { reads, writes };
}

function preflightProjectIO(io, options = {}) {
  for (let index = 0; index < io.writes.length; index += 1) {
    const current = io.writes[index];
    for (const source of io.reads) {
      if (samePath(current.file, source.file)) {
        throw new Error(`${current.label} must not overwrite or alias read input ${source.label}.`);
      }
    }
    for (let previous = 0; previous < index; previous += 1) {
      if (samePath(current.file, io.writes[previous].file)) {
        throw new Error(`${current.label} aliases write target ${io.writes[previous].label}.`);
      }
    }
    if (entryExists(current.file)) {
      const stat = fs.lstatSync(current.file);
      if (stat.isDirectory()) throw new Error(`${current.label} points to a directory.`);
      if (!options.force) {
        throw new Error(`${current.label} already exists: ${current.file}. Re-run with --force to replace generated outputs.`);
      }
    }
  }
}

function gradeFilter(timeline, shot) {
  const look = { ...(timeline.look || {}), ...(shot.look || {}) };
  const preview = timeline._renderProfile === 'preview';
  const contrast = clamp(finite(look.contrast, 1.035), 0.5, 2);
  const saturation = clamp(finite(look.saturation, 0.95), 0, 3);
  const brightness = clamp(finite(look.brightness, -0.008), -0.5, 0.5);
  const gamma = clamp(finite(look.gamma, 0.995), 0.2, 5);
  const filters = [`eq=contrast=${contrast}:saturation=${saturation}:brightness=${brightness}:gamma=${gamma}`];
  if (!preview && look.vignette !== false) filters.push(`vignette=${typeof look.vignette === 'string' ? look.vignette : 'PI/5'}`);
  const grain = preview ? 0 : clamp(finite(look.grain, 0.8), 0, 12);
  if (grain > 0) filters.push(`noise=alls=${grain}:allf=t+u`);
  filters.push('format=yuv420p');
  return filters.join(',');
}

function zoomExpression(motion, frames) {
  const last = Math.max(1, frames - 1);
  const centered = "x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2'";
  if (motion === 'pullBack') return `z='max(1,1.14-0.14*on/${last})':${centered}`;
  if (motion === 'panDown') return `z='1.12':x='iw/2-iw/zoom/2':y='(ih-ih/zoom)*on/${last}'`;
  if (motion === 'panUp') return `z='1.12':x='iw/2-iw/zoom/2':y='(ih-ih/zoom)*(1-on/${last})'`;
  if (motion === 'panLeft') return `z='1.12':x='(iw-iw/zoom)*(1-on/${last})':y='ih/2-ih/zoom/2'`;
  if (motion === 'panRight') return `z='1.12':x='(iw-iw/zoom)*on/${last}':y='ih/2-ih/zoom/2'`;
  if (motion === 'none') return `z='1':${centered}`;
  return `z='min(1.14,1+0.14*on/${last})':${centered}`;
}

function imageFilter(shot, timeline, frames) {
  const { width, height, fps } = timeline.output;
  const scaleFlags = timeline._renderProfile === 'preview' ? 'bilinear' : 'lanczos';
  const fit = shot.fit || 'cover';
  const zoom = zoomExpression(shot.motion || 'pushIn', frames);
  let composition;
  if (fit === 'containBlur') {
    const foregroundWidth = Math.max(2, width - Math.round(width * 0.067));
    const foregroundHeight = Math.max(2, height - Math.round(height * 0.156));
    composition = [
      '[0:v]split=2[bg][fg]',
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=${scaleFlags},crop=${width}:${height},gblur=sigma=32,eq=brightness=-0.11:saturation=0.72[bgv]`,
      `[fg]scale=${foregroundWidth}:${foregroundHeight}:force_original_aspect_ratio=decrease:flags=${scaleFlags}[fgv]`,
      `[bgv][fgv]overlay=(W-w)/2:(H-h)/2:format=auto[composed]`
    ].join(';');
  } else if (fit === 'contain') {
    composition = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=${scaleFlags},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black[composed]`;
  } else {
    const workingWidth = Math.ceil(width * 1.2 / 2) * 2;
    const workingHeight = Math.ceil(height * 1.2 / 2) * 2;
    composition = `[0:v]scale=${workingWidth}:${workingHeight}:force_original_aspect_ratio=increase:flags=${scaleFlags},crop=${workingWidth}:${workingHeight}[composed]`;
  }
  return `${composition};[composed]zoompan=${zoom}:d=1:s=${width}x${height}:fps=${fps},settb=AVTB,setsar=1,${gradeFilter(timeline, shot)}[v]`;
}

function videoFilter(shot, timeline) {
  const { width, height, fps } = timeline.output;
  const scaleFlags = timeline._renderProfile === 'preview' ? 'bilinear' : 'lanczos';
  const duration = finite(shot.duration, 1);
  const commonTail = `setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},fps=${fps},settb=AVTB,setsar=1,${gradeFilter(timeline, shot)}[v]`;
  if (shot.fit === 'containBlur') {
    const foregroundWidth = Math.max(2, width - Math.round(width * 0.067));
    const foregroundHeight = Math.max(2, height - Math.round(height * 0.156));
    return [
      '[0:v]split=2[bg][fg]',
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=${scaleFlags},crop=${width}:${height},gblur=sigma=32,eq=brightness=-0.11:saturation=0.72[bgv]`,
      `[fg]scale=${foregroundWidth}:${foregroundHeight}:force_original_aspect_ratio=decrease:flags=${scaleFlags}[fgv]`,
      `[bgv][fgv]overlay=(W-w)/2:(H-h)/2:format=auto,${commonTail}`
    ].join(';');
  }
  if (shot.fit === 'contain') {
    return `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=${scaleFlags},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,${commonTail}`;
  }
  return `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=${scaleFlags},crop=${width}:${height},${commonTail}`;
}

function segmentCacheKey(context, shot, input) {
  const { timeline, tools } = context;
  const stat = fs.statSync(input);
  const output = timeline.output || {};
  const payload = {
    version: SEGMENT_CACHE_VERSION,
    ffmpeg: tools.version,
    source: {
      realpath: fs.realpathSync(input),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      ino: stat.ino
    },
    shot,
    look: timeline.look || null,
    profile: timeline._renderProfile,
    output: {
      width: output.width,
      height: output.height,
      fps: output.fps,
      level: output.level || '4.2',
      intermediatePreset: output.intermediatePreset || 'veryfast',
      intermediateCrf: finite(output.intermediateCrf, 18)
    }
  };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function cacheFileAtomically(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = temporarySibling(destination);
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_FICLONE);
    commitTemporary(temporary, destination);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    throw error;
  }
}

function reusableCacheFile(file, minimumBytes = 1024) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size > minimumBytes;
  } catch {
    return false;
  }
}

function renderShot(context, shot, index) {
  const { timeline, projectRoot, buildDir, tools, progress, cacheRoot, cacheStats } = context;
  const output = timeline.output;
  const duration = finite(shot.duration, 0);
  const frames = Math.round(duration * output.fps);
  const input = projectPath(projectRoot, shot.path, `shot ${shot.id} path`, { exists: true });
  const segment = path.join(buildDir, 'segments', `${String(index + 1).padStart(3, '0')}-${shot.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.mkv`);
  const cacheFile = cacheRoot
    ? path.join(cacheRoot, `${segmentCacheKey(context, shot, input)}.mkv`)
    : null;
  if (cacheFile && reusableCacheFile(cacheFile)) {
    cacheStats.hits += 1;
    cacheStats.segments.hits += 1;
    progress(`shot ${index + 1}/${timeline.shots.length}: ${shot.id} (cache hit)`);
    return cacheFile;
  }
  if (cacheFile && cacheStats) {
    cacheStats.misses += 1;
    cacheStats.segments.misses += 1;
  }
  fs.mkdirSync(path.dirname(segment), { recursive: true });
  const args = ['-hide_banner', '-loglevel', 'warning', '-y'];
  if (shot.kind === 'image') {
    args.push('-loop', '1', '-framerate', String(output.fps), '-i', input);
  } else {
    if (finite(shot.in, 0) > 0) args.push('-ss', String(finite(shot.in, 0)));
    args.push('-i', input);
  }
  args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=48000:d=${duration}`);
  const sourceHasAudio = shot.kind === 'video' && shot.sourceAudio === true && hasAudio(input, tools.ffprobe);
  const gain = clamp(finite(shot.sourceGainDb, 0), -60, 24);
  const videoGraph = shot.kind === 'image' ? imageFilter(shot, timeline, frames) : videoFilter(shot, timeline);
  const audioGraph = sourceHasAudio
    ? `[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${gain}dB,apad,atrim=0:${duration}[a]`
    : `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${duration}[a]`;
  progress(`shot ${index + 1}/${timeline.shots.length}: ${shot.id}`);
  run(tools.ffmpeg, [
    ...args,
    '-filter_complex', `${videoGraph};${audioGraph}`,
    '-map', '[v]', '-map', '[a]',
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', output.intermediatePreset || 'veryfast', '-crf', String(finite(output.intermediateCrf, 18)),
    '-profile:v', 'high', '-level', output.level || '4.2', '-pix_fmt', 'yuv420p',
    '-r', String(output.fps), '-g', String(Math.round(output.fps * 2)),
    '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    segment
  ], { cwd: projectRoot });
  if (!cacheFile) return segment;
  cacheFileAtomically(segment, cacheFile);
  return cacheFile;
}

function concatSegments(context, segments) {
  const { buildDir, tools, projectRoot, progress } = context;
  const list = path.join(buildDir, 'segments.txt');
  const content = segments.map((file) => {
    if (/\r|\n/.test(file)) throw new Error('Segment paths cannot contain newlines.');
    return `file '${file.replace(/'/g, "'\\''")}'`;
  }).join('\n') + '\n';
  fs.writeFileSync(list, content, 'utf8');
  const assembled = path.join(buildDir, 'assembled.mkv');
  progress('assembling shots');
  run(tools.ffmpeg, [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-c', 'copy',
    assembled
  ], { cwd: projectRoot });
  return assembled;
}

function resolveCaptionFont(context, document) {
  const { timeline, projectRoot, fontFilesRoot } = context;
  if (timeline.fontsDir) {
    return {
      family: timeline.font || document.font || 'Noto Sans CJK SC',
      directory: projectPath(projectRoot, timeline.fontsDir, 'fontsDir', { exists: true }),
      source: 'project'
    };
  }
  const candidates = [
    path.join(os.homedir(), 'Library', 'Fonts', 'NotoSansCJKsc-Regular.otf'),
    '/Library/Fonts/NotoSansCJKsc-Regular.otf',
    '/opt/homebrew/share/fonts/NotoSansCJKsc-Regular.otf',
    '/usr/local/share/fonts/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!source) {
    return {
      family: timeline.font || document.font || 'Noto Sans CJK SC',
      directory: null,
      source: 'system-unverified'
    };
  }
  const stat = fs.statSync(source);
  const extension = path.extname(source) || '.otf';
  const fingerprint = crypto.createHash('sha256')
    .update(`${source}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`)
    .digest('hex')
    .slice(0, 16);
  const directory = path.join(fontFilesRoot, fingerprint);
  const destination = path.join(directory, `NotoSansCJKsc-Regular${extension}`);
  ensureInternalDirectory(projectRoot, directory, 'caption font cache');
  if (!reusableCacheFile(destination, 0) || fs.lstatSync(destination).size !== stat.size) {
    cacheFileAtomically(source, destination);
  }
  return { family: 'Noto Sans CJK SC', directory, source: 'local-auto' };
}

function prepareCaptions(context) {
  const { timeline, projectRoot, progress } = context;
  if (!timeline.captionSource && !timeline.captions) return null;
  const output = projectPath(projectRoot, timeline.captions || 'captions/final.ass', 'captions');
  if (!timeline.captionSource) {
    if (!fs.existsSync(output)) throw new Error(`Caption ASS not found: ${path.relative(projectRoot, output)}`);
    context.resolvedCaptionFont = resolveCaptionFont(context, { font: timeline.font });
    return output;
  }
  const input = projectPath(projectRoot, timeline.captionSource, 'captionSource', { exists: true });
  const document = readCaptionDocument(input);
  const resolvedFont = resolveCaptionFont(context, document);
  context.resolvedCaptionFont = resolvedFont;
  const events = [...(document.events || []), ...(document.cues || [])];
  if (events.length > 20000) throw new Error('Caption event count exceeds the default safety limit of 20,000.');
  for (const [index, event] of events.entries()) {
    if (finite(event.end, 0) > finite(timeline.output.duration, 0) + 0.01) {
      throw new Error(`Caption ${index + 1} ends after output.duration.`);
    }
  }
  progress('generating bilingual ASS captions');
  const ass = generateBilingualAss(document, {
    width: timeline.output.width,
    height: timeline.output.height,
    font: resolvedFont.family
  });
  atomicWriteFile(output, ass, 'utf8');
  return output;
}

function atempoChain(tempo) {
  const filters = [];
  let remaining = tempo;
  while (remaining > 2.000001) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  if (remaining > 1.001) filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters;
}

function narrationSpec(timeline, projectRoot) {
  if (!timeline.narration) return null;
  if (typeof timeline.narration === 'string') {
    return readJson(projectPath(projectRoot, timeline.narration, 'narration', { exists: true }));
  }
  if (typeof timeline.narration === 'object' && !Array.isArray(timeline.narration)) return timeline.narration;
  throw new Error('narration must be a project-relative JSON path or an object.');
}

function narrationCacheKey(context, spec, cue, start) {
  const sayStat = fs.statSync('/usr/bin/say');
  const rate = Math.round(finite(cue.rate, finite(spec.rate, 174)));
  const remaining = context.timeline.output.duration - start;
  const declaredMaxDuration = Number.isFinite(Number(cue.maxDuration))
    ? clamp(Number(cue.maxDuration), 0.05, remaining)
    : null;
  const payload = {
    version: TTS_CACHE_VERSION,
    platform: process.platform,
    osRelease: os.release(),
    sayMtimeMs: sayStat.mtimeMs,
    ffmpeg: context.tools.version,
    text: cue.text,
    voice: cue.voice || spec.voice || null,
    rate,
    gain: clamp(finite(cue.gain, finite(spec.gain, 1.18)), 0, 4),
    declaredMaxDuration,
    remaining
  };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function verifiedFileNarrationProvenance(projectRoot, spec, source) {
  const declaredProvenance = Boolean(
    spec.provider || spec.assetId || spec.speakerId || spec.speakerName || spec.narrationTextSha256
  );
  const manifestFile = projectPath(projectRoot, 'assets-manifest.json', 'asset manifest');
  if (!fs.existsSync(manifestFile)) {
    if (declaredProvenance) throw new Error('File narration provenance requires assets-manifest.json.');
    return null;
  }
  const manifest = readJson(manifestFile);
  if (!manifest || !Array.isArray(manifest.assets)) throw new Error('assets-manifest.json must contain { assets: [] }.');
  const asset = manifest.assets.find((candidate) => (
    spec.assetId ? candidate.id === spec.assetId : candidate.localPath === spec.path
  ));
  if (!asset) {
    if (declaredProvenance) throw new Error('File narration provenance does not match an asset manifest record.');
    return null;
  }
  if (asset.provider === 'listenhub') {
    for (const field of ['assetId', 'speakerId', 'speakerName', 'narrationTextSha256']) {
      if (!spec[field]) throw new Error(`ListenHub file narration requires ${field} provenance.`);
    }
  }
  if (spec.assetId && asset.id !== spec.assetId) throw new Error('File narration assetId does not match the asset manifest record.');
  if (asset.localPath !== spec.path) throw new Error('File narration assetId does not match narration.path.');
  if (asset.mediaType !== 'audio') throw new Error('File narration manifest record must be an audio asset.');
  if (spec.provider && asset.provider !== spec.provider) throw new Error('File narration provider does not match the asset manifest.');
  if (asset.provider === 'listenhub') {
    if (!/^[a-f0-9]{64}$/.test(String(asset.sha256 || ''))) {
      throw new Error('ListenHub file narration manifest record requires a valid SHA-256 digest.');
    }
    if (sha256File(source) !== asset.sha256) {
      throw new Error('ListenHub file narration content SHA-256 does not match the asset manifest.');
    }
  }
  const runs = Array.isArray(asset.provenanceRuns) && asset.provenanceRuns.length
    ? asset.provenanceRuns
    : asset.provenance
      ? [asset.provenance]
      : [];
  const matchingRun = runs.find((run) => {
    const identityMatches = (
      (!spec.speakerId || run.speakerId === spec.speakerId)
      && (!spec.speakerName || run.speakerName === spec.speakerName)
      && (!spec.narrationTextSha256 || run.narrationTextSha256 === spec.narrationTextSha256)
    );
    if (!identityMatches || asset.provider !== 'listenhub') return identityMatches;
    return /^[a-f0-9]{64}$/.test(String(run.speakerCatalogSha256 || ''))
      && /^[a-f0-9]{64}$/.test(String(run.captureSha256 || ''))
      && /^\.qiaocut\/jobs\/listenhub\/.+\.json$/.test(String(run.capturePath || ''));
  });
  if ((spec.speakerId || spec.speakerName || spec.narrationTextSha256) && !matchingRun) {
    throw new Error('File narration speaker/text/catalog/capture provenance does not match the asset manifest.');
  }
  return {
    provider: asset.provider,
    assetId: asset.id,
    speakerId: spec.speakerId || (matchingRun && matchingRun.speakerId) || null,
    speakerName: spec.speakerName || (matchingRun && matchingRun.speakerName) || null,
    narrationTextSha256: spec.narrationTextSha256 || (matchingRun && matchingRun.narrationTextSha256) || null,
    speakerCatalogSha256: (matchingRun && matchingRun.speakerCatalogSha256) || null,
    capturePath: (matchingRun && matchingRun.capturePath) || null,
    captureSha256: (matchingRun && matchingRun.captureSha256) || null
  };
}

function prepareNarration(context) {
  const { timeline, projectRoot, buildDir, tools, progress, ttsCacheRoot, cacheStats } = context;
  const spec = narrationSpec(timeline, projectRoot);
  if (!spec || spec.engine === 'none') return null;
  if (spec.engine === 'file') {
    if (!spec.path || typeof spec.path !== 'string') throw new Error('narration.engine file requires path.');
    const source = projectPath(projectRoot, spec.path, 'narration.path', { exists: true });
    const provenance = verifiedFileNarrationProvenance(projectRoot, spec, source);
    const sourceDuration = durationOf(source, tools.ffprobe);
    const trim = clamp(finite(spec.trim, 0), 0, Math.max(0, sourceDuration));
    const start = clamp(finite(spec.start, 0), 0, timeline.output.duration);
    if (!Number.isFinite(sourceDuration) || sourceDuration <= trim + 0.01) {
      throw new Error('File narration has no playable audio after trim.');
    }
    if (start >= timeline.output.duration) throw new Error('File narration start must be before output.duration.');
    const available = sourceDuration - trim;
    const duration = Math.min(
      clamp(finite(spec.duration, available), 0.01, available),
      timeline.output.duration - start
    );
    const output = path.join(buildDir, 'narration-file.wav');
    const delay = Math.round(start * 1000);
    progress('normalizing project file narration');
    run(tools.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', source,
      '-af', [
        `atrim=start=${trim}:duration=${duration}`,
        'asetpts=PTS-STARTPTS',
        'aresample=48000',
        'aformat=sample_fmts=fltp:channel_layouts=stereo',
        `volume=${clamp(finite(spec.gain, 1), 0, 4)}`,
        `adelay=${delay}:all=1`,
        'apad',
        `atrim=0:${timeline.output.duration}`,
        'alimiter=limit=0.94'
      ].join(','),
      '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
      output
    ], { cwd: projectRoot });
    return {
      file: output,
      engine: 'file',
      cues: 1,
      voice: spec.speakerName || spec.voice || null,
      provenance
    };
  }
  if (spec.engine !== 'macos-say') throw new Error(`Unsupported narration engine: ${spec.engine}`);
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/say')) {
    throw new Error('narration.engine macos-say requires macOS /usr/bin/say. Supply recorded narration or disable narration on this platform.');
  }
  if (!Array.isArray(spec.cues) || spec.cues.length === 0) return null;
  if (spec.cues.length > 2000) throw new Error('Narration cue count exceeds the default safety limit of 2,000.');
  const ttsDir = path.join(buildDir, 'tts');
  fs.mkdirSync(ttsDir, { recursive: true });
  const normalized = [];
  const cueIds = new Set();
  progress(`synthesizing ${spec.cues.length} narration cues with macOS say`);
  for (const [index, cue] of spec.cues.entries()) {
    const id = String(cue.id || `cue-${index + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (cueIds.has(id)) throw new Error(`Duplicate narration cue id: ${id}`);
    cueIds.add(id);
    if (typeof cue.text !== 'string' || !cue.text.trim()) throw new Error(`Narration cue ${id} has no text.`);
    const start = finite(cue.start, NaN);
    if (!Number.isFinite(start) || start < 0 || start >= timeline.output.duration) {
      throw new Error(`Narration cue ${id} has invalid start time.`);
    }
    const raw = path.join(ttsDir, `${id}.aiff`);
    const wav = path.join(ttsDir, `${id}.wav`);
    const cacheFile = ttsCacheRoot
      ? path.join(ttsCacheRoot, `${narrationCacheKey(context, spec, cue, start)}.wav`)
      : null;
    if (cacheFile && reusableCacheFile(cacheFile)) {
      cacheStats.hits += 1;
      cacheStats.narration.hits += 1;
      normalized.push({ id, start, path: cacheFile });
      continue;
    }
    if (cacheFile && cacheStats) {
      cacheStats.misses += 1;
      cacheStats.narration.misses += 1;
    }
    const sayArgs = [];
    if (cue.voice || spec.voice) sayArgs.push('-v', String(cue.voice || spec.voice));
    sayArgs.push('-r', String(Math.round(finite(cue.rate, finite(spec.rate, 174)))), '-o', raw, cue.text);
    run('/usr/bin/say', sayArgs, { cwd: projectRoot });
    const rawDuration = durationOf(raw, tools.ffprobe);
    if (!Number.isFinite(rawDuration) || rawDuration <= 0.05) {
      throw new Error(`Narration cue ${id} produced no playable audio. Grant access to the local macOS speech service and retry.`);
    }
    const remaining = timeline.output.duration - start;
    const maxDuration = clamp(finite(cue.maxDuration, rawDuration), 0.05, remaining);
    const tempo = rawDuration > maxDuration ? rawDuration / maxDuration : 1;
    const filters = [
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      'highpass=f=75',
      'lowpass=f=11500',
      'acompressor=threshold=0.12:ratio=2.2:attack=12:release=140',
      `volume=${clamp(finite(cue.gain, finite(spec.gain, 1.18)), 0, 4)}`,
      ...atempoChain(tempo),
      `atrim=0:${maxDuration}`,
      'asetpts=PTS-STARTPTS'
    ];
    run(tools.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', raw,
      '-af', filters.join(','),
      '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
      wav
    ], { cwd: projectRoot });
    if (cacheFile) {
      cacheFileAtomically(wav, cacheFile);
      normalized.push({ id, start, path: cacheFile });
    } else {
      normalized.push({ id, start, path: wav });
    }
  }
  const graphFile = path.join(buildDir, 'narration.ffscript');
  const graph = normalized.map((cue, index) => {
    const delay = Math.round(cue.start * 1000);
    return `[${index}:a]adelay=${delay}:all=1,apad,atrim=0:${timeline.output.duration}[n${index}]`;
  }).join(';\n') + ';\n' + normalized.map((_, index) => `[n${index}]`).join('') +
    `amix=inputs=${normalized.length}:duration=longest:dropout_transition=0:normalize=0,atrim=0:${timeline.output.duration},alimiter=limit=0.94[narration]\n`;
  fs.writeFileSync(graphFile, graph, 'utf8');
  const narration = path.join(buildDir, 'narration.wav');
  const args = ['-hide_banner', '-loglevel', 'warning', '-y'];
  for (const cue of normalized) args.push('-i', cue.path);
  args.push(
    '-/filter_complex', graphFile,
    '-map', '[narration]',
    '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
    narration
  );
  run(tools.ffmpeg, args, { cwd: projectRoot });
  return { file: narration, engine: spec.engine, cues: normalized.length, voice: spec.voice || null, provenance: null };
}

function shotStarts(shots) {
  const starts = [];
  let cursor = 0;
  for (const shot of shots) {
    starts.push(Math.round(cursor * 1000) / 1000);
    cursor += finite(shot.duration, 0);
  }
  return starts;
}

function prepareMusic(context) {
  const { timeline, projectRoot, buildDir, progress } = context;
  if (timeline.music === false) return null;
  const object = timeline.music && typeof timeline.music === 'object' && !Array.isArray(timeline.music)
    ? timeline.music
    : null;
  const relativePath = object && object.path
    ? object.path
    : typeof timeline.music === 'string'
      ? timeline.music
      : null;
  const output = relativePath
    ? projectPath(projectRoot, relativePath, 'music path')
    : path.join(buildDir, 'procedural-music.wav');
  const mode = object && object.mode
    ? object.mode
    : typeof timeline.music === 'string'
      ? 'file'
      : 'procedural';
  if (mode === 'none') return null;
  if (mode === 'file') {
    if (!fs.existsSync(output)) throw new Error(`Music file not found: ${relativePath}`);
    return { file: output, mode: 'file' };
  }
  if (mode !== 'procedural') throw new Error(`Unsupported music mode: ${mode}`);
  const options = { ...(timeline.musicOptions || {}), ...(object || {}) };
  progress('generating deterministic procedural score');
  const temp = temporarySibling(output);
  try {
    const report = generateProceduralMusic(temp, {
      ...options,
      duration: timeline.output.duration,
      transitions: options.transitions || shotStarts(timeline.shots)
    });
    commitTemporary(temp, output);
    return { ...report, file: output, mode: 'procedural' };
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    throw error;
  }
}

function captionFontFingerprints(projectRoot, directory) {
  const extensions = new Set(['.otf', '.otc', '.ttf', '.ttc', '.woff', '.woff2']);
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .filter((entry) => extensions.has(path.extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > 256) throw new Error('Caption font directory exceeds the 256-file safety limit.');
  let totalBytes = 0;
  return entries.map((entry) => {
    const file = path.join(directory, entry.name);
    assertPhysicalPathWithin(projectRoot, file, `caption font ${entry.name}`);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error(`Caption font entry is not a regular file: ${entry.name}`);
    totalBytes += stat.size;
    if (stat.size > 128 * 1024 * 1024 || totalBytes > 512 * 1024 * 1024) {
      throw new Error('Caption font files exceed the default size safety limit.');
    }
    return {
      name: entry.name,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    };
  });
}

function pictureCacheKey(context, segments, captions) {
  const { timeline, tools } = context;
  const captionHash = captions
    ? crypto.createHash('sha256').update(fs.readFileSync(captions)).digest('hex')
    : null;
  const segmentFingerprints = segments.map((file) => {
    const stat = fs.statSync(file);
    return {
      name: path.basename(file),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs
    };
  });
  const resolvedFont = context.resolvedCaptionFont || null;
  const fontDirectory = resolvedFont && resolvedFont.directory ? resolvedFont.directory : null;
  const fontFiles = captions && fontDirectory
    ? captionFontFingerprints(context.projectRoot, fontDirectory)
    : null;
  const payload = {
    version: PICTURE_CACHE_VERSION,
    ffmpeg: tools.version,
    profile: timeline._renderProfile,
    captions: captionHash,
    segments: segmentFingerprints,
    fonts: captions
      ? fontDirectory
        ? { family: resolvedFont.family, files: fontFiles }
        : { system: os.release(), family: resolvedFont ? resolvedFont.family : (timeline.font || null) }
      : null,
    output: {
      width: timeline.output.width,
      height: timeline.output.height,
      fps: timeline.output.fps,
      duration: timeline.output.duration,
      preset: timeline.output.preset || 'slow',
      crf: finite(timeline.output.crf, 18),
      level: timeline.output.level || '4.2'
    }
  };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function renderPicture(context, assembled, captions, segments) {
  const {
    timeline,
    projectRoot,
    buildDir,
    tools,
    progress,
    fontCacheRoot,
    pictureCacheRoot,
    cacheStats
  } = context;
  const deterministicFont = !captions ||
    (context.resolvedCaptionFont && context.resolvedCaptionFont.source !== 'system-unverified');
  const cacheFile = pictureCacheRoot && deterministicFont
    ? path.join(pictureCacheRoot, `${pictureCacheKey(context, segments, captions)}.mp4`)
    : null;
  if (cacheFile && reusableCacheFile(cacheFile)) {
    cacheStats.hits += 1;
    cacheStats.pictures.hits += 1;
    progress('mastered picture (cache hit)');
    return cacheFile;
  }
  if (cacheFile && cacheStats) {
    cacheStats.misses += 1;
    cacheStats.pictures.misses += 1;
  }
  const picture = path.join(buildDir, 'picture.mp4');
  let filter = 'format=yuv420p';
  if (captions) {
    const fonts = context.resolvedCaptionFont && context.resolvedCaptionFont.directory
      ? `:fontsdir='${filterPath(context.resolvedCaptionFont.directory)}'`
      : '';
    filter = `ass=filename='${filterPath(captions)}'${fonts},format=yuv420p`;
  }
  progress(captions ? 'burning captions and mastering picture' : 'mastering picture');
  const rendered = run(tools.ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', assembled,
    '-vf', filter,
    '-an', '-t', String(timeline.output.duration),
    '-c:v', 'libx264', '-preset', timeline.output.preset || 'slow', '-crf', String(finite(timeline.output.crf, 18)),
    '-profile:v', 'high', '-level', timeline.output.level || '4.2', '-pix_fmt', 'yuv420p',
    '-r', String(timeline.output.fps), '-g', String(Math.round(timeline.output.fps * 2)),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-movflags', '+faststart',
    picture
  ], {
    cwd: projectRoot,
    capture: true,
    maxBuffer: 4 * 1024 * 1024,
    env: { XDG_CACHE_HOME: fontCacheRoot }
  });
  if (/error opening font|failed to find any fallback with glyph|fontselect:.*failed/i.test(rendered.stderr)) {
    throw new Error(
      'Subtitle rendering could not resolve one or more glyphs. Add a CJK-capable font file under the project, set timeline.fontsDir to that project-relative directory, and set the caption font family.'
    );
  }
  if (!cacheFile) return picture;
  cacheFileAtomically(picture, cacheFile);
  return cacheFile;
}

function mixAudio(context, assembled, narration, music) {
  const { timeline, projectRoot, buildDir, tools, progress } = context;
  const mix = path.join(buildDir, 'mix.wav');
  const duration = finite(timeline.output.duration, 0);
  const audio = timeline.audio || {};
  const args = ['-hide_banner', '-loglevel', 'warning', '-y', '-i', assembled];
  let narrationIndex = null;
  let musicIndex = null;
  if (narration) {
    narrationIndex = args.filter((value) => value === '-i').length;
    args.push('-i', narration.file);
  }
  if (music) {
    musicIndex = args.filter((value) => value === '-i').length;
    args.push('-i', music.file);
  }
  const graph = [];
  graph.push(`[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${clamp(finite(audio.originalGain, 1), 0, 4)}[original]`);
  if (narrationIndex != null) {
    graph.push(`[${narrationIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${clamp(finite(audio.narrationGain, 1), 0, 4)}[narration]`);
    graph.push('[original][narration]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.93[speech]');
  } else {
    graph.push('[original]anull[speech]');
  }
  if (musicIndex != null) {
    graph.push('[speech]asplit=2[speechout][sidechain]');
    graph.push(`[${musicIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${clamp(finite(audio.musicGain, 0.62), 0, 4)},highpass=f=35,lowpass=f=12000[music]`);
    graph.push(`[music][sidechain]sidechaincompress=threshold=${clamp(finite(audio.duckThreshold, 0.022), 0.0001, 1)}:ratio=${clamp(finite(audio.duckRatio, 8), 1, 20)}:attack=${clamp(finite(audio.duckAttackMs, 12), 1, 500)}:release=${clamp(finite(audio.duckReleaseMs, 380), 10, 3000)}[ducked]`);
    graph.push(`[speechout][ducked]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.92,atrim=0:${duration}[mix]`);
  } else {
    graph.push(`[speech]alimiter=limit=0.92,atrim=0:${duration}[mix]`);
  }
  const graphFile = path.join(buildDir, 'mix.ffscript');
  fs.writeFileSync(graphFile, `${graph.join(';\n')}\n`, 'utf8');
  progress('mixing source audio, narration, and music with sidechain ducking');
  args.push(
    '-/filter_complex', graphFile,
    '-map', '[mix]',
    '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
    mix
  );
  run(tools.ffmpeg, args, { cwd: projectRoot });
  return mix;
}

function parseLoudnormStats(stderr) {
  const matches = String(stderr || '').match(/\{\s*"input_i"[\s\S]*?\}/g);
  if (!matches || !matches.length) throw new Error('Could not parse ffmpeg loudnorm analysis.');
  return JSON.parse(matches[matches.length - 1]);
}

function usableLoudnormStats(stats) {
  return ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']
    .every((key) => Number.isFinite(Number(stats[key])));
}

function loudnorm(context, input) {
  const { timeline, projectRoot, buildDir, tools, progress } = context;
  const normalized = path.join(buildDir, 'normalized.wav');
  const target = clamp(finite(timeline.output.loudnessLufs, -14), -70, -5);
  const peak = clamp(finite(timeline.output.truePeakDb, -1.5), -9, -0.1);
  const mode = timeline._normalizationMode || 'two-pass';
  progress(`normalizing audio to ${target} LUFS / ${peak} dBTP (${mode})`);
  if (mode === 'single-pass') {
    run(tools.ffmpeg, [
      '-hide_banner', '-loglevel', 'warning', '-y', '-i', input,
      '-af', `loudnorm=I=${target}:LRA=7:TP=${peak},aresample=48000`,
      '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
      normalized
    ], { cwd: projectRoot });
    return {
      file: normalized,
      stats: null,
      passes: 1,
      mode,
      targetLufs: target,
      targetTruePeakDb: peak
    };
  }
  const first = run(tools.ffmpeg, [
    '-hide_banner', '-nostats', '-i', input,
    '-af', `loudnorm=I=${target}:LRA=7:TP=${peak}:print_format=json`,
    '-f', 'null', '-'
  ], { cwd: projectRoot, capture: true });
  const stats = parseLoudnormStats(first.stderr);
  const filter = usableLoudnormStats(stats)
    ? [
        `loudnorm=I=${target}`,
        'LRA=7',
        `TP=${peak}`,
        `measured_I=${stats.input_i}`,
        `measured_TP=${stats.input_tp}`,
        `measured_LRA=${stats.input_lra}`,
        `measured_thresh=${stats.input_thresh}`,
        `offset=${stats.target_offset}`,
        'linear=true',
        'print_format=summary'
      ].join(':') + ',aresample=48000'
    : `loudnorm=I=${target}:LRA=7:TP=${peak},aresample=48000`;
  run(tools.ffmpeg, [
    '-hide_banner', '-loglevel', 'warning', '-y', '-i', input,
    '-af', filter,
    '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
    normalized
  ], { cwd: projectRoot });
  return {
    file: normalized,
    stats,
    passes: 2,
    mode,
    targetLufs: target,
    targetTruePeakDb: peak
  };
}

function muxFinal(context, picture, audio) {
  const { timeline, projectRoot, tools, progress } = context;
  const output = projectPath(projectRoot, timeline.output.file || 'renders/final.mp4', 'output.file');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporaryOutput = temporarySibling(output);
  const metadata = timeline.metadata || {};
  progress(`muxing final video: ${path.relative(projectRoot, output)}`);
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-i', picture, '-i', audio,
    '-t', String(timeline.output.duration),
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', timeline.output.audioBitrate || '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-metadata', `title=${metadata.title || timeline.title || 'QiaoCut video'}`,
    '-metadata', `comment=${metadata.comment || 'Created with qiaomu-cut.'}`
  ];
  if (metadata.artist) args.push('-metadata', `artist=${metadata.artist}`);
  if (metadata.copyright) args.push('-metadata', `copyright=${metadata.copyright}`);
  args.push(temporaryOutput);
  try {
    run(tools.ffmpeg, args, { cwd: projectRoot });
    commitTemporary(temporaryOutput, output);
  } catch (error) {
    try { fs.rmSync(temporaryOutput, { force: true }); } catch (_) {}
    throw error;
  }
  return output;
}

function contactSheet(context, finalVideo) {
  const { timeline, projectRoot, tools, progress } = context;
  if (timeline.reports && timeline.reports.contactSheet === false) return null;
  const spec = timeline.reports || {};
  const output = projectPath(projectRoot, spec.contactSheet || 'reports/contact-sheet.jpg', 'reports.contactSheet');
  const count = clamp(Math.round(finite(spec.contactSheetFrames, 12)), 4, 30);
  const columns = clamp(Math.round(finite(spec.contactSheetColumns, 4)), 2, 6);
  const rows = Math.ceil(count / columns);
  const thumbWidth = clamp(Math.round(finite(spec.contactSheetThumbWidth, 270)), 120, 640);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporaryOutput = temporarySibling(output);
  progress('creating visual contact sheet');
  try {
    run(tools.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', finalVideo,
      '-vf', `fps=${count}/${timeline.output.duration},scale=${thumbWidth}:-2:flags=lanczos,tile=${columns}x${rows}:nb_frames=${count}:padding=8:margin=8:color=0x111111`,
      '-frames:v', '1',
      temporaryOutput
    ], { cwd: projectRoot });
    commitTemporary(temporaryOutput, output);
  } catch (error) {
    try { fs.rmSync(temporaryOutput, { force: true }); } catch (_) {}
    throw error;
  }
  return output;
}

function fraction(value) {
  if (typeof value !== 'string' || !value.includes('/')) return finite(value, 0);
  const [numerator, denominator] = value.split('/').map(Number);
  return denominator ? numerator / denominator : 0;
}

function lastNumber(text, pattern) {
  const matches = [...String(text || '').matchAll(pattern)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

function inspectFinal(context, file) {
  const { timeline, tools, projectRoot } = context;
  const validation = context.validation || timeline._validationLevel || 'full';
  const checks = {
    streams: true,
    loudness: validation !== 'basic',
    blackFrames: validation === 'full',
    silence: validation !== 'basic'
  };
  const result = run(tools.ffprobe, [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', file
  ], { capture: true });
  const data = JSON.parse(result.stdout);
  const video = (data.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (data.streams || []).find((stream) => stream.codec_type === 'audio');
  const duration = finite(data.format && data.format.duration, 0);
  const errors = [];
  const warnings = [];
  if (!video) errors.push('No video stream.');
  if (!audio) errors.push('No audio stream.');
  if (video && (video.width !== timeline.output.width || video.height !== timeline.output.height)) {
    errors.push(`Unexpected resolution ${video.width}x${video.height}.`);
  }
  if (video && video.pix_fmt !== 'yuv420p') errors.push(`Unexpected pixel format ${video.pix_fmt}.`);
  if (video && Math.abs(fraction(video.avg_frame_rate) - timeline.output.fps) > 0.01) {
    errors.push(`Unexpected frame rate ${video.avg_frame_rate}.`);
  }
  if (Math.abs(duration - timeline.output.duration) > Math.max(0.15, 2 / timeline.output.fps)) {
    errors.push(`Unexpected duration ${duration.toFixed(3)} seconds.`);
  }
  if (!data.format || finite(data.format.size, 0) <= 0) errors.push('Output file is empty.');

  let integratedLufs = null;
  let truePeakDbfs = null;
  const targetLufs = finite(timeline.output.loudnessLufs, -14);
  const targetPeak = finite(timeline.output.truePeakDb, -1.5);
  const allowSilent = Boolean(timeline.audio && timeline.audio.allowSilent);
  if (checks.loudness) {
    const loudnessRun = run(tools.ffmpeg, [
      '-hide_banner', '-nostats', '-i', file,
      '-vn', '-filter_complex', 'ebur128=peak=true',
      '-f', 'null', '-'
    ], { cwd: projectRoot, capture: true });
    const loudnessText = `${loudnessRun.stdout}\n${loudnessRun.stderr}`;
    integratedLufs = lastNumber(loudnessText, /I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g);
    truePeakDbfs = lastNumber(loudnessText, /Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/g);
    if (integratedLufs === null || truePeakDbfs === null) {
      const message = 'Could not measure final integrated loudness and true peak.';
      if (allowSilent) warnings.push(message);
      else errors.push(message);
    } else {
      const tolerance = validation === 'full' ? 1 : 1.5;
      if (!allowSilent && Math.abs(integratedLufs - targetLufs) > tolerance) {
        errors.push(`Integrated loudness ${integratedLufs} LUFS misses target ${targetLufs} LUFS by more than ${tolerance} LU.`);
      }
    }
    if (truePeakDbfs !== null && truePeakDbfs > targetPeak + 0.6) {
      errors.push(`True peak ${truePeakDbfs} dBFS exceeds target tolerance ${targetPeak + 0.6} dBFS.`);
    }
  }

  let blackEvents = [];
  if (checks.blackFrames) {
    const blackRun = run(tools.ffmpeg, [
      '-hide_banner', '-nostats', '-i', file,
      '-vf', 'blackdetect=d=0.35:pix_th=0.10',
      '-an', '-f', 'null', '-'
    ], { cwd: projectRoot, capture: true });
    blackEvents = [...`${blackRun.stdout}\n${blackRun.stderr}`.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)]
      .map((match) => ({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) }));
    if (blackEvents.length) warnings.push(`${blackEvents.length} black-frame interval(s) require visual review.`);
  }

  let silenceEvents = [];
  if (checks.silence) {
    const silenceRun = run(tools.ffmpeg, [
      '-hide_banner', '-nostats', '-i', file,
      '-af', 'silencedetect=noise=-45dB:d=1.5',
      '-vn', '-f', 'null', '-'
    ], { cwd: projectRoot, capture: true });
    silenceEvents = [...`${silenceRun.stdout}\n${silenceRun.stderr}`.matchAll(/silence_start:\s*([\d.]+)|silence_end:\s*([\d.]+)/g)]
      .map((match) => match[1]
        ? { type: 'start', time: Number(match[1]) }
        : { type: 'end', time: Number(match[2]) });
    if (silenceEvents.length && !allowSilent) warnings.push(`${silenceEvents.length} silence boundary event(s) require review.`);
  }

  return {
    ok: errors.length === 0,
    level: validation,
    checks,
    errors,
    warnings,
    duration,
    sizeBytes: data.format ? finite(data.format.size, 0) : 0,
    video: video ? {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      fps: fraction(video.avg_frame_rate),
      pixelFormat: video.pix_fmt,
      colorSpace: video.color_space || null
    } : null,
    audio: audio ? {
      codec: audio.codec_name,
      sampleRate: finite(audio.sample_rate, null),
      channels: audio.channels,
      integratedLufs,
      truePeakDbfs
    } : null,
    diagnostics: { blackEvents, silenceEvents }
  };
}

function makeProgress(options) {
  if (typeof options.onProgress === 'function') return options.onProgress;
  if (options.quiet) return () => {};
  return (message) => process.stderr.write(`[qiaomu-cut] ${message}\n`);
}

function timedStage(context, name, operation) {
  const started = process.hrtime.bigint();
  try {
    return operation();
  } finally {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    context.timings[name] = Math.round(seconds * 100) / 100;
  }
}

function renderProject(projectDir, options = {}) {
  const started = Date.now();
  const projectRoot = path.resolve(projectDir);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project directory not found: ${projectRoot}`);
  }
  const timelineRelative = options.timeline || 'timeline.json';
  const timelineFile = projectPath(projectRoot, timelineRelative, 'timeline', { exists: true });
  const sourceTimeline = readJson(timelineFile);
  const renderProfile = applyRenderProfile(sourceTimeline, options);
  const timeline = renderProfile.timeline;
  validateTimeline(timeline, projectRoot, options);
  preflightProjectIO(collectProjectIO(timeline, projectRoot, timelineFile), options);
  const tools = inspectDependencies();
  const buildRoot = projectPath(projectRoot, '.qiaocut', 'internal build root');
  ensureInternalDirectory(projectRoot, buildRoot, 'internal build root');
  const cacheBase = options.cache === false ? null : path.join(buildRoot, 'cache');
  const cacheRoot = cacheBase ? path.join(cacheBase, 'segments') : null;
  const ttsCacheRoot = cacheBase ? path.join(cacheBase, 'tts') : null;
  const pictureCacheRoot = cacheBase ? path.join(cacheBase, 'pictures') : null;
  if (cacheBase) {
    for (const [directory, label] of [
      [cacheRoot, 'segment cache'],
      [ttsCacheRoot, 'narration cache'],
      [pictureCacheRoot, 'picture cache']
    ]) {
      ensureInternalDirectory(projectRoot, directory, label);
    }
  }
  const buildDir = fs.mkdtempSync(path.join(buildRoot, 'render-'));
  const fontCacheRoot = path.join(buildDir, 'fontconfig');
  const fontFilesRoot = cacheBase ? path.join(cacheBase, 'fonts') : path.join(buildDir, 'fonts');
  for (const [directory, label] of [
    [fontCacheRoot, 'Fontconfig runtime cache'],
    [fontFilesRoot, 'caption font cache root']
  ]) {
    ensureInternalDirectory(projectRoot, directory, label);
  }
  const progress = makeProgress(options);
  const cacheStats = {
    enabled: Boolean(cacheBase),
    hits: 0,
    misses: 0,
    segments: { hits: 0, misses: 0 },
    narration: { hits: 0, misses: 0 },
    pictures: { hits: 0, misses: 0 }
  };
  const timings = {};
  const context = {
    timeline,
    projectRoot,
    timelineFile,
    buildDir,
    tools,
    progress,
    cacheRoot,
    ttsCacheRoot,
    pictureCacheRoot,
    fontCacheRoot,
    fontFilesRoot,
    cacheStats,
    timings,
    profile: renderProfile.name,
    validation: renderProfile.validation
  };
  progress(`${tools.version}; profile=${renderProfile.name}; validation=${renderProfile.validation}`);
  try {
    const captions = timedStage(context, 'captions', () => prepareCaptions(context));
    const music = timedStage(context, 'music', () => prepareMusic(context));
    const narration = timedStage(context, 'narration', () => prepareNarration(context));
    const segments = timedStage(context, 'shots', () => timeline.shots.map((shot, index) => renderShot(context, shot, index)));
    const assembled = timedStage(context, 'assemble', () => concatSegments(context, segments));
    const picture = timedStage(context, 'picture', () => renderPicture(context, assembled, captions, segments));
    const mix = timedStage(context, 'audioMix', () => mixAudio(context, assembled, narration, music));
    const normalized = timedStage(context, 'normalization', () => loudnorm(context, mix));
    const finalVideo = timedStage(context, 'mux', () => muxFinal(context, picture, normalized.file));
    const sheet = timedStage(context, 'contactSheet', () => contactSheet(context, finalVideo));
    const verification = timedStage(context, 'verification', () => inspectFinal(context, finalVideo));
    const captionFontVerified = !captions ||
      (context.resolvedCaptionFont && context.resolvedCaptionFont.source !== 'system-unverified');
    if (!captionFontVerified) {
      verification.warnings.push('Caption font resolution is system-unverified; configure fontsDir before release.');
    }
    const reportPath = projectPath(
      projectRoot,
      (timeline.reports && timeline.reports.renderReport) || 'reports/render-report.json',
      'reports.renderReport'
    );
    const report = {
      ok: verification.ok,
      schema: timeline.schema,
      title: timeline.title || null,
      profile: renderProfile.name,
      releaseReady: renderProfile.name === 'final' && renderProfile.validation === 'full' &&
        verification.ok && captionFontVerified,
      project: '.',
      timeline: path.relative(projectRoot, timelineFile),
      finalVideo: path.relative(projectRoot, finalVideo),
      contactSheet: sheet ? path.relative(projectRoot, sheet) : null,
      renderReport: path.relative(projectRoot, reportPath),
      durationSeconds: timeline.output.duration,
      resolution: `${timeline.output.width}x${timeline.output.height}`,
      fps: timeline.output.fps,
      shots: timeline.shots.length,
      captions: captions ? path.relative(projectRoot, captions) : null,
      captionFont: captions && context.resolvedCaptionFont ? {
        family: context.resolvedCaptionFont.family,
        source: context.resolvedCaptionFont.source
      } : null,
      narration: narration ? {
        engine: narration.engine,
        cues: narration.cues,
        voice: narration.voice,
        provenance: narration.provenance
      } : null,
      music: music ? { mode: music.mode, file: path.relative(projectRoot, music.file), bpm: music.bpm || null, seed: music.seed || null } : null,
      loudness: {
        targetLufs: normalized.targetLufs,
        targetTruePeakDb: normalized.targetTruePeakDb,
        mode: normalized.mode,
        passes: normalized.passes,
        firstPass: normalized.stats
      },
      cache: cacheStats,
      timings,
      ffmpeg: tools.version,
      verification,
      elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
      buildDir: options.keepBuild ? path.relative(projectRoot, buildDir) : null
    };
    writeJson(reportPath, report);
    if (!verification.ok) {
      throw new Error(`Final video verification failed: ${verification.errors.join(' ')}`);
    }
    if (!options.keepBuild) fs.rmSync(buildDir, { recursive: true, force: true });
    return {
      ...report,
      finalVideo: path.resolve(projectRoot, report.finalVideo),
      contactSheet: report.contactSheet ? path.resolve(projectRoot, report.contactSheet) : null,
      renderReport: reportPath
    };
  } catch (error) {
    error.buildDir = buildDir;
    throw error;
  }
}

function parseArgs(argv) {
  const options = { keepBuild: false, json: false, force: false, allowLarge: false, cache: true };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-h') {
      options.help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    if (token === '--json') options.json = true;
    else if (token === '--keep-build') options.keepBuild = true;
    else if (token === '--force') options.force = true;
    else if (token === '--allow-large') options.allowLarge = true;
    else if (token === '--no-cache') options.cache = false;
    else if (token === '--help') options.help = true;
    else if (token === '--timeline') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new UsageError('--timeline requires a project-relative path.');
      options.timeline = value;
      index += 1;
    } else if (token.startsWith('--timeline=')) {
      options.timeline = token.slice('--timeline='.length);
      if (!options.timeline) throw new UsageError('--timeline requires a project-relative path.');
    } else if (['--profile', '--validation', '--output'].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new UsageError(`${token} requires a value.`);
      options[token.slice(2)] = value;
      index += 1;
    } else if (token.startsWith('--profile=')) {
      options.profile = token.slice('--profile='.length);
      if (!options.profile) throw new UsageError('--profile requires a value.');
    } else if (token.startsWith('--validation=')) {
      options.validation = token.slice('--validation='.length);
      if (!options.validation) throw new UsageError('--validation requires a value.');
    } else if (token.startsWith('--output=')) {
      options.output = token.slice('--output='.length);
      if (!options.output) throw new UsageError('--output requires a project-relative path.');
    } else {
      throw new UsageError(`Unknown option: ${token}`);
    }
  }
  if (positional.length > 1) throw new UsageError('Only one project directory may be supplied.');
  return { projectDir: positional[0], options };
}

function usage() {
  return `Usage: render_project.js <project-dir> [--profile preview|standard|final] [--validation basic|standard|full]
       [--timeline timeline.json] [--output renders/file.mp4] [--no-cache]
       [--json] [--keep-build] [--force] [--allow-large]

Renders a qiaocut.timeline.v1 project with ffmpeg-full. All media and output paths
inside the timeline must be relative to <project-dir>. Existing generated outputs
are preserved unless --force is supplied. The default profile remains final for
backward compatibility; preview and standard use separate suffixed outputs.
`;
}

function cli(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
    if (parsed.options.help) {
      process.stdout.write(usage());
      return 0;
    }
    if (!parsed.projectDir) throw new UsageError('A project directory is required.');
    const report = renderProject(parsed.projectDir, parsed.options);
    const printable = {
      ...report,
      finalVideo: displayPath(report.finalVideo),
      contactSheet: displayPath(report.contactSheet),
      renderReport: displayPath(report.renderReport),
      buildDir: displayPath(report.buildDir)
    };
    if (parsed.options.json) process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
    else process.stdout.write(`Rendered: ${printable.finalVideo}\nReport: ${printable.renderReport}\n`);
    return 0;
  } catch (error) {
    const isUsage = error instanceof UsageError;
    const json = parsed && parsed.options && parsed.options.json;
    if (json) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        error: displayText(error.message),
        buildDir: displayPath(error.buildDir || null)
      }, null, 2)}\n`);
    } else {
      process.stderr.write(`${displayText(error.message)}\n`);
      if (isUsage) process.stderr.write(usage());
      if (error.buildDir) process.stderr.write(`Intermediate files retained at: ${displayPath(error.buildDir)}\n`);
    }
    return isUsage ? 2 : 1;
  }
}

module.exports = {
  applyRenderProfile,
  ensureInternalDirectory,
  UsageError,
  inspectDependencies,
  parseArgs,
  preflightProjectIO,
  projectPath,
  renderProject,
  verifiedFileNarrationProvenance,
  validateTimeline
};

if (require.main === module) process.exitCode = cli();
