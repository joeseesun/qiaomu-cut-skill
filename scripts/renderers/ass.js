'use strict';

const fs = require('fs');

function assTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  const cs = Math.floor((value - Math.floor(value)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAss(text) {
  return String(text || '')
    .replace(/\r?\n/g, '\\N')
    .replace(/[{}]/g, '');
}

function generateAss(captions, options = {}) {
  const width = Number(options.width || 1920);
  const height = Number(options.height || 1080);
  const font = options.font || 'Arial';
  const fontSize = Number(options.fontSize || Math.round(height * 0.052));
  const primary = options.primary || '&H00FFFFFF';
  const outline = options.outline || '&HAA000000';
  const marginV = Number(options.marginV || Math.round(height * 0.08));

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${font},${fontSize},${primary},&H000000FF,${outline},&H66000000,-1,0,0,0,100,100,0,0,1,3,0,2,80,80,${marginV},1`,
    `Style: Highlight,${font},${Math.round(fontSize * 1.08)},&H0000D7FF,&H000000FF,${outline},&H66000000,-1,0,0,0,100,100,0,0,1,3,0,2,80,80,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];

  for (const caption of captions) {
    const style = caption.style || (caption.highlight ? 'Highlight' : 'Default');
    lines.push(`Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},${style},,0,0,0,,${escapeAss(caption.text)}`);
  }

  return lines.join('\n') + '\n';
}

function readCaptions(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.captions)) return data.captions;
  throw new Error('Caption JSON must be an array or { "captions": [...] }.');
}

module.exports = {
  assTime,
  generateAss,
  readCaptions
};

if (require.main === module) {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) {
    console.error('Usage: ass.js captions.json subtitles.ass');
    process.exit(2);
  }
  const ass = generateAss(readCaptions(input));
  fs.writeFileSync(output, ass);
  console.log(output);
}
