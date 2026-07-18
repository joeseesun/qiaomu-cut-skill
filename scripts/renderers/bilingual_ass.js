#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const STYLE_ORDER = [
  'English',
  'Chinese',
  'Note',
  'Source',
  'Card',
  'CardChinese',
  'BigWord',
  'BigChinese'
];

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assColor(value, fallback) {
  const text = String(value || '').trim();
  return /^&H[0-9A-Fa-f]{6,8}&?$/.test(text) ? text.replace(/&$/, '') : fallback;
}

function fontFamily(value) {
  const text = String(value || 'Noto Sans CJK SC').replace(/[,\r\n{}\\]/g, '').trim();
  return text || 'Noto Sans CJK SC';
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(number(seconds, 0) * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor(centiseconds / 6000) % 60;
  const secs = Math.floor(centiseconds / 100) % 60;
  const cs = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapePlain(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/[{}]/g, '')
    .replace(/\r?\n/g, '\\N');
}

function renderText(text, style, highlightColor) {
  const pieces = String(text == null ? '' : text).split(/(\[\[.*?\]\])/gs);
  return pieces.map((piece) => {
    if (piece.startsWith('[[') && piece.endsWith(']]')) {
      const content = escapePlain(piece.slice(2, -2));
      return `{\\c${highlightColor}\\b1}${content}{\\r${style}}`;
    }
    return escapePlain(piece);
  }).join('');
}

function expandCues(cues) {
  const events = [];
  for (const cue of cues || []) {
    const common = {
      start: cue.start,
      end: cue.end,
      pos: cue.pos
    };
    if (cue.english) events.push({ ...common, layer: 2, style: cue.englishStyle || 'English', text: cue.english });
    if (cue.chinese) events.push({ ...common, layer: 1, style: cue.chineseStyle || 'Chinese', text: cue.chinese });
    if (cue.note) events.push({ ...common, layer: 0, style: cue.noteStyle || 'Note', text: cue.note });
    if (cue.source) events.push({ ...common, layer: 3, style: 'Source', text: cue.source });
  }
  return events;
}

function styleValues(document, options) {
  const width = Math.max(320, Math.round(number(options.width, 1080)));
  const height = Math.max(240, Math.round(number(options.height, 1920)));
  const scale = height / 1920;
  const horizontalScale = Math.min(1.2, Math.max(0.72, width / 1080));
  const typeScale = Math.min(scale, horizontalScale);
  const size = (base, minimum = 20) => Math.max(minimum, Math.round(base * typeScale));
  const margin = (ratio, minimum = 20) => Math.max(minimum, Math.round(height * ratio));
  const side = Math.max(48, Math.round(width * 0.083));
  const font = fontFamily(document.font || options.font || 'Noto Sans CJK SC');
  const theme = document.theme || {};
  const primary = assColor(theme.primary, '&H00FFFFFF');
  const secondary = assColor(theme.secondary, '&H00E8E2D8');
  const outline = assColor(theme.outline, '&HCC101010');
  const back = assColor(theme.back, '&H70000000');

  return {
    English: [font, size(76, 32), primary, outline, back, 1, 0.4, 4, 1, 2, side, side, margin(0.289)],
    Chinese: [font, size(46, 24), secondary, outline, back, 0, 0.2, 3, 0, 2, side, side, margin(0.228)],
    Note: [font, size(34, 20), assColor(theme.note, '&H00D1D7D9'), '&H99101010', '&H60000000', 0, 2.2, 2, 0, 8, side, side, margin(0.0875)],
    Source: [font, size(25, 18), assColor(theme.source, '&H00C1C7C9'), '&HAA101010', '&H60000000', 0, 0.3, 2, 0, 7, Math.max(32, Math.round(width * 0.059)), side, margin(0.048)],
    Card: [font, size(76, 32), primary, outline, '&H80000000', 1, 1, 4, 1, 5, side, side, 0],
    CardChinese: [font, size(46, 24), secondary, outline, '&H80000000', 0, 0.3, 3, 0, 5, side, side, 0],
    BigWord: [font, size(106, 42), primary, outline, '&H85000000', 1, 1.4, 5, 1, 5, side, side, 0],
    BigChinese: [font, size(50, 26), secondary, outline, '&H85000000', 0, 0.3, 3, 0, 5, side, side, 0]
  };
}

function styleLine(name, values) {
  const [font, fontSize, primary, outline, back, bold, spacing, outlineWidth, shadow, alignment, marginL, marginR, marginV] = values;
  return `Style: ${name},${font},${fontSize},${primary},&H000000FF,${outline},${back},${bold},0,0,0,100,100,${spacing},0,1,${outlineWidth},${shadow},${alignment},${marginL},${marginR},${marginV},1`;
}

function header(document, options = {}) {
  const width = Math.max(320, Math.round(number(options.width, 1080)));
  const height = Math.max(240, Math.round(number(options.height, 1920)));
  const styles = styleValues(document, { ...options, width, height });
  const styleLines = STYLE_ORDER.map((name) => styleLine(name, styles[name]));
  return `[Script Info]
Title: ${escapePlain(document.title || 'QiaoCut bilingual captions')}
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

function eventLine(event, document = {}) {
  const style = STYLE_ORDER.includes(event.style) ? event.style : 'English';
  const theme = document.theme || {};
  const tags = [`\\fad(${Math.max(0, Math.round(number(event.fadeInMs, 120)))},${Math.max(0, Math.round(number(event.fadeOutMs, 140)))})`];
  const width = Math.max(320, Math.round(number(document.width, 1080)));
  const height = Math.max(240, Math.round(number(document.height, 1920)));
  if (style === 'BigWord') tags.push(`\\pos(${Math.round(width / 2)},${Math.round(height * 0.469)})`);
  if (style === 'BigChinese') tags.push(`\\pos(${Math.round(width / 2)},${Math.round(height * 0.547)})`);
  if (style === 'Card') tags.push(`\\pos(${Math.round(width / 2)},${Math.round(height * 0.453)})`);
  if (style === 'CardChinese') tags.push(`\\pos(${Math.round(width / 2)},${Math.round(height * 0.526)})`);
  if (Array.isArray(event.pos) && event.pos.length === 2) {
    tags.push(`\\pos(${number(event.pos[0], width / 2)},${number(event.pos[1], height / 2)})`);
  }
  const text = `{${tags.join('')}}${renderText(event.text, style, `${assColor(theme.highlight, '&H0042B9F4')}&`)}`;
  return `Dialogue: ${Math.round(number(event.layer, 0))},${assTime(event.start)},${assTime(event.end)},${style},,0,0,0,,${text}`;
}

function validateEvents(events) {
  for (const [index, event] of events.entries()) {
    const start = number(event.start, NaN);
    const end = number(event.end, NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(`Caption event ${index + 1} must have finite start/end with 0 <= start < end.`);
    }
    if (typeof event.text !== 'string' || !event.text.trim()) {
      throw new Error(`Caption event ${index + 1} has no text.`);
    }
  }
}

function generateBilingualAss(document, options = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Caption JSON must be an object with events or cues.');
  }
  const events = [
    ...(Array.isArray(document.events) ? document.events : []),
    ...expandCues(Array.isArray(document.cues) ? document.cues : [])
  ];
  validateEvents(events);
  const renderingDocument = {
    ...document,
    font: options.font || document.font,
    width: number(options.width, document.width || 1080),
    height: number(options.height, document.height || 1920)
  };
  return header(renderingDocument, renderingDocument) + events.map((event) => eventLine(event, renderingDocument)).join('\n') + '\n';
}

function readCaptionDocument(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const [input, output, width, height] = argv;
  if (!input || !output) {
    process.stderr.write('Usage: bilingual_ass.js captions.json subtitles.ass [width] [height]\n');
    process.exitCode = 2;
    return;
  }
  const document = readCaptionDocument(path.resolve(input));
  const ass = generateBilingualAss(document, { width, height });
  const absoluteOutput = path.resolve(output);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, ass, 'utf8');
  process.stdout.write(`${absoluteOutput}\n`);
}

module.exports = {
  STYLE_ORDER,
  assTime,
  escapePlain,
  expandCues,
  generateBilingualAss,
  readCaptionDocument,
  renderText
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
