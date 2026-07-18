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
  const fake33tc = path.join(temp, '33tc-fixture');
  const fake33tcLog = path.join(temp, '33tc-calls.jsonl');
  fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const source = path.join(project, 'assets', 'source.png');
  const outsideSecret = path.join(outside, 'secret.txt');
  fs.writeFileSync(source, 'fixture');
  fs.writeFileSync(outsideSecret, 'do-not-read');
  fs.writeFileSync(fake33tc, `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(fake33tcLog)}, JSON.stringify({
  args: process.argv.slice(2),
  listenhubApiKeyPresent: Boolean(process.env.LISTENHUB_API_KEY),
  githubTokenPresent: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)
}) + '\\n');
process.stdout.write(JSON.stringify({ id: 'clip-fixture', token: 'opaque-33tc-token', mediaUrl: 'https://private.example.test/file.mp4?sig=secret' }));
`, { mode: 0o700 });

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
    const qcut33tc = path.join(__dirname, 'adapters', '33tc_cli.js');
    const fake33tcEnvironment = {
      ...process.env,
      QIAOMU_33TC_CLI: fake33tc,
      LISTENHUB_API_KEY: 'synthetic-listenhub-secret',
      GITHUB_TOKEN: 'synthetic-github-secret'
    };
    const unconfirmed33tc = childProcess.spawnSync(
      process.execPath,
      [qcut33tc, 'pick', 'clip-fixture'],
      { encoding: 'utf8', env: fake33tcEnvironment }
    );
    assert.equal(unconfirmed33tc.status, 1);
    assert.equal(fs.existsSync(fake33tcLog), false);
    const falseConfirmed33tc = childProcess.spawnSync(
      process.execPath,
      [qcut33tc, 'cut', 'clip-fixture', '--yes=false'],
      { encoding: 'utf8', env: fake33tcEnvironment }
    );
    assert.equal(falseConfirmed33tc.status, 1);
    assert.equal(fs.existsSync(fake33tcLog), false);
    const confirmed33tc = childProcess.spawnSync(
      process.execPath,
      [qcut33tc, 'pick', 'clip-fixture', '--yes'],
      { encoding: 'utf8', env: fake33tcEnvironment }
    );
    assert.equal(confirmed33tc.status, 0);
    assert(!confirmed33tc.stdout.includes('opaque-33tc-token'));
    assert(confirmed33tc.stdout.includes('clip-fixture'));
    assert.equal(fs.existsSync(fake33tcLog), true);
    const confirmed33tcCall = JSON.parse(fs.readFileSync(fake33tcLog, 'utf8').trim());
    assert.equal(confirmed33tcCall.listenhubApiKeyPresent, false);
    assert.equal(confirmed33tcCall.githubTokenPresent, false);
    const planned = childProcess.spawnSync(
      process.execPath,
      [qcut, 'plan', '做一个唐代李白水墨人物中文讲解视频，忧郁但有希望', '--json'],
      { encoding: 'utf8' }
    );
    assert.equal(planned.status, 0);
    const plannedIr = JSON.parse(planned.stdout);
    assert.equal(plannedIr.generation.narration.providerPriority[0], 'listenhub');
    assert.equal(plannedIr.generation.narration.preferredVoiceName, '向阳乔木');
    assert.equal(plannedIr.style.visualBible.strategy, 'content-derived');
    assert.match(plannedIr.style.visualBible.medium, /ink-wash/);
    assert.match(plannedIr.style.visualBible.era, /Tang-dynasty/);
    assert.match(plannedIr.style.visualBible.emotion, /melancholic but hopeful/);
    assert(plannedIr.style.visualBible.palette.includes('one restrained warm amber accent'));
    assert.match(plannedIr.style.visualBible.id, /^vb-[a-f0-9]{16}$/);
    assert.equal(plannedIr.generation.images.visualBibleRequired, true);
    assert.equal(plannedIr.generation.images.visualBibleId, plannedIr.style.visualBible.id);
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

    process.stdout.write(`${JSON.stringify({ ok: true, checks: 39 }, null, 2)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
