'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function commandExists(command) {
  try {
    const result = childProcess.spawnSync('which', [command], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

function getConfigPath() {
  return path.join(os.homedir(), 'Library', 'Application Support', '33TaiCi', 'config.json');
}

function displayPath(file) {
  if (!file) return null;
  const home = os.homedir();
  return file === home || file.startsWith(`${home}${path.sep}`)
    ? `<HOME>${file.slice(home.length)}`
    : file;
}

function detect33tc() {
  const configPath = getConfigPath();
  const cliPath = commandExists('33tc');
  let configExists = false;
  let loggedIn = false;
  let appVersion = null;

  if (fs.existsSync(configPath)) {
    configExists = true;
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      loggedIn = Boolean(data && (
        data.token ||
        data.accessToken ||
        data.userToken ||
        data.web_user_token ||
        data.Authorization
      ));
      appVersion = data && (data.version || data.appVersion || null);
    } catch {
      loggedIn = false;
    }
  }

  return {
    adapter: '33tc',
    available: Boolean(cliPath || configExists),
    cliPath: displayPath(cliPath),
    configPath: displayPath(configPath),
    configExists,
    loggedIn,
    appVersion,
    privacy: 'Config/token values are never printed by qiaomu-cut.'
  };
}

function search33tc(query, options = {}) {
  const cli = commandExists('33tc');
  if (!cli) {
    throw new Error('33tc CLI not found. Install or link qiaomu-33taici-cli first.');
  }
  const args = ['search', query];
  if (options.limit) args.push('--limit', String(options.limit));
  const result = childProcess.spawnSync(cli, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || '33tc search failed.');
  }
  return result.stdout;
}

module.exports = {
  detect33tc,
  search33tc,
  getConfigPath
};
