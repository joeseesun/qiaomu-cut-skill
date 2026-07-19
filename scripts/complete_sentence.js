#!/usr/bin/env node
'use strict';
const TERMINAL = /[.!?。！？][”’"']?\s*$/;
const DANGLING = /(?:\b(?:and|but|because|so|if|when|that|to)|[,;:，；：—-])\s*$/i;
function completeRange(hit, options = {}) {
  const cues = [hit.previous, hit.current || hit, hit.next].filter(Boolean);
  const currentIndex = hit.previous ? 1 : 0;
  let first = currentIndex, last = currentIndex;
  while (first > 0 && !TERMINAL.test(String(cues[first - 1].text || ''))) first--;
  while (last < cues.length - 1 && (!TERMINAL.test(String(cues[last].text || '')) || DANGLING.test(String(cues[last].text || '')))) last++;
  const startPad = Number(options.startPad ?? 0.45);
  const endPad = Number(options.endPad ?? 0.75);
  return { in: Math.max(0, Number(cues[first].start) - startPad), out: Number(cues[last].end) + endPad, cueStart: first, cueEnd: last, complete: TERMINAL.test(String(cues[last].text || '')) && !DANGLING.test(String(cues[last].text || '')) };
}
function assertComplete(hit, options) {
  const range = completeRange(hit, options);
  if (!range.complete) throw new Error('No complete sentence boundary found; fetch more subtitle context or use ASR/manual listening before render.');
  return range;
}
module.exports = { completeRange, assertComplete };
