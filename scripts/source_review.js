#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function commandPath(names) {
  for (const name of names) {
    const result = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  return null;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${path.basename(command)} failed`);
  return result.stdout;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const args = process.argv.slice(2);
const inputArg = args.find((arg) => !arg.startsWith('--'));
if (!inputArg) fail('Usage: source_review.js <asset-dir> --output <review-dir> [--samples 12] [--force] [--json]');
function flagValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const input = path.resolve(inputArg);
const output = path.resolve(flagValue('--output', path.join(input, 'source-review')));
const samples = Math.max(4, Math.min(30, Number(flagValue('--samples', 12)) || 12));
const force = args.includes('--force');
const jsonOutput = args.includes('--json');
if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) fail('asset-dir must be an existing directory.');
if (input === output) fail('review-dir must differ from asset-dir.');
fs.mkdirSync(output, { recursive: true });

const ffmpeg = process.env.QIAOMU_FFMPEG || (fs.existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' : commandPath(['ffmpeg']));
const ffprobe = ffmpeg && path.join(path.dirname(ffmpeg), 'ffprobe');
if (!ffmpeg || !ffprobe || !fs.existsSync(ffprobe)) fail('ffmpeg and ffprobe are required.');

const extensions = new Set(['.mp4', '.mov', '.mkv', '.m4v', '.webm']);
const files = fs.readdirSync(input).filter((name) => extensions.has(path.extname(name).toLowerCase())).sort();
if (!files.length) fail('No supported video files found.');

const columns = Math.ceil(Math.sqrt(samples));
const rows = Math.ceil(samples / columns);
const items = [];
for (const name of files) {
  const source = path.join(input, name);
  if (fs.lstatSync(source).isSymbolicLink()) fail(`Refusing symbolic-link input: ${name}`);
  const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source]));
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  if (!video) continue;
  const duration = Number(probe.format.duration || video.duration || 0);
  if (!(duration > 0)) continue;
  const base = path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9._-]+/g, '-');
  const contactName = `${base}-contact.jpg`;
  const contact = path.join(output, contactName);
  if (fs.existsSync(contact) && !force) fail(`${contactName} already exists; re-run with --force after reviewing the target.`);
  const fps = samples / duration;
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-vf', `fps=${fps},scale=240:-1,tile=${columns}x${rows}`, '-frames:v', '1', contact]);
  items.push({
    file: name,
    duration: Number(duration.toFixed(3)),
    width: video.width,
    height: video.height,
    codec: video.codec_name,
    contactSheet: contactName,
    decision: 'pending',
    usableRanges: [],
    rejectionReason: ''
  });
}

const report = { schema: 'qiaocut.source-review.v1', createdAt: new Date().toISOString(), input, samples, items };
const reportPath = path.join(output, 'source-review.json');
const htmlPath = path.join(output, 'index.html');
for (const target of [reportPath, htmlPath]) if (fs.existsSync(target) && !force) fail(`${path.basename(target)} already exists; re-run with --force after reviewing the target.`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const cards = items.map((item) => `<article><img src="${escapeHtml(item.contactSheet)}" alt="${escapeHtml(item.file)}"><h2>${escapeHtml(item.file)}</h2><p>${item.width}×${item.height} · ${item.duration}s · ${escapeHtml(item.codec)}</p><p>Decision: pending · Usable ranges: pending</p></article>`).join('\n');
fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><title>QiaoCut Source Review</title><style>body{margin:24px;background:#111;color:#eee;font:14px system-ui}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}article{background:#1b1b1b;padding:14px;border-radius:12px}img{width:100%;height:auto;background:#000}h2{font-size:16px;word-break:break-all}p{color:#bbb}</style><h1>QiaoCut Source Review</h1><p>${items.length} videos · ${samples} samples each</p><main>${cards}</main>`);

if (jsonOutput) process.stdout.write(`${JSON.stringify({ ok: true, videos: items.length, report: reportPath, index: htmlPath }, null, 2)}\n`);
else process.stdout.write(`Reviewed ${items.length} videos\n${htmlPath}\n`);
