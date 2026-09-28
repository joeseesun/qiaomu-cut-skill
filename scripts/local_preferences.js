'use strict';

// Local-user persistent authorization for paid remote actions.
//
// The public skill never ships this file and stays blocking by default. A single
// machine-private file with 0600 permissions may record standing consent so the
// operator is not asked before every charged call. An explicit `--yes=false`
// always wins over a stored authorization.

const fs = require('fs');
const path = require('path');

const SCHEMA = 'qiaocut.local-preferences.v1';

function preferencePath() {
  const explicit = process.env.QIAOMU_CUT_LOCAL_PREFERENCES;
  return explicit
    ? path.resolve(explicit)
    : path.join(__dirname, '..', '.qiaocut-local-preferences.json');
}

function readPreferences() {
  const file = preferencePath();
  try {
    const stat = fs.statSync(file);
    // Group/other bits must be empty: a world-readable consent file is not private.
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schema !== SCHEMA) return null;
    return parsed;
  } catch {
    return null;
  }
}

// `provider` is the preference key, e.g. '33tc' or 'listenhub'.
function hasPersistentCreditAuthorization(provider) {
  const preferences = readPreferences();
  if (!preferences) return false;
  const setting = preferences[provider];
  return Boolean(setting) && setting.scope === 'local-user' && setting.autoUseCredits === true;
}

function hasPersistentUploadAuthorization(provider) {
  const preferences = readPreferences();
  if (!preferences) return false;
  const setting = preferences[provider];
  return Boolean(setting) && setting.scope === 'local-user' && setting.autoAllowUpload === true;
}

module.exports = {
  SCHEMA,
  preferencePath,
  readPreferences,
  hasPersistentCreditAuthorization,
  hasPersistentUploadAuthorization
};
