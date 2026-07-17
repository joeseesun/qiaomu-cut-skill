#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function commandPath(command) {
  try {
    const result = childProcess.spawnSync('which', [command], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

function preferredFfprobe() {
  const candidates = [
    process.env.QIAOMU_FFPROBE,
    '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe',
    '/usr/local/opt/ffmpeg-full/bin/ffprobe',
    commandPath('ffprobe')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate) || !candidate.includes('/')) || null;
}

function displayPath(file) {
  const home = os.homedir();
  return file === home || file.startsWith(`${home}${path.sep}`)
    ? `<HOME>${file.slice(home.length)}`
    : file;
}

function verifyVideo(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    return {
      ok: false,
      file: displayPath(absolute),
      errors: [`File not found: ${displayPath(absolute)}`],
      warnings: []
    };
  }
  const ffprobe = preferredFfprobe();
  if (!ffprobe) {
    return {
      ok: false,
      file: displayPath(absolute),
      errors: ['ffprobe not found. Install ffmpeg-full or set QIAOMU_FFPROBE.'],
      warnings: []
    };
  }
  const result = childProcess.spawnSync(ffprobe, [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-of', 'json',
    absolute
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    return {
      ok: false,
      file: displayPath(absolute),
      errors: [result.stderr || result.stdout || 'ffprobe failed.'],
      warnings: []
    };
  }
  const data = JSON.parse(result.stdout);
  const video = (data.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (data.streams || []).find((stream) => stream.codec_type === 'audio');
  const format = data.format || {};
  const warnings = [];
  const errors = [];
  if (!video) errors.push('No video stream found.');
  if (!audio) warnings.push('No audio stream found.');
  if (video && Number(video.width) < 720) warnings.push(`Video width is low: ${video.width}px.`);
  if (format.duration && Number(format.duration) <= 0) errors.push('Duration is zero or invalid.');
  if (format.size && Number(format.size) <= 0) errors.push('File size is zero.');
  return {
    ok: errors.length === 0,
    file: displayPath(absolute),
    ffprobe: displayPath(ffprobe),
    format: {
      duration: format.duration ? Number(format.duration) : null,
      size: format.size ? Number(format.size) : null,
      bitRate: format.bit_rate ? Number(format.bit_rate) : null,
      formatName: format.format_name || null
    },
    video: video ? {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      frameRate: video.avg_frame_rate,
      pixFmt: video.pix_fmt
    } : null,
    audio: audio ? {
      codec: audio.codec_name,
      channels: audio.channels,
      sampleRate: audio.sample_rate
    } : null,
    warnings,
    errors
  };
}

module.exports = {
  verifyVideo,
  preferredFfprobe
};

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: verify_video.js /path/to/video.mp4');
    process.exit(2);
  }
  const report = verifyVideo(file);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}
