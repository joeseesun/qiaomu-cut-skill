#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEXT_EXTENSIONS = new Set(['', '.js', '.json', '.md', '.yaml', '.yml', '.sh', '.svg', '.txt']);
const MEDIA_BLOCKLIST = new Set(['.mp4', '.mov', '.mkv', '.webm', '.wav', '.aiff', '.mp3']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.qiaocut']);
const SECRET_PATTERNS = [
  { name: 'OpenAI-style secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub token', pattern: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private user path', pattern: /\/Users\/joe(?:\/|\b)/ },
  { name: 'bundled 33TaiCi private API', pattern: /33-api\.agilestudio\.cn|createDecipheriv|get-signed-video-url|DlojCEIMVrj2W9xN|KYe234567VLABHAEQ/ }
];

function filesUnder(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) filesUnder(full, result);
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function main() {
  const failures = [];
  const files = filesUnder(ROOT);
  for (const file of files) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    const extension = path.extname(file).toLowerCase();
    if (MEDIA_BLOCKLIST.has(extension)) failures.push(`${relative}: distributable media file is blocked`);
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    if (relative === 'scripts/release_check.js') continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const check of SECRET_PATTERNS) {
      if (check.pattern.test(text)) failures.push(`${relative}: ${check.name}`);
    }
  }
  const report = { ok: failures.length === 0, filesScanned: files.length, failures };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

main();
