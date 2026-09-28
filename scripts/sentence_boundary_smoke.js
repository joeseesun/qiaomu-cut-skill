#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { assertComplete, assertCompleteContext } = require('./complete_sentence');
const range = assertComplete({ current: { start: 10, end: 11.2, text: 'I think that' }, next: { start: 11.2, end: 12.8, text: 'we should leave.' } });
assert.strictEqual(range.out, 13.55);
assert.ok(range.in <= 9.55);
assert.throws(() => assertComplete({ current: { start: 1, end: 2, text: 'Because' } }), /fetch more subtitle context/);

assert.throws(
  () => assertCompleteContext({
    previous: { start: 8, end: 10, content: 'that says a principal cannot live next door to a student.' },
    current: { start: 10, end: 11, content: 'That makes sense.' }
  }),
  /begins inside a sentence/
);

const contextRange = assertCompleteContext({
  before: [{ start: 6, end: 8, content: 'There is a district rule' }],
  previous: { start: 8, end: 10, content: 'that says a principal cannot live next door to a student.' },
  current: { start: 10, end: 11, content: 'That makes sense.' }
});
assert.equal(contextRange.in, 5.55);
assert.deepEqual(contextRange.selectedText, [
  'There is a district rule',
  'that says a principal cannot live next door to a student.',
  'That makes sense.'
]);

const noContext = assertCompleteContext(
  { current: { start: 10, end: 11, content: 'That makes sense.' } },
  { contextBefore: 0 }
);
assert.equal(noContext.complete, true);

process.stdout.write(JSON.stringify({
  ok: true,
  trailingPad: 0.75,
  incompleteCueExtendsNext: true,
  leadingFragmentBlockedBeforePaidCut: true,
  contentFieldSupported: true
}) + '\n');
