#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ensureInternalDirectory, projectPath } = require('./render_project');

const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'subtitle', 'document', 'other']);
const MAX_DEFAULT_BYTES = 2 * 1024 * 1024 * 1024;
const MANIFEST_LOCK = path.join('.qiaocut', 'locks', 'assets-manifest.lock');
const LOCK_TIMEOUT_MS = 5000;

function waitSync(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function removeAbandonedLock(lockFile, stat) {
  let metadata = null;
  try { metadata = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch (_) {}
  let ownerAlive = null;
  if (metadata && Number.isInteger(Number(metadata.pid)) && Number(metadata.pid) > 0) {
    try {
      process.kill(Number(metadata.pid), 0);
      ownerAlive = true;
    } catch (error) {
      ownerAlive = error.code !== 'ESRCH';
    }
  }
  const oldEnough = Date.now() - stat.mtimeMs > 10 * 60 * 1000;
  if (ownerAlive !== false && !(ownerAlive == null && oldEnough)) return false;
  try {
    const current = fs.lstatSync(lockFile);
    if (current.dev === stat.dev && current.ino === stat.ino) fs.unlinkSync(lockFile);
    return true;
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

function acquireManifestLock(projectRoot) {
  const lockFile = projectPath(projectRoot, MANIFEST_LOCK, 'asset manifest lock');
  ensureInternalDirectory(projectRoot, path.dirname(lockFile), 'asset manifest lock directory');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const descriptor = fs.openSync(lockFile, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      return { descriptor, lockFile };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = fs.lstatSync(lockFile);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error('Asset manifest lock must be a regular, non-symbolic-link file.');
      }
      if (removeAbandonedLock(lockFile, stat)) continue;
      waitSync(25);
    }
  }
  throw new Error('Timed out waiting for the asset manifest lock. Retry the import.');
}

function releaseManifestLock(lock) {
  try {
    const held = fs.fstatSync(lock.descriptor);
    const current = fs.lstatSync(lock.lockFile);
    if (held.dev === current.dev && held.ino === current.ino) fs.unlinkSync(lock.lockFile);
  } catch (_) {
    // Preserve the primary error; a later run will report a stale or busy lock.
  }
  try { fs.closeSync(lock.descriptor); } catch (_) {}
}

function hashFile(file) {
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

function safeSlug(value, fallback) {
  const slug = String(value || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function atomicJson(file, value, projectRoot) {
  ensureInternalDirectory(projectRoot, path.dirname(file), 'asset manifest directory');
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    throw error;
  }
}

function readManifest(file) {
  if (!fs.existsSync(file)) return { assets: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || !Array.isArray(data.assets)) throw new Error('assets-manifest.json must contain { assets: [] }.');
  return data;
}

function normalizeMetadata(metadata = {}) {
  const kind = String(metadata.kind || metadata.mediaType || 'other').toLowerCase();
  if (!MEDIA_KINDS.has(kind)) throw new Error(`Unsupported asset kind: ${kind}`);
  const provider = safeSlug(metadata.provider || 'local', 'local');
  const credits = metadata.creditCharged == null || metadata.creditCharged === ''
    ? null
    : Number(metadata.creditCharged);
  if (credits != null && (!Number.isFinite(credits) || credits < 0)) throw new Error('creditCharged must be a non-negative number.');
  return {
    kind,
    provider,
    taskId: metadata.taskId ? String(metadata.taskId) : null,
    model: metadata.model ? String(metadata.model) : null,
    speakerId: metadata.speakerId ? String(metadata.speakerId) : null,
    speakerName: metadata.speakerName ? String(metadata.speakerName) : null,
    speakerCatalogSha256: metadata.speakerCatalogSha256 ? String(metadata.speakerCatalogSha256) : null,
    narrationTextSha256: metadata.narrationTextSha256 ? String(metadata.narrationTextSha256) : null,
    visualBibleId: metadata.visualBibleId ? String(metadata.visualBibleId) : null,
    prompt: metadata.prompt ? String(metadata.prompt) : null,
    seed: metadata.seed == null || metadata.seed === '' ? null : String(metadata.seed),
    creditCharged: credits,
    source: metadata.source ? String(metadata.source) : provider,
    attribution: metadata.attribution ? String(metadata.attribution) : `AI-generated with ${provider}`,
    termsStatus: metadata.termsStatus ? String(metadata.termsStatus) : 'provider_terms_unverified',
    capturePath: metadata.capturePath ? String(metadata.capturePath) : null,
    captureSha256: metadata.captureSha256 ? String(metadata.captureSha256) : null,
    resultField: metadata.resultField ? String(metadata.resultField) : null,
    creditStatus: metadata.creditStatus === 'reported' || credits != null ? 'reported' : 'unreported',
    aiGenerated: metadata.aiGenerated !== false
  };
}

function provenanceRecord(normalized) {
  return {
    taskId: normalized.taskId,
    model: normalized.model,
    speakerId: normalized.speakerId,
    speakerName: normalized.speakerName,
    speakerCatalogSha256: normalized.speakerCatalogSha256,
    narrationTextSha256: normalized.narrationTextSha256,
    visualBibleId: normalized.visualBibleId,
    prompt: normalized.prompt,
    seed: normalized.seed,
    creditCharged: normalized.creditCharged,
    creditStatus: normalized.creditStatus,
    capturePath: normalized.capturePath,
    captureSha256: normalized.captureSha256,
    resultField: normalized.resultField,
    termsStatus: normalized.termsStatus,
    importedAt: new Date().toISOString()
  };
}

function mergeProvenanceRuns(asset, current) {
  const runs = Array.isArray(asset.provenanceRuns)
    ? [...asset.provenanceRuns]
    : asset.provenance
      ? [asset.provenance]
      : [];
  const comparable = (value) => JSON.stringify({ ...value, importedAt: null });
  if (!runs.some((run) => comparable(run) === comparable(current))) runs.push(current);
  return runs;
}

function existingAssetIsUsable(projectRoot, asset, digest) {
  if (!asset || typeof asset.localPath !== 'string' || !asset.localPath.trim()) {
    throw new Error('Existing asset manifest record has no valid localPath.');
  }
  let file;
  try {
    file = projectPath(projectRoot, asset.localPath, 'existing generated asset');
  } catch (error) {
    if (/not found/i.test(error.message)) return false;
    throw error;
  }
  if (!fs.existsSync(file)) return false;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  return hashFile(file) === digest;
}

function registerExistingAsset(projectDirectory, assetFile, metadata = {}) {
  const projectRoot = fs.realpathSync(path.resolve(projectDirectory));
  const absolute = path.resolve(assetFile);
  const target = projectPath(projectRoot, path.relative(projectRoot, absolute), 'generated asset', { exists: true });
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Generated asset must be a regular, non-symbolic-link file.');
  const normalized = normalizeMetadata(metadata);
  const digest = metadata.sha256 || hashFile(target);
  const relative = path.relative(projectRoot, target).split(path.sep).join('/');
  const manifestFile = projectPath(projectRoot, 'assets-manifest.json', 'asset manifest');
  const lock = acquireManifestLock(projectRoot);
  try {
    const manifest = readManifest(manifestFile);
    const existing = manifest.assets.find((asset) => (
      asset.sha256 === digest
      && asset.provider === normalized.provider
      && asset.mediaType === normalized.kind
    ));
    const currentProvenance = provenanceRecord(normalized);
    if (existing) {
      const provenanceRuns = mergeProvenanceRuns(existing, currentProvenance);
      if (existingAssetIsUsable(projectRoot, existing, digest)) {
        existing.provenanceRuns = provenanceRuns;
        if (provenanceRuns.length > 1) atomicJson(manifestFile, manifest, projectRoot);
        return { asset: existing, manifest: 'assets-manifest.json', reused: true, repaired: false };
      }
      existing.title = path.basename(relative);
      existing.localPath = relative;
      existing.bytes = stat.size;
      existing.provenance = currentProvenance;
      existing.provenanceRuns = provenanceRuns;
      atomicJson(manifestFile, manifest, projectRoot);
      return { asset: existing, manifest: 'assets-manifest.json', reused: false, repaired: true };
    }
    const id = `${normalized.provider}-${normalized.kind}-${digest.slice(0, 12)}`;
    const record = {
      id,
      title: path.basename(relative),
      source: normalized.source,
      provider: normalized.provider,
      mediaType: normalized.kind,
      localPath: relative,
      sourcePage: '',
      licenseStatus: normalized.aiGenerated ? 'ai_generated' : 'unknown',
      attribution: normalized.attribution,
      aiGenerated: normalized.aiGenerated,
      sha256: digest,
      bytes: stat.size,
      provenance: currentProvenance,
      provenanceRuns: [currentProvenance]
    };
    manifest.assets.push(record);
    atomicJson(manifestFile, manifest, projectRoot);
    return { asset: record, manifest: 'assets-manifest.json', reused: false };
  } finally {
    releaseManifestLock(lock);
  }
}

function importAsset(projectDirectory, sourceFile, metadata = {}) {
  const projectRoot = fs.realpathSync(path.resolve(projectDirectory));
  const source = path.resolve(sourceFile);
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Source asset must be a regular, non-symbolic-link file.');
  const maxBytes = metadata.allowLarge ? Number.MAX_SAFE_INTEGER : MAX_DEFAULT_BYTES;
  if (sourceStat.size > maxBytes) throw new Error('Source asset exceeds the 2 GiB default limit. Re-run with --allow-large after reviewing disk use.');
  const normalized = normalizeMetadata(metadata);
  const digest = hashFile(source);
  const extension = path.extname(source).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12);
  const basename = safeSlug(path.basename(source, path.extname(source)), normalized.kind);
  const destinationRelative = metadata.destination
    || `assets/generated/${normalized.provider}/${normalized.kind}/${basename}-${digest.slice(0, 12)}${extension}`;
  const destination = projectPath(projectRoot, destinationRelative, 'generated asset destination');
  ensureInternalDirectory(projectRoot, path.dirname(destination), 'generated asset directory');
  let copied = false;
  if (fs.existsSync(destination)) {
    const existing = fs.lstatSync(destination);
    if (!existing.isFile() || existing.isSymbolicLink() || hashFile(destination) !== digest) {
      throw new Error(`Generated asset destination already exists with different content: ${destinationRelative}`);
    }
  } else {
    const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`);
    try {
      fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(temporary, 0o600);
      fs.linkSync(temporary, destination);
      fs.unlinkSync(temporary);
      copied = true;
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch (_) {}
      throw error;
    }
  }
  try {
    const destinationLocalPath = path.relative(projectRoot, destination).split(path.sep).join('/');
    const registered = registerExistingAsset(projectRoot, destination, { ...metadata, sha256: digest });
    if (copied && registered.reused && registered.asset.localPath !== destinationLocalPath) {
      fs.unlinkSync(destination);
      copied = false;
    }
    return { ...registered, copied, localPath: registered.asset.localPath };
  } catch (error) {
    if (copied) {
      try { fs.rmSync(destination, { force: true }); } catch (_) {}
    }
    throw error;
  }
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const booleans = new Set(['allow-large', 'not-ai-generated', 'json']);
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

function cli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const [project, source] = positional;
  if (!project || !source) {
    throw new Error('Usage: ingest_asset.js <project> <source-file> --kind image|video|audio --provider listenhub [--task-id id] [--model name] [--json]');
  }
  const report = importAsset(project, source, {
    kind: flags.kind,
    provider: flags.provider,
    taskId: flags['task-id'],
    model: flags.model,
    speakerId: flags['speaker-id'],
    speakerName: flags['speaker-name'],
    speakerCatalogSha256: flags['speaker-catalog-sha256'],
    narrationTextSha256: flags['narration-text-sha256'],
    visualBibleId: flags['visual-bible-id'],
    prompt: flags.prompt,
    seed: flags.seed,
    creditCharged: flags.credits,
    destination: flags.output,
    termsStatus: flags['terms-status'],
    attribution: flags.attribution,
    aiGenerated: !flags['not-ai-generated'],
    allowLarge: Boolean(flags['allow-large'])
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...report }, null, 2)}\n`);
  return 0;
}

module.exports = {
  hashFile,
  importAsset,
  normalizeMetadata,
  registerExistingAsset
};

if (require.main === module) {
  try {
    process.exitCode = cli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
