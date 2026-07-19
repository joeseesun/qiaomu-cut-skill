#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { generateBilingualAss } = require('./renderers/bilingual_ass');

const ass = generateBilingualAss({
  title: 'Typography smoke',
  cues: [{ start: 0, end: 2, english: 'I do not know.', chinese: '我不知道。', note: '语境提示', source: '影视来源' }]
}, { width: 1080, height: 1920 });

assert.match(ass, /^Style: English,[^,]+,88,/m);
assert.match(ass, /^Style: English,[^,]+,88,.*?,2,120,180,500,1$/m);
assert.match(ass, /^Style: Chinese,[^,]+,72,.*?,1,0,0,0,100,100,0\.2,0,1,4,0,2,120,180,360,1$/m);
assert.match(ass, /^Style: Note,[^,]+,76,.*?,1,0,0,0,100,100,1\.2,0,1,4,1,8,120,180,560,1$/m);
assert.match(ass, /^Style: Source,[^,]+,46,.*?,0,0,0,0,100,100,0\.3,0,1,3,0,7,120,180,280,1$/m);
assert.doesNotMatch(ass, /,Source,,/);

const withSource = generateBilingualAss({
  showSource: true,
  cues: [{ start: 0, end: 1, english: 'Test', source: 'Source name' }]
}, { width: 1080, height: 1920 });
assert.match(withSource, /,Source,,.*Source name/);

process.stdout.write(JSON.stringify({
  ok: true,
  canvas: '1080x1920',
  safeZone: { left: 120, right: 180, top: 240, bottom: 660, x: [120, 900], y: [240, 1260] },
  typography: { english: 88, chinese: 72, note: 76, source: 46 },
  sourceVisibleByDefault: false,
  placement: { note: 560, english: 1420, chinese: 1560, relation: 'outside-footage-first' }
}) + '\n');
