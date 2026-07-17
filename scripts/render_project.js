#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { generateBilingualAss, readCaptionDocument } = require('./renderers/bilingual_ass');
const { generateProceduralMusic } = require('./renderers/procedural_music');

class UsageError extends Error {}

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  const contrast = clamp(finite(look.contrast, 1.035), 0.5, 2);
  const saturation = clamp(finite(look.saturation, 0.95), 0, 3);
  const brightness = clamp(finite(look.brightness, -0.008), -0.5, 0.5);
  const gamma = clamp(finite(look.gamma, 0.995), 0.2, 5);
  const filters = [`eq=contrast=${contrast}:saturation=${saturation}:brightness=${brightness}:gamma=${gamma}`];
  if (look.vignette !== false) filters.push(`vignette=${typeof look.vignette === 'string' ? look.vignette : 'PI/5'}`);
  const grain = clamp(finite(look.grain, 0.8), 0, 12);
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
  const fit = shot.fit || 'cover';
  const zoom = zoomExpression(shot.motion || 'pushIn', frames);
  let composition;
  if (fit === 'containBlur') {
    const foregroundWidth = Math.max(2, width - Math.round(width * 0.067));
    const foregroundHeight = Math.max(2, height - Math.round(height * 0.156));
    composition = [
      '[0:v]split=2[bg][fg]',
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},gblur=sigma=32,eq=brightness=-0.11:saturation=0.72[bgv]`,
      `[fg]scale=${foregroundWidth}:${foregroundHeight}:force_original_aspect_ratio=decrease:flags=lanczos[fgv]`,
      `[bgv][fgv]overlay=(W-w)/2:(H-h)/2:format=auto[composed]`
    ].join(';');
  } else if (fit === 'contain') {
    composition = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black[composed]`;
  } else {
    const workingWidth = Math.ceil(width * 1.2 / 2) * 2;
    const workingHeight = Math.ceil(height * 1.2 / 2) * 2;
    composition = `[0:v]scale=${workingWidth}:${workingHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${workingWidth}:${workingHeight}[composed]`;
  }
  return `${composition};[composed]zoompan=${zoom}:d=1:s=${width}x${height}:fps=${fps},settb=AVTB,setsar=1,${gradeFilter(timeline, shot)}[v]`;
}

function videoFilter(shot, timeline) {
  const { width, height, fps } = timeline.output;
  const duration = finite(shot.duration, 1);
  const commonTail = `setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},fps=${fps},settb=AVTB,setsar=1,${gradeFilter(timeline, shot)}[v]`;
  if (shot.fit === 'containBlur') {
    const foregroundWidth = Math.max(2, width - Math.round(width * 0.067));
    const foregroundHeight = Math.max(2, height - Math.round(height * 0.156));
    return [
      '[0:v]split=2[bg][fg]',
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},gblur=sigma=32,eq=brightness=-0.11:saturation=0.72[bgv]`,
      `[fg]scale=${foregroundWidth}:${foregroundHeight}:force_original_aspect_ratio=decrease:flags=lanczos[fgv]`,
      `[bgv][fgv]overlay=(W-w)/2:(H-h)/2:format=auto,${commonTail}`
    ].join(';');
  }
  if (shot.fit === 'contain') {
    return `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,${commonTail}`;
  }
  return `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},${commonTail}`;
}

function renderShot(context, shot, index) {
  const { timeline, projectRoot, buildDir, tools, progress } = context;
  const output = timeline.output;
  const duration = finite(shot.duration, 0);
  const frames = Math.round(duration * output.fps);
  const input = projectPath(projectRoot, shot.path, `shot ${shot.id} path`, { exists: true });
  const segment = path.join(buildDir, 'segments', `${String(index + 1).padStart(3, '0')}-${shot.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.mkv`);
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
  return segment;
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

function prepareCaptions(context) {
  const { timeline, projectRoot, progress } = context;
  if (!timeline.captionSource && !timeline.captions) return null;
  const output = projectPath(projectRoot, timeline.captions || 'captions/final.ass', 'captions');
  if (!timeline.captionSource) {
    if (!fs.existsSync(output)) throw new Error(`Caption ASS not found: ${path.relative(projectRoot, output)}`);
    return output;
  }
  const input = projectPath(projectRoot, timeline.captionSource, 'captionSource', { exists: true });
  const document = readCaptionDocument(input);
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
    font: timeline.font
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

function prepareNarration(context) {
  const { timeline, projectRoot, buildDir, tools, progress } = context;
  const spec = narrationSpec(timeline, projectRoot);
  if (!spec || spec.engine === 'none') return null;
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
    normalized.push({ id, start, path: wav });
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
  return { file: narration, engine: spec.engine, cues: normalized.length, voice: spec.voice || null };
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

function renderPicture(context, assembled, captions) {
  const { timeline, projectRoot, buildDir, tools, progress } = context;
  const picture = path.join(buildDir, 'picture.mp4');
  let filter = 'format=yuv420p';
  if (captions) {
    const fonts = timeline.fontsDir
      ? `:fontsdir='${filterPath(projectPath(projectRoot, timeline.fontsDir, 'fontsDir', { exists: true }))}'`
      : '';
    filter = `ass=filename='${filterPath(captions)}'${fonts},format=yuv420p`;
  }
  progress(captions ? 'burning captions and mastering picture' : 'mastering picture');
  const rendered = run(tools.ffmpeg, [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-i', assembled,
    '-vf', filter,
    '-an', '-t', String(timeline.output.duration),
    '-c:v', 'libx264', '-preset', timeline.output.preset || 'slow', '-crf', String(finite(timeline.output.crf, 18)),
    '-profile:v', 'high', '-level', timeline.output.level || '4.2', '-pix_fmt', 'yuv420p',
    '-r', String(timeline.output.fps), '-g', String(Math.round(timeline.output.fps * 2)),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-movflags', '+faststart',
    picture
  ], { cwd: projectRoot, capture: true });
  if (/failed to find any fallback with glyph|fontselect:.*failed/i.test(rendered.stderr)) {
    throw new Error(
      'Subtitle rendering could not resolve one or more glyphs. Add a CJK-capable font file under the project, set timeline.fontsDir to that project-relative directory, and set the caption font family.'
    );
  }
  return picture;
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
  progress(`normalizing audio to ${target} LUFS / ${peak} dBTP`);
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
  return { file: normalized, stats, targetLufs: target, targetTruePeakDb: peak };
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

  const loudnessRun = run(tools.ffmpeg, [
    '-hide_banner', '-nostats', '-i', file,
    '-filter_complex', 'ebur128=peak=true',
    '-f', 'null', '-'
  ], { cwd: projectRoot, capture: true });
  const loudnessText = `${loudnessRun.stdout}\n${loudnessRun.stderr}`;
  const integratedLufs = lastNumber(loudnessText, /I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g);
  const truePeakDbfs = lastNumber(loudnessText, /Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/g);
  const targetLufs = finite(timeline.output.loudnessLufs, -14);
  const targetPeak = finite(timeline.output.truePeakDb, -1.5);
  const allowSilent = Boolean(timeline.audio && timeline.audio.allowSilent);
  if (integratedLufs === null || truePeakDbfs === null) {
    const message = 'Could not measure final integrated loudness and true peak.';
    if (allowSilent) warnings.push(message);
    else errors.push(message);
  } else if (!allowSilent && Math.abs(integratedLufs - targetLufs) > 1) {
    errors.push(`Integrated loudness ${integratedLufs} LUFS misses target ${targetLufs} LUFS by more than 1 LU.`);
  }
  if (truePeakDbfs !== null && truePeakDbfs > targetPeak + 0.6) {
    errors.push(`True peak ${truePeakDbfs} dBFS exceeds target tolerance ${targetPeak + 0.6} dBFS.`);
  }

  const blackRun = run(tools.ffmpeg, [
    '-hide_banner', '-nostats', '-i', file,
    '-vf', 'blackdetect=d=0.35:pix_th=0.10',
    '-an', '-f', 'null', '-'
  ], { cwd: projectRoot, capture: true });
  const blackEvents = [...`${blackRun.stdout}\n${blackRun.stderr}`.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)]
    .map((match) => ({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) }));
  if (blackEvents.length) warnings.push(`${blackEvents.length} black-frame interval(s) require visual review.`);

  const silenceRun = run(tools.ffmpeg, [
    '-hide_banner', '-nostats', '-i', file,
    '-af', 'silencedetect=noise=-45dB:d=1.5',
    '-vn', '-f', 'null', '-'
  ], { cwd: projectRoot, capture: true });
  const silenceEvents = [...`${silenceRun.stdout}\n${silenceRun.stderr}`.matchAll(/silence_start:\s*([\d.]+)|silence_end:\s*([\d.]+)/g)]
    .map((match) => match[1]
      ? { type: 'start', time: Number(match[1]) }
      : { type: 'end', time: Number(match[2]) });
  if (silenceEvents.length && !allowSilent) warnings.push(`${silenceEvents.length} silence boundary event(s) require review.`);

  return {
    ok: errors.length === 0,
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

function renderProject(projectDir, options = {}) {
  const started = Date.now();
  const projectRoot = path.resolve(projectDir);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project directory not found: ${projectRoot}`);
  }
  const timelineRelative = options.timeline || 'timeline.json';
  const timelineFile = projectPath(projectRoot, timelineRelative, 'timeline', { exists: true });
  const timeline = readJson(timelineFile);
  validateTimeline(timeline, projectRoot, options);
  preflightProjectIO(collectProjectIO(timeline, projectRoot, timelineFile), options);
  const tools = inspectDependencies();
  const buildRoot = projectPath(projectRoot, '.qiaocut', 'internal build root');
  fs.mkdirSync(buildRoot, { recursive: true });
  assertPhysicalPathWithin(projectRoot, buildRoot, 'internal build root');
  const buildDir = fs.mkdtempSync(path.join(buildRoot, 'render-'));
  const progress = makeProgress(options);
  const context = { timeline, projectRoot, timelineFile, buildDir, tools, progress };
  progress(`${tools.version}`);
  try {
    const captions = prepareCaptions(context);
    const music = prepareMusic(context);
    const narration = prepareNarration(context);
    const segments = timeline.shots.map((shot, index) => renderShot(context, shot, index));
    const assembled = concatSegments(context, segments);
    const picture = renderPicture(context, assembled, captions);
    const mix = mixAudio(context, assembled, narration, music);
    const normalized = loudnorm(context, mix);
    const finalVideo = muxFinal(context, picture, normalized.file);
    const sheet = contactSheet(context, finalVideo);
    const verification = inspectFinal(context, finalVideo);
    const reportPath = projectPath(
      projectRoot,
      (timeline.reports && timeline.reports.renderReport) || 'reports/render-report.json',
      'reports.renderReport'
    );
    const report = {
      ok: verification.ok,
      schema: timeline.schema,
      title: timeline.title || null,
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
      narration: narration ? { engine: narration.engine, cues: narration.cues, voice: narration.voice } : null,
      music: music ? { mode: music.mode, file: path.relative(projectRoot, music.file), bpm: music.bpm || null, seed: music.seed || null } : null,
      loudness: {
        targetLufs: normalized.targetLufs,
        targetTruePeakDb: normalized.targetTruePeakDb,
        firstPass: normalized.stats
      },
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
  const options = { keepBuild: false, json: false, force: false, allowLarge: false };
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
    else if (token === '--help') options.help = true;
    else if (token === '--timeline') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new UsageError('--timeline requires a project-relative path.');
      options.timeline = value;
      index += 1;
    } else if (token.startsWith('--timeline=')) {
      options.timeline = token.slice('--timeline='.length);
      if (!options.timeline) throw new UsageError('--timeline requires a project-relative path.');
    } else {
      throw new UsageError(`Unknown option: ${token}`);
    }
  }
  if (positional.length > 1) throw new UsageError('Only one project directory may be supplied.');
  return { projectDir: positional[0], options };
}

function usage() {
  return `Usage: render_project.js <project-dir> [--timeline timeline.json] [--json] [--keep-build] [--force] [--allow-large]

Renders a qiaocut.timeline.v1 project with ffmpeg-full. All media and output paths
inside the timeline must be relative to <project-dir>. Existing generated outputs
are preserved unless --force is supplied.
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
  UsageError,
  inspectDependencies,
  parseArgs,
  preflightProjectIO,
  projectPath,
  renderProject,
  validateTimeline
};

if (require.main === module) process.exitCode = cli();
