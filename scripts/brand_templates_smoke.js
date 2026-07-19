#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { TEMPLATES, chooseTemplate, buildBrandCards } = require('./brand_templates');
assert.strictEqual(TEMPLATES.length, 20);
assert.strictEqual(new Set(TEMPLATES.map(x => x.id)).size, 20);
assert.strictEqual(chooseTemplate('电影英语学习'), 'cinema-frame');
const cards = buildBrandCards({ context: '英语常用句' });
assert.match(cards.outro.cta, /关注向阳乔木/);
assert.strictEqual(cards.outro.handle, '@vista8');
assert.notStrictEqual(cards.intro.layout, cards.outro.layout);
assert.strictEqual(cards.outro.motion, 'none');
assert.strictEqual(cards.outro.transition, 'snap-flash-pop');
assert.doesNotMatch(cards.outro.publicText.join(' '), /STYLE|模板|template|水墨留白/i);
process.stdout.write(JSON.stringify({ ok: true, templates: 20, default: cards.template.id }) + '\n');
