#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderProject, validateTimeline, verifiedFileNarrationProvenance } = require('./render_project');

function commandPath(command) {
  const result = childProcess.spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function ffmpegPath() {
  const candidates = [
    process.env.QIAOMU_FFMPEG,
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
    commandPath('ffmpeg')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function makePpm(file) {
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 3] = 18;
    pixels[index * 3 + 1] = 65;
    pixels[index * 3 + 2] = 112;
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
}

function main() {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) throw new Error('ffmpeg is required for file narration smoke test.');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiaomu-cut-file-narration-'));
  fs.mkdirSync(path.join(temp, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'renders'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'reports'), { recursive: true });
  try {
    makePpm(path.join(temp, 'assets', 'solid.ppm'));
    const audio = childProcess.spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.1',
      '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '1',
      path.join(temp, 'audio', 'narration.wav')
    ], { encoding: 'utf8' });
    if (audio.status !== 0) throw new Error(audio.stderr || 'Could not create narration fixture.');
    const narrationAudio = path.join(temp, 'audio', 'narration.wav');
    const narrationAudioSha256 = crypto.createHash('sha256').update(fs.readFileSync(narrationAudio)).digest('hex');
    const narrationTextSha256 = crypto.createHash('sha256').update('fixture narration').digest('hex');
    const speakerCatalogSha256 = crypto.createHash('sha256').update('fixture speaker catalog').digest('hex');
    const captureSha256 = crypto.createHash('sha256').update('fixture private capture').digest('hex');
    fs.writeFileSync(path.join(temp, 'assets-manifest.json'), `${JSON.stringify({
      assets: [{
        id: 'listenhub-audio-fixture',
        provider: 'listenhub',
        mediaType: 'audio',
        localPath: 'audio/narration.wav',
        sha256: narrationAudioSha256,
        provenance: {
          speakerId: 'speaker-xiangyang-qiaomu',
          speakerName: '向阳乔木',
          speakerCatalogSha256,
          narrationTextSha256,
          capturePath: '.qiaocut/jobs/listenhub/fixture.json',
          captureSha256
        },
        provenanceRuns: [{
          speakerId: 'speaker-xiangyang-qiaomu',
          speakerName: '向阳乔木',
          speakerCatalogSha256,
          narrationTextSha256,
          capturePath: '.qiaocut/jobs/listenhub/fixture.json',
          captureSha256
        }]
      }]
    }, null, 2)}\n`);
    const timeline = {
      schema: 'qiaocut.timeline.v1',
      title: 'File narration smoke',
      output: {
        width: 640,
        height: 360,
        fps: 24,
        duration: 1.2,
        file: 'renders/final.mp4'
      },
      shots: [{
        id: 's01', kind: 'image', path: 'assets/solid.ppm', duration: 1.2,
        fit: 'cover', motion: 'none', sourceAudio: false
      }],
      narration: {
        engine: 'file', path: 'audio/narration.wav', start: 0.2, trim: 0.1,
        duration: 0.7, gain: 0.8,
        provider: 'listenhub',
        assetId: 'listenhub-audio-fixture',
        speakerId: 'speaker-xiangyang-qiaomu',
        speakerName: '向阳乔木',
        narrationTextSha256
      },
      music: false,
      reports: { contactSheet: false, renderReport: 'reports/render-report.json' }
    };
    for (const [field, value] of [['start', -1], ['trim', -1], ['duration', 0], ['gain', 4.1]]) {
      const invalid = JSON.parse(JSON.stringify(timeline));
      invalid.narration[field] = value;
      assert.throws(() => validateTimeline(invalid, temp), new RegExp(`narration\\.${field}`));
    }
    fs.writeFileSync(path.join(temp, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
    const report = renderProject(temp, {
      profile: 'preview',
      validation: 'basic',
      cache: false,
      onProgress: () => {}
    });
    assert.equal(report.profile, 'preview');
    assert.equal(report.narration.engine, 'file');
    assert.equal(report.narration.cues, 1);
    assert.equal(report.narration.voice, '向阳乔木');
    assert.equal(report.narration.provenance.assetId, 'listenhub-audio-fixture');
    assert.equal(report.narration.provenance.speakerId, 'speaker-xiangyang-qiaomu');
    assert.equal(report.narration.provenance.speakerCatalogSha256, speakerCatalogSha256);
    assert.equal(report.narration.provenance.captureSha256, captureSha256);
    assert.equal(report.verification.ok, true);
    assert(fs.existsSync(report.finalVideo));
    assert.throws(
      () => verifiedFileNarrationProvenance(temp, { ...timeline.narration, assetId: 'wrong-asset-id' }, narrationAudio),
      /does not match an asset manifest record/
    );
    fs.appendFileSync(narrationAudio, 'tampered');
    assert.throws(
      () => verifiedFileNarrationProvenance(temp, timeline.narration, narrationAudio),
      /content SHA-256 does not match/
    );
    const providerOmitted = { ...timeline.narration };
    delete providerOmitted.provider;
    assert.throws(
      () => verifiedFileNarrationProvenance(temp, providerOmitted, narrationAudio),
      /content SHA-256 does not match/
    );
    assert.throws(
      () => verifiedFileNarrationProvenance(temp, { engine: 'file', path: 'audio/narration.wav' }, narrationAudio),
      /requires assetId provenance/
    );
    process.stdout.write(`${JSON.stringify({
      ok: true,
      profile: report.profile,
      narration: report.narration,
      verification: {
        ok: report.verification.ok,
        duration: report.verification.duration,
        videoCodec: report.verification.video && report.verification.video.codec,
        audioCodec: report.verification.audio && report.verification.audio.codec
      }
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
