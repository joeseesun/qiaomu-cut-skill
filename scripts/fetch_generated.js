#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const https = require('https');
const net = require('net');
const path = require('path');
const { ensureInternalDirectory, projectPath } = require('./render_project');
const { hashFile, registerExistingAsset } = require('./ingest_asset');

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const ABSOLUTE_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const KINDS = new Set(['image', 'video', 'audio']);
const DEFAULT_EXTENSIONS = { image: '.jpg', video: '.mp4', audio: '.mp3' };
const CAPTURE_DIRECTORY = path.join('.qiaocut', 'jobs', 'listenhub');

function assertNoSymlinkComponents(projectRoot, target, label) {
  const relative = path.relative(projectRoot, target);
  let cursor = projectRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} cannot contain symbolic links.`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}

function buildAddressBlockLists() {
  const ipv4 = new net.BlockList();
  const ipv6 = new net.BlockList();
  for (const [network, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4]
  ]) ipv4.addSubnet(network, prefix, 'ipv4');
  for (const [network, prefix] of [
    ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
    ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
    ['3fff::', 20], ['5f00::', 16], ['fc00::', 7], ['fe80::', 10],
    ['fec0::', 10], ['ff00::', 8]
  ]) ipv6.addSubnet(network, prefix, 'ipv6');
  ipv6.addAddress('::1', 'ipv6');
  return { ipv4, ipv6 };
}

const ADDRESS_BLOCK_LISTS = buildAddressBlockLists();

function blockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return ADDRESS_BLOCK_LISTS.ipv4.check(address, 'ipv4');
  if (family === 6) return ADDRESS_BLOCK_LISTS.ipv6.check(address, 'ipv6');
  return true;
}

async function safeLookup(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('Local download hosts are blocked.');
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => blockedAddress(record.address))) {
    throw new Error('Download host resolves to a local, private, or reserved address.');
  }
  return records[0];
}

function validateUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Generated asset URL is invalid.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Generated assets must use HTTPS.');
  if (parsed.username || parsed.password) throw new Error('Credential-bearing URLs are not allowed.');
  return parsed;
}

function validateContentType(kind, contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!type || type === 'application/octet-stream' || type === 'binary/octet-stream') return;
  if (kind === 'image' && type.startsWith('image/')) return;
  if (kind === 'video' && type.startsWith('video/')) return;
  if (kind === 'audio' && (type.startsWith('audio/') || type === 'video/mp4')) return;
  throw new Error(`Unexpected content type for ${kind}: ${type}`);
}

function validateSignature(file, kind) {
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(32);
  let bytes = 0;
  try {
    bytes = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const head = buffer.subarray(0, bytes);
  const ascii = head.toString('ascii');
  const isMp4 = bytes >= 12 && ascii.slice(4, 8) === 'ftyp';
  const isJpeg = bytes >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = bytes >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isGif = ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
  const isWebp = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  const isWave = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
  const isOgg = ascii.startsWith('OggS');
  const isFlac = ascii.startsWith('fLaC');
  const isId3 = ascii.startsWith('ID3');
  const isMp3Frame = bytes >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
  const valid = kind === 'image'
    ? isJpeg || isPng || isGif || isWebp
    : kind === 'video'
      ? isMp4
      : isWave || isOgg || isFlac || isId3 || isMp3Frame || isMp4;
  if (!valid) throw new Error(`Downloaded file does not have a recognized ${kind} signature.`);
}

async function requestToFile(url, temporary, options, redirects = 0) {
  if (redirects > 5) throw new Error('Generated asset download exceeded five redirects.');
  const parsed = validateUrl(url);
  const address = await safeLookup(parsed.hostname);
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      headers: {
        'User-Agent': 'qiaomu-cut/0.4',
        Accept: options.kind === 'image' ? 'image/*' : options.kind === 'video' ? 'video/*' : 'audio/*'
      },
      lookup: (_hostname, _lookupOptions, callback) => callback(null, address.address, address.family),
      servername: parsed.hostname
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, parsed).toString();
        requestToFile(next, temporary, options, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Generated asset download failed with HTTP ${response.statusCode}.`));
        return;
      }
      try {
        validateContentType(options.kind, response.headers['content-type']);
        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          throw new Error('Generated asset exceeds the configured download limit.');
        }
      } catch (error) {
        response.destroy();
        reject(error);
        return;
      }
      const output = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
      let bytes = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        response.destroy();
        output.destroy();
        reject(error);
      };
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > options.maxBytes) fail(new Error('Generated asset exceeds the configured download limit.'));
      });
      response.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => {
        if (settled) return;
        settled = true;
        output.close(() => resolve({ bytes, contentType: response.headers['content-type'] || null }));
      });
      response.pipe(output);
    });
    request.setTimeout(options.timeoutMs, () => request.destroy(new Error('Generated asset download timed out.')));
    request.on('error', reject);
  });
}

function readJsonField(root, field) {
  const parts = String(field || '').split('.').filter(Boolean);
  if (!parts.length) throw new Error('--field is required. Example: result.videoUrl');
  let value = root;
  for (const part of parts) {
    if (['__proto__', 'prototype', 'constructor'].includes(part)) throw new Error('Unsafe JSON field path.');
    if (value == null || (typeof value !== 'object' && !Array.isArray(value)) || !(part in value)) {
      throw new Error(`JSON field not found: ${field}`);
    }
    value = value[part];
  }
  if (typeof value !== 'string') throw new Error(`JSON field is not a URL string: ${field}`);
  return value;
}

function commandFlag(command, names) {
  if (!Array.isArray(command)) return null;
  for (let index = 0; index < command.length; index += 1) {
    const token = String(command[index]);
    const equal = token.indexOf('=');
    const flag = equal > 0 ? token.slice(0, equal) : token;
    if (!names.has(flag)) continue;
    const value = equal > 0 ? token.slice(equal + 1) : command[index + 1];
    if (value != null && !String(value).startsWith('--')) return String(value);
  }
  return null;
}

function commandTaskId(command) {
  if (!Array.isArray(command)) return null;
  const lowered = command.map((token) => String(token).toLowerCase());
  let getIndex = lowered.lastIndexOf('get');
  if (getIndex < 0) getIndex = lowered.lastIndexOf('task');
  if (getIndex < 0) return null;
  for (let index = getIndex + 1; index < command.length; index += 1) {
    const token = String(command[index]);
    if (!token.startsWith('-')) return token;
  }
  return null;
}

function recursiveValue(root, keys) {
  const queue = [root];
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < 10000) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const candidate = value[key];
      if (['string', 'number'].includes(typeof candidate) && String(candidate).trim()) return candidate;
    }
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return null;
}

function inferredProvenance(document, options, resultFile, projectRoot) {
  const command = Array.isArray(document.command) ? document.command : [];
  const explicitCredits = options.creditCharged == null || options.creditCharged === ''
    ? null
    : options.creditCharged;
  const inferredCredits = recursiveValue(document.result, ['creditCharged', 'credits', 'creditCost']);
  const creditCharged = explicitCredits == null ? inferredCredits : explicitCredits;
  return {
    taskId: options.taskId
      || commandFlag(command, new Set(['--task-id', '--taskId', '--id']))
      || commandTaskId(command)
      || recursiveValue(document.result, ['taskId', 'episodeId', 'creationId', 'id']),
    model: options.model
      || commandFlag(command, new Set(['--model']))
      || recursiveValue(document.result, ['model', 'modelName']),
    creditCharged,
    creditStatus: creditCharged == null || creditCharged === '' ? 'unreported' : 'reported',
    capturePath: path.relative(projectRoot, resultFile).split(path.sep).join('/'),
    captureSha256: hashFile(resultFile),
    resultField: options.field
  };
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const booleans = new Set(['json', 'allow-large']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const equal = token.indexOf('=');
    if (equal > 2) {
      const key = token.slice(2, equal);
      if (booleans.has(key)) throw new Error(`--${key} is a bare boolean flag and cannot use =value.`);
      flags[key] = token.slice(equal + 1);
      continue;
    }
    const key = token.slice(2);
    if (booleans.has(key)) {
      flags[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value.`);
    flags[key] = value;
    index += 1;
  }
  return { positional, flags };
}

function resolveMaxBytes(options = {}) {
  const requested = options.maxBytes == null || options.maxBytes === ''
    ? (options.allowLarge ? ABSOLUTE_MAX_BYTES : DEFAULT_MAX_BYTES)
    : Number(options.maxBytes);
  if (!Number.isFinite(requested) || requested <= 0) throw new Error('Download byte limit must be positive.');
  if (requested > ABSOLUTE_MAX_BYTES) {
    throw new Error('Download byte limit cannot exceed the absolute 8 GiB safety limit.');
  }
  if (requested > DEFAULT_MAX_BYTES && !options.allowLarge) {
    throw new Error('Download limits above 1 GiB require --allow-large after reviewing disk use.');
  }
  return requested;
}

async function fetchGeneratedAsset(projectDirectory, options) {
  const projectRoot = fs.realpathSync(path.resolve(projectDirectory));
  const kind = String(options.kind || '').toLowerCase();
  if (!KINDS.has(kind)) throw new Error('--kind must be image, video, or audio.');
  const resultFile = projectPath(projectRoot, options.result, 'ListenHub result', { exists: true });
  const captureRoot = projectPath(projectRoot, CAPTURE_DIRECTORY, 'ListenHub capture directory');
  if (resultFile !== captureRoot && !resultFile.startsWith(`${captureRoot}${path.sep}`)) {
    throw new Error(`ListenHub results must stay under ${CAPTURE_DIRECTORY.split(path.sep).join('/')}/.`);
  }
  assertNoSymlinkComponents(projectRoot, resultFile, 'ListenHub result');
  const resultStat = fs.lstatSync(resultFile);
  if (!resultStat.isFile() || resultStat.isSymbolicLink()) throw new Error('ListenHub result must be a regular project file.');
  const document = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const url = readJsonField(document, options.field);
  validateUrl(url);
  const urlHash = crypto.createHash('sha256').update(url).digest('hex');
  const provider = String(options.provider || 'listenhub').toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'listenhub';
  const outputRelative = options.output || `assets/generated/${provider}/${kind}/${urlHash.slice(0, 16)}${DEFAULT_EXTENSIONS[kind]}`;
  const output = projectPath(projectRoot, outputRelative, 'generated asset output');
  ensureInternalDirectory(projectRoot, path.dirname(output), 'generated asset directory');
  if (fs.existsSync(output)) throw new Error(`Generated asset output already exists: ${outputRelative}`);
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${Date.now()}.part`);
  const requestedMax = resolveMaxBytes(options);
  let linkedOutput = false;
  try {
    const transfer = await requestToFile(url, temporary, {
      kind,
      maxBytes: requestedMax,
      timeoutMs: Number(options.timeoutMs || 30000)
    });
    validateSignature(temporary, kind);
    fs.linkSync(temporary, output);
    linkedOutput = true;
    fs.unlinkSync(temporary);
    const sha256 = hashFile(output);
    const provenance = inferredProvenance(document, options, resultFile, projectRoot);
    const registered = registerExistingAsset(projectRoot, output, {
      kind,
      provider,
      ...provenance,
      attribution: options.attribution,
      termsStatus: options.termsStatus,
      visualBibleId: options.visualBibleId,
      prompt: options.prompt,
      seed: options.seed,
      sha256
    });
    const outputLocalPath = path.relative(projectRoot, output).split(path.sep).join('/');
    if (linkedOutput && registered.reused && registered.asset.localPath !== outputLocalPath) {
      fs.unlinkSync(output);
      linkedOutput = false;
    }
    return {
      localPath: registered.asset.localPath,
      bytes: transfer.bytes,
      sha256,
      contentType: transfer.contentType,
      manifest: registered.manifest,
      asset: registered.asset
    };
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    try {
      if (linkedOutput && fs.existsSync(output) && !readManifestContains(projectRoot, output)) {
        fs.rmSync(output, { force: true });
      }
    } catch (_) {}
    throw error;
  }
}

function readManifestContains(projectRoot, output) {
  const manifest = projectPath(projectRoot, 'assets-manifest.json', 'asset manifest');
  if (!fs.existsSync(manifest)) return false;
  const relative = path.relative(projectRoot, output).split(path.sep).join('/');
  const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return Array.isArray(data.assets) && data.assets.some((asset) => asset.localPath === relative);
}

async function cli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const project = positional[0];
  if (!project || !flags.result || !flags.field || !flags.kind) {
    throw new Error('Usage: fetch_generated.js <project> --result .qiaocut/jobs/listenhub/result.json --field result.videoUrl --kind video [--output assets/generated/listenhub/video/shot.mp4]');
  }
  const maxBytes = flags['max-mb'] ? Number(flags['max-mb']) * 1024 * 1024 : undefined;
  const report = await fetchGeneratedAsset(project, {
    result: flags.result,
    field: flags.field,
    kind: flags.kind,
    provider: flags.provider,
    output: flags.output,
    taskId: flags['task-id'],
    model: flags.model,
    creditCharged: flags.credits,
    attribution: flags.attribution,
    termsStatus: flags['terms-status'],
    visualBibleId: flags['visual-bible-id'],
    prompt: flags.prompt,
    seed: flags.seed,
    maxBytes,
    timeoutMs: flags['timeout-ms'],
    allowLarge: Boolean(flags['allow-large'])
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...report }, null, 2)}\n`);
  return 0;
}

module.exports = {
  blockedAddress,
  fetchGeneratedAsset,
  inferredProvenance,
  readJsonField,
  resolveMaxBytes,
  validateSignature,
  validateUrl
};

if (require.main === module) {
  cli().then(
    (status) => { process.exitCode = status; },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  );
}
