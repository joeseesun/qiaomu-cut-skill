#!/usr/bin/env node
'use strict';

/*
 * qcut cover — the cover is frame 0 (see references/cover-thumbnail-method.md).
 *
 *   check  <video|image>  frame 0 not black, contrast, resolution/aspect, JPG ≤ 2 MB,
 *                         cover hold (video: 0 s vs 0.5 s), 360/168 feed previews
 *   export <video>        thumbnails from a frame: full-res PNG + 1280×720 JPG + previews
 *
 * Copyright (c) 向阳乔木 — MIT
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIMITS = {
  blackMean: 28,        // mean luma (0–255) below this = black/blank open
  flatStd: 30,          // luma std below this = washed-out cover without a focal point
  minWidth: 1280,
  minHeight: 720,
  jpgBytes: 2 * 1024 * 1024, // YouTube mobile upload ceiling
  holdPsnr: 35          // 0 s vs 0.5 s: the cover must actually hold
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function tool(name) {
  const env = name === 'ffmpeg' ? process.env.QIAOMU_FFMPEG : process.env.QIAOMU_FFPROBE;
  const candidates = [env, `/opt/homebrew/opt/ffmpeg-full/bin/${name}`, `/usr/local/opt/ffmpeg-full/bin/${name}`, `/opt/homebrew/bin/${name}`, name];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!candidate.includes('/')) {
      const found = spawnSync('which', [candidate], { encoding: 'utf8' });
      if (found.status === 0) return found.stdout.trim();
    } else if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${name} is required (run qcut setup --only ffmpeg).`);
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${path.basename(bin)} failed: ${String(result.stderr || '').slice(-800)}`);
  return result;
}

function dimensions(file) {
  const out = run(tool('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { encoding: 'utf8' });
  const stream = (JSON.parse(out.stdout).streams || [])[0] || {};
  return { width: Number(stream.width) || 0, height: Number(stream.height) || 0 };
}

// Mean and standard deviation of luma on a 320×180 downscale of one frame.
function lumaStats(file, at = 0) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (at > 0) args.push('-ss', String(at));
  args.push('-i', file, '-frames:v', '1', '-vf', 'scale=320:180:flags=area', '-f', 'rawvideo', '-pix_fmt', 'gray', '-');
  const data = run(tool('ffmpeg'), args).stdout;
  if (!data.length) throw new Error(`No frame decoded at ${at}s from ${file}.`);
  let sum = 0;
  for (const value of data) sum += value;
  const mean = sum / data.length;
  let variance = 0;
  for (const value of data) variance += (value - mean) ** 2;
  return { mean: round(mean), std: round(Math.sqrt(variance / data.length)) };
}

function extractFrame(file, at, output, scale) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (at > 0) args.push('-ss', String(at));
  args.push('-i', file, '-frames:v', '1');
  if (scale) args.push('-vf', `scale=${scale}:flags=lanczos`);
  if (/\.jpe?g$/i.test(output)) args.push('-q:v', '2');
  args.push(output);
  run(tool('ffmpeg'), args);
  return output;
}

function psnr(a, b) {
  const result = spawnSync(tool('ffmpeg'), ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const match = /average:(inf|[\d.]+)/.exec(result.stderr || '');
  if (!match) return null;
  return match[1] === 'inf' ? Infinity : Number(match[1]);
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/*
 * Write thumbnail deliverables for one frame: <base>.jpg (1280-wide, same aspect),
 * <base>-360.png and <base>-168.png feed previews. Returns relative paths.
 */
function exportThumbnails(source, outDir, base, at = 0) {
  fs.mkdirSync(outDir, { recursive: true });
  const { width, height } = dimensions(source);
  const landscape = width >= height;
  const jpg = path.join(outDir, `${base}.jpg`);
  extractFrame(source, at, jpg, landscape ? '1280:-2' : '-2:1280');
  const previews = [];
  for (const w of [360, 168]) {
    const file = path.join(outDir, `${base}-${w}.png`);
    extractFrame(source, at, file, landscape ? `${w}:-2` : `-2:${w}`);
    previews.push(file);
  }
  return { jpg, previews };
}

function checkCover(file, options = {}) {
  const errors = [];
  const warnings = [];
  const add = (list, code, message) => list.push({ code, message });
  if (!fs.existsSync(file)) throw new Error(`Not found: ${file}`);
  const isImage = IMAGE_EXT.has(path.extname(file).toLowerCase());
  const dims = dimensions(file);
  const stats = lumaStats(file, 0);
  if (stats.mean < LIMITS.blackMean) add(errors, 'frame0-not-black', `Frame 0 mean luma ${stats.mean}/255 is below ${LIMITS.blackMean}: the video opens on black/blank. Make frame 0 the cover.`);
  if (stats.std < LIMITS.flatStd) add(warnings, 'frame0-contrast', `Frame 0 luma std ${stats.std} is below ${LIMITS.flatStd}: low contrast, no clear focal point.`);
  const long = Math.max(dims.width, dims.height);
  const short = Math.min(dims.width, dims.height);
  if (long < LIMITS.minWidth || short < LIMITS.minHeight) add(errors, 'resolution', `${dims.width}×${dims.height} is below 1280×720.`);
  const ratio = long / short;
  if (Math.abs(ratio - 16 / 9) > 0.02) add(warnings, 'aspect', `Aspect ${round(ratio, 3)} is not 16:9 / 9:16; platforms will letterbox or crop the thumbnail.`);
  if (isImage && /\.jpe?g$/i.test(file)) {
    const bytes = fs.statSync(file).size;
    if (bytes > LIMITS.jpgBytes) add(errors, 'jpg-size', `${bytes} bytes exceeds the 2 MB mobile upload limit.`);
  }
  let hold = null;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qcut-cover-'));
  try {
    if (!isImage) {
      const a = extractFrame(file, 0, path.join(work, 'a.png'));
      const b = extractFrame(file, Number(options.holdAt || 0.5), path.join(work, 'b.png'));
      const value = psnr(a, b);
      hold = { at: Number(options.holdAt || 0.5), psnr: value === Infinity ? 'inf' : value, held: value === Infinity || (value != null && value >= LIMITS.holdPsnr) };
      if (!hold.held) add(warnings, 'cover-hold', `Frame 0 and ${hold.at}s differ (PSNR ${hold.psnr} dB): the cover does not hold long enough to read.`);
    }
    let previews = null;
    if (options.outDir) {
      const base = options.base || path.basename(file, path.extname(file));
      previews = exportThumbnails(file, options.outDir, base);
    }
    return {
      ok: errors.length === 0,
      file,
      kind: isImage ? 'image' : 'video',
      dimensions: dims,
      frame0: stats,
      hold,
      limits: LIMITS,
      errors,
      warnings,
      previews,
      human: 'Open the 168/360 previews: subject and words readable at feed size; nothing key under the bottom-right duration badge; the first seconds deliver what the cover promises.'
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { flags[key] = next; i += 1; } else flags[key] = true;
    } else positional.push(arg);
  }
  return { positional, flags };
}

function usage() {
  return `Usage:
  qcut cover check  <video|image> [--out dir] [--hold-at 0.5] [--json]
  qcut cover export <video> [--at 0] [--out renders/cover] [--name cover] [--json]
Method: references/cover-thumbnail-method.md
`;
}

function cli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const [command, target] = positional;
  if (!['check', 'export'].includes(command) || !target) {
    process.stderr.write(usage());
    return 2;
  }
  const file = path.resolve(target);
  let result;
  if (command === 'check') {
    result = checkCover(file, { outDir: flags.out ? path.resolve(String(flags.out)) : null, holdAt: flags['hold-at'] });
  } else {
    const outDir = path.resolve(String(flags.out || 'renders/cover'));
    const name = String(flags.name || 'cover');
    const at = Number(flags.at || 0);
    const full = extractFrame(file, at, path.join(fs.mkdirSync(outDir, { recursive: true }) || outDir, `${name}@source.png`));
    const thumbs = exportThumbnails(full, outDir, name);
    result = { ok: true, at, source: full, ...thumbs, check: checkCover(thumbs.jpg) };
    result.ok = result.check.ok;
  }
  if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`cover ${command}: ${result.ok ? 'ok' : 'blocked'}\n${[...(result.errors || (result.check && result.check.errors) || [])].map((item) => `  ✗ ${item.message}`).join('\n')}\n`);
  return result.ok ? 0 : 1;
}

module.exports = { LIMITS, lumaStats, checkCover, exportThumbnails, extractFrame, dimensions };

if (require.main === module) {
  try { process.exitCode = cli(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
