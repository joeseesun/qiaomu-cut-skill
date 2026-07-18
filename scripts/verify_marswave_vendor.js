#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor', 'marswaveai-skills');
const LOCK = path.join(ROOT, 'vendor', 'marswaveai-skills.UPSTREAM.lock.json');

function inventory(directory, root = directory, entries = []) {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(absolute);
      const resolved = path.resolve(path.dirname(absolute), target);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Vendor symlink escapes snapshot root: ${relative} -> ${target}`);
      }
      entries.push({ type: 'symlink', path: relative, target });
    } else if (stat.isDirectory()) {
      inventory(absolute, root, entries);
    } else if (stat.isFile()) {
      const content = fs.readFileSync(absolute);
      entries.push({
        type: 'file',
        path: relative,
        bytes: stat.size,
        sha256: crypto.createHash('sha256').update(content).digest('hex')
      });
    } else {
      throw new Error(`Unsupported vendor entry type: ${relative}`);
    }
  }
  return entries;
}

function snapshotReport(directory = VENDOR) {
  const entries = inventory(directory).sort((left, right) => left.path.localeCompare(right.path));
  const canonical = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  return {
    entries: entries.length,
    files: entries.filter((entry) => entry.type === 'file').length,
    symlinks: entries.filter((entry) => entry.type === 'symlink').length,
    bytes: entries.filter((entry) => entry.type === 'file').reduce((total, entry) => total + entry.bytes, 0),
    contentDigest: crypto.createHash('sha256').update(canonical).digest('hex')
  };
}

function snapshotFailures(actual, expected) {
  return Object.keys(actual)
    .filter((key) => actual[key] !== expected[key])
    .map((key) => `${key}: expected ${expected[key]}, found ${actual[key]}`);
}

function main() {
  const actual = snapshotReport();
  if (process.argv.includes('--print-digest')) {
    process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  const layouts = [
    { name: 'git-source', expected: lock.snapshot },
    { name: 'dereferenced-installer', expected: lock.distributionLayout }
  ].filter((layout) => layout.expected);
  const attempts = layouts.map((layout) => ({
    name: layout.name,
    failures: snapshotFailures(actual, layout.expected)
  }));
  const match = attempts.find((attempt) => attempt.failures.length === 0);
  const failures = match
    ? []
    : attempts.flatMap((attempt) => attempt.failures.map((failure) => `${attempt.name}: ${failure}`));
  const report = {
    ok: Boolean(match),
    repository: lock.repository,
    commit: lock.commit,
    tree: lock.tree,
    isolation: lock.isolation,
    layout: match ? match.name : null,
    actual,
    failures
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

module.exports = { inventory, snapshotReport, snapshotFailures };

if (require.main === module) main();
