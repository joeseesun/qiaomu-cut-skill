#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const MEDIA_BLOCKLIST = new Set([
  '.3g2', '.3gp', '.aac', '.aif', '.aiff', '.alac', '.avi', '.flac', '.flv',
  '.m2ts', '.m4a', '.m4v', '.mkv', '.mov', '.mp3', '.mp4', '.mpeg', '.mpg',
  '.mts', '.oga', '.ogg', '.opus', '.pcm', '.wav', '.wave', '.webm',
  '.wma', '.wmv'
]);
// Only Git internals are excluded. Runtime/config/dependency directories must be
// absent or clean before release; otherwise they could hide a force-added secret.
const SKIP_ROOT_DIRS = new Set(['.git']);
const VENDOR_SYMLINK_ROOT = path.join('vendor', 'marswaveai-skills');

// vendor/marswaveai-skills is a pinned, non-executable evidence snapshot (see
// THIRD_PARTY_NOTICES.md / references/trust-boundary.md). Some nested vendored
// skills (e.g. cola-avatar-pack/GENERATE.md) contain destructive shell instructions
// and silent AGENT.md persistence injection that must never run as part of this
// repo's own workflow. Today no script reads vendor/**/*.md as instructions; this
// guard turns that absence into a checked invariant instead of a silent assumption.
const VENDOR_EXEC_GUARD_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.py', '.sh']);
const VENDOR_EXEC_GUARD_ALLOWED_READERS = new Set([
  'scripts/verify_marswave_vendor.js',
  'scripts/release_check.js',
  // Carries this guard's own regression fixtures (literal vendor/SKILL.md
  // strings used to prove the check fires), not real vendor access code.
  'scripts/listenhub_smoke.js'
]);
// Two independent substring checks rather than one contiguous-path regex: real
// code usually builds vendor paths via path.join(...)/glob(...) with separate
// string arguments, so "vendor" and "SKILL.md" won't sit adjacent in the source
// text. Requiring both tokens to appear anywhere in the same file is a coarser
// but far harder to accidentally defeat static guard.
const VENDOR_EXEC_GUARD_PATH_TOKEN = /\bvendor\b/i;
const VENDOR_EXEC_GUARD_INSTRUCTION_TOKEN = /SKILL\.md|GENERATE\.md|\*\*[\\/]\*\.(?:md|js|py|sh)/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build private-provider markers at runtime so this scanner can scan its own source.
const PRIVATE_API_MARKERS = [
  ['33-api', 'agilestudio', 'cn'].join('.'),
  ['create', 'Decipheriv'].join(''),
  ['get-signed', 'video-url'].join('-'),
  ['Dloj', 'CEIM', 'Vrj2W9xN'].join(''),
  ['KYe', '234567', 'VLABHAEQ'].join('')
];

const SECRET_PATTERNS = [
  { name: 'OpenAI-style secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub token', pattern: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'ListenHub API key', pattern: /\blh_sk_[A-Za-z0-9_]{20,}\b/ },
  {
    name: 'private key block',
    pattern: new RegExp(['-{5}BEGIN ', '(?:PGP PRIVATE KEY BLOCK|[A-Z0-9 ]*PRIVATE KEY)', '-{5}'].join(''))
  },
  { name: 'private user path', pattern: /\/Users\/joe(?:\/|\b)/ },
  {
    name: 'bundled 33TaiCi private API',
    pattern: new RegExp(PRIVATE_API_MARKERS.map(escapeRegExp).join('|'))
  }
];

function relativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function mediaSignature(buffer) {
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'MP4/M4A';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF') {
    const kind = buffer.subarray(8, 12).toString('ascii');
    if (kind === 'WAVE') return 'WAV';
    if (kind === 'AVI ') return 'AVI';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'Ogg';
  if (buffer.subarray(0, 4).toString('ascii') === 'fLaC') return 'FLAC';
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'MP3';
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'Matroska/WebM';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'AAC frame';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'MP3 frame';
  return null;
}

function entriesUnder(directory, root = directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && directory === root && SKIP_ROOT_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      entriesUnder(absolute, root, result);
    } else if (entry.isFile()) {
      result.push({ type: 'file', absolute, relative: relativePath(root, absolute) });
    } else if (entry.isSymbolicLink()) {
      result.push({ type: 'symlink', absolute, relative: relativePath(root, absolute) });
    } else {
      result.push({ type: 'unsupported', absolute, relative: relativePath(root, absolute) });
    }
  }
  return result;
}

function validateVendorSymlink(root, entry) {
  const vendorRoot = path.resolve(root, VENDOR_SYMLINK_ROOT);
  if (!isWithin(vendorRoot, entry.absolute) || entry.absolute === vendorRoot) {
    return 'symbolic links are blocked outside vendor/marswaveai-skills';
  }

  const target = fs.readlinkSync(entry.absolute);
  if (path.isAbsolute(target) || path.win32.isAbsolute(target)) {
    return 'vendor symbolic link target must be relative';
  }

  const resolved = path.resolve(path.dirname(entry.absolute), target);
  if (!isWithin(vendorRoot, resolved)) {
    return 'vendor symbolic link escapes vendor/marswaveai-skills';
  }
  if (!fs.existsSync(resolved)) {
    return 'vendor symbolic link target does not exist';
  }

  try {
    const realVendorRoot = fs.realpathSync(vendorRoot);
    const realTarget = fs.realpathSync(resolved);
    if (!isWithin(realVendorRoot, realTarget)) {
      return 'vendor symbolic link resolves outside vendor/marswaveai-skills';
    }
  } catch (error) {
    return `vendor symbolic link could not be verified: ${error.message}`;
  }
  return null;
}

function scanRoot(root = ROOT) {
  const resolvedRoot = path.resolve(root);
  const failures = [];
  const entries = entriesUnder(resolvedRoot);
  let filesScanned = 0;
  let bytesScanned = 0;
  let symlinksChecked = 0;

  for (const entry of entries) {
    if (entry.type === 'unsupported') {
      failures.push(`${entry.relative}: unsupported filesystem entry type`);
      continue;
    }
    if (entry.type === 'symlink') {
      symlinksChecked += 1;
      const failure = validateVendorSymlink(resolvedRoot, entry);
      if (failure) failures.push(`${entry.relative}: ${failure}`);
      continue;
    }

    const stat = fs.statSync(entry.absolute);
    const extension = path.extname(entry.absolute).toLowerCase();
    if (MEDIA_BLOCKLIST.has(extension)) {
      failures.push(`${entry.relative}: distributable media file is blocked`);
    }
    if (stat.size > MAX_SCAN_BYTES) {
      failures.push(`${entry.relative}: file is too large to scan (${stat.size} bytes; limit ${MAX_SCAN_BYTES})`);
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(entry.absolute);
    } catch (error) {
      failures.push(`${entry.relative}: file could not be scanned: ${error.message}`);
      continue;
    }
    filesScanned += 1;
    bytesScanned += content.length;
    const detectedMedia = mediaSignature(content);
    if (detectedMedia && !MEDIA_BLOCKLIST.has(extension)) {
      failures.push(`${entry.relative}: distributable media signature is blocked (${detectedMedia})`);
    }
    const text = content.toString('latin1');
    for (const check of SECRET_PATTERNS) {
      if (check.pattern.test(text)) failures.push(`${entry.relative}: ${check.name}`);
    }
    if (
      VENDOR_EXEC_GUARD_EXTENSIONS.has(extension) &&
      !entry.relative.startsWith('vendor/') &&
      !VENDOR_EXEC_GUARD_ALLOWED_READERS.has(entry.relative) &&
      VENDOR_EXEC_GUARD_PATH_TOKEN.test(text) &&
      VENDOR_EXEC_GUARD_INSTRUCTION_TOKEN.test(text)
    ) {
      failures.push(`${entry.relative}: references both "vendor" and a nested-skill-instruction file/glob (SKILL.md/GENERATE.md/**/*.md) outside the allowed hash/symlink verifiers — this could auto-load a nested vendored skill such as cola-avatar-pack and must be reviewed before merge`);
    }
  }

  return {
    ok: failures.length === 0,
    filesDiscovered: entries.filter((entry) => entry.type === 'file').length,
    filesScanned,
    bytesScanned,
    symlinksChecked,
    failures
  };
}

function main() {
  const report = scanRoot(ROOT);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

module.exports = { MAX_SCAN_BYTES, scanRoot };

if (require.main === module) main();
