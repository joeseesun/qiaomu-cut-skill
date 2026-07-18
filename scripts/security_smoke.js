#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  applyRenderProfile,
  ensureInternalDirectory,
  projectPath,
  preflightProjectIO,
  parseArgs
} = require('./render_project');
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
      () => ensureInternalDirectory(project, path.join(project, 'assets', 'outside-link', 'must-not-create'), 'cache escape'),
      /symbolic link/
    );
    assert.equal(fs.existsSync(path.join(outside, 'must-not-create')), false);

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

    const baseTimeline = {
      output: {
        width: 1080,
        height: 1920,
        fps: 30,
        file: 'renders/final.mp4'
      },
      captionSource: 'captions/source.json',
      captions: 'captions/final.ass',
      reports: {
        contactSheet: 'reports/contact-sheet.jpg',
        renderReport: 'reports/render-report.json'
      }
    };
    const preview = applyRenderProfile(baseTimeline, { profile: 'preview' });
    assert.deepEqual(
      {
        width: preview.timeline.output.width,
        height: preview.timeline.output.height,
        fps: preview.timeline.output.fps,
        file: preview.timeline.output.file,
        validation: preview.validation
      },
      {
        width: 540,
        height: 960,
        fps: 24,
        file: 'renders/final.preview.mp4',
        validation: 'basic'
      }
    );

    const standard = applyRenderProfile(baseTimeline, { profile: 'standard' });
    assert.deepEqual(
      {
        width: standard.timeline.output.width,
        height: standard.timeline.output.height,
        file: standard.timeline.output.file
      },
      {
        width: 720,
        height: 1280,
        file: 'renders/final.standard.mp4'
      }
    );

    mustThrow(() => applyRenderProfile(baseTimeline, { profile: 'invalid' }), /Unknown render profile/);
    mustThrow(() => applyRenderProfile(baseTimeline, { validation: 'invalid' }), /Unknown validation level/);

    const v03Args = parseArgs([
      '/tmp/project',
      '--profile=standard',
      '--validation', 'full',
      '--output', 'renders/custom.mp4',
      '--no-cache'
    ]);
    assert.equal(v03Args.projectDir, '/tmp/project');
    assert.deepEqual(
      {
        profile: v03Args.options.profile,
        validation: v03Args.options.validation,
        output: v03Args.options.output,
        cache: v03Args.options.cache
      },
      {
        profile: 'standard',
        validation: 'full',
        output: 'renders/custom.mp4',
        cache: false
      }
    );

    const qcut = path.join(__dirname, 'qcut.js');
    const booleanBeforeProject = childProcess.spawnSync(
      process.execPath,
      [qcut, 'render', '--no-cache', path.join(temp, 'missing-project')],
      { encoding: 'utf8' }
    );
    assert.equal(booleanBeforeProject.status, 1);
    assert.match(booleanBeforeProject.stderr, /Project directory not found/);
    const unknownRenderFlag = childProcess.spawnSync(
      process.execPath,
      [qcut, 'render', path.join(temp, 'missing-project'), '--bogus'],
      { encoding: 'utf8' }
    );
    assert.equal(unknownRenderFlag.status, 2);
    assert.match(unknownRenderFlag.stderr, /Unknown option: --bogus/);

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

    process.stdout.write(`${JSON.stringify({ ok: true, checks: 18 }, null, 2)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
