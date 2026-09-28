#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_VERSION = 'qiaomu-cut-shared-scene-v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
}

function sceneContentKey(scene, output, files) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(stable({
    version: CACHE_VERSION,
    engine: scene.engine,
    duration: Number(scene.duration),
    width: Number(scene.width || output.width || 1080),
    height: Number(scene.height || output.height || 1920),
    fps: Number(scene.fps || output.fps || 24),
    sceneClass: scene.sceneClass || null
  })));
  for (const file of files) {
    hash.update('\0');
    hash.update(path.basename(file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function sharedCacheRoot() {
  if (process.env.QIAOMU_CUT_SHARED_CACHE === 'off') return null;
  return path.resolve(process.env.QIAOMU_CUT_SHARED_CACHE || path.join(os.homedir(), '.cache', 'qiaomu-cut', 'scenes-v1'));
}

function cacheFile(key) {
  const root = sharedCacheRoot();
  return root ? path.join(root, key.slice(0, 2), `${key}.mp4`) : null;
}

function reusable(file) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size > 1024; }
  catch (_) { return false; }
}

function copyAtomically(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(source, temporary);
  fs.renameSync(temporary, destination);
}

function restore(key, destination) {
  const source = cacheFile(key);
  if (!source || !reusable(source)) return false;
  try { copyAtomically(source, destination); return true; }
  catch (_) { return false; }
}

function store(key, source) {
  const destination = cacheFile(key);
  if (!destination || !reusable(source)) return false;
  if (reusable(destination)) return true;
  try { copyAtomically(source, destination); return true; }
  catch (_) { return false; }
}

function manifestFile(projectRoot) {
  return path.join(projectRoot, '.qiaocut', 'scene-content-manifest.json');
}

function readManifest(projectRoot) {
  const file = manifestFile(projectRoot);
  if (!fs.existsSync(file)) return { version: CACHE_VERSION, scenes: {} };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && value.version === CACHE_VERSION && value.scenes ? value : { version: CACHE_VERSION, scenes: {} };
  } catch (_) { return { version: CACHE_VERSION, scenes: {} }; }
}

function writeManifest(projectRoot, manifest) {
  const file = manifestFile(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

module.exports = { CACHE_VERSION, readManifest, restore, sceneContentKey, sharedCacheRoot, store, writeManifest };
