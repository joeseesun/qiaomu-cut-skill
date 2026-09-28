#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createdTaskId } = require('./adapters/33tc_cli');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaomu-cut-ffmpeg-shim-'));
const fakeFfmpeg = path.join(temp, 'real-ffmpeg');
const log = path.join(temp, 'calls.jsonl');
const counter = path.join(temp, 'counter');
const shim = path.join(__dirname, 'shims', 'ffmpeg');

try {
  fs.writeFileSync(fakeFfmpeg, `#!/usr/bin/env node
const fs = require('fs');
const log = ${JSON.stringify(log)};
const counter = ${JSON.stringify(counter)};
const count = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
fs.writeFileSync(counter, String(count + 1));
fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(count === 0 ? 187 : 0);
`, { mode: 0o700 });

  const remote = spawnSync(shim, [
    '-hide_banner', '-y', '-ss', '10', '-i', 'https://media.example.test/video.mkv?signature=secret',
    '-t', '2', '-c', 'copy', path.join(temp, 'out.mp4')
  ], {
    encoding: 'utf8',
    env: { ...process.env, QIAOMU_FFMPEG: fakeFfmpeg, QIAOMU_FFMPEG_RETRIES: '2' }
  });
  assert.equal(remote.status, 0);
  const remoteCalls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(remoteCalls.length, 2);
  assert(remoteCalls[0].includes('-reconnect_on_network_error'));
  assert(remoteCalls[0].includes('-rw_timeout'));

  fs.writeFileSync(counter, '0');
  fs.writeFileSync(log, '');
  const local = spawnSync(shim, ['-i', path.join(temp, 'local.mp4'), path.join(temp, 'out.mp4')], {
    encoding: 'utf8',
    env: { ...process.env, QIAOMU_FFMPEG: fakeFfmpeg, QIAOMU_FFMPEG_RETRIES: '5' }
  });
  assert.equal(local.status, 187);
  const localCalls = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(localCalls.length, 1);
  assert(!localCalls[0].includes('-reconnect'));

  assert.equal(createdTaskId('Created cut task: 5067441\n', ''), '5067441');
  assert.equal(createdTaskId('', 'ordinary failure'), null);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    remoteRetries: 2,
    localRetries: 1,
    paidTaskRecoveryHint: true
  })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
