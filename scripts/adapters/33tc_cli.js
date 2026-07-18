#!/usr/bin/env node
'use strict';

// Public boundary: qiaomu-cut delegates to an independently installed 33tc
// adapter. It intentionally does not redistribute 33TaiCi's private protocol,
// signing, token, or media-URL implementation.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sanitizeOutput } = require('./listenhub');

function executable(file) {
  if (!file) return null;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return path.resolve(file);
  } catch {
    return null;
  }
}

function commandPath(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  return executable(result.stdout.trim());
}

function resolveAdapter() {
  const explicit = executable(process.env.QIAOMU_33TC_CLI);
  const discovered = commandPath('33tc');
  const current = path.resolve(__filename);
  return [explicit, discovered].find((candidate) => candidate && candidate !== current) || null;
}

function main(argv = process.argv.slice(2)) {
  const command = String(argv[0] || '').toLowerCase();
  if (['pick', 'cut'].includes(command) && !argv.includes('--yes')) {
    process.stderr.write(`33tc ${command} may create a remote task or consume credits. Review the selection and re-run with a bare --yes.\n`);
    return 1;
  }
  const adapter = resolveAdapter();
  if (!adapter) {
    process.stderr.write(
      '33tc adapter not found. Install an authorized 33tc CLI adapter, then set QIAOMU_33TC_CLI or place 33tc on PATH.\n' +
      'The 33TaiCi desktop app must also be installed and logged in. qiaomu-cut does not bundle private app protocols.\n'
    );
    return 1;
  }
  const result = spawnSync(adapter, argv, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['inherit', 'pipe', 'pipe']
  });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return 1;
  }
  if (result.stdout) process.stdout.write(sanitizeOutput(result.stdout, { urls: 'display' }));
  if (result.stderr) process.stderr.write(sanitizeOutput(result.stderr, { urls: 'display' }));
  return result.status == null ? 1 : result.status;
}

module.exports = { main, resolveAdapter };

if (require.main === module) process.exitCode = main();
