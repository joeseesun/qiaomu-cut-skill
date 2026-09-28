#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureInternalDirectory, projectPath } = require('./render_project');

class UsageError extends Error {}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.m4v', '.webm']);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const booleans = new Set(['json', 'force', 'apply', 'help']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    const name = token.slice(2, equals > 2 ? equals : undefined);
    if (equals > 2) {
      flags[name] = token.slice(equals + 1);
      continue;
    }
    if (booleans.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new UsageError(`Missing value for --${name}`);
    flags[name] = value;
    index += 1;
  }
  return { positional, flags };
}

function usage() {
  return `Usage:
  qcut movie-montage init <project-dir> [--target 10] [--clip-duration 3.4] [--force] [--json]
  qcut movie-montage review <project-dir> [--clip-duration 3.4] [--motion-fps 4]
             [--samples 15] [--apply] [--force] [--json]

The selection contract is source-selection.json. Candidate media may be set with
candidates[].localPath or stored below assets/source/<candidate-id>/. The review
recommends high-motion windows but always emits visual evidence for human approval.
`;
}

function displayPath(file) {
  const home = os.homedir();
  return file === home || file.startsWith(`${home}${path.sep}`) ? `<HOME>${file.slice(home.length)}` : file;
}

function writeJson(file, value, force = false) {
  if (fs.existsSync(file) && !force) throw new Error(`Output already exists: ${file}. Re-run with --force after reviewing it.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
}

function commandPath(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function mediaTools() {
  const ffmpeg = process.env.QIAOMU_FFMPEG ||
    (fs.existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' : commandPath('ffmpeg'));
  const ffprobe = process.env.QIAOMU_FFPROBE ||
    (ffmpeg && fs.existsSync(path.join(path.dirname(ffmpeg), 'ffprobe')) ? path.join(path.dirname(ffmpeg), 'ffprobe') : commandPath('ffprobe'));
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe not found. Run qcut doctor and install ffmpeg-full.');
  return { ffmpeg, ffprobe };
}

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout || '');
    throw new Error((stderr || stdout || `${path.basename(binary)} failed`).trim());
  }
  return result.stdout;
}

function safeId(value) {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw new Error('Every montage candidate needs a stable id.');
  return id;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    do {
      bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytes > 0) hash.update(buffer.subarray(0, bytes));
    } while (bytes > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function inspectMedia(file, ffprobe) {
  const output = run(ffprobe, [
    '-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'json', file
  ], { encoding: 'utf8' });
  const data = JSON.parse(String(output));
  const streams = data.streams || [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  return {
    hasVideo: Boolean(video),
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    duration: Number(data.format && data.format.duration) || 0,
    sizeBytes: Number(data.format && data.format.size) || 0,
    width: video && Number(video.width) || null,
    height: video && Number(video.height) || null,
    videoCodec: video && video.codec_name || null
  };
}

function numeric(value, fallback, minimum, maximum, label) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new UsageError(`--${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function findVideos(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) queue.push(path.join(current, name));
    } else if (VIDEO_EXTENSIONS.has(path.extname(current).toLowerCase())) {
      found.push(current);
    }
  }
  return found;
}

function timelineMap(projectRoot) {
  const file = projectPath(projectRoot, 'timeline.json', 'timeline');
  if (!fs.existsSync(file)) return new Map();
  const timeline = readJson(file, 'timeline.json');
  return new Map((timeline.shots || []).map((shot) => [shot.id, shot]));
}

function candidateMedia(projectRoot, candidate, shots) {
  if (candidate.localPath) return projectPath(projectRoot, candidate.localPath, `${candidate.id} localPath`);
  const timelineShot = shots.get(candidate.id);
  if (timelineShot && timelineShot.path) return projectPath(projectRoot, timelineShot.path, `${candidate.id} timeline path`);
  const directory = projectPath(projectRoot, `assets/source/${safeId(candidate.id)}`, `${candidate.id} source directory`);
  return findVideos(directory)[0] || null;
}

function candidateMediaFiles(projectRoot, candidate) {
  const directory = projectPath(projectRoot, `assets/source/${safeId(candidate.id)}`, `${candidate.id} source directory`);
  return findVideos(directory);
}

function motionWindow(file, media, ffmpeg, clipDuration, motionFps) {
  const width = 160;
  const height = 90;
  const frameBytes = width * height;
  const raw = run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', `fps=${motionFps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
  ]);
  const frames = Math.floor(raw.length / frameBytes);
  if (frames < 2) return { recommendedIn: 0, duration: Math.min(clipDuration, media.duration), score: 0, activeRatio: 0, samples: frames };
  const differences = [0];
  for (let frame = 1; frame < frames; frame += 1) {
    const previous = (frame - 1) * frameBytes;
    const current = frame * frameBytes;
    let sum = 0;
    for (let pixel = 0; pixel < frameBytes; pixel += 1) sum += Math.abs(raw[current + pixel] - raw[previous + pixel]);
    differences.push(sum / frameBytes);
  }
  const windowFrames = Math.max(2, Math.min(frames, Math.round(clipDuration * motionFps)));
  let best = { index: 0, score: -Infinity, average: 0, activeRatio: 0 };
  for (let start = 0; start <= frames - windowFrames; start += 1) {
    const values = differences.slice(start, start + windowFrames);
    const sorted = [...values].sort((left, right) => left - right);
    const cap = sorted[Math.max(0, Math.floor(sorted.length * 0.9) - 1)] || 0;
    const winsorized = values.map((value) => Math.min(value, cap));
    const average = winsorized.reduce((sum, value) => sum + value, 0) / winsorized.length;
    const activeRatio = values.filter((value) => value >= Math.max(2.5, average * 0.45)).length / values.length;
    const score = average * (0.72 + activeRatio * 0.28);
    if (score > best.score) best = { index: start, score, average, activeRatio };
  }
  const maxIn = Math.max(0, media.duration - Math.min(clipDuration, media.duration));
  const recommendedIn = Math.min(maxIn, Math.max(0, best.index / motionFps));
  return {
    recommendedIn: Number(recommendedIn.toFixed(3)),
    duration: Number(Math.min(clipDuration, media.duration).toFixed(3)),
    score: Number(best.score.toFixed(3)),
    averageFrameDifference: Number(best.average.toFixed(3)),
    activeRatio: Number(best.activeRatio.toFixed(3)),
    samples: frames,
    method: 'winsorized grayscale frame-difference; recommendation only, not semantic approval'
  };
}

function visualEvidence(file, outputDir, id, media, motion, ffmpeg, samples, force) {
  const contact = path.join(outputDir, `${id}-dense.jpg`);
  const strip = path.join(outputDir, `${id}-motion-strip.jpg`);
  const phone = path.join(outputDir, `${id}-phone-crops.jpg`);
  if (!force && [contact, strip, phone].some((target) => fs.existsSync(target))) {
    throw new Error(`Review evidence already exists for ${id}. Re-run with --force after reviewing it.`);
  }
  const count = Math.max(4, Math.min(samples, Math.ceil(media.duration)));
  const columns = Math.min(5, count);
  const rows = Math.ceil(count / columns);
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', file,
    '-vf', `fps=${count / media.duration},scale=240:-2,tile=${columns}x${rows}:nb_frames=${count}:padding=2:margin=2:color=black`,
    '-frames:v', '1', contact
  ], { encoding: 'utf8' });
  const start = motion.recommendedIn;
  const duration = motion.duration;
  const times = [start + duration * 0.18, start + duration * 0.5, start + duration * 0.82]
    .map((value) => Math.max(0, Math.min(media.duration - 0.04, value)));
  const stripInputs = times.flatMap((time) => ['-ss', String(time), '-i', file]);
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', ...stripInputs,
    '-filter_complex', '[0:v]scale=240:-2[a];[1:v]scale=240:-2[b];[2:v]scale=240:-2[c];[a][b][c]hstack=inputs=3[out]',
    '-map', '[out]', '-frames:v', '1', strip
  ], { encoding: 'utf8' });
  const midpoint = Math.max(0, Math.min(media.duration - 0.04, start + duration / 2));
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(midpoint), '-i', file,
    '-filter_complex',
    '[0:v]split=3[coverin][bg][fg];' +
      '[coverin]scale=270:480:force_original_aspect_ratio=increase,crop=270:480[cover];' +
      '[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=24,eq=brightness=-0.11:saturation=0.72[bgv];' +
      '[fg]scale=252:405:force_original_aspect_ratio=decrease[fgv];' +
      '[bgv][fgv]overlay=(W-w)/2:(H-h)/2[contain];[cover][contain]hstack=inputs=2[out]',
    '-map', '[out]', '-frames:v', '1', phone
  ], { encoding: 'utf8' });
  return { contact, strip, phone, midpoint: Number(midpoint.toFixed(3)) };
}

function overviewSheet(projectRoot, entries, output, ffmpeg, force, width, height, columns) {
  if (!entries.length) return null;
  if (fs.existsSync(output) && !force) throw new Error(`Overview already exists: ${path.basename(output)}. Re-run with --force after reviewing it.`);
  const rows = Math.ceil(entries.length / columns);
  const inputs = entries.flatMap((entry) => ['-i', projectPath(projectRoot, entry.path, `${entry.id} review evidence`, { exists: true })]);
  const filters = [];
  for (let index = 0; index < entries.length; index += 1) {
    const label = `${String(index + 1).padStart(2, '0')} ${safeId(entries[index].id)}`;
    filters.push(
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,` +
      `drawtext=text='${label}':x=10:y=10:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.62:boxborderw=5[v${index}]`
    );
  }
  const layout = entries.map((_, index) => `${(index % columns) * width}_${Math.floor(index / columns) * height}`).join('|');
  filters.push(`${entries.map((_, index) => `[v${index}]`).join('')}xstack=inputs=${entries.length}:layout=${layout}:fill=black[out]`);
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', filters.join(';'), '-map', '[out]', '-frames:v', '1', output
  ], { encoding: 'utf8' });
  return { path: path.relative(projectRoot, output), columns, rows, order: entries.map((entry) => entry.id) };
}

function initProject(projectRoot, flags) {
  const targetCount = Math.round(numeric(flags.target, 10, 1, 100, 'target'));
  const clipDuration = numeric(flags['clip-duration'], 3.4, 0.5, 30, 'clip-duration');
  const candidateLimit = targetCount + Math.ceil(targetCount * 0.25);
  fs.mkdirSync(projectRoot, { recursive: true });
  for (const directory of ['assets/source', 'assets/rejected', 'assets/cards', 'scenes', 'renders', 'reports/movie-montage-review']) {
    ensureInternalDirectory(projectRoot, path.join(projectRoot, directory), `${directory} directory`);
  }
  const selection = {
    schema: 'qiaocut.source-selection.v1',
    createdAt: new Date().toISOString(),
    workflow: 'movie-montage',
    targetCount,
    candidateLimit,
    selectedCount: 0,
    defaultClipDuration: clipDuration,
    source: '33tc',
    paidAttemptPolicy: {
      maxPerCandidate: 2,
      recoverExistingTaskBeforeNewCut: true,
      rule: 'After two weak paid windows, reject or replace the candidate instead of repeatedly spending credits.'
    },
    cropPolicy: {
      centeredAction: 'cover',
      ensembleOrWideFormation: 'containBlur',
      rule: 'Compare both phone crops before locking; motion score cannot approve composition.'
    },
    candidates: [],
    finalSelection: [],
    rejections: []
  };
  const output = projectPath(projectRoot, 'source-selection.json', 'source selection');
  writeJson(output, selection, Boolean(flags.force));
  return { ok: true, project: displayPath(projectRoot), selection: 'source-selection.json', targetCount, candidateLimit, clipDuration };
}

function reviewProject(projectRoot, flags) {
  const selectionFile = projectPath(projectRoot, 'source-selection.json', 'source selection', { exists: true });
  const selection = readJson(selectionFile, 'source-selection.json');
  if (!Array.isArray(selection.candidates)) throw new Error('source-selection.json must contain candidates[].');
  const clipDuration = numeric(flags['clip-duration'], Number(selection.defaultClipDuration) || 3.4, 0.5, 30, 'clip-duration');
  const motionFps = numeric(flags['motion-fps'], 4, 1, 12, 'motion-fps');
  const samples = Math.round(numeric(flags.samples, 15, 4, 30, 'samples'));
  const targetCount = Number(selection.targetCount || 10);
  const candidateLimit = Number(selection.candidateLimit || targetCount + Math.ceil(targetCount * 0.25));
  const maxPaidAttempts = Number(selection.paidAttemptPolicy && selection.paidAttemptPolicy.maxPerCandidate || 2);
  const outputDir = projectPath(projectRoot, 'reports/movie-montage-review', 'movie montage review directory');
  ensureInternalDirectory(projectRoot, outputDir, 'movie montage review directory');
  const reportFile = path.join(outputDir, 'review.json');
  if (fs.existsSync(reportFile) && !flags.force) throw new Error('Movie-montage review already exists. Re-run with --force after reviewing it.');
  const { ffmpeg, ffprobe } = mediaTools();
  const shots = timelineMap(projectRoot);
  const shaOwners = new Map();
  const videoOwners = new Map();
  const warnings = [];
  const errors = [];
  const items = [];

  if (selection.candidates.length > candidateLimit) {
    warnings.push({ code: 'candidate-pool-over-limit', actual: selection.candidates.length, recommendedMaximum: candidateLimit });
  }
  for (const candidate of selection.candidates) {
    const id = safeId(candidate.id);
    const item = { id, title: candidate.title || null, videoId: candidate.videoId ?? null, warnings: [], errors: [] };
    const explicitPaidAttempts = Array.isArray(candidate.attempts) ? candidate.attempts.length : Number(candidate.paidAttempts || 0);
    const inferredPaidAttempts = candidateMediaFiles(projectRoot, candidate).length;
    const paidAttempts = explicitPaidAttempts || inferredPaidAttempts;
    item.paidAttempts = paidAttempts;
    item.paidAttemptsEvidence = explicitPaidAttempts ? 'selection-contract' : inferredPaidAttempts ? 'inferred-from-local-variants' : 'none';
    if (paidAttempts > maxPaidAttempts) {
      const message = `paid-attempt-limit-exceeded:${paidAttempts}>${maxPaidAttempts}`;
      if (explicitPaidAttempts) item.errors.push(message);
      else item.warnings.push(`historical-${message}`);
    }
    const mediaFile = candidateMedia(projectRoot, candidate, shots);
    if (!mediaFile || !fs.existsSync(mediaFile)) {
      item.mediaExists = false;
      item.warnings.push('candidate-media-missing');
      items.push(item);
      warnings.push({ clip: id, message: 'candidate-media-missing' });
      continue;
    }
    item.mediaExists = true;
    item.localPath = path.relative(projectRoot, mediaFile);
    try {
      item.media = inspectMedia(mediaFile, ffprobe);
      item.sha256 = sha256(mediaFile);
      if (!item.media.hasVideo) item.errors.push('missing-video-stream');
      if (!item.media.hasAudio) item.warnings.push('missing-audio-stream');
      if (shaOwners.has(item.sha256)) item.errors.push(`duplicate-sha256:${shaOwners.get(item.sha256)}`);
      else shaOwners.set(item.sha256, id);
      if (candidate.videoId != null) {
        const key = String(candidate.videoId);
        if (videoOwners.has(key)) item.warnings.push(`duplicate-video-id:${videoOwners.get(key)}`);
        else videoOwners.set(key, id);
      }
      if (item.media.duration > 120) item.errors.push('candidate-duration-exceeds-120-second-review-limit');
      if (item.media.hasVideo && item.media.duration > 0 && item.media.duration <= 120) {
        item.motion = motionWindow(mediaFile, item.media, ffmpeg, clipDuration, motionFps);
        const evidence = visualEvidence(mediaFile, outputDir, id, item.media, item.motion, ffmpeg, samples, Boolean(flags.force));
        item.evidence = {
          denseContactSheet: path.relative(projectRoot, evidence.contact),
          recommendedWindowStrip: path.relative(projectRoot, evidence.strip),
          phoneCropComparison: path.relative(projectRoot, evidence.phone),
          phoneCropTime: evidence.midpoint,
          order: 'left=cover, right=containBlur'
        };
        const timelineFit = shots.get(id) && shots.get(id).fit;
        item.fitRecommendation = timelineFit || candidate.fit ||
          (candidate.composition === 'centered' ? 'cover' : candidate.composition === 'ensemble' ? 'containBlur' : 'compare-review');
        item.humanChecksRequired = ['actual dance/action, not dialogue or camera motion', 'complete movement phrase', 'face/body legible on phone', 'crop preserves the strongest gesture'];
        if (flags.apply) {
          const priorReview = candidate.review;
          candidate.review = {
            ...(candidate.review && typeof candidate.review === 'object' ? candidate.review : {}),
            ...(typeof priorReview === 'string' && priorReview.trim() ? { priorNote: priorReview.trim() } : {}),
            recommendedIn: item.motion.recommendedIn,
            recommendedDuration: item.motion.duration,
            motionScore: item.motion.score,
            fitRecommendation: item.fitRecommendation,
            evidence: item.evidence,
            semanticDecision: 'pending-human-review'
          };
        }
      }
    } catch (error) {
      item.errors.push(`review-failed:${error.message}`);
    }
    errors.push(...item.errors.map((message) => ({ clip: id, message })));
    warnings.push(...item.warnings.map((message) => ({ clip: id, message })));
    items.push(item);
  }

  const selected = [];
  const selectedSha = new Map();
  const selectedVideos = new Map();
  for (const final of selection.finalSelection || []) {
    const id = safeId(final.id);
    const shot = shots.get(id);
    let mediaFile = null;
    if (final.localPath) mediaFile = projectPath(projectRoot, final.localPath, `${id} final localPath`);
    else if (shot && shot.path) mediaFile = projectPath(projectRoot, shot.path, `${id} final timeline path`);
    else mediaFile = candidateMedia(projectRoot, final, shots);
    const entry = { id, videoId: final.videoId ?? null, localPath: mediaFile ? path.relative(projectRoot, mediaFile) : null, errors: [] };
    if (!mediaFile || !fs.existsSync(mediaFile)) entry.errors.push('selected-media-missing');
    else {
      const media = inspectMedia(mediaFile, ffprobe);
      entry.sha256 = sha256(mediaFile);
      entry.hasVideo = media.hasVideo;
      entry.hasAudio = media.hasAudio;
      if (!media.hasVideo) entry.errors.push('selected-missing-video-stream');
      if (!media.hasAudio) entry.errors.push('selected-missing-audio-stream');
      if (selectedSha.has(entry.sha256)) entry.errors.push(`selected-duplicate-sha256:${selectedSha.get(entry.sha256)}`);
      else selectedSha.set(entry.sha256, id);
      if (entry.videoId != null) {
        const key = String(entry.videoId);
        if (selectedVideos.has(key)) entry.errors.push(`selected-duplicate-video-id:${selectedVideos.get(key)}`);
        else selectedVideos.set(key, id);
      }
    }
    errors.push(...entry.errors.map((message) => ({ clip: id, message })));
    selected.push(entry);
  }
  if (selected.length > targetCount) errors.push({ code: 'selected-count-exceeds-target', selected: selected.length, target: targetCount });

  const evidenceItems = items.filter((item) => item.evidence);
  const overviews = {
    motionWindows: overviewSheet(
      projectRoot,
      evidenceItems.map((item) => ({ id: item.id, path: item.evidence.recommendedWindowStrip })),
      path.join(outputDir, 'all-motion-windows.jpg'), ffmpeg, Boolean(flags.force), 480, 180, 2
    ),
    phoneCrops: overviewSheet(
      projectRoot,
      evidenceItems.map((item) => ({ id: item.id, path: item.evidence.phoneCropComparison })),
      path.join(outputDir, 'all-phone-crops.jpg'), ffmpeg, Boolean(flags.force), 270, 240, 4
    )
  };

  if (flags.apply) {
    const temporary = `${selectionFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(selection, null, 2)}\n`);
    fs.renameSync(temporary, selectionFile);
  }
  const report = {
    schema: 'qiaocut.movie-montage-review.v1',
    generatedAt: new Date().toISOString(),
    ok: errors.length === 0,
    workflow: selection.workflow,
    targetCount,
    candidateCount: selection.candidates.length,
    candidateLimit,
    selectedCount: selected.length,
    padded: false,
    policy: {
      maxPaidAttemptsPerCandidate: maxPaidAttempts,
      clipDuration,
      motionFps,
      recovery: 'reuse existing task ID before any new paid cut',
      decisionBoundary: 'motion window is a ranking hint; visual semantic review remains required'
    },
    errors,
    warnings,
    overviews,
    items,
    selected,
    checksRequired: ['view every recommended motion strip', 'compare both phone crops', 'reject dialogue/setup windows', 'verify distinct works and hashes', 'record point balance before and after paid cuts']
  };
  writeJson(reportFile, report, Boolean(flags.force));
  return { ...report, report: path.relative(projectRoot, reportFile), applied: Boolean(flags.apply) };
}

async function cli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const [action, projectArg] = positional;
  if (flags.help || action === 'help' || !action) {
    process.stdout.write(usage());
    return 0;
  }
  if (!projectArg || positional.length > 2) throw new UsageError(usage());
  const projectRoot = path.resolve(projectArg);
  let result;
  if (action === 'init') result = initProject(projectRoot, flags);
  else {
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) throw new Error(`Project directory not found: ${projectArg}`);
    if (action === 'review') result = reviewProject(projectRoot, flags);
    else throw new UsageError(`Unknown movie-montage action: ${action}\n${usage()}`);
  }
  if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${action} complete: ${displayPath(projectRoot)}\n`);
  return result.ok === false ? 1 : 0;
}

module.exports = { initProject, motionWindow, reviewProject };

if (require.main === module) {
  cli().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
