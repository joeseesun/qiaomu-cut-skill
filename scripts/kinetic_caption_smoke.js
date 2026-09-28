#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { generateBilingualAss } = require('./renderers/bilingual_ass');

const ass = generateBilingualAss({
  title: 'Kinetic caption smoke',
  width: 1080,
  height: 1920,
  theme: { highlight: '&H0042B9F4', karaokePending: '&H00D3D6DC' },
  events: [
    {
      start: 0,
      end: 1.2,
      style: 'BigWord',
      text: 'TOKEN IS NOT A WORD',
      animation: 'word-follow',
      segments: [
        { text: 'TOKEN ', durationMs: 300 },
        { text: 'IS NOT ', durationMs: 400 },
        { text: 'A WORD', durationMs: 500 }
      ]
    },
    { start: 1.2, end: 2, style: 'Card', text: '弹入', animation: 'pop' },
    { start: 2, end: 3, style: 'Chinese', text: '滑入', animation: 'slide-up', pos: [540, 1200] }
  ]
});

assert.match(ass, /\\kf\d+/);
assert.match(ass, /\\1c&H0042B9F4&\\2c&H00D3D6DC&/);
assert.match(ass, /\\fscx72\\fscy72\\t\(0,180,/);
assert.match(ass, /\\move\(540,1242,540,1200,0,220\)/);

const previewAss = generateBilingualAss({
  width: 1080,
  height: 1920,
  events: [{ start: 0, end: 1, style: 'Chinese', text: '预览坐标', animation: 'slide-up', pos: [540, 1200] }]
}, { width: 540, height: 960, coordinateWidth: 1080, coordinateHeight: 1920 });
assert.match(previewAss, /\\move\(270,621,270,600,0,220\)/);

process.stdout.write(`${JSON.stringify({ ok: true, checks: ['word-follow', 'pop', 'slide-up', 'profile-coordinate-scaling'] }, null, 2)}\n`);
