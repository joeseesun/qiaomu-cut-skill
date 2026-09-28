#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { assertCompleteContext } = require('./complete_sentence');
const { ensureInternalDirectory, projectPath } = require('./render_project');

class UsageError extends Error {}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const booleans = new Set(['json', 'force', 'apply', 'require-media', 'strict-boundaries', 'help']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
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
  qcut english-mix init <project-dir> --phrases "A|B|C" [--clips-per-phrase 4] [--force] [--json]
  qcut english-mix audit <project-dir> [--require-media] [--strict-boundaries] [--json]
  qcut english-mix pace <project-dir> [--lead-ms 60] [--tail-ms 500]
             [--fade-in-ms 40] [--fade-out-ms 160] [--crossfade-ms 200]
             [--apply] [--force] [--json]
  qcut english-mix review <project-dir> [--video renders/final.preview.mp4] [--frames 8] [--force] [--json]

The selection contract is source-selection.json. Put downloaded clips at
assets/source/<clip-id>.mp4 or set clips[].localPath. Store previous/current/next
subtitle evidence in clips[].subtitleWindow before paid cut creation.
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

function normalizePhrase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'‘’]/g, '')
    .replace(/[.!?。！？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${path.basename(binary)} failed`).trim());
  return result.stdout || '';
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function inspectMedia(file, ffprobe) {
  const data = JSON.parse(run(ffprobe, [
    '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'json', file
  ]));
  const streams = data.streams || [];
  return {
    hasVideo: streams.some((stream) => stream.codec_type === 'video'),
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    duration: Number(data.format && data.format.duration) || 0,
    sizeBytes: Number(data.format && data.format.size) || 0
  };
}

function boundedMilliseconds(value, fallback, minimum, maximum, name) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new UsageError(`--${name} must be between ${minimum} and ${maximum} milliseconds.`);
  }
  return Math.round(number);
}

function maxVolume(file, ffmpeg, start, duration) {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-nostats', '-v', 'info', '-ss', String(start), '-t', String(duration), '-i', file,
    '-vn', '-af', 'volumedetect', '-f', 'null', '-'
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'ffmpeg volumedetect failed').trim());
  const match = String(result.stderr || '').match(/max_volume:\s*(-?inf|-?[\d.]+) dB/i);
  if (!match) throw new Error(`Could not measure edge silence for ${path.basename(file)}.`);
  return match[1].toLowerCase() === '-inf' ? -Infinity : Number(match[1]);
}

function paceProject(projectRoot, flags) {
  const selectionFile = projectPath(projectRoot, 'source-selection.json', 'source selection', { exists: true });
  const selection = readJson(selectionFile, 'source-selection.json');
  if (selection.workflow !== 'english-mix' || !Array.isArray(selection.groups)) {
    throw new Error('source-selection.json must describe workflow=english-mix with groups[].');
  }
  const { ffmpeg, ffprobe } = mediaTools();
  const policy = {
    leadHoldMs: boundedMilliseconds(flags['lead-ms'], 60, 20, 300, 'lead-ms'),
    tailHoldMs: boundedMilliseconds(flags['tail-ms'], 500, 200, 1000, 'tail-ms'),
    audioFadeInMs: boundedMilliseconds(flags['fade-in-ms'], 40, 20, 200, 'fade-in-ms'),
    audioFadeOutMs: boundedMilliseconds(flags['fade-out-ms'], 160, 60, 400, 'fade-out-ms'),
    crossfadeMs: boundedMilliseconds(flags['crossfade-ms'], 200, 100, 350, 'crossfade-ms')
  };
  const outputDir = projectPath(projectRoot, 'assets/processed', 'processed media directory');
  ensureInternalDirectory(projectRoot, outputDir, 'processed media directory');
  const items = [];

  for (const group of selection.groups) {
    for (const clip of group.clips || []) {
      if (!clip.id) throw new Error('Every selected clip needs an id before pacing.');
      const sourceRelative = clip.localPath || `assets/source/${clip.id}.mp4`;
      const outputRelative = clip.processedPath || `assets/processed/${clip.id}.mp4`;
      const source = projectPath(projectRoot, sourceRelative, `${clip.id} source`, { exists: true });
      const output = projectPath(projectRoot, outputRelative, `${clip.id} processed output`);
      if (fs.existsSync(output) && !flags.force) {
        throw new Error(`Processed output already exists: ${outputRelative}. Re-run with --force after reviewing it.`);
      }
      const media = inspectMedia(source, ffprobe);
      if (!media.hasVideo || !media.hasAudio) throw new Error(`${clip.id} must contain both video and audio before pacing.`);
      const trimStart = Math.max(0, Number(clip.trimStartMs || 0) / 1000);
      const requestedTrimEnd = clip.trimEndMs == null ? media.duration : Number(clip.trimEndMs) / 1000;
      const trimEnd = Math.min(media.duration, requestedTrimEnd);
      if (!Number.isFinite(trimStart) || !Number.isFinite(trimEnd) || trimEnd <= trimStart + 0.2) {
        throw new Error(`${clip.id} has an invalid trim window: ${clip.trimStartMs || 0}..${clip.trimEndMs || Math.round(media.duration * 1000)} ms.`);
      }
      const contentDuration = trimEnd - trimStart;
      const lead = policy.leadHoldMs / 1000;
      const tail = policy.tailHoldMs / 1000;
      const fadeIn = policy.audioFadeInMs / 1000;
      const fadeOut = policy.audioFadeOutMs / 1000;
      const total = contentDuration + lead + tail;
      const fadeOutStart = Math.max(lead, lead + contentDuration - fadeOut);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      run(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
        '-filter_complex',
        `[0:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS,` +
        `tpad=start_mode=clone:start_duration=${lead}:stop_mode=clone:stop_duration=${tail}[v];` +
        `[0:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS,` +
        `adelay=${policy.leadHoldMs}:all=1,afade=t=in:st=${lead}:d=${fadeIn},` +
        `afade=t=out:st=${fadeOutStart}:d=${fadeOut},apad,atrim=0:${total}[a]`,
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output
      ]);
      const processed = inspectMedia(output, ffprobe);
      const measuredLead = Math.max(0.05, lead - 0.03);
      const measuredTail = Math.max(0.05, tail - 0.03);
      const leadMaxDb = maxVolume(output, ffmpeg, 0, measuredLead);
      const tailMaxDb = maxVolume(output, ffmpeg, Math.max(0, processed.duration - measuredTail), measuredTail);
      const item = {
        id: clip.id,
        sourcePath: sourceRelative,
        processedPath: outputRelative,
        sourceDuration: media.duration,
        trimStartMs: Math.round(trimStart * 1000),
        trimEndMs: Math.round(trimEnd * 1000),
        contentDuration,
        processedDuration: processed.duration,
        leadMaxDb,
        tailMaxDb,
        edgeSilenceVerified: leadMaxDb <= -60 && tailMaxDb <= -60
      };
      if (!item.edgeSilenceVerified) throw new Error(`${clip.id} failed the -60 dB edge-silence gate.`);
      items.push(item);
      if (flags.apply) clip.processedPath = outputRelative;
    }
  }

  if (flags.apply) {
    selection.rangePolicy = { ...(selection.rangePolicy || {}), ...policy };
    const temporary = `${selectionFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(selection, null, 2)}\n`);
    fs.renameSync(temporary, selectionFile);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    ok: true,
    applied: Boolean(flags.apply),
    policy,
    silenceThresholdDb: -60,
    count: items.length,
    trimmedLeadingFragments: items.filter((item) => item.trimStartMs > 0).length,
    trimmedTrailingFragments: items.filter((item) => item.trimEndMs < Math.round(item.sourceDuration * 1000) - 5).length,
    items
  };
  const reportFile = projectPath(projectRoot, 'reports/english-mix-pacing.json', 'English mix pacing report');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, report: 'reports/english-mix-pacing.json' };
}

function initProject(projectRoot, flags) {
  const phrases = String(flags.phrases || '').split('|').map((value) => value.trim()).filter(Boolean);
  if (phrases.length === 0) throw new UsageError('--phrases must contain one or more expressions separated by |.');
  const clipsPerPhrase = Math.max(1, Math.min(20, Math.round(Number(flags['clips-per-phrase'] || 4))));
  fs.mkdirSync(projectRoot, { recursive: true });
  for (const directory of ['assets/source', 'assets/processed', 'assets/rejected', 'captions', 'scenes', 'renders', 'reports']) {
    ensureInternalDirectory(projectRoot, path.join(projectRoot, directory), `${directory} directory`);
  }
  const selection = {
    schema: 'qiaocut.source-selection.v1',
    createdAt: new Date().toISOString(),
    workflow: 'english-mix',
    targetCount: phrases.length * clipsPerPhrase,
    selectedCount: 0,
    clipsPerPhrase,
    source: '33tc',
    rangePolicy: {
      contextBefore: 1,
      startPadMs: 450,
      endPadMs: 750,
      leadHoldMs: 60,
      tailHoldMs: 500,
      audioFadeInMs: 40,
      audioFadeOutMs: 160,
      crossfadeMs: 200,
      introMaxMs: 700,
      groupCardDurationMs: 2000,
      groupCardMaxMs: 2200,
      firstAudioMaxMs: 2600,
      rule: 'Store subtitleWindow, trim partial subtitle cues, pass strict boundary audit before paid cuts, pace accepted media, then overlap adjacent timeline shots by crossfadeMs. Frame zero must already be a complete cover; keep the cover brief but leave phrase-introduction cards readable.'
    },
    groups: phrases.map((phrase) => ({ phrase, note: '', clips: [] }))
  };
  const output = projectPath(projectRoot, 'source-selection.json', 'source selection');
  writeJson(output, selection, Boolean(flags.force));
  return { ok: true, project: displayPath(projectRoot), selection: 'source-selection.json', targetCount: selection.targetCount };
}

function auditProject(projectRoot, flags) {
  const selectionFile = projectPath(projectRoot, 'source-selection.json', 'source selection', { exists: true });
  const selection = readJson(selectionFile, 'source-selection.json');
  if (selection.workflow !== 'english-mix' || !Array.isArray(selection.groups)) {
    throw new Error('source-selection.json must describe workflow=english-mix with groups[].');
  }
  const { ffprobe } = mediaTools();
  const items = [];
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const stableKeys = new Map();
  const shaOwners = new Map();

  for (const group of selection.groups) {
    const phrase = normalizePhrase(group.phrase);
    if (!phrase) errors.push({ code: 'empty-phrase', group: group.phrase || '' });
    for (const clip of group.clips || []) {
      const item = { id: clip.id || '', phrase: group.phrase, errors: [], warnings: [] };
      if (!clip.id || ids.has(clip.id)) item.errors.push('missing-or-duplicate-id');
      else ids.add(clip.id);
      const stableKey = [clip.videoId ?? '', clip.sourceStartMs ?? '', clip.sourceEndMs ?? ''].join(':');
      if (stableKey !== '::') {
        if (stableKeys.has(stableKey)) item.errors.push(`duplicate-range:${stableKeys.get(stableKey)}`);
        else stableKeys.set(stableKey, clip.id);
      }
      const textEvidence = `${clip.english || ''}\n${clip.content || ''}`;
      if (phrase && !normalizePhrase(textEvidence).includes(phrase)) item.errors.push('target-phrase-missing-from-selection-text');

      if (clip.subtitleWindow) {
        try {
          const boundary = assertCompleteContext(clip.subtitleWindow, {
            contextBefore: Number(clip.contextBefore ?? selection.rangePolicy?.contextBefore ?? 1),
            startPad: Number(selection.rangePolicy?.startPadMs ?? 450) / 1000,
            endPad: Number(selection.rangePolicy?.endPadMs ?? 750) / 1000
          });
          item.boundary = { status: 'verified', in: boundary.in, out: boundary.out, selectedText: boundary.selectedText };
          if (Number.isFinite(Number(clip.sourceStartMs)) && Number(clip.sourceStartMs) / 1000 > boundary.in + 0.03) {
            item.errors.push('paid-cut-starts-after-complete-context-boundary');
          }
          if (Number.isFinite(Number(clip.sourceEndMs)) && Number(clip.sourceEndMs) / 1000 < boundary.out - 0.03) {
            item.errors.push('paid-cut-ends-before-complete-context-boundary');
          }
        } catch (error) {
          item.errors.push(`sentence-boundary:${error.message}`);
        }
      } else {
        item.boundary = { status: 'missing-evidence' };
        item.warnings.push('subtitleWindow missing; paid range cannot be proven complete');
        if (flags['strict-boundaries']) item.errors.push('strict-boundary-evidence-required');
      }

      const localPath = clip.localPath || `assets/source/${clip.id}.mp4`;
      const mediaFile = projectPath(projectRoot, localPath, `${clip.id} media`);
      item.localPath = localPath;
      item.mediaExists = fs.existsSync(mediaFile);
      if (item.mediaExists) {
        try {
          item.media = inspectMedia(mediaFile, ffprobe);
          item.sha256 = sha256(mediaFile);
          if (!item.media.hasVideo) item.errors.push('missing-video-stream');
          if (!item.media.hasAudio) item.errors.push('missing-audio-stream');
          if (shaOwners.has(item.sha256)) item.errors.push(`duplicate-sha256:${shaOwners.get(item.sha256)}`);
          else shaOwners.set(item.sha256, clip.id);
          const subtitlePath = clip.subtitlePath || `assets/source/${clip.id}.srt`;
          const subtitleFile = projectPath(projectRoot, subtitlePath, `${clip.id} subtitle`);
          if (fs.existsSync(subtitleFile) && phrase && !normalizePhrase(fs.readFileSync(subtitleFile, 'utf8')).includes(phrase)) {
            item.errors.push('target-phrase-missing-from-downloaded-subtitle');
          }
        } catch (error) {
          item.errors.push(`media-inspection:${error.message}`);
        }
      } else {
        item.warnings.push('media-not-downloaded');
        if (flags['require-media']) item.errors.push('required-media-missing');
      }
      errors.push(...item.errors.map((message) => ({ clip: clip.id, message })));
      warnings.push(...item.warnings.map((message) => ({ clip: clip.id, message })));
      items.push(item);
    }
  }

  const targetCount = Number(selection.targetCount || 0);
  if (targetCount > 0 && items.length > targetCount) errors.push({ code: 'selected-count-exceeds-target', selected: items.length, target: targetCount });
  const report = {
    generatedAt: new Date().toISOString(),
    ok: errors.length === 0,
    workflow: 'english-mix',
    selectedCount: items.length,
    targetCount,
    padded: false,
    mediaCount: items.filter((item) => item.mediaExists).length,
    uniqueSha256: shaOwners.size,
    errors,
    warnings,
    items
  };
  const reportFile = projectPath(projectRoot, 'reports/source-audit.json', 'source audit');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const temporary = `${reportFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, reportFile);
  return { ...report, report: 'reports/source-audit.json' };
}

function transitionDuration(shot) {
  if (!shot || !shot.transition) return 0;
  if (typeof shot.transition === 'string') return shot.transition === 'cut' ? 0 : 0.25;
  return Number(shot.transition.duration || 0);
}

function shotWindows(timeline) {
  let cursor = 0;
  return (timeline.shots || []).map((shot, index) => {
    const overlap = index === 0 ? 0 : transitionDuration(shot);
    const start = Math.max(0, cursor - overlap);
    const end = start + Number(shot.duration || 0);
    cursor = end;
    return { id: shot.id, start, end, duration: Number(shot.duration || 0), sourceAudio: shot.sourceAudio === true };
  });
}

function evenlySample(items, count) {
  if (items.length <= count) return items;
  const selected = [];
  for (let index = 0; index < count; index += 1) {
    selected.push(items[Math.round(index * (items.length - 1) / (count - 1))]);
  }
  return selected;
}

function previewPath(outputFile) {
  const extension = path.extname(outputFile);
  return `${outputFile.slice(0, -extension.length)}.preview${extension}`;
}

function reviewProject(projectRoot, flags) {
  const timelineFile = projectPath(projectRoot, 'timeline.json', 'timeline', { exists: true });
  const timeline = readJson(timelineFile, 'timeline.json');
  const relativeVideo = flags.video || previewPath(timeline.output && timeline.output.file || 'renders/final.mp4');
  const video = projectPath(projectRoot, relativeVideo, 'preview video', { exists: true });
  const outputDir = projectPath(projectRoot, 'reports/english-mix-review', 'English mix review directory');
  ensureInternalDirectory(projectRoot, outputDir, 'English mix review directory');
  const contactSheet = path.join(outputDir, 'contact-sheet.jpg');
  const phoneFrame = path.join(outputDir, 'phone-long-caption.png');
  const reviewFile = path.join(outputDir, 'review.json');
  if (!flags.force && [contactSheet, phoneFrame, reviewFile].some((file) => fs.existsSync(file))) {
    throw new Error('English-mix review outputs already exist. Re-run with --force after reviewing them.');
  }
  const { ffmpeg } = mediaTools();
  const count = Math.max(1, Math.min(12, Math.round(Number(flags.frames || 8))));
  const candidates = shotWindows(timeline).filter((shot) => shot.sourceAudio && shot.duration > 0.2);
  if (candidates.length === 0) throw new Error('No sourceAudio=true shots found for English-mix review.');
  const selected = evenlySample(candidates, Math.min(count, candidates.length));
  const frames = [];
  for (const [index, shot] of selected.entries()) {
    const time = Math.round((shot.start + shot.duration * 0.65) * 1000) / 1000;
    const output = path.join(outputDir, `frame-${String(index + 1).padStart(2, '0')}.png`);
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(time), '-i', video,
      '-frames:v', '1', '-vf', 'scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2:black', output
    ]);
    frames.push({ shotId: shot.id, time, path: path.relative(projectRoot, output) });
  }
  if (frames.length === 1) {
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(projectRoot, frames[0].path),
      '-frames:v', '1', contactSheet
    ]);
  } else {
    const columns = Math.min(4, frames.length);
    const layout = frames.map((_, index) => `${(index % columns) * 270}_${Math.floor(index / columns) * 480}`).join('|');
    const inputs = frames.flatMap((frame) => ['-i', path.join(projectRoot, frame.path)]);
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', ...inputs,
      '-filter_complex', `xstack=inputs=${frames.length}:layout=${layout}:fill=black`, '-frames:v', '1', contactSheet
    ]);
  }

  let phoneTime = frames[0].time;
  if (timeline.captionSource) {
    const captionFile = projectPath(projectRoot, timeline.captionSource, 'caption source', { exists: true });
    const captions = readJson(captionFile, 'caption source');
    const english = (captions.events || []).filter((event) => event.style === 'English' && Number(event.end) > Number(event.start));
    english.sort((left, right) => String(right.text || '').length - String(left.text || '').length);
    if (english[0]) phoneTime = (Number(english[0].start) + Number(english[0].end)) / 2;
  }
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(phoneTime), '-i', video,
    '-frames:v', '1', phoneFrame
  ]);
  const report = {
    generatedAt: new Date().toISOString(),
    ok: true,
    video: relativeVideo,
    frameCount: frames.length,
    frames,
    contactSheet: path.relative(projectRoot, contactSheet),
    phoneLongCaption: { time: phoneTime, path: path.relative(projectRoot, phoneFrame) },
    checksRequired: ['text outside footage', 'faces unobscured', 'original subtitles unobscured', 'mobile readability', 'platform UI risk']
  };
  fs.writeFileSync(reviewFile, `${JSON.stringify(report, null, 2)}\n`);
  return report;
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
    if (action === 'audit') result = auditProject(projectRoot, flags);
    else if (action === 'pace') result = paceProject(projectRoot, flags);
    else if (action === 'review') result = reviewProject(projectRoot, flags);
    else throw new UsageError(`Unknown english-mix action: ${action}\n${usage()}`);
  }
  if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${action} complete: ${displayPath(projectRoot)}\n`);
  return result.ok === false ? 1 : 0;
}

module.exports = { auditProject, evenlySample, initProject, paceProject, reviewProject, shotWindows };

if (require.main === module) {
  cli().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
