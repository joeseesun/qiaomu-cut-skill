#!/usr/bin/env node
'use strict';

/*
 * qcut setup — detect and install every local dependency the skill uses.
 *
 * Policy: missing tools are installed, not worked around. The agent runs this
 * whenever qcut doctor (or any command) reports a missing capability, then
 * continues the task. Installs are idempotent and pinned where it matters.
 *
 *   ffmpeg-full   libass/drawtext/xfade/loudnorm build        (brew | apt)
 *   font          Noto Sans CJK SC for deterministic captions  (brew cask | apt)
 *   browser       playwright-core in <skill>/.deps + headless Chromium (npm)
 *   manim         Manim Community CLI                          (brew | uv | pip)
 *   listenhub     pinned ListenHub + Coli CLIs                 (bootstrap_listenhub.sh)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_ROOT = path.resolve(__dirname, '..');
const DEPS_DIR = path.join(SKILL_ROOT, '.deps');
const PLAYWRIGHT_VERSION = '1.61.1';
const COMPONENTS = ['ffmpeg', 'font', 'browser', 'manim', 'listenhub'];

function which(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sh(command, args, options = {}) {
  process.stderr.write(`$ ${[command, ...args].join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || SKILL_ROOT,
    env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', ...(options.env || {}) },
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: options.timeout || 45 * 60 * 1000
  });
  return result.status === 0;
}

function aptInstall(packages) {
  if (!which('apt-get')) return false;
  const prefix = process.getuid && process.getuid() === 0 ? [] : ['sudo', '-n'];
  const [command, ...rest] = [...prefix, 'apt-get', 'install', '-y', ...packages];
  return sh(command, rest);
}

// ---------- detection ----------

function ffmpegStatus() {
  const candidates = [process.env.QIAOMU_FFMPEG, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', which('ffmpeg')].filter(Boolean);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const filters = spawnSync(candidate, ['-hide_banner', '-filters'], { encoding: 'utf8' });
    const text = `${filters.stdout}${filters.stderr}`;
    const missing = ['ass', 'drawtext', 'subtitles', 'overlay', 'loudnorm', 'sidechaincompress', 'zoompan', 'xfade', 'tmix', 'gblur']
      .filter((name) => !new RegExp(`\\b${name}\\b`).test(text));
    if (!missing.length) return { ok: true, path: candidate };
    if (candidate === candidates[candidates.length - 1]) return { ok: false, path: candidate, missing };
  }
  return { ok: false, missing: ['ffmpeg'] };
}

function fontStatus() {
  const files = [
    path.join(os.homedir(), 'Library/Fonts/NotoSansCJKsc-Regular.otf'),
    '/Library/Fonts/NotoSansCJKsc-Regular.otf',
    '/opt/homebrew/share/fonts/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc'
  ];
  const found = files.find((file) => fs.existsSync(file));
  if (found) return { ok: true, path: found };
  if (which('fc-list')) {
    const list = spawnSync('fc-list', [':lang=zh', 'family'], { encoding: 'utf8' }).stdout || '';
    if (/Noto Sans CJK SC/i.test(list)) return { ok: true, path: 'fontconfig' };
  }
  return { ok: false };
}

function browserStatus() {
  delete require.cache[require.resolve('./render_scene')];
  const engines = require('./render_scene').inspectSceneEngines();
  return { ok: engines.html.available, playwright: engines.html.playwright, browser: engines.html.browser };
}

function manimStatus() {
  const bin = process.env.QIAOMU_MANIM || which('manim');
  return bin ? { ok: true, path: bin } : { ok: false };
}

function listenhubStatus() {
  const result = spawnSync('bash', [path.join(__dirname, 'bootstrap_listenhub.sh'), '--check'], { encoding: 'utf8' });
  return { ok: result.status === 0, detail: String(result.stdout || result.stderr || '').trim().split('\n').slice(-3).join(' | ') };
}

const STATUS = { ffmpeg: ffmpegStatus, font: fontStatus, browser: browserStatus, manim: manimStatus, listenhub: listenhubStatus };

// ---------- installers ----------

function installFfmpeg() {
  if (process.platform === 'darwin' && which('brew')) return sh('brew', ['install', 'ffmpeg-full']);
  return aptInstall(['ffmpeg']);
}

function installFont() {
  if (process.platform === 'darwin' && which('brew')) return sh('brew', ['install', '--cask', 'font-noto-sans-cjk-sc']);
  return aptInstall(['fonts-noto-cjk']);
}

function installBrowser() {
  fs.mkdirSync(DEPS_DIR, { recursive: true });
  const manifest = path.join(DEPS_DIR, 'package.json');
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, `${JSON.stringify({ name: 'qiaomu-cut-deps', private: true }, null, 2)}\n`);
  if (!sh('npm', ['install', '--no-audit', '--no-fund', '--prefix', DEPS_DIR, `playwright-core@${PLAYWRIGHT_VERSION}`])) return false;
  if (browserStatus().ok) return true;
  // No system Chrome/Chromium: download the pinned headless shell.
  const cli = path.join(DEPS_DIR, 'node_modules', 'playwright-core', 'cli.js');
  return sh(process.execPath, [cli, 'install', 'chromium-headless-shell']);
}

function installManim() {
  if (process.platform === 'darwin' && which('brew')) return sh('brew', ['install', 'manim']);
  if (which('uv')) return sh('uv', ['tool', 'install', 'manim']);
  if (which('pipx')) return sh('pipx', ['install', 'manim']);
  return sh('python3', ['-m', 'pip', 'install', '--user', 'manim']);
}

function installListenhub() {
  return sh('bash', [path.join(__dirname, 'bootstrap_listenhub.sh'), '--install']);
}

const INSTALL = { ffmpeg: installFfmpeg, font: installFont, browser: installBrowser, manim: installManim, listenhub: installListenhub };

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) { flags[token.slice(2)] = next; index += 1; }
    else flags[token.slice(2)] = true;
  }
  return flags;
}

// Executables inside the skill lose their exec bit under some sync tools.
function repairPermissions() {
  const repaired = [];
  const targets = [path.join(__dirname, 'shims', 'ffmpeg'), ...fs.readdirSync(__dirname).filter((name) => /\.sh$/.test(name)).map((name) => path.join(__dirname, name))];
  for (const file of targets) {
    try {
      fs.accessSync(file, fs.constants.X_OK);
    } catch (_) {
      try { fs.chmodSync(file, 0o755); repaired.push(path.relative(SKILL_ROOT, file)); } catch (__) {}
    }
  }
  return repaired;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const only = flags.only ? String(flags.only).split(',').map((item) => item.trim()).filter(Boolean) : COMPONENTS;
  const unknown = only.filter((item) => !COMPONENTS.includes(item));
  if (unknown.length) {
    process.stderr.write(`Unknown component(s): ${unknown.join(', ')}. Choose from ${COMPONENTS.join(', ')}.\n`);
    return 2;
  }
  const results = {};
  const repaired = flags.check ? [] : repairPermissions();
  for (const component of only) {
    const before = STATUS[component]();
    if (before.ok || flags.check) {
      results[component] = { ...before, action: before.ok ? 'present' : 'missing' };
      continue;
    }
    const attempted = INSTALL[component]();
    const after = STATUS[component]();
    results[component] = { ...after, action: after.ok ? 'installed' : 'install-failed', attempted };
  }
  const failed = Object.entries(results).filter(([, value]) => !value.ok).map(([key]) => key);
  const report = {
    ok: failed.length === 0,
    mode: flags.check ? 'check' : 'install',
    platform: process.platform,
    results,
    repairedPermissions: repaired,
    failed,
    hint: failed.length
      ? (flags.check ? 'Run qcut setup to install the missing components.' : 'Install failed; read the log above. Homebrew/apt may need network or sudo.')
      : 'All requested dependencies are ready.'
  };
  process.stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : `${Object.entries(results).map(([key, value]) => `${value.ok ? '✓' : '✗'} ${key}: ${value.action}`).join('\n')}\n${report.hint}\n`);
  return report.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { COMPONENTS, STATUS };
