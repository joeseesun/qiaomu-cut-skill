#!/usr/bin/env node
'use strict';

const nodeAssert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
let checkCount = 0;
const assert = new Proxy(nodeAssert, {
  apply(target, thisArg, args) {
    checkCount += 1;
    return Reflect.apply(target, thisArg, args);
  },
  get(target, property) {
    const value = target[property];
    if (typeof value !== 'function') return value;
    return (...args) => {
      checkCount += 1;
      return value(...args);
    };
  }
});
const {
  classifyListenHubArgs,
  executeAsr,
  executeListenHub,
  minimalEnvironment,
  redactSecrets,
  sanitizeOutput
} = require('./adapters/listenhub');
const { blockedAddress, inferredProvenance, readJsonField, resolveMaxBytes, validateSignature } = require('./fetch_generated');
const { importAsset } = require('./ingest_asset');
const { resolveExactSpeaker, synthesizeNarration, validateRequestedAudioFormat } = require('./listenhub_narration');
const { MAX_SCAN_BYTES, scanRoot } = require('./release_check');

function mustThrow(fn, pattern) {
  assert.throws(fn, pattern);
}

function writeFakeCli(file) {
  fs.writeFileSync(file, `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('0.1.0\\n'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write('{"loggedIn":false}\\n'); process.exit(0); }
if (process.env.FAKE_LISTENHUB_CALL_LOG) fs.appendFileSync(process.env.FAKE_LISTENHUB_CALL_LOG, JSON.stringify({
  args,
  listenhubApiKeyPresent: Boolean(process.env.LISTENHUB_API_KEY)
}) + '\\n');
if (args[0] === 'image' && args[1] === 'create') {
  const response = {
    id: 'task-fixture',
    imageUrl: 'https://tokenized-subdomain.example.test/path/image.png?X-Amz-Signature=fixture-signature',
    token: 'opaque-provider-token',
    nested: { password: 'opaque-provider-password', cookie: 'opaque-provider-cookie' }
  };
  if (process.env.LISTENHUB_API_KEY) response[process.env.LISTENHUB_API_KEY] = 'secret-key-name-value';
  process.stdout.write(JSON.stringify(response));
} else if (args[0] === 'video' && args[1] === 'get') {
  process.stdout.write(JSON.stringify({ taskId: args[2], model: 'fixture-video-model', creditCharged: 7, videoUrl: 'https://cdn.example.test/private-capability-token/video.mp4?sig=fixture' }));
} else if (args[0] === 'openapi' && args[1] === 'speakers' && args[2] === 'list') {
  process.stdout.write(JSON.stringify({ speakers: [
    { speakerId: 'speaker-xiangyang-qiaomu', displayName: '向阳乔木' },
    { speakerId: 'speaker-other', displayName: '其他音色' }
  ] }));
} else if (args[0] === 'openapi' && args[1] === 'tts') {
  const outputIndex = args.indexOf('--output');
  const output = args[outputIndex + 1];
  const formatIndex = args.indexOf('--format');
  const format = args[formatIndex + 1];
  fs.mkdirSync(require('path').dirname(output), { recursive: true });
  if (format === 'wav') {
    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(36, 4);
    wav.write('WAVEfmt ', 8, 'ascii');
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24);
    wav.writeUInt32LE(96000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii');
    fs.writeFileSync(output, wav);
  } else {
    fs.writeFileSync(output, Buffer.from('ID3fixture-narration'));
  }
  process.stdout.write(JSON.stringify({ taskId: 'tts-task-fixture', model: 'fixture-tts-model', creditCharged: 3 }));
} else {
  process.stdout.write(JSON.stringify({ ok: true, args }));
}
`, { mode: 0o700 });
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaomu-cut-listenhub-'));
  const project = path.join(temp, 'project');
  const fakeCli = path.join(temp, 'listenhub-fixture');
  const wrongVersionCli = path.join(temp, 'listenhub-wrong-version');
  const callLog = path.join(temp, 'calls.jsonl');
  const fakeConfig = path.join(temp, 'fake-config');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(fakeConfig, { recursive: true });
  fs.writeFileSync(path.join(project, 'assets-manifest.json'), '{"assets":[]}\n');
  writeFakeCli(fakeCli);
  fs.writeFileSync(wrongVersionCli, '#!/bin/sh\nprintf "9.9.9\\n"\n', { mode: 0o700 });
  const syntheticKey = `lh_${'sk_'}${'A'.repeat(40)}`;
  const providerOptions = {
    cli: fakeCli,
    skipPackageVerification: true,
    env: {
      ...minimalEnvironment(),
      XDG_CONFIG_HOME: fakeConfig,
      LISTENHUB_API_KEY: syntheticKey,
      FAKE_LISTENHUB_CALL_LOG: callLog
    }
  };
  const asrOptions = {
    coli: fakeCli,
    skipPackageVerification: true,
    env: {
      ...minimalEnvironment(),
      XDG_CONFIG_HOME: fakeConfig,
      LISTENHUB_API_KEY: syntheticKey,
      FAKE_LISTENHUB_CALL_LOG: callLog
    }
  };

  try {
    assert.equal(classifyListenHubArgs(['video', 'estimate']).charged, false);
    assert.equal(classifyListenHubArgs(['openapi', 'content', 'get', 'task']).charged, false);
    assert.equal(classifyListenHubArgs(['openapi', 'content', 'extract', '--url', 'https://example.test']).charged, true);
    assert.equal(classifyListenHubArgs(['music', 'instrumental']).charged, true);

    mustThrow(
      () => executeListenHub(['image', 'create', '--prompt', 'fixture', '--qcut-project', project], providerOptions),
      /re-run with --yes/
    );
    assert.equal(fs.existsSync(callLog), false);
    mustThrow(
      () => executeListenHub(['video', 'get', 'task-fixture'], { cli: fakeCli }),
      /@marswave\/listenhub-cli 0\.0\.15 is required/
    );
    mustThrow(
      () => executeListenHub(['video', 'get', 'task-fixture'], {
        ...providerOptions,
        cli: wrongVersionCli
      }),
      /CLI protocol 0\.1\.0 is required/
    );
    mustThrow(
      () => executeListenHub(['openapi', 'speakers', 'list', '--language', 'zh', '-j'], {
        ...providerOptions,
        env: { ...providerOptions.env, XDG_CONFIG_HOME: 'relative-config' }
      }),
      /XDG_CONFIG_HOME must be absolute/
    );
    const insecureConfig = path.join(temp, 'insecure-config', 'listenhub');
    fs.mkdirSync(insecureConfig, { recursive: true });
    fs.writeFileSync(path.join(insecureConfig, 'openapi.json'), '{"configured":true}\n', { mode: 0o644 });
    mustThrow(
      () => executeListenHub(['openapi', 'speakers', 'list', '--language', 'zh', '-j'], {
        ...providerOptions,
        env: { ...minimalEnvironment(), XDG_CONFIG_HOME: path.dirname(insecureConfig) }
      }),
      /credential store must be a regular file with mode 0600/
    );
    const symlinkProject = path.join(temp, 'symlink-project');
    const publicCaptureDirectory = path.join(symlinkProject, 'reports', 'provider-jobs');
    fs.mkdirSync(path.join(symlinkProject, '.qiaocut', 'jobs'), { recursive: true });
    fs.mkdirSync(publicCaptureDirectory, { recursive: true });
    fs.symlinkSync(publicCaptureDirectory, path.join(symlinkProject, '.qiaocut', 'jobs', 'listenhub'));
    mustThrow(
      () => executeListenHub([
        'image', 'create', '--prompt', 'fixture', '--qcut-project', symlinkProject, '--yes'
      ], providerOptions),
      /cannot contain symbolic links/
    );
    assert.equal(fs.existsSync(callLog), false);

    const created = executeListenHub([
      'image', 'create', '--prompt', 'fixture', '--json', '--qcut-project', project, '--yes'
    ], providerOptions);
    assert.equal(created.ok, true);
    assert(created.capture.startsWith('.qiaocut/jobs/listenhub/'));
    assert(!created.stdout.includes('fixture-signature'));
    assert(created.stdout.includes('<REDACTED>'));
    const capture = JSON.parse(fs.readFileSync(path.join(project, created.capture), 'utf8'));
    assert.equal(capture.result.id, 'task-fixture');
    assert(capture.result.imageUrl.includes('fixture-signature'));
    assert.equal(capture.result.token, '<REDACTED>');
    assert.equal(capture.result.nested.password, '<REDACTED>');
    assert.equal(capture.result.nested.cookie, '<REDACTED>');
    assert(!JSON.stringify(capture).includes('AAAA'));
    assert(Object.keys(capture.result).some((key) => key.startsWith('<REDACTED_KEY_')));
    assert(!created.stdout.includes('tokenized-subdomain'));
    assert.equal(fs.statSync(path.join(project, created.capture)).mode & 0o077, 0);
    for (const privateDirectory of ['.qiaocut', '.qiaocut/jobs', '.qiaocut/jobs/listenhub']) {
      assert.equal(fs.statSync(path.join(project, privateDirectory)).mode & 0o077, 0, privateDirectory);
    }

    const localReference = path.join(project, 'reference.png');
    fs.writeFileSync(localReference, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    fs.writeFileSync(path.join(project, 'reference.wav'), 'fixture');
    mustThrow(
      () => executeListenHub([
        'image', 'create', '--prompt', 'fixture', '--reference', 'reference.png',
        '--qcut-project', project, '--yes'
      ], providerOptions),
      /--allow-upload/
    );
    mustThrow(
      () => executeAsr(['../outside.wav', '--model', 'sensevoice', '--json', '--qcut-project', project], asrOptions),
      /escapes the project/
    );
    const asr = executeAsr(['reference.wav', '--model', 'sensevoice', '--json', '--qcut-project', project], asrOptions);
    assert.equal(asr.ok, true);
    assert(asr.capture.startsWith('.qiaocut/jobs/listenhub/'));
    mustThrow(
      () => executeAsr([
        'reference.wav', '--model', 'sensevoice', '--json', '--qcut-project', project,
        '--qcut-capture', 'reports/asr.json'
      ], asrOptions),
      /must stay under \.qiaocut\/jobs\/listenhub/
    );
    mustThrow(
      () => executeAsr([
        'reference.wav', '--model-path', '../outside-model', '--json', '--qcut-project', project
      ], asrOptions),
      /escapes the project/
    );
    const modelDirectory = path.join(project, 'models', 'fixture-model');
    fs.mkdirSync(modelDirectory, { recursive: true });
    fs.symlinkSync(path.join(temp, 'outside-model.bin'), path.join(modelDirectory, 'weights.bin'));
    mustThrow(
      () => executeAsr([
        'reference.wav', '--model-path', 'models/fixture-model', '--json', '--qcut-project', project
      ], asrOptions),
      /cannot contain symbolic links/
    );
    const uploaded = executeListenHub([
      'image', 'create', '--prompt', 'fixture', '--reference', 'reference.png',
      '--qcut-project', project, '--allow-upload', '--yes'
    ], providerOptions);
    assert.equal(uploaded.ok, true);
    mustThrow(
      () => executeListenHub([
        'music', 'soundtrack', '--image', 'reference.png', '--qcut-project', project, '--yes'
      ], providerOptions),
      /--allow-upload/
    );
    mustThrow(
      () => executeListenHub([
        'music', 'remix', 'reference.wav', '--qcut-project', project, '--yes'
      ], providerOptions),
      /--allow-upload/
    );
    mustThrow(
      () => executeListenHub([
        'music', 'remix', '--', 'reference.wav', '--qcut-project', project, '--yes'
      ], providerOptions),
      /--allow-upload/
    );

    mustThrow(
      () => executeListenHub([
        'openapi', 'tts', '--text', 'fixture', '--voice', 'fixture', '--output', '../escape.mp3',
        '--qcut-project', project, '--yes'
      ], providerOptions),
      /escapes the project/
    );
    fs.writeFileSync(path.join(project, 'existing.mp3'), 'fixture');
    mustThrow(
      () => executeListenHub([
        'openapi', 'tts', '--text', 'fixture', '--voice', 'fixture', '--output', 'existing.mp3',
        '--qcut-project', project, '--yes'
      ], providerOptions),
      /already exists/
    );
    mustThrow(
      () => executeListenHub([
        'openapi', 'tts', '--text', 'fixture', '--voice', 'fixture',
        '--qcut-project', project, '--yes'
      ], providerOptions),
      /can return binary media/
    );
    mustThrow(
      () => executeListenHub([
        'image', 'create', '--prompt', 'fixture', '--qcut-project', project,
        '--qcut-capture', 'reports/provider-job.json', '--yes'
      ], providerOptions),
      /must stay under \.qiaocut\/jobs\/listenhub/
    );
    for (const destructive of [
      ['auth', 'logout', '--yes'],
      ['image', 'delete', 'task-fixture', '--yes'],
      ['openapi', 'config', 'clear', '--yes']
    ]) {
      mustThrow(() => executeListenHub(destructive, providerOptions), /not exposed through qcut/);
    }

    mustThrow(
      () => executeListenHub(['openapi', 'config', 'set-key', syntheticKey, '--yes'], providerOptions),
      /Never pass an API key/
    );
    mustThrow(
      () => executeListenHub(['openapi', 'content', 'extract', '--password', 'opaque-password', '--yes'], providerOptions),
      /Never pass an API key/
    );
    for (const sensitiveArgs of [
      ['--token', 'opaque-token'],
      ['--token=opaque-token'],
      ['--client-secret', 'opaque-secret'],
      ['--id-token', 'opaque-id-token'],
      ['--password-file', 'secret.txt']
    ]) {
      mustThrow(
        () => executeListenHub(['openapi', 'content', 'extract', ...sensitiveArgs, '--yes'], providerOptions),
        /Never pass an API key/
      );
    }
    assert(!redactSecrets(syntheticKey).includes('AAAA'));
    assert(!sanitizeOutput(JSON.stringify({ apiKey: syntheticKey })).includes('AAAA'));
    const opaque = 'opaque-value-should-not-survive';
    assert(!redactSecrets(`apiKey: ${opaque}`).includes(opaque));
    assert(!redactSecrets(`access_token=${opaque}`).includes(opaque));
    const compoundSecrets = {
      clientSecret: 'client-secret-fixture',
      sessionToken: 'session-token-fixture',
      idToken: 'id-token-fixture',
      privateKey: 'private-key-fixture',
      passwordHash: 'password-hash-fixture',
      cookieHeader: 'cookie-header-fixture',
      session: 'session-fixture',
      sessionId: 'session-id-fixture',
      passphrase: 'passphrase-fixture',
      tokens: ['opaque-list-token'],
      tokenCount: 12,
      usageTokens: 34
    };
    const compoundJson = sanitizeOutput(JSON.stringify(compoundSecrets));
    for (const value of [...Object.values(compoundSecrets).filter((value) => typeof value === 'string'), 'opaque-list-token']) {
      assert(!compoundJson.includes(value));
    }
    assert(compoundJson.includes('"tokens": "<REDACTED>"'));
    assert(compoundJson.includes('"tokenCount": 12'));
    assert(compoundJson.includes('"usageTokens": 34'));
    const secretAsKey = sanitizeOutput(JSON.stringify({ [syntheticKey]: 'value' }));
    assert(!secretAsKey.includes('AAAA'));
    assert(secretAsKey.includes('<REDACTED_KEY_'));
    const compoundText = redactSecrets(Object.entries(compoundSecrets)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'));
    for (const value of Object.values(compoundSecrets).filter((value) => typeof value === 'string')) {
      assert(!compoundText.includes(value));
    }
    for (const [fixture, leaked] of [
      ['prefix {"password":"opaque-password"}', 'opaque-password'],
      ['{"password":"opaque-jsonl"}\n{"ok":true}', 'opaque-jsonl'],
      ["warning {'sessionToken':'opaque-session'}", 'opaque-session'],
      ['error [api_token]="opaque-token"', 'opaque-token']
    ]) {
      assert(!sanitizeOutput(fixture).includes(leaked));
    }
    const storageCredentialUrls = [
      ['https://user:opaque-pass@example.test/file.mp3', 'opaque-pass'],
      ['https://example.test/file.mp3?api_key=opaque-long-lived', 'opaque-long-lived'],
      [`https://example.test/file.mp3?k=${syntheticKey.replaceAll('_', '%5F')}`, 'AAAA']
    ];
    for (const [url, leaked] of storageCredentialUrls) {
      const stored = sanitizeOutput(JSON.stringify({ audioUrl: url }), { urls: 'storage' });
      assert(!stored.includes(leaked));
      assert(stored.includes('<REDACTED_CREDENTIAL_URL>'));
    }
    const signedStorageUrl = 'https://cdn.example.test/file.mp3?X-Amz-Credential=fixture&X-Amz-Signature=short-lived';
    assert(sanitizeOutput(JSON.stringify({ audioUrl: signedStorageUrl }), { urls: 'storage' }).includes(signedStorageUrl));
    const terminalText = sanitizeOutput(
      `\u001b]8;;https://bad.example/token\u0007label\u001b]8;;\u0007 https://cdn.example.test/private-capability-token/video.mp4?sig=secret`,
      { urls: 'display' }
    );
    assert(!terminalText.includes('private-capability-token'));
    assert(!terminalText.includes('\u001b'));

    const safe = executeListenHub([
      'video', 'get', 'task-fixture', '--json', '--qcut-project', project
    ], providerOptions);
    assert.equal(safe.ok, true);
    assert(safe.capture.startsWith('.qiaocut/jobs/listenhub/'));
    const safeCaptureFile = path.join(project, safe.capture);
    const safeCapture = JSON.parse(fs.readFileSync(safeCaptureFile, 'utf8'));
    const inferred = inferredProvenance(safeCapture, { field: 'result.videoUrl' }, safeCaptureFile, project);
    assert.equal(inferred.taskId, 'task-fixture');
    assert.equal(inferred.model, 'fixture-video-model');
    assert.equal(inferred.creditCharged, 7);
    assert.equal(inferred.creditStatus, 'reported');
    assert.equal(inferred.capturePath, safe.capture);
    assert.match(inferred.captureSha256, /^[a-f0-9]{64}$/);
    assert.equal(resolveMaxBytes({}), 1024 * 1024 * 1024);
    assert.equal(resolveMaxBytes({ allowLarge: true }), 8 * 1024 * 1024 * 1024);
    assert.equal(resolveMaxBytes({ allowLarge: true, maxBytes: 2 * 1024 * 1024 * 1024 }), 2 * 1024 * 1024 * 1024);
    mustThrow(() => resolveMaxBytes({ maxBytes: 2 * 1024 * 1024 * 1024 }), /require --allow-large/);
    mustThrow(() => resolveMaxBytes({ allowLarge: true, maxBytes: 9 * 1024 * 1024 * 1024 }), /absolute 8 GiB/);
    const calls = fs.readFileSync(callLog, 'utf8').trim().split('\n').map(JSON.parse);
    assert(calls.every((call) => !call.args.includes('--yes') && !call.args.includes('--allow-upload')));
    assert(calls.some((call) => call.args[0] === 'image' && call.listenhubApiKeyPresent));
    assert(calls.some((call) => call.args[0] === 'asr' && !call.listenhubApiKeyPresent));

    const source = path.join(temp, 'generated.mp4');
    const mp4Header = Buffer.alloc(32);
    mp4Header.writeUInt32BE(24, 0);
    mp4Header.write('ftyp', 4, 'ascii');
    mp4Header.write('isom', 8, 'ascii');
    fs.writeFileSync(source, mp4Header);
    validateSignature(source, 'video');
    const imported = importAsset(project, source, {
      kind: 'video', provider: 'listenhub', ...inferred
    });
    assert.equal(imported.asset.licenseStatus, 'ai_generated');
    assert.equal(imported.asset.provenance.termsStatus, 'provider_terms_unverified');
    assert.equal(imported.asset.provenance.taskId, 'task-fixture');
    assert.equal(imported.asset.provenance.model, 'fixture-video-model');
    assert.equal(imported.asset.provenance.creditCharged, 7);
    assert.equal(imported.asset.provenance.creditStatus, 'reported');
    assert.equal(imported.asset.provenance.capturePath, safe.capture);
    assert.equal(imported.asset.provenance.resultField, 'result.videoUrl');
    assert(!JSON.stringify(imported.asset).includes('https://'));
    const importedAgain = importAsset(project, source, {
      kind: 'video', provider: 'listenhub', ...inferred
    });
    assert.equal(importedAgain.reused, true);
    const aliasSource = path.join(temp, 'generated-alias.mp4');
    fs.copyFileSync(source, aliasSource);
    const aliasImport = importAsset(project, aliasSource, {
      kind: 'video', provider: 'listenhub', ...inferred, taskId: 'task-alias'
    });
    assert.equal(aliasImport.reused, true);
    assert.equal(aliasImport.localPath, imported.localPath);
    assert.equal(fs.existsSync(path.join(project, 'assets', 'generated', 'listenhub', 'video', `generated-alias-${imported.asset.sha256.slice(0, 12)}.mp4`)), false);
    let videoAssets = JSON.parse(fs.readFileSync(path.join(project, 'assets-manifest.json'), 'utf8')).assets
      .filter((asset) => asset.sha256 === imported.asset.sha256 && asset.provider === 'listenhub' && asset.mediaType === 'video');
    assert.equal(videoAssets.length, 1);
    assert.equal(new Set(videoAssets.map((asset) => asset.id)).size, videoAssets.length);
    fs.unlinkSync(path.join(project, imported.localPath));
    const repairedImport = importAsset(project, aliasSource, {
      kind: 'video', provider: 'listenhub', ...inferred, taskId: 'task-repair'
    });
    assert.equal(repairedImport.repaired, true);
    assert.equal(repairedImport.reused, false);
    assert.equal(fs.existsSync(path.join(project, repairedImport.localPath)), true);
    videoAssets = JSON.parse(fs.readFileSync(path.join(project, 'assets-manifest.json'), 'utf8')).assets
      .filter((asset) => asset.sha256 === imported.asset.sha256 && asset.provider === 'listenhub' && asset.mediaType === 'video');
    assert.equal(videoAssets.length, 1);
    assert(videoAssets[0].provenanceRuns.some((run) => run.taskId === 'task-fixture'));
    assert(videoAssets[0].provenanceRuns.some((run) => run.taskId === 'task-repair'));
    const manifestLock = path.join(project, '.qiaocut', 'locks', 'assets-manifest.lock');
    fs.writeFileSync(manifestLock, `${JSON.stringify({ pid: 2147483647, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    const recoveredImport = importAsset(project, source, {
      kind: 'video', provider: 'listenhub', ...inferred
    });
    assert.equal(recoveredImport.reused, true);

    mustThrow(
      () => synthesizeNarration(['--text', '测试讲解', '--qcut-project', project], providerOptions),
      /re-run with --yes/
    );
    mustThrow(
      () => synthesizeNarration(['--text', '测试讲解', '--qcut-project', project, '--yes=false'], providerOptions),
      /bare boolean flag/
    );
    mustThrow(
      () => synthesizeNarration(['--text', '测试讲解', '--qcut-project', project, '--voice-nme', '错别字', '--yes'], providerOptions),
      /Unknown narration option/
    );
    assert.deepEqual(
      resolveExactSpeaker({ speakers: [{ speakerId: 'one', displayName: '向阳乔木' }] }, '向阳乔木'),
      { id: 'one', name: '向阳乔木' }
    );
    mustThrow(
      () => resolveExactSpeaker({ speakers: [
        { speakerId: 'one', displayName: '向阳乔木' },
        { speakerId: 'two', displayName: '向阳乔木' }
      ] }, '向阳乔木'),
      /More than one/
    );
    const narration = synthesizeNarration([
      '--text', '测试讲解', '--qcut-project', project, '--yes', '--json'
    ], providerOptions);
    assert.equal(narration.speaker.name, '向阳乔木');
    assert.equal(narration.speaker.id, 'speaker-xiangyang-qiaomu');
    assert.equal(narration.asset.provenance.speakerName, '向阳乔木');
    assert.equal(narration.asset.provenance.speakerId, 'speaker-xiangyang-qiaomu');
    assert.match(narration.asset.provenance.speakerCatalogSha256, /^[a-f0-9]{64}$/);
    assert.match(narration.narrationTextSha256, /^[a-f0-9]{64}$/);
    assert.equal(narration.timelineNarration.engine, 'file');
    assert.equal(narration.timelineNarration.assetId, narration.asset.id);
    assert(narration.localPath.endsWith('.wav'));
    assert.equal(fs.existsSync(path.join(project, narration.localPath)), true);
    assert.equal(fs.existsSync(path.join(project, '.qiaocut', 'staging', 'listenhub')), true);
    assert.equal(fs.readdirSync(path.join(project, '.qiaocut', 'staging', 'listenhub')).length, 0);
    mustThrow(() => validateRequestedAudioFormat(source, 'wav'), /does not match the requested wav format/);

    const symlink = path.join(temp, 'generated-link.mp4');
    fs.symlinkSync(source, symlink);
    mustThrow(() => importAsset(project, symlink, { kind: 'video', provider: 'listenhub' }), /non-symbolic-link/);
    assert.equal(blockedAddress('127.0.0.1'), true);
    assert.equal(blockedAddress('10.2.3.4'), true);
    assert.equal(blockedAddress('8.8.8.8'), false);
    for (const blocked of [
      '192.0.2.1', '198.51.100.2', '203.0.113.3', '::7f00:1', '::ffff:127.0.0.1',
      '64:ff9b::7f00:1', '64:ff9b:1::1', 'fec0::1', 'ff02::1', '2001:db8::1',
      '3fff::1', '5f00::1'
    ]) assert.equal(blockedAddress(blocked), true, blocked);
    assert.equal(readJsonField({ result: { tracks: [{ audioUrl: 'https://example.test/a.mp3' }] } }, 'result.tracks.0.audioUrl'), 'https://example.test/a.mp3');
    mustThrow(() => readJsonField({}, '__proto__.x'), /Unsafe JSON field path|not found/);

    const secretRoot = path.join(temp, 'secret-scan');
    fs.mkdirSync(secretRoot);
    fs.writeFileSync(path.join(secretRoot, 'fixture.mjs'), syntheticKey);
    const nestedIgnoredName = path.join(secretRoot, 'docs', '.listenhub');
    fs.mkdirSync(nestedIgnoredName, { recursive: true });
    fs.writeFileSync(path.join(nestedIgnoredName, 'nested-secret.cjs'), syntheticKey);
    fs.writeFileSync(path.join(secretRoot, 'fixture.pem'), ['-----BEGIN', 'PRIVATE KEY-----'].join(' '));
    fs.writeFileSync(path.join(secretRoot, 'safe-target.txt'), 'safe fixture');
    fs.symlinkSync('safe-target.txt', path.join(secretRoot, 'unsafe-link'));
    const oversizedFixture = path.join(secretRoot, 'oversized.bin');
    fs.writeFileSync(oversizedFixture, '');
    fs.truncateSync(oversizedFixture, MAX_SCAN_BYTES + 1);
    const forbiddenAudioExtensions = ['.flac', '.aac', '.m4a', '.ogg', '.opus', '.pcm'];
    for (const extension of forbiddenAudioExtensions) {
      fs.writeFileSync(path.join(secretRoot, `narration${extension}`), 'media fixture');
    }
    fs.writeFileSync(path.join(secretRoot, 'hidden-audio'), Buffer.from('fLaCfixture'));
    fs.writeFileSync(path.join(secretRoot, 'source.ts'), 'export const safe = true;\n');
    const secretReport = scanRoot(secretRoot);
    assert.equal(secretReport.ok, false);
    assert(secretReport.failures.some((failure) => failure.includes('ListenHub API key')));
    assert(secretReport.failures.some((failure) => failure.includes('docs/.listenhub/nested-secret.cjs')));
    assert(secretReport.failures.some((failure) => failure.includes('fixture.pem') && failure.includes('private key block')));
    assert(secretReport.failures.some((failure) => failure.includes('unsafe-link') && failure.includes('symbolic links are blocked')));
    assert(secretReport.failures.some((failure) => failure.includes('oversized.bin') && failure.includes('too large to scan')));
    for (const extension of forbiddenAudioExtensions) {
      assert(secretReport.failures.some((failure) => failure.includes(`narration${extension}`) && failure.includes('media file is blocked')));
    }
    assert(secretReport.failures.some((failure) => failure.includes('hidden-audio') && failure.includes('media signature is blocked')));
    assert(!secretReport.failures.some((failure) => failure.includes('source.ts')));

    const vendorGuardRoot = path.join(temp, 'vendor-guard-scan');
    fs.mkdirSync(vendorGuardRoot);
    fs.writeFileSync(
      path.join(vendorGuardRoot, 'regression-fixture.js'),
      "const glob = require('path').join('vendor', 'marswaveai-skills', '**', 'SKILL.md');\nmodule.exports = { glob };\n"
    );
    fs.writeFileSync(
      path.join(vendorGuardRoot, 'vendor-mention-only.js'),
      "// See THIRD_PARTY_NOTICES.md for the vendor lock file details.\nmodule.exports = {};\n"
    );
    fs.mkdirSync(path.join(vendorGuardRoot, 'vendor'), { recursive: true });
    fs.writeFileSync(
      path.join(vendorGuardRoot, 'vendor', 'SKILL.md'),
      'vendor content itself is never scanned as a source file by this guard.'
    );
    const vendorGuardReport = scanRoot(vendorGuardRoot);
    assert.equal(vendorGuardReport.ok, false);
    assert(vendorGuardReport.failures.some((failure) => failure.includes('regression-fixture.js') && failure.includes('nested-skill-instruction')));
    assert(!vendorGuardReport.failures.some((failure) => failure.includes('vendor-mention-only.js')));
    assert(!vendorGuardReport.failures.some((failure) => failure.includes('vendor/SKILL.md')));

    process.stdout.write(`${JSON.stringify({ ok: true, checks: checkCount }, null, 2)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
