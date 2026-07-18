'use strict';

const fs = require('fs');
const path = require('path');

function portableValue(value, fallback = '') {
  if (typeof value !== 'string') return value == null ? fallback : value;
  if (path.isAbsolute(value)) return `[local path redacted]/${path.basename(value)}`;
  return value;
}

function readAssets(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.assets)) return data.assets;
  if (Array.isArray(data.items)) return data.items;
  throw new Error('Asset JSON must be an array, { assets: [...] }, or { items: [...] }.');
}

function makeLicenseReport(assets, options = {}) {
  const title = options.title || 'License Report';
  const lines = [
    `# ${title}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Assets',
    '',
    '| ID | Type | Provider | Title | Source Page | License Status | Attribution |',
    '|---|---|---|---|---|---|---|'
  ];
  for (const asset of assets) {
    const row = [
      portableValue(asset.id || ''),
      asset.mediaType || '',
      asset.provider || asset.source || '',
      asset.title || '',
      asset.sourcePage || portableValue(asset.localPath || ''),
      asset.licenseStatus || 'unknown',
      asset.attribution || ''
    ].map((value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' '));
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('', '## Notes', '');
  lines.push('- ClipSeek is treated as discovery only; verify licenses on provider source pages.');
  lines.push('- User-provided local files remain the user’s responsibility.');
  lines.push('- AI-generated assets must be marked as `ai_generated`.');
  lines.push('- AI-generated does not prove commercial rights; keep provider terms as `provider_terms_unverified` until reviewed.');
  return lines.join('\n') + '\n';
}

module.exports = {
  readAssets,
  makeLicenseReport
};

if (require.main === module) {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input) {
    console.error('Usage: license_report.js assets.json [license-report.md]');
    process.exit(2);
  }
  const report = makeLicenseReport(readAssets(input));
  if (output) {
    fs.writeFileSync(output, report);
    console.log(output);
  } else {
    process.stdout.write(report);
  }
}
