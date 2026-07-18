'use strict';

const fs = require('fs');
const path = require('path');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac']);

function mediaTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}

function scanLocal(directory, options = {}) {
  const root = path.resolve(directory || process.cwd());
  const rootIsFile = fs.existsSync(root) && fs.statSync(root).isFile();
  const relativeBase = rootIsFile ? path.dirname(root) : root;
  const max = Number(options.limit || 100);
  const recursive = Boolean(options.recursive);
  const results = [];

  function walk(dir) {
    if (results.length >= max) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !entry.name.startsWith('.')) walk(full);
        continue;
      }
      const mediaType = mediaTypeFor(full);
      if (!mediaType) continue;
      const stat = fs.statSync(full);
      const relative = path.relative(relativeBase, full) || path.basename(full);
      results.push({
        id: `local:${relative.split(path.sep).join('/')}`,
        source: 'local',
        provider: 'user-local-file',
        mediaType,
        title: path.basename(full),
        localPath: relative.split(path.sep).join('/'),
        bytes: stat.size,
        licenseStatus: 'user_provided',
        attribution: 'User-provided local asset; preserve original file.'
      });
      if (results.length >= max) return;
    }
  }

  if (!fs.existsSync(root)) throw new Error(`Local path not found: ${root}`);
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    const mediaType = mediaTypeFor(root);
    if (!mediaType) return [];
    const relative = path.basename(root);
    return [{
      id: `local:${relative}`,
      source: 'local',
      provider: 'user-local-file',
      mediaType,
      title: path.basename(root),
      localPath: relative,
      bytes: stat.size,
      licenseStatus: 'user_provided',
      attribution: 'User-provided local asset; preserve original file.'
    }];
  }
  walk(root);
  return results;
}

module.exports = {
  scanLocal,
  mediaTypeFor
};
