#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { assertComplete } = require('./complete_sentence');
const range = assertComplete({ current: { start: 10, end: 11.2, text: 'I think that' }, next: { start: 11.2, end: 12.8, text: 'we should leave.' } });
assert.strictEqual(range.out, 13.55);
assert.ok(range.in <= 9.55);
assert.throws(() => assertComplete({ current: { start: 1, end: 2, text: 'Because' } }), /fetch more subtitle context/);
process.stdout.write(JSON.stringify({ ok: true, trailingPad: 0.75, incompleteCueExtendsNext: true }) + '\n');
