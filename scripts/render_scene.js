#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { spawn, spawnSync } = require('child_process');

class UsageError extends Error {}
const BROWSER_MODE = 'headless-only';

function commandPath(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function executable(candidate) {
  if (!candidate) return null;
  if (!candidate.includes(path.sep)) return commandPath(candidate);
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function preferredFfmpeg() {
  return [
    process.env.QIAOMU_FFMPEG,
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
    'ffmpeg'
  ].map(executable).find(Boolean) || null;
}

function preferredManim() {
  return [process.env.QIAOMU_MANIM, 'manim'].map(executable).find(Boolean) || null;
}

function cachedPlaywrightBrowser() {
  const root = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!fs.existsSync(root)) return null;
  const directories = fs.readdirSync(root)
    .filter((name) => /^chromium_headless_shell-\d+$/.test(name))
    .sort((left, right) => Number(right.split('-').pop()) - Number(left.split('-').pop()));
  for (const directory of directories) {
    const base = path.join(root, directory);
    const candidates = [
      path.join(base, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
      path.join(base, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
      path.join(base, 'chrome-headless-shell-linux', 'chrome-headless-shell')
    ];
    const found = candidates.map(executable).find(Boolean);
    if (found) return found;
  }
  return null;
}

function preferredBrowser() {
  return [
    process.env.QIAOMU_CHROME,
    cachedPlaywrightBrowser(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
    'chromium',
    'chromium-browser'
  ].map(executable).find(Boolean) || null;
}

function playwrightCandidates() {
  const candidates = [];
  if (process.env.QIAOMU_PLAYWRIGHT_CORE) candidates.push(process.env.QIAOMU_PLAYWRIGHT_CORE);
  candidates.push(path.resolve(__dirname, '..', '.deps', 'node_modules', 'playwright-core'));
  candidates.push('playwright-core', 'playwright');
  candidates.push(path.resolve(__dirname, '..', '..', 'qiaomu-ai-access', 'node_modules', 'playwright-core'));
  candidates.push(path.join(os.homedir(), '.agents', 'skills', 'qiaomu-ai-access', 'node_modules', 'playwright-core'));
  return candidates;
}

function resolvePlaywright() {
  for (const candidate of playwrightCandidates()) {
    try {
      const loaded = require(candidate);
      if (loaded && loaded.chromium) return { module: loaded, source: candidate };
    } catch (_) {}
  }
  return null;
}

function displayPath(file) {
  if (!file || typeof file !== 'string') return file;
  const home = os.homedir();
  return file === home || file.startsWith(`${home}${path.sep}`)
    ? `<HOME>${file.slice(home.length)}`
    : file;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function projectPath(root, relative, label, exists = false) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a non-empty project-relative path.`);
  }
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute)) throw new Error(`${label} escapes the project directory.`);
  const anchor = fs.existsSync(absolute) ? absolute : path.dirname(absolute);
  if (fs.existsSync(anchor)) {
    const realRoot = fs.realpathSync(root);
    const realAnchor = fs.realpathSync(anchor);
    if (!isWithin(realRoot, realAnchor)) throw new Error(`${label} escapes through a symbolic link.`);
  }
  if (exists && !fs.existsSync(absolute)) throw new Error(`${label} not found: ${relative}`);
  return absolute;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'inherit'],
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${path.basename(command)} failed with exit code ${result.status}.${detail ? `\n${detail.slice(-6000)}` : ''}`);
  }
  return result;
}

function inspectSceneEngines() {
  const playwright = resolvePlaywright();
  const browser = preferredBrowser();
  const ffmpeg = preferredFfmpeg();
  const manim = preferredManim();
  return {
    html: {
      available: Boolean(playwright && browser && ffmpeg),
      browserMode: BROWSER_MODE,
      headless: true,
      playwright: playwright ? displayPath(playwright.source) : null,
      browser: displayPath(browser),
      ffmpeg: displayPath(ffmpeg),
      role: 'deterministic HTML/CSS/Web Animations frame capture to MP4'
    },
    svg: {
      available: Boolean(playwright && browser && ffmpeg),
      browserMode: BROWSER_MODE,
      headless: true,
      playwright: playwright ? displayPath(playwright.source) : null,
      browser: displayPath(browser),
      ffmpeg: displayPath(ffmpeg),
      role: 'SVG/CSS animation frame capture to MP4'
    },
    manim: {
      available: Boolean(manim),
      cli: displayPath(manim),
      role: 'Manim Scene class rendering to MP4'
    }
  };
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    if (['--json', '--force', '--allow-large', '--transparent'].includes(token)) {
      flags[token.slice(2)] = true;
      continue;
    }
    const equal = token.indexOf('=');
    if (equal > 2) {
      flags[token.slice(2, equal)] = token.slice(equal + 1);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new UsageError(`${token} requires a value.`);
    flags[token.slice(2)] = value;
    index += 1;
  }
  return { positional, flags };
}

function positive(value, fallback, label) {
  const number = Number(value == null ? fallback : value);
  if (!Number.isFinite(number) || number <= 0) throw new UsageError(`${label} must be a positive number.`);
  return number;
}

function outputGuard(output, force) {
  if (!fs.existsSync(output)) return;
  const stat = fs.lstatSync(output);
  if (stat.isDirectory()) throw new Error('Scene output points to a directory.');
  if (!force) throw new Error(`Scene output already exists: ${output}. Re-run with --force to replace it.`);
}

function temporarySibling(file) {
  const extension = path.extname(file);
  return path.join(path.dirname(file), `.${path.basename(file, extension)}.qiaocut-${process.pid}-${Date.now()}${extension}`);
}

function commitTemporary(temp, destination) {
  fs.renameSync(temp, destination);
}

function waitForDrain(stream) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

function waitForEncoder(child, label) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12000);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}.${stderr.trim() ? `\n${stderr.trim()}` : ''}`));
    });
  });
}

async function openScenePage(browser, options) {
  const { source, width, height, projectRoot } = options;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: options.scale || 1,
    reducedMotion: 'no-preference'
  });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (/^(data|blob):/.test(url)) {
      await route.continue();
      return;
    }
    if (url.startsWith('file:')) {
      let local;
      try { local = fileURLToPath(new URL(url)); } catch (_) { local = null; }
      if (local && isWithin(projectRoot, path.resolve(local))) await route.continue();
      else await route.abort('blockedbyclient');
      return;
    }
    await route.abort('blockedbyclient');
  });
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  return { context, page };
}

// Seek every clock the page exposes. __QIAOCUT_SET_TIME__ may return a Promise
// (for example to await image decodes of a real-footage JPEG sequence).
async function seekPage(page, timeMs) {
  await page.evaluate(async (value) => {
    if (typeof window.__QIAOCUT_SET_TIME__ === 'function') {
      const pending = window.__QIAOCUT_SET_TIME__(value);
      if (pending && typeof pending.then === 'function') await pending;
    }
    for (const animation of document.getAnimations({ subtree: true })) {
      animation.pause();
      try { animation.currentTime = value; } catch (_) {}
    }
  }, timeMs);
}

async function screenshotPage(page, transparent) {
  return page.screenshot({
    type: 'png',
    omitBackground: Boolean(transparent),
    animations: 'allow',
    timeout: 120000
  });
}

async function openBrowserRuntime() {
  const resolved = resolvePlaywright();
  const browserPath = preferredBrowser();
  const ffmpeg = preferredFfmpeg();
  if (!resolved || !browserPath || !ffmpeg) {
    throw new Error('HTML/SVG scene capture requires playwright-core, a Chromium browser, and ffmpeg-full. Run: qcut setup --only browser,ffmpeg');
  }
  const browser = await resolved.module.chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync']
  });
  return { browser, browserPath, browserMode: BROWSER_MODE, ffmpeg, resolved };
}

async function captureBrowserSceneInRuntime(options, runtime) {
  const { output, fps, duration, transparent, projectRoot } = options;
  const { browser, browserPath, browserMode, ffmpeg, resolved } = runtime;
  const frames = Math.max(1, Math.ceil(duration * fps));
  const subframes = Math.max(1, Math.min(8, Math.round(options.motionBlur || 1)));
  const shutter = Math.max(0.05, Math.min(1, options.shutter == null ? 0.5 : Number(options.shutter)));
  const scale = options.scale || 1;
  if (!options.allowLarge && frames * subframes > 7200 * 2) {
    throw new Error('Scene capture exceeds 7,200 frames. Re-run with --allow-large after reviewing render cost.');
  }
  const buildRoot = path.join(projectRoot, '.qiaocut');
  fs.mkdirSync(buildRoot, { recursive: true });
  const buildDir = fs.mkdtempSync(path.join(buildRoot, 'scene-render-'));
  let context;
  let encoder;
  let encoderCompletion;
  let temporary;
  try {
    temporary = temporarySibling(output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const blend = subframes > 1
      ? ['-vf', `tmix=frames=${subframes},select='eq(mod(n\\,${subframes})\\,${subframes - 1})',setpts=N/(${fps}*TB)`]
      : [];
    const evenScale = scale !== 1 ? ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'] : [];
    if (blend.length && evenScale.length) blend[1] = `${blend[1]},scale=trunc(iw/2)*2:trunc(ih/2)*2`;
    encoder = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps * subframes),
      '-i', 'pipe:0',
      ...(blend.length ? blend : evenScale),
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-movflags', '+faststart',
      temporary
    ], {
      cwd: projectRoot,
      env: process.env,
      stdio: ['pipe', 'ignore', 'pipe']
    });
    encoderCompletion = waitForEncoder(encoder, 'ffmpeg image2pipe encoder');
    ({ context } = await openScenePage(browser, options));
    const page = context.pages()[0];
    for (let frame = 0; frame < frames; frame += 1) {
      for (let sub = 0; sub < subframes; sub += 1) {
        const offset = subframes > 1 ? ((sub + 0.5) / subframes - 0.5) * shutter / fps : 0;
        const timeMs = Math.min(duration, Math.max(0, frame / fps + offset)) * 1000;
        await seekPage(page, timeMs);
        const png = await screenshotPage(page, transparent);
        if (!encoder.stdin.write(png)) await waitForDrain(encoder.stdin);
      }
    }
    await context.close();
    context = null;
    encoder.stdin.end();
    await encoderCompletion;
    encoder = null;
    commitTemporary(temporary, output);
    fs.rmSync(buildDir, { recursive: true, force: true });
    return {
      frames,
      capture: resolved.source,
      browser: displayPath(browserPath),
      browserMode,
      browserShared: true,
      transport: 'image2pipe',
      intermediateFrameFiles: 0,
      motionBlur: subframes > 1 ? { subframes, shutter, method: 'ffmpeg tmix of centered subframes' } : null,
      scale
    };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    if (encoder && !encoder.killed) {
      encoder.stdin.destroy();
      encoder.kill('SIGTERM');
      await encoderCompletion.catch(() => {});
    }
    if (temporary && fs.existsSync(temporary)) {
      try { fs.unlinkSync(temporary); } catch (_) {}
    }
    error.buildDir = buildDir;
    throw error;
  }
}

async function captureBrowserScenes(optionsList) {
  if (!Array.isArray(optionsList) || optionsList.length === 0) return { results: [], browserLaunches: 0 };
  const projectRoot = optionsList[0].projectRoot;
  if (optionsList.some((item) => item.projectRoot !== projectRoot)) throw new Error('A browser batch must belong to one project.');
  const runtime = await openBrowserRuntime();
  try {
    const results = [];
    for (const options of optionsList) results.push(await captureBrowserSceneInRuntime(options, runtime));
    return { results, browserLaunches: 1, browser: displayPath(runtime.browserPath), browserMode: runtime.browserMode };
  } finally {
    await runtime.browser.close().catch(() => {});
  }
}

async function captureBrowserScene(options) {
  const batch = await captureBrowserScenes([options]);
  return { ...batch.results[0], browserLaunches: batch.browserLaunches };
}

function sha256(buffer) {
  return require('crypto').createHash('sha256').update(buffer).digest('hex');
}

/*
 * Capture PNG stills at chosen times and prove the scene is a pure function of
 * time: a forward pass, a reverse-order pass and a cold page for a sample of
 * times must produce byte-identical frames.
 */
async function captureStills(options) {
  const { projectRoot, times, outDir } = options;
  const runtime = await openBrowserRuntime();
  const stills = [];
  const mismatches = [];
  try {
    const { context, page } = await openScenePage(runtime.browser, options);
    const forward = new Map();
    for (const time of times) {
      await seekPage(page, time * 1000);
      const png = await screenshotPage(page, options.transparent);
      forward.set(time, png);
      const name = `t${time.toFixed(3).replace('.', '_')}.png`;
      const file = path.join(outDir, name);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(file, png);
      stills.push({ time, file: path.relative(projectRoot, file), sha256: sha256(png) });
    }
    let checked = 0;
    if (options.determinism !== false && times.length > 1) {
      for (const time of [...times].reverse()) {
        await seekPage(page, time * 1000);
        const png = await screenshotPage(page, options.transparent);
        checked += 1;
        if (sha256(png) !== sha256(forward.get(time))) {
          const file = path.join(outDir, `t${time.toFixed(3).replace('.', '_')}.reverse.png`);
          fs.writeFileSync(file, png);
          mismatches.push({ time, pass: 'reverse-order seek', file: path.relative(projectRoot, file) });
        }
      }
      await context.close();
      const cold = await openScenePage(runtime.browser, options);
      const sample = times[Math.floor(times.length / 2)];
      await seekPage(cold.page, sample * 1000);
      const png = await screenshotPage(cold.page, options.transparent);
      checked += 1;
      if (sha256(png) !== sha256(forward.get(sample))) {
        const file = path.join(outDir, `t${sample.toFixed(3).replace('.', '_')}.cold.png`);
        fs.writeFileSync(file, png);
        mismatches.push({ time: sample, pass: 'cold page direct seek', file: path.relative(projectRoot, file) });
      }
      await cold.context.close();
    } else {
      await context.close();
    }
    return {
      stills,
      determinism: options.determinism === false
        ? null
        : { checked, deterministic: mismatches.length === 0, mismatches },
      browser: displayPath(runtime.browserPath)
    };
  } finally {
    await runtime.browser.close().catch(() => {});
  }
}

function findFiles(root, suffix, result = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) findFiles(absolute, suffix, result);
    else if (entry.isFile() && entry.name.endsWith(suffix)) result.push(absolute);
  }
  return result;
}

function renderManimScene(options) {
  const manim = preferredManim();
  const ffmpeg = preferredFfmpeg();
  if (!manim) throw new Error('Manim is not available. Run: qcut setup --only manim');
  if (!ffmpeg) throw new Error('ffmpeg-full is required to normalize Manim scene output.');
  if (!options.sceneClass) throw new UsageError('--scene-class is required for Manim rendering.');
  const buildRoot = path.join(options.projectRoot, '.qiaocut');
  fs.mkdirSync(buildRoot, { recursive: true });
  const buildDir = fs.mkdtempSync(path.join(buildRoot, 'manim-render-'));
  const mediaDir = path.join(buildDir, 'media');
  try {
    run(manim, [
      'render', '--format', 'mp4', '--progress_bar', 'none', '--verbosity', 'warning',
      '--media_dir', mediaDir,
      '-r', `${options.width},${options.height}`,
      '--fps', String(options.fps),
      '-o', 'scene.mp4',
      options.source,
      options.sceneClass
    ], { cwd: options.projectRoot });
    const candidates = findFiles(mediaDir, '.mp4').sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    if (!candidates.length) throw new Error('Manim completed without producing an MP4.');
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    const temporary = temporarySibling(options.output);
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-i', candidates[0],
      '-vf', `scale=${options.width}:${options.height}:flags=lanczos,fps=${options.fps},tpad=stop_mode=clone:stop_duration=${options.duration},trim=duration=${options.duration},setpts=PTS-STARTPTS`,
      '-an', '-t', String(options.duration),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      temporary
    ], { cwd: options.projectRoot });
    commitTemporary(temporary, options.output);
    fs.rmSync(buildDir, { recursive: true, force: true });
    return { manim: displayPath(manim), ffmpeg: displayPath(ffmpeg) };
  } catch (error) {
    error.buildDir = buildDir;
    throw error;
  }
}

function usage() {
  return `Usage: render_scene.js render <project-dir> <source> --engine html|svg|manim
       --output assets/scenes/scene.mp4 [--duration 4] [--width 1080] [--height 1920]
       [--fps 30] [--scene-class SceneName] [--transparent] [--force] [--json]
       [--motion-blur 1-8 subframes] [--shutter 0.5] [--scale 0.5 draft resolution]
       render_scene.js batch <project-dir> <batch-spec.json> [--json]

HTML/SVG sources are captured deterministically by pausing CSS/Web Animations at
each frame. Pages may define window.__QIAOCUT_SET_TIME__(milliseconds) for custom
canvas or JavaScript animation; it may return a Promise (awaited per frame).
--motion-blur N captures N centered subframes per frame across the shutter
fraction of a frame and blends them with ffmpeg tmix. Network requests are
blocked during capture.
`;
}

function browserOptions(projectRoot, item, inheritedForce = false) {
  const source = projectPath(projectRoot, item.source, 'scene source', true);
  const engine = String(item.engine || path.extname(source).slice(1)).toLowerCase();
  if (!['html', 'htm', 'svg'].includes(engine)) throw new UsageError('Browser batches only support html or svg scenes.');
  if (!item.output) throw new UsageError('Scene output is required.');
  const output = projectPath(projectRoot, item.output, 'scene output');
  if (path.extname(output).toLowerCase() !== '.mp4') throw new UsageError('Scene output must use the .mp4 extension.');
  if (source === output) throw new Error('Scene output must differ from its source.');
  outputGuard(output, Boolean(inheritedForce || item.force));
  const options = {
    projectRoot, source, output,
    width: Math.round(positive(item.width, 1080, 'width')),
    height: Math.round(positive(item.height, 1920, 'height')),
    fps: positive(item.fps, 30, 'fps'),
    duration: positive(item.duration, 4, 'duration'),
    transparent: Boolean(item.transparent),
    allowLarge: Boolean(item.allowLarge),
    motionBlur: item.motionBlur == null ? 1 : positive(item.motionBlur, 1, 'motionBlur'),
    shutter: item.shutter,
    scale: item.scale == null ? 1 : positive(item.scale, 1, 'scale')
  };
  if (options.width % 2 || options.height % 2) throw new UsageError('width and height must be even integers.');
  return { engine: engine === 'htm' ? 'html' : engine, options };
}

async function cli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  if (!['render', 'batch'].includes(positional[0]) || positional.length < 3) throw new UsageError(usage());
  const projectRoot = path.resolve(positional[1]);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) throw new Error('Project directory not found.');
  if (positional[0] === 'batch') {
    const specFile = projectPath(projectRoot, positional[2], 'batch spec', true);
    let document;
    try { document = JSON.parse(fs.readFileSync(specFile, 'utf8')); }
    catch (error) { throw new UsageError(`Batch spec is not valid JSON: ${error.message}`); }
    if (!Array.isArray(document.scenes) || document.scenes.length === 0 || document.scenes.length > 32) {
      throw new UsageError('Batch spec scenes must contain 1–32 browser scenes.');
    }
    const prepared = document.scenes.map((item) => browserOptions(projectRoot, item, Boolean(flags.force)));
    const batch = await captureBrowserScenes(prepared.map((item) => item.options));
    const result = {
      ok: true,
      batch: true,
      browserLaunches: batch.browserLaunches,
      browser: batch.browser,
      browserMode: batch.browserMode,
      results: prepared.map((item, index) => ({
        ok: true,
        engine: item.engine,
        source: path.relative(projectRoot, item.options.source),
        output: path.relative(projectRoot, item.options.output),
        width: item.options.width,
        height: item.options.height,
        fps: item.options.fps,
        duration: item.options.duration,
        ...batch.results[index]
      }))
    };
    if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`Rendered ${result.results.length} scenes with one browser launch.\n`);
    return 0;
  }
  const source = projectPath(projectRoot, positional[2], 'scene source', true);
  const engine = String(flags.engine || path.extname(source).slice(1)).toLowerCase();
  if (!['html', 'htm', 'svg', 'manim'].includes(engine)) throw new UsageError('--engine must be html, svg, or manim.');
  if (!flags.output) throw new UsageError('--output is required.');
  const output = projectPath(projectRoot, flags.output, 'scene output');
  if (path.extname(output).toLowerCase() !== '.mp4') throw new UsageError('--output must use the .mp4 extension.');
  if (source === output) throw new Error('Scene output must differ from its source.');
  outputGuard(output, Boolean(flags.force));
  const options = {
    projectRoot,
    source,
    output,
    width: Math.round(positive(flags.width, 1080, '--width')),
    height: Math.round(positive(flags.height, 1920, '--height')),
    fps: positive(flags.fps, 30, '--fps'),
    duration: positive(flags.duration, 4, '--duration'),
    sceneClass: flags['scene-class'],
    transparent: Boolean(flags.transparent),
    allowLarge: Boolean(flags['allow-large']),
    motionBlur: flags['motion-blur'] == null ? 1 : positive(flags['motion-blur'], 1, '--motion-blur'),
    shutter: flags.shutter == null ? undefined : positive(flags.shutter, 0.5, '--shutter'),
    scale: flags.scale == null ? 1 : positive(flags.scale, 1, '--scale')
  };
  if (options.width % 2 || options.height % 2) throw new UsageError('--width and --height must be even integers.');
  const detail = engine === 'manim'
    ? renderManimScene(options)
    : await captureBrowserScene(options);
  const result = {
    ok: true,
    engine: engine === 'htm' ? 'html' : engine,
    source: path.relative(projectRoot, source),
    output: path.relative(projectRoot, output),
    width: options.width,
    height: options.height,
    fps: options.fps,
    duration: options.duration,
    ...detail
  };
  if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`Rendered scene: ${result.output}\n`);
  return 0;
}

module.exports = { inspectSceneEngines, captureBrowserScene, captureBrowserScenes, captureStills, renderManimScene, projectPath };

if (require.main === module) {
  cli().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    if (error.buildDir) process.stderr.write(`Intermediate files retained at: ${displayPath(error.buildDir)}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
