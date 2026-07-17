#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { projectPath, preflightProjectIO, parseArgs } = require('./render_project');
const { scanLocal } = require('./adapters/local');
const { makeLicenseReport } = require('./license_report');
const { generateHtmlScene } = require('./renderers/html_scene');
const { generateBilingualAss } = require('./renderers/bilingual_ass');

function mustThrow(fn, pattern) {
  assert.throws(fn, pattern);
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaomu-cut-security-'));
  const project = path.join(temp, 'project');
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const source = path.join(project, 'assets', 'source.png');
  const outsideSecret = path.join(outside, 'secret.txt');
  fs.writeFileSync(source, 'fixture');
  fs.writeFileSync(outsideSecret, 'do-not-read');

  try {
    mustThrow(() => projectPath(project, '../outside/secret.txt', 'escape', { exists: true }), /escapes the project/);
    fs.symlinkSync(outside, path.join(project, 'assets', 'outside-link'));
    mustThrow(
      () => projectPath(project, 'assets/outside-link/secret.txt', 'symlink escape', { exists: true }),
      /symbolic link/
    );

    mustThrow(
      () => preflightProjectIO({ reads: [{ label: 'source', file: source }], writes: [{ label: 'output', file: source }] }),
      /must not overwrite/
    );
    mustThrow(
      () => preflightProjectIO({ reads: [], writes: [{ label: 'output', file: source }] }),
      /already exists/
    );
    preflightProjectIO({ reads: [], writes: [{ label: 'output', file: source }] }, { force: true });
    assert.equal(parseArgs(['/tmp/project', '--force', '--allow-large']).options.force, true);

    const scanned = scanLocal(path.join(project, 'assets'));
    assert.equal(scanned[0].localPath, 'source.png');
    assert(!JSON.stringify(scanned).includes(temp));

    const report = makeLicenseReport([{ id: source, localPath: source, mediaType: 'image' }]);
    assert(report.includes('[local path redacted]/source.png'));
    assert(!report.includes(temp));

    mustThrow(
      () => generateHtmlScene({ text: { content: 'Safe' } }, { aspect: '16/9;}</style><script>' }),
      /numeric ratio/
    );

    const ass = generateBilingualAss({
      font: 'Safe,Font\nDialogue: injected',
      theme: { highlight: 'red;bad' },
      events: [{ start: 0, end: 1, style: 'English', text: '[[SAFE]]' }]
    });
    assert(!ass.includes('\nDialogue: injected'));
    assert(ass.includes('\\c&H0042B9F4&'));

    process.stdout.write(`${JSON.stringify({ ok: true, checks: 10 }, null, 2)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
