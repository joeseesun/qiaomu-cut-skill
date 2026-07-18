'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { projectPath, ensureInternalDirectory } = require('../render_project');

const MIN_NODE_MAJOR = 20;
const LISTENHUB_PACKAGE_VERSION = '0.0.15';
const LISTENHUB_CLI_VERSION = '0.1.0';
const COLI_PACKAGE_VERSION = '0.0.20';
const CAPTURE_DIRECTORY = path.join('.qiaocut', 'jobs', 'listenhub');
const SENSITIVE_ARGUMENT = /(?:^|\b)(?:lh_sk_[A-Za-z0-9_]{12,}|authorization\s*:\s*bearer\s+\S+)/i;
const UPLOAD_FLAGS = new Set([
  '--audio',
  '--first-frame',
  '--image',
  '--last-frame',
  '--reference',
  '--reference-audio',
  '--reference-image',
  '--reference-video',
  '--video'
]);
const BOOLEAN_FLAGS = new Set([
  '--generate-audio', '--has-video-input', '--help', '-h', '--instrumental', '--json', '-j',
  '--no-generate-audio', '--no-skip-audio', '--no-wait', '--skip-audio', '--summarize',
  '--version', '-V', '--wait', '--watermark'
]);

function commandPath(command) {
  const configured = command === 'listenhub'
    ? process.env.QIAOMU_LISTENHUB_CLI
    : command === 'coli'
      ? process.env.QIAOMU_COLI_CLI
      : null;
  if (configured) {
    const absolute = path.resolve(configured);
    try {
      const stat = fs.statSync(absolute);
      return stat.isFile() ? absolute : null;
    } catch {
      return null;
    }
  }
  try {
    const result = childProcess.spawnSync('which', [command], {
      encoding: 'utf8',
      timeout: 3000
    });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

function displayPath(value) {
  if (!value || typeof value !== 'string') return value;
  const home = os.homedir();
  return value === home || value.startsWith(`${home}${path.sep}`)
    ? `<HOME>${value.slice(home.length)}`
    : value;
}

function redactSecrets(value) {
  let text = String(value == null ? '' : value);
  text = text.replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '');
  text = text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  text = text.split(os.homedir()).join('<HOME>');
  text = text.replace(/\blh_sk_[A-Za-z0-9_]{8,}\b/g, 'lh_sk_<REDACTED>');
  text = text.replace(/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, '$1<REDACTED>');
  text = text.replace(
    /((?:["']|\[)?([A-Za-z][A-Za-z0-9_-]{0,63})(?:["']|\])?\s*[:=]\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;}\]]+)/g,
    (match, prefix, key) => isSensitiveKey(key) ? `${prefix}<REDACTED>` : match
  );
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<JWT_REDACTED>');
  return text;
}

function sanitizeUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return value;
    const extension = path.posix.extname(parsed.pathname).toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '';
    return `${parsed.protocol}//<REDACTED_HOST>/<REDACTED>${safeExtension}`;
  } catch {
    return value;
  }
}

function isSensitiveKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  const nonSecret = new Set([
    'keyid', 'speakerid', 'taskid', 'episodeid', 'providersongid',
    'tokencount', 'usagetokens', 'credittoken', 'credittokens'
  ]);
  if (nonSecret.has(normalized)) return false;
  return normalized === 'key' || [
    'apikey', 'token', 'secret', 'password', 'passwd', 'passphrase', 'cookie',
    'credential', 'privatekey', 'signature', 'authorization', 'session'
  ].some((marker) => normalized.includes(marker));
}

function isSensitiveFlag(argument) {
  const token = String(argument || '');
  if (!token.startsWith('--')) return false;
  const name = token.slice(2).split('=', 1)[0];
  return isSensitiveKey(name);
}

function sanitizeStoredUrl(value) {
  let text = String(value);
  text = text.replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '');
  text = text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  text = text.split(os.homedir()).join('<HOME>');
  text = text.replace(/\blh_sk_[A-Za-z0-9_]{8,}\b/g, 'lh_sk_<REDACTED>');
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<JWT_REDACTED>');
  try {
    const parsed = new URL(text);
    if (parsed.username || parsed.password) return '<REDACTED_CREDENTIAL_URL>';
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch (_) {}
    if (/\blh_sk_[A-Za-z0-9_]{8,}\b/i.test(decoded)
      || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(decoded)) {
      return '<REDACTED_CREDENTIAL_URL>';
    }
    const forbiddenParameters = new Set([
      'apikey', 'accesstoken', 'authorization', 'password', 'passwd',
      'clientsecret', 'refreshtoken'
    ]);
    for (const key of parsed.searchParams.keys()) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (forbiddenParameters.has(normalized)) return '<REDACTED_CREDENTIAL_URL>';
    }
  } catch (_) {}
  return text;
}

function sanitizeObject(value, options = {}) {
  if (Array.isArray(value)) return value.map((item) => sanitizeObject(item, options));
  if (value && typeof value === 'object') {
    const output = {};
    let redactedKeyIndex = 0;
    for (const [key, item] of Object.entries(value)) {
      const sanitizedKey = redactSecrets(key);
      const keyContainsSecret = sanitizedKey.includes('<REDACTED>') || sanitizedKey.includes('<JWT_REDACTED>');
      const outputKey = keyContainsSecret ? `<REDACTED_KEY_${redactedKeyIndex += 1}>` : sanitizedKey;
      if (isSensitiveKey(key)) {
        output[outputKey] = '<REDACTED>';
      } else {
        output[outputKey] = sanitizeObject(item, options);
      }
    }
    return output;
  }
  if (typeof value !== 'string') return value;
  if (options.urls === 'storage' && /^https?:\/\//i.test(value)) return sanitizeStoredUrl(value);
  const redacted = redactSecrets(value);
  if (options.urls === 'display' && /^https?:\/\//i.test(redacted)) return sanitizeUrl(redacted);
  return options.urls === 'display'
    ? redacted.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url))
    : redacted;
}

function sanitizeOutput(raw, options = {}) {
  const text = String(raw || '');
  try {
    const parsed = JSON.parse(text);
    return `${JSON.stringify(sanitizeObject(parsed, options), null, 2)}\n`;
  } catch {
    const redacted = redactSecrets(text);
    if (options.urls !== 'display') return redacted;
    return redacted.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url));
  }
}

function minimalEnvironment(options = {}) {
  const allowed = [
    'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'PATH', 'SHELL', 'SSL_CERT_DIR', 'SSL_CERT_FILE',
    'TMPDIR', 'TMP', 'TEMP', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'
  ];
  const environment = {};
  for (const name of allowed) {
    if (process.env[name] != null) environment[name] = process.env[name];
  }
  if (options.listenhub && process.env.LISTENHUB_API_KEY) {
    environment.LISTENHUB_API_KEY = process.env.LISTENHUB_API_KEY;
  }
  return environment;
}

function run(binary, args, options = {}) {
  const result = childProcess.spawnSync(binary, args, {
    cwd: options.cwd,
    env: options.env || minimalEnvironment(),
    encoding: 'utf8',
    input: options.input,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    timeout: options.timeout,
    stdio: options.inheritStdin ? ['inherit', 'pipe', 'pipe'] : undefined
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function nodeMajor() {
  return Number(process.versions.node.split('.')[0]);
}

function packageVersionForExecutable(executable, packageName) {
  if (!executable) return null;
  try {
    let cursor = fs.realpathSync(executable);
    cursor = path.dirname(cursor);
    for (let depth = 0; depth < 8; depth += 1) {
      const manifest = path.join(cursor, 'package.json');
      if (fs.existsSync(manifest)) {
        const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (!packageName || data.name === packageName) return data.version || null;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  } catch (_) {}
  return null;
}

function helpIncludes(cli, command, pattern) {
  const result = run(cli, [...command, '--help'], { timeout: 5000, env: minimalEnvironment() });
  return result.ok && pattern.test(`${result.stdout}\n${result.stderr}`);
}

function packageContract(executable, packageName, expectedVersion) {
  const actualVersion = packageVersionForExecutable(executable, packageName);
  return {
    name: packageName,
    version: actualVersion,
    expectedVersion,
    verified: actualVersion === expectedVersion
  };
}

function assertPackageContract(executable, packageName, expectedVersion, options = {}) {
  const contract = packageContract(executable, packageName, expectedVersion);
  if (!options.skipPackageVerification && !contract.verified) {
    const actual = contract.version || 'unknown';
    throw new Error(
      `${packageName} ${expectedVersion} is required, but ${actual} was resolved. `
      + 'Run scripts/bootstrap_listenhub.sh --install before using this provider.'
    );
  }
  return contract;
}

function credentialFileStatus(file) {
  try {
    const stat = fs.lstatSync(file);
    const regular = stat.isFile() && !stat.isSymbolicLink();
    return {
      present: true,
      regular,
      secureMode: regular && (stat.mode & 0o077) === 0
    };
  } catch {
    return { present: false, regular: null, secureMode: null };
  }
}

function listenHubConfigDirectory(environment = process.env) {
  const configured = environment.XDG_CONFIG_HOME;
  const base = configured == null || configured === ''
    ? path.join(os.homedir(), '.config')
    : configured;
  if (!path.isAbsolute(base)) throw new Error('XDG_CONFIG_HOME must be absolute before ListenHub credentials can be used.');
  return path.join(path.normalize(base), 'listenhub');
}

function credentialFilesForEnvironment(environment = process.env) {
  const directory = listenHubConfigDirectory(environment);
  return {
    oauth: credentialFileStatus(path.join(directory, 'credentials.json')),
    openapi: credentialFileStatus(path.join(directory, 'openapi.json'))
  };
}

function assertCredentialStoreSecurity(args, environment) {
  const files = credentialFilesForEnvironment(environment);
  const openapi = args[0] === 'openapi';
  const usesEnvironmentKey = openapi && Boolean(environment.LISTENHUB_API_KEY);
  const relevant = openapi ? files.openapi : files.oauth;
  if (!usesEnvironmentKey && relevant.present && (!relevant.regular || !relevant.secureMode)) {
    throw new Error(`ListenHub ${openapi ? 'OpenAPI' : 'OAuth'} credential store must be a regular file with mode 0600.`);
  }
  return files;
}

function detectListenHub(options = {}) {
  const cli = commandPath('listenhub');
  const coli = commandPath('coli');
  const nodeOk = nodeMajor() >= MIN_NODE_MAJOR;
  const cliPackage = packageContract(cli, '@marswave/listenhub-cli', LISTENHUB_PACKAGE_VERSION);
  const coliPackage = packageContract(coli, '@marswave/coli', COLI_PACKAGE_VERSION);
  let cliVersion = null;
  let auth = { configured: false, source: 'none' };
  let openapi = { configured: Boolean(process.env.LISTENHUB_API_KEY), source: process.env.LISTENHUB_API_KEY ? 'environment' : 'none' };
  let capabilities = {};
  let credentialFiles;
  let credentialConfigValid = true;
  try {
    credentialFiles = credentialFilesForEnvironment(process.env);
  } catch (_) {
    credentialConfigValid = false;
    credentialFiles = {
      oauth: { present: null, regular: null, secureMode: null },
      openapi: { present: null, regular: null, secureMode: null }
    };
  }
  const credentialFilesSecure = credentialConfigValid && Object.values(credentialFiles)
    .every((file) => !file.present || (file.regular && file.secureMode));
  if (cli && cliPackage.verified && nodeOk) {
    const versionResult = run(cli, ['--version'], { timeout: 5000, env: minimalEnvironment() });
    if (versionResult.ok) cliVersion = versionResult.stdout.trim() || null;
    if (credentialConfigValid && (!credentialFiles.oauth.present || (credentialFiles.oauth.regular && credentialFiles.oauth.secureMode))) {
      const authResult = run(cli, ['auth', 'status', '--json'], { timeout: 5000, env: minimalEnvironment() });
      const authJson = parseJson(authResult.stdout);
      auth = {
        configured: Boolean(authJson && (authJson.loggedIn || authJson.authenticated)),
        source: authJson && (authJson.loggedIn || authJson.authenticated) ? 'oauth' : 'none'
      };
    }
    const mayInspectOpenApi = Boolean(process.env.LISTENHUB_API_KEY)
      || (credentialConfigValid && (!credentialFiles.openapi.present || (credentialFiles.openapi.regular && credentialFiles.openapi.secureMode)));
    if (mayInspectOpenApi) {
      const openapiResult = run(cli, ['openapi', 'config', 'show', '--json'], {
        timeout: 5000,
        env: minimalEnvironment({ listenhub: true })
      });
      const openapiJson = parseJson(openapiResult.stdout);
      if (openapiResult.ok && openapiJson) {
        const configured = Boolean(
          process.env.LISTENHUB_API_KEY
          || openapiJson.configured
          || openapiJson.keyId
          || (openapiJson.source && openapiJson.source !== 'none')
        );
        openapi = {
          configured,
          source: process.env.LISTENHUB_API_KEY
            ? 'environment'
            : configured
              ? 'credential-store'
              : 'none'
        };
      }
    }
    if (options.capabilities !== false && cliVersion === LISTENHUB_CLI_VERSION) {
      capabilities = {
        podcast: helpIncludes(cli, ['podcast'], /\bcreate\b/),
        tts: helpIncludes(cli, ['tts'], /\bcreate\b/),
        explainer: helpIncludes(cli, ['explainer'], /\bcreate\b/),
        slides: helpIncludes(cli, ['slides'], /\bcreate\b/),
        image: helpIncludes(cli, ['image'], /\bcreate\b/),
        music: helpIncludes(cli, ['music'], /\bgenerate\b/),
        video: helpIncludes(cli, ['video'], /\bestimate\b/),
        contentExtraction: helpIncludes(cli, ['openapi', 'content'], /\bextract\b/),
        listenhubVoice: helpIncludes(cli, ['openapi', 'listenhub-voice'], /\bgenerate\b/),
        pixverse: helpIncludes(cli, ['openapi', 'video'], /\bpixverse\b/)
      };
    }
  }
  const cliContractVerified = cliPackage.verified && cliVersion === LISTENHUB_CLI_VERSION;
  return {
    available: Boolean(cli) && nodeOk && cliContractVerified,
    cliInstalled: Boolean(cli),
    cli: displayPath(cli),
    cliVersion,
    expectedCliVersion: LISTENHUB_CLI_VERSION,
    package: cliPackage,
    contractVerified: cliContractVerified,
    node: process.version,
    nodeCompatible: nodeOk,
    minimumNodeMajor: MIN_NODE_MAJOR,
    authentication: {
      oauth: auth,
      openapi,
      ready: Boolean(auth.configured || openapi.configured) && credentialFilesSecure,
      credentialFilesSecure,
      credentialConfigValid,
      credentialFiles
    },
    capabilities,
    asr: {
      available: Boolean(coli) && coliPackage.verified,
      cli: displayPath(coli),
      package: coliPackage,
      modelDownloadOnFirstUse: true
    }
  };
}

function stripQcutFlags(rawArgs) {
  const args = [];
  const control = {
    confirmed: false,
    allowUpload: false,
    project: null,
    capture: null
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === '--yes') {
      control.confirmed = true;
      continue;
    }
    if (token === '--allow-upload') {
      control.allowUpload = true;
      continue;
    }
    if (token === '--qcut-project' || token === '--qcut-capture') {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value.`);
      if (token === '--qcut-project') control.project = value;
      else control.capture = value;
      index += 1;
      continue;
    }
    if (token.startsWith('--qcut-project=')) {
      control.project = token.slice('--qcut-project='.length);
      if (!control.project) throw new Error('--qcut-project requires a value.');
      continue;
    }
    if (token.startsWith('--qcut-capture=')) {
      control.capture = token.slice('--qcut-capture='.length);
      if (!control.capture) throw new Error('--qcut-capture requires a value.');
      continue;
    }
    args.push(token);
  }
  return { args, control };
}

function commandWords(args) {
  const words = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token.startsWith('-')) {
      if (!token.includes('=') && args[index + 1] && !args[index + 1].startsWith('-')) index += 1;
      continue;
    }
    words.push(token.toLowerCase());
    if (words.length >= 4) break;
  }
  return words;
}

function classifyListenHubArgs(args) {
  const words = commandWords(args);
  const root = words[0] || '';
  const action = words[1] || '';
  const third = words[2] || '';
  const fourth = words[3] || '';
  if (!root || root === 'help' || args.includes('--help') || args.includes('-h') || args.includes('--version') || args.includes('-V')) {
    return { risk: 'read', charged: false, reason: 'help or version' };
  }
  const destructiveWords = new Set(['clear', 'delete', 'logout', 'remove', 'revoke']);
  const destructive = args
    .map((token) => String(token).toLowerCase().split('=').pop())
    .find((word) => destructiveWords.has(word))
    || words.find((word) => destructiveWords.has(word));
  if (destructive) {
    return {
      risk: 'blocked-destructive',
      charged: false,
      reason: `destructive provider action (${destructive}) is not exposed through qcut`
    };
  }
  if (root === 'auth') {
    return action === 'status'
      ? { risk: 'read', charged: false, reason: 'authentication status' }
      : { risk: 'account-change', charged: false, reason: `authentication ${action || 'change'}` };
  }
  if (root === 'speakers' && action === 'list') return { risk: 'read', charged: false, reason: 'speaker list' };
  if (root === 'creation' && action === 'get') {
    return { risk: 'read', charged: false, taskResult: true, reason: 'creation status' };
  }
  if (['podcast', 'tts', 'explainer', 'slides'].includes(root) && action === 'list') {
    return { risk: 'read', charged: false, reason: `${root} list` };
  }
  if (root === 'image' && ['list', 'get'].includes(action)) {
    return { risk: 'read', charged: false, taskResult: action === 'get', reason: `image ${action}` };
  }
  if (root === 'music' && ['list', 'get'].includes(action)) {
    return { risk: 'read', charged: false, taskResult: action === 'get', reason: `music ${action}` };
  }
  if (root === 'lyrics' && ['list', 'get'].includes(action)) {
    return { risk: 'read', charged: false, taskResult: action === 'get', reason: `lyrics ${action}` };
  }
  if (root === 'video' && ['list', 'get', 'estimate'].includes(action)) {
    return { risk: 'read', charged: false, taskResult: action === 'get', reason: `video ${action}` };
  }
  if (root === 'openapi') {
    if (action === 'config' && third === 'show') return { risk: 'read-sensitive', charged: false, reason: 'API key status (redacted)' };
    if (action === 'config') return { risk: 'account-change', charged: false, reason: `OpenAPI config ${third || 'change'}` };
    if (action === 'subscription') return { risk: 'read', charged: false, reason: 'subscription status' };
    if (['get', 'list', 'estimate', 'task', 'tasks', 'text-stream'].includes(third)) {
      return {
        risk: 'read',
        charged: false,
        taskResult: ['get', 'task'].includes(third),
        reason: `OpenAPI ${action} ${third}`
      };
    }
    if (action === 'video' && third === 'pixverse' && fourth === 'estimate') {
      return { risk: 'read', charged: false, reason: 'OpenAPI PixVerse estimate' };
    }
    return { risk: 'remote-create', charged: true, reason: `OpenAPI ${action || 'operation'}` };
  }
  return { risk: 'remote-create', charged: true, reason: `${root} ${action}`.trim() };
}

function localUploadArguments(args) {
  const uploads = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    let flag = token;
    let value = null;
    const equal = token.indexOf('=');
    if (equal > 0) {
      flag = token.slice(0, equal);
      value = token.slice(equal + 1);
    } else if (UPLOAD_FLAGS.has(flag)) {
      value = args[index + 1];
    }
    if (!UPLOAD_FLAGS.has(flag) || !value || /^https?:\/\//i.test(value)) continue;
    uploads.push({ flag, value });
  }
  const musicPrefix = args[0] === 'music' && ['remix', 'track'].includes(args[1])
    ? 2
    : args[0] === 'openapi' && args[1] === 'music' && ['remix', 'track'].includes(args[2])
      ? 3
      : null;
  if (musicPrefix != null) {
    const positionals = [];
    for (let index = musicPrefix; index < args.length; index += 1) {
      const token = args[index];
      if (token === '--') {
        positionals.push(...args.slice(index + 1));
        break;
      }
      if (token.startsWith('-')) {
        if (!token.includes('=') && !BOOLEAN_FLAGS.has(token)) index += 1;
        continue;
      }
      positionals.push(token);
    }
    if (positionals[0] && !/^https?:\/\//i.test(positionals[0])) {
      uploads.push({ flag: 'music positional audio', value: positionals[0] });
    }
  }
  return uploads;
}

function argumentValues(args, flags) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const equal = token.indexOf('=');
    const flag = equal > 0 ? token.slice(0, equal) : token;
    if (!flags.has(flag)) continue;
    const value = equal > 0 ? token.slice(equal + 1) : args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    values.push({ flag, value });
  }
  return values;
}

function validateProjectFileArguments(projectRoot, args, uploads) {
  const outputFlags = new Set(['--output', '-o']);
  for (const { flag, value } of argumentValues(args, outputFlags)) {
    if (!projectRoot) throw new Error(`${flag} requires --qcut-project so writes stay inside the video project.`);
    if (value === '-') throw new Error('Binary provider output to stdout is blocked; use a project-relative --output file.');
    const output = projectPath(projectRoot, value, `ListenHub ${flag}`);
    const privateRoot = projectPath(projectRoot, '.qiaocut', 'QiaoCut private directory');
    if (output === privateRoot) throw new Error(`ListenHub ${flag} must name a file, not the .qiaocut directory.`);
    if (output.startsWith(`${privateRoot}${path.sep}`)) {
      ensurePrivateDirectory(projectRoot, path.dirname(output));
    } else {
      ensureInternalDirectory(projectRoot, path.dirname(output), `ListenHub ${flag} directory`);
    }
    if (fs.existsSync(output)) throw new Error(`ListenHub ${flag} already exists; provider output is no-clobber by default.`);
  }
  for (const upload of uploads) {
    if (!projectRoot) throw new Error('Local provider uploads require --qcut-project.');
    const input = projectPath(projectRoot, upload.value, `ListenHub ${upload.flag}`, { exists: true });
    const stat = fs.lstatSync(input);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`ListenHub ${upload.flag} must be a regular project file.`);
  }
}

function requiresBinaryOutput(args) {
  return args[0] === 'openapi' && ['audio-speech', 'tts'].includes(args[1]);
}

function assertNoSymlinkComponents(projectRoot, target, label) {
  const relative = path.relative(projectRoot, target);
  let cursor = projectRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} cannot contain symbolic links.`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}

function assertSafeLocalTree(target, label) {
  const pending = [target];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} cannot contain symbolic links.`);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
    } else if (!stat.isFile()) {
      throw new Error(`${label} may contain only regular files and directories.`);
    }
    visited += 1;
    if (visited > 100000) throw new Error(`${label} exceeds the 100,000-entry safety limit.`);
  }
}

function ensurePrivateDirectory(projectRoot, directory) {
  ensureInternalDirectory(projectRoot, directory, 'ListenHub private directory');
  assertNoSymlinkComponents(projectRoot, directory, 'ListenHub private directory');
  const privateRoot = projectPath(projectRoot, '.qiaocut', 'QiaoCut private directory');
  let cursor = privateRoot;
  if (directory === privateRoot || directory.startsWith(`${privateRoot}${path.sep}`)) {
    fs.chmodSync(privateRoot, 0o700);
    for (const component of path.relative(privateRoot, directory).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, component);
      fs.chmodSync(cursor, 0o700);
    }
  }
}

function restrictedCapturePath(projectRoot, relative) {
  const base = projectPath(projectRoot, CAPTURE_DIRECTORY, 'ListenHub private capture directory');
  const capture = projectPath(projectRoot, relative, 'ListenHub capture');
  if (capture !== base && !capture.startsWith(`${base}${path.sep}`)) {
    throw new Error(`ListenHub captures must stay under ${CAPTURE_DIRECTORY.replaceAll(path.sep, '/')}/.`);
  }
  if (path.extname(capture).toLowerCase() !== '.json') {
    throw new Error('ListenHub capture files must use the .json extension.');
  }
  assertNoSymlinkComponents(projectRoot, capture, 'ListenHub capture');
  return capture;
}

function atomicWrite(projectRoot, file, content) {
  ensurePrivateDirectory(projectRoot, path.dirname(file));
  if (fs.existsSync(file)) throw new Error(`ListenHub capture already exists: ${path.basename(file)}`);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.linkSync(temporary, file);
    fs.unlinkSync(temporary);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    throw error;
  }
}

function defaultCapturePath(projectRoot, args) {
  const command = commandWords(args);
  const depth = command[0] === 'openapi' ? 3 : 2;
  const words = command.slice(0, depth).join('-').replace(/[^a-z0-9-]+/g, '-') || 'command';
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 10);
  const nonce = crypto.randomBytes(3).toString('hex');
  return `.qiaocut/jobs/listenhub/${new Date().toISOString().replace(/[:.]/g, '-')}-${words}-${fingerprint}-${nonce}.json`;
}

function captureResult(projectRoot, relative, args, classification, result, version) {
  const capture = restrictedCapturePath(projectRoot, relative);
  const parsed = parseJson(result.stdout);
  const envelope = {
    schema: 'qiaocut.listenhub.capture.v1',
    createdAt: new Date().toISOString(),
    cliVersion: version,
    command: sanitizeObject(args),
    classification,
    status: result.status,
    result: sanitizeObject(parsed == null ? result.stdout : parsed, { urls: 'storage' }),
    stderr: sanitizeObject(result.stderr, { urls: 'storage' })
  };
  atomicWrite(projectRoot, capture, `${JSON.stringify(envelope, null, 2)}\n`);
  return path.relative(projectRoot, capture).split(path.sep).join('/');
}

function executeListenHub(rawArgs, options = {}) {
  const cli = options.cli || commandPath('listenhub');
  if (!cli) throw new Error('ListenHub CLI is not installed. Run scripts/bootstrap_listenhub.sh --install.');
  if (nodeMajor() < MIN_NODE_MAJOR) throw new Error(`ListenHub requires Node.js ${MIN_NODE_MAJOR} or newer.`);
  assertPackageContract(cli, '@marswave/listenhub-cli', LISTENHUB_PACKAGE_VERSION, options);
  const { args, control } = stripQcutFlags(rawArgs);
  if (args.length === 0) throw new Error('Usage: qcut listenhub <listenhub arguments>');
  if (args.some((argument) => SENSITIVE_ARGUMENT.test(argument) || isSensitiveFlag(argument))) {
    throw new Error('Never pass an API key as a command argument. Use LISTENHUB_API_KEY or the interactive ListenHub credential store.');
  }
  const classification = classifyListenHubArgs(args);
  if (classification.risk === 'blocked-destructive') {
    throw new Error(`${classification.reason}. Use the upstream CLI directly only after explicitly reviewing the account impact.`);
  }
  if (classification.risk !== 'read' && classification.risk !== 'read-sensitive' && !control.confirmed) {
    throw new Error(`${classification.reason} changes account state, writes remote state, or may consume credits. Review the request and re-run with --yes.`);
  }
  const uploads = localUploadArguments(args);
  if (uploads.length && !control.allowUpload) {
    const names = uploads.map((item) => path.basename(item.value)).join(', ');
    throw new Error(`This request uploads local files (${names}) to a third-party service. Re-run with --allow-upload after reviewing them.`);
  }
  let projectRoot = null;
  if (control.project) {
    projectRoot = fs.realpathSync(path.resolve(control.project));
    if (!fs.statSync(projectRoot).isDirectory()) throw new Error('QiaoCut project must be a directory.');
  }
  if (classification.charged && !projectRoot) {
    throw new Error('Remote generation must include --qcut-project <project-dir> so the private job result can be captured for download and cost evidence.');
  }
  if (control.capture && !projectRoot) throw new Error('--qcut-capture requires --qcut-project.');
  if (control.capture) restrictedCapturePath(projectRoot, control.capture);
  if (requiresBinaryOutput(args) && argumentValues(args, new Set(['--output', '-o'])).length === 0) {
    throw new Error('This OpenAPI command can return binary media. Provide a project-relative --output and --qcut-project.');
  }
  validateProjectFileArguments(projectRoot, args, uploads);
  let plannedCapture = null;
  if (projectRoot && (classification.charged || classification.taskResult || control.capture)) {
    plannedCapture = control.capture || defaultCapturePath(projectRoot, args);
    restrictedCapturePath(projectRoot, plannedCapture);
  }
  const versionResult = run(cli, ['--version'], { timeout: 5000, env: minimalEnvironment() });
  const version = versionResult.ok ? versionResult.stdout.trim() : null;
  if (version !== LISTENHUB_CLI_VERSION) {
    throw new Error(
      `ListenHub CLI protocol ${LISTENHUB_CLI_VERSION} is required, but ${version || 'unknown'} was reported. `
      + 'Run scripts/bootstrap_listenhub.sh --install.'
    );
  }
  const providerEnvironment = options.env || minimalEnvironment({ listenhub: true });
  assertCredentialStoreSecurity(args, providerEnvironment);
  const result = run(cli, args, {
    cwd: projectRoot || options.cwd,
    env: providerEnvironment,
    inheritStdin: classification.risk === 'account-change'
  });
  if (result.error) throw result.error;
  assertCredentialStoreSecurity(args, providerEnvironment);
  let capture = null;
  if (plannedCapture) {
    capture = captureResult(projectRoot, plannedCapture, args, classification, result, version);
  }
  return {
    ok: result.ok,
    status: result.status,
    signal: result.signal,
    classification,
    capture,
    stdout: sanitizeOutput(result.stdout, { urls: 'display' }),
    stderr: sanitizeOutput(result.stderr, { urls: 'display' })
  };
}

function executeAsr(rawArgs, options = {}) {
  const coli = options.coli || commandPath('coli');
  if (!coli) throw new Error('Coli ASR is not installed. Run scripts/bootstrap_listenhub.sh --install.');
  if (nodeMajor() < MIN_NODE_MAJOR) throw new Error(`Coli ASR requires Node.js ${MIN_NODE_MAJOR} or newer.`);
  assertPackageContract(coli, '@marswave/coli', COLI_PACKAGE_VERSION, options);
  const { args, control } = stripQcutFlags(rawArgs);
  if (args.some((argument) => SENSITIVE_ARGUMENT.test(argument) || isSensitiveFlag(argument))) {
    throw new Error('Secret-like values are not valid ASR arguments.');
  }
  if (!control.project) throw new Error('Local ASR requires --qcut-project so its input and private result stay inside the video project.');
  const projectRoot = fs.realpathSync(path.resolve(control.project));
  if (control.capture) restrictedCapturePath(projectRoot, control.capture);
  const input = args[0];
  if (!input || input.startsWith('-')) throw new Error('Usage: qcut listenhub asr <project-relative-audio> --model sensevoice --json --qcut-project <dir>');
  const inputFile = projectPath(projectRoot, input, 'ASR input', { exists: true });
  const inputStat = fs.lstatSync(inputFile);
  if (!inputStat.isFile() || inputStat.isSymbolicLink()) throw new Error('ASR input must be a regular project file.');
  if (inputStat.size > 4 * 1024 * 1024 * 1024) throw new Error('ASR input exceeds the 4 GiB safety limit.');
  for (const { value } of argumentValues(args, new Set(['--model-path']))) {
    const modelPath = projectPath(projectRoot, value, 'ASR model path', { exists: true });
    const modelStat = fs.lstatSync(modelPath);
    if (modelStat.isSymbolicLink() || (!modelStat.isFile() && !modelStat.isDirectory())) {
      throw new Error('ASR --model-path must be a regular file or directory inside the project.');
    }
    assertSafeLocalTree(modelPath, 'ASR --model-path');
  }
  const command = ['asr', ...args];
  const plannedCapture = control.capture || defaultCapturePath(projectRoot, command);
  restrictedCapturePath(projectRoot, plannedCapture);
  const asrEnvironment = { ...(options.env || minimalEnvironment()) };
  delete asrEnvironment.LISTENHUB_API_KEY;
  const result = run(coli, command, { cwd: projectRoot || options.cwd, env: asrEnvironment });
  if (result.error) throw result.error;
  let capture = null;
  if (projectRoot) {
    capture = captureResult(
      projectRoot,
      plannedCapture,
      command,
      { risk: 'local-processing', charged: false, reason: 'local ASR' },
      result,
      packageVersionForExecutable(coli, '@marswave/coli')
    );
  }
  return {
    ok: result.ok,
    status: result.status,
    classification: { risk: 'local-processing', charged: false, reason: 'local ASR' },
    capture,
    stdout: sanitizeOutput(result.stdout, { urls: 'display' }),
    stderr: sanitizeOutput(result.stderr, { urls: 'display' })
  };
}

module.exports = {
  CAPTURE_DIRECTORY,
  COLI_PACKAGE_VERSION,
  LISTENHUB_CLI_VERSION,
  LISTENHUB_PACKAGE_VERSION,
  classifyListenHubArgs,
  commandPath,
  detectListenHub,
  executeAsr,
  executeListenHub,
  localUploadArguments,
  minimalEnvironment,
  redactSecrets,
  sanitizeOutput,
  stripQcutFlags
};
