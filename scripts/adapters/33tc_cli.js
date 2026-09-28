#!/usr/bin/env node
'use strict';

// Public boundary: qiaomu-cut delegates to an independently installed 33tc
// adapter. It intentionally does not redistribute 33TaiCi's private protocol,
// signing, token, or media-URL implementation.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { minimalEnvironment, sanitizeOutput } = require('./listenhub');

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

function preferredFfmpeg() {
  const explicit = executable(process.env.QIAOMU_FFMPEG);
  const preferred = executable('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg');
  const discovered = commandPath('ffmpeg');
  return explicit || preferred || discovered || null;
}

function adapterEnvironment(command) {
  const environment = minimalEnvironment();
  if (!['pick', 'cut', 'download'].includes(command) || process.env.QIAOMU_33TC_FFMPEG_RETRY === 'off') {
    return environment;
  }
  const shim = path.join(__dirname, '..', 'shims', 'ffmpeg');
  const ffmpeg = preferredFfmpeg();
  // File sync tools (Nutstore, some zip extractors) can strip the exec bit; restore it.
  if (!executable(shim)) { try { fs.chmodSync(shim, 0o755); } catch (_) {} }
  if (!executable(shim) || !ffmpeg) return environment;
  environment.PATH = `${path.dirname(shim)}${path.delimiter}${environment.PATH || ''}`;
  environment.QIAOMU_FFMPEG = ffmpeg;
  environment.QIAOMU_FFMPEG_RETRIES = String(Math.max(1, Math.min(5, Number(process.env.QIAOMU_FFMPEG_RETRIES || 5) || 5)));
  return environment;
}

function createdTaskId(stdout, stderr) {
  const match = `${stdout || ''}\n${stderr || ''}`.match(/Created cut task:\s*(\d+)/i);
  return match ? match[1] : null;
}

const { hasPersistentCreditAuthorization, preferencePath } = require('../local_preferences');

function main(argv = process.argv.slice(2)) {
  const command = String(argv[0] || '').toLowerCase();
  const changesCredits = ['pick', 'cut'].includes(command);
  const explicitYes = argv.includes('--yes');
  const explicitNo = argv.includes('--yes=false');
  const persistentAuthorization = changesCredits && !explicitYes && !explicitNo && hasPersistentCreditAuthorization('33tc');
  if (changesCredits && !explicitYes && !persistentAuthorization) {
    process.stderr.write(`33tc ${command} may create a remote task or consume credits. Review the selection and re-run with a bare --yes.\n`);
    return 1;
  }
  const forwardedArgs = persistentAuthorization ? [...argv, '--yes'] : argv;
  if (persistentAuthorization) {
    process.stderr.write('qiaomu-cut: applied the local user persistent authorization for 33tc credits; no repeated prompt was required.\n');
  }
  const adapter = resolveAdapter();
  if (!adapter) {
    process.stderr.write(
      '33tc adapter not found. Install an authorized 33tc CLI adapter, then set QIAOMU_33TC_CLI or place 33tc on PATH.\n' +
      'The 33TaiCi desktop app must also be installed and logged in. qiaomu-cut does not bundle private app protocols.\n'
    );
    return 1;
  }
  const result = spawnSync(adapter, forwardedArgs, {
    encoding: 'utf8',
    env: adapterEnvironment(command),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['inherit', 'pipe', 'pipe']
  });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return 1;
  }
  if (result.stdout) process.stdout.write(sanitizeOutput(result.stdout, { urls: 'display' }));
  if (result.stderr) process.stderr.write(sanitizeOutput(result.stderr, { urls: 'display' }));
  const taskId = result.status === 0 ? null : createdTaskId(result.stdout, result.stderr);
  if (taskId) {
    process.stderr.write(
      `qiaomu-cut recovery: remote cut task ${taskId} already exists. Do not submit another paid cut. ` +
      `Retry the existing task with: qcut 33tc download ${taskId} --no-status [--output <dir>]\n`
    );
  }
  return result.status == null ? 1 : result.status;
}

module.exports = {
  adapterEnvironment,
  createdTaskId,
  // Re-exported for callers and smoke tests that predate scripts/local_preferences.js.
  hasPersistentCreditAuthorization: () => hasPersistentCreditAuthorization('33tc'),
  localPreferencePath: preferencePath,
  main,
  preferredFfmpeg,
  resolveAdapter
};

if (require.main === module) process.exitCode = main();
