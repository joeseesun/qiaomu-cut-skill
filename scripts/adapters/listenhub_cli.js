#!/usr/bin/env node
'use strict';

const {
  detectListenHub,
  executeAsr,
  executeListenHub,
  redactSecrets
} = require('./listenhub');
const { synthesizeNarration } = require('../listenhub_narration');

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.capture) {
    process.stderr.write(`QiaoCut private capture: ${result.capture}\n`);
  }
  return result.status == null ? (result.ok ? 0 : 1) : result.status;
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`Usage:
  qcut listenhub doctor [--json]
  qcut listenhub capabilities [--json]
  qcut listenhub narration --text <text>|--text-file <project-relative.txt>
              --qcut-project <dir> [--voice-name 向阳乔木] --yes [--json]
  qcut listenhub asr <file> --model sensevoice --json [--qcut-project <dir>]
  qcut listenhub <upstream args...> [--qcut-project <dir>] [--qcut-capture <relative.json>]
                  [--allow-upload] [--yes]

Remote creation requires --yes and --qcut-project. Local file upload also requires
--allow-upload. API keys are accepted only through LISTENHUB_API_KEY or ListenHub's
interactive credential store; never pass a key as an argument.
`);
    return 0;
  }
  if (command === 'doctor' || command === 'capabilities') {
    const report = detectListenHub({ capabilities: true });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.available && report.authentication.credentialFilesSecure ? 0 : 1;
  }
  if (command === 'asr') return printResult(executeAsr(rest));
  if (command === 'narration') {
    const result = synthesizeNarration(rest);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  return printResult(executeListenHub(argv));
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${redactSecrets(error.message)}\n`);
  process.exitCode = 1;
}
