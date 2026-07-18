#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { projectPath } = require('./render_project');
const { hashFile, importAsset } = require('./ingest_asset');
const { inferredProvenance, validateSignature } = require('./fetch_generated');
const { executeListenHub, redactSecrets } = require('./adapters/listenhub');

const DEFAULT_VOICE_NAME = '向阳乔木';
const MAX_TEXT_BYTES = 128 * 1024;
const STAGING_ROOT = path.join('.qiaocut', 'staging', 'listenhub');

function parseArgs(argv) {
  const flags = {};
  const booleans = new Set(['yes', 'json']);
  const allowed = new Set([
    ...booleans,
    'attribution', 'credits', 'format', 'language', 'model', 'output', 'qcut-project',
    'terms-status', 'text', 'text-file', 'voice-name'
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected narration argument: ${token}`);
    const equal = token.indexOf('=');
    if (equal > 2) {
      const key = token.slice(2, equal);
      if (!allowed.has(key)) throw new Error(`Unknown narration option: --${key}`);
      if (booleans.has(key)) throw new Error(`--${key} is a bare boolean flag and cannot use =value.`);
      flags[key] = token.slice(equal + 1);
      continue;
    }
    const key = token.slice(2);
    if (!allowed.has(key)) throw new Error(`Unknown narration option: --${key}`);
    if (booleans.has(key)) {
      flags[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value.`);
    flags[key] = value;
    index += 1;
  }
  return flags;
}

function readNarrationText(projectRoot, flags) {
  if (Boolean(flags.text) === Boolean(flags['text-file'])) {
    throw new Error('Provide exactly one of --text or --text-file.');
  }
  let text = flags.text;
  if (flags['text-file']) {
    const file = projectPath(projectRoot, flags['text-file'], 'narration text file', { exists: true });
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Narration text must be a regular project file.');
    if (stat.size > MAX_TEXT_BYTES) throw new Error('Narration text exceeds the 128 KiB safety limit.');
    text = fs.readFileSync(file, 'utf8');
  }
  text = String(text || '').trim();
  if (!text) throw new Error('Narration text cannot be empty.');
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('Narration text exceeds the 128 KiB safety limit.');
  return text;
}

function collectSpeakerCandidates(value, output = [], seen = new Set(), depth = 0) {
  if (depth > 12 || value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectSpeakerCandidates(item, output, seen, depth + 1);
    return output;
  }
  if (typeof value !== 'object' || seen.has(value)) return output;
  seen.add(value);
  const name = value.displayName || value.speakerName || value.name || value.title;
  const id = value.speakerId || value.voiceId || value.id;
  if (typeof name === 'string' && typeof id === 'string' && name.trim() && id.trim()) {
    output.push({ name: name.trim(), id: id.trim() });
  }
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    collectSpeakerCandidates(child, output, seen, depth + 1);
  }
  return output;
}

function resolveExactSpeaker(document, expectedName) {
  const normalizedName = String(expectedName || '').normalize('NFKC').trim();
  const matches = collectSpeakerCandidates(document)
    .filter((speaker) => speaker.name.normalize('NFKC').trim() === normalizedName);
  const unique = [...new Map(matches.map((speaker) => [speaker.id, speaker])).values()];
  if (unique.length === 0) {
    throw new Error(`No authorized ListenHub speaker exactly matches “${normalizedName}”; no fallback voice was used.`);
  }
  if (unique.length > 1) {
    throw new Error(`More than one ListenHub speaker exactly matches “${normalizedName}”; choose explicitly before generating.`);
  }
  return unique[0];
}

function restrictedStagingPath(projectRoot, requested, extension, fingerprint) {
  const relative = requested || `${STAGING_ROOT}/narration-${fingerprint}-${crypto.randomBytes(4).toString('hex')}${extension}`;
  const base = projectPath(projectRoot, STAGING_ROOT, 'ListenHub narration staging directory');
  const output = projectPath(projectRoot, relative, 'ListenHub narration staging output');
  if (output !== base && !output.startsWith(`${base}${path.sep}`)) {
    throw new Error(`ListenHub narration output must stay under ${STAGING_ROOT.split(path.sep).join('/')}/.`);
  }
  if (path.extname(output).toLowerCase() !== extension) {
    throw new Error(`ListenHub narration output must use ${extension}.`);
  }
  return { output, relative: path.relative(projectRoot, output).split(path.sep).join('/') };
}

function parseProviderJson(result, label) {
  if (!result.ok) throw new Error(`${label} failed: ${result.stderr || 'provider returned a non-zero status'}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

function validateRequestedAudioFormat(file, format) {
  const descriptor = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  let bytes;
  try {
    bytes = fs.readSync(descriptor, head, 0, head.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const ascii = head.subarray(0, bytes).toString('ascii');
  const matches = format === 'wav'
    ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE'
    : ascii.startsWith('ID3') || (bytes >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  if (!matches) throw new Error(`ListenHub narration output does not match the requested ${format} format.`);
}

function synthesizeNarration(argv, options = {}) {
  const flags = parseArgs(argv);
  if (!flags.yes) throw new Error('ListenHub narration may consume credits. Review the text and re-run with --yes.');
  if (!flags['qcut-project']) throw new Error('ListenHub narration requires --qcut-project <project-dir>.');
  const projectRoot = fs.realpathSync(path.resolve(flags['qcut-project']));
  const text = readNarrationText(projectRoot, flags);
  const language = String(flags.language || 'zh');
  const voiceName = String(flags['voice-name'] || DEFAULT_VOICE_NAME).normalize('NFKC').trim();
  const format = String(flags.format || 'wav').toLowerCase();
  if (!['mp3', 'wav'].includes(format)) throw new Error('--format must be mp3 or wav.');
  const textSha256 = crypto.createHash('sha256').update(text).digest('hex');
  const speakerList = executeListenHub(
    ['openapi', 'speakers', 'list', '--language', language, '-j'],
    options
  );
  const speakerDocument = parseProviderJson(speakerList, 'ListenHub speaker lookup');
  const speaker = resolveExactSpeaker(speakerDocument, voiceName);
  const speakerCatalogSha256 = crypto.createHash('sha256').update(speakerList.stdout).digest('hex');
  const staging = restrictedStagingPath(projectRoot, flags.output, `.${format}`, textSha256.slice(0, 16));
  let generated = false;
  try {
    const tts = executeListenHub([
      'openapi', 'tts', '--text', text, '--voice', speaker.id,
      '--output', staging.relative, '--format', format,
      '--qcut-project', projectRoot, '--yes'
    ], options);
    if (!tts.ok) throw new Error(`ListenHub narration generation failed: ${tts.stderr || 'provider returned a non-zero status'}`);
    if (!fs.existsSync(staging.output)) throw new Error('ListenHub reported success but did not create the narration audio file.');
    const stat = fs.lstatSync(staging.output);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ListenHub narration output must be a regular file.');
    validateSignature(staging.output, 'audio');
    validateRequestedAudioFormat(staging.output, format);
    generated = true;
    let inferred = {};
    if (tts.capture) {
      const captureFile = projectPath(projectRoot, tts.capture, 'ListenHub narration capture', { exists: true });
      const capture = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
      inferred = inferredProvenance(capture, {}, captureFile, projectRoot);
    }
    const imported = importAsset(projectRoot, staging.output, {
      kind: 'audio',
      provider: 'listenhub',
      ...inferred,
      model: flags.model || inferred.model,
      creditCharged: flags.credits == null ? inferred.creditCharged : flags.credits,
      speakerId: speaker.id,
      speakerName: speaker.name,
      speakerCatalogSha256,
      narrationTextSha256: textSha256,
      termsStatus: flags['terms-status'],
      attribution: flags.attribution || `AI narration generated with ListenHub voice ${speaker.name}`
    });
    fs.unlinkSync(staging.output);
    generated = false;
    return {
      ok: true,
      provider: 'listenhub',
      speaker: { id: speaker.id, name: speaker.name, catalogSha256: speakerCatalogSha256 },
      narrationTextSha256: textSha256,
      capture: tts.capture,
      asset: imported.asset,
      localPath: imported.localPath,
      timelineNarration: {
        engine: 'file',
        path: imported.localPath,
        provider: 'listenhub',
        assetId: imported.asset.id,
        speakerId: speaker.id,
        speakerName: speaker.name,
        narrationTextSha256: textSha256
      }
    };
  } catch (error) {
    if (generated || fs.existsSync(staging.output)) {
      try { fs.unlinkSync(staging.output); } catch (_) {}
    }
    throw error;
  }
}

function cli(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  const report = synthesizeNarration(argv);
  if (flags.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`ListenHub narration: ${report.localPath} (${report.speaker.name})\n`);
  return 0;
}

module.exports = {
  DEFAULT_VOICE_NAME,
  collectSpeakerCandidates,
  resolveExactSpeaker,
  synthesizeNarration,
  validateRequestedAudioFormat
};

if (require.main === module) {
  try {
    process.exitCode = cli();
  } catch (error) {
    process.stderr.write(`${redactSecrets(error.message)}\n`);
    process.exitCode = 1;
  }
}
