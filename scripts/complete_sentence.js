#!/usr/bin/env node
'use strict';
const TERMINAL = /[.!?。！？][”’"']?\s*$/;
const DANGLING = /(?:\b(?:and|but|because|so|if|when|that|to)|[,;:，；：—-])\s*$/i;
const LEADING_PUNCTUATION = /^(?:\.{2,}|…|[,;:，；：—-])/;

function cueText(cue) {
  return String((cue && (cue.text ?? cue.content)) || '').trim();
}

function leadingFragment(cue) {
  const text = cueText(cue).replace(/^[“”"'‘’\s]+/, '');
  if (!text) return true;
  // Subtitle providers commonly preserve lowercase when a cue starts inside a
  // sentence. This caught real paid-cut failures such as "that says...",
  // "when we do it again" and "taking a shower..." before remote creation.
  return LEADING_PUNCTUATION.test(text) || /^[a-z]/.test(text);
}

function cueSequence(hit) {
  const before = Array.isArray(hit.before) ? hit.before : [];
  const after = Array.isArray(hit.after) ? hit.after : [];
  const cues = [...before];
  if (hit.previous) cues.push(hit.previous);
  const currentIndex = cues.length;
  cues.push(hit.current || hit);
  if (hit.next) cues.push(hit.next);
  cues.push(...after);
  return { cues: cues.filter(Boolean), currentIndex };
}

function completeRange(hit, options = {}) {
  const cues = [hit.previous, hit.current || hit, hit.next].filter(Boolean);
  const currentIndex = hit.previous ? 1 : 0;
  let first = currentIndex, last = currentIndex;
  while (first > 0 && !TERMINAL.test(cueText(cues[first - 1]))) first--;
  while (last < cues.length - 1 && (!TERMINAL.test(cueText(cues[last])) || DANGLING.test(cueText(cues[last])))) last++;
  const startPad = Number(options.startPad ?? 0.45);
  const endPad = Number(options.endPad ?? 0.75);
  return { in: Math.max(0, Number(cues[first].start) - startPad), out: Number(cues[last].end) + endPad, cueStart: first, cueEnd: last, complete: TERMINAL.test(cueText(cues[last])) && !DANGLING.test(cueText(cues[last])) };
}

function completeContextRange(hit, options = {}) {
  const { cues, currentIndex } = cueSequence(hit);
  const contextBefore = Math.max(0, Math.round(Number(options.contextBefore ?? 1)));
  const contextAfter = Math.max(0, Math.round(Number(options.contextAfter ?? 0)));
  let first = Math.max(0, currentIndex - contextBefore);
  let last = Math.min(cues.length - 1, currentIndex + contextAfter);

  while (first > 0 && leadingFragment(cues[first])) first--;
  while (last < cues.length - 1 && (!TERMINAL.test(cueText(cues[last])) || DANGLING.test(cueText(cues[last])))) last++;

  const selectedContext = first < currentIndex;
  const needsMoreBefore = selectedContext && first === 0 && leadingFragment(cues[first]);
  const needsMoreAfter = !TERMINAL.test(cueText(cues[last])) || DANGLING.test(cueText(cues[last]));
  const startPad = Number(options.startPad ?? 0.45);
  const endPad = Number(options.endPad ?? 0.75);
  return {
    in: Math.max(0, Number(cues[first].start) - startPad),
    out: Number(cues[last].end) + endPad,
    cueStart: first,
    cueEnd: last,
    complete: !needsMoreBefore && !needsMoreAfter,
    needsMoreBefore,
    needsMoreAfter,
    selectedText: cues.slice(first, last + 1).map(cueText)
  };
}

function assertComplete(hit, options) {
  const range = completeRange(hit, options);
  if (!range.complete) throw new Error('No complete sentence boundary found; fetch more subtitle context or use ASR/manual listening before render.');
  return range;
}

function assertCompleteContext(hit, options) {
  const range = completeContextRange(hit, options);
  if (range.needsMoreBefore) {
    throw new Error('Selected setup cue begins inside a sentence; fetch more subtitle context before creating a paid cut task.');
  }
  if (range.needsMoreAfter) {
    throw new Error('No complete sentence ending found; fetch more subtitle context or use ASR/manual listening before creating a paid cut task.');
  }
  return range;
}

module.exports = { completeRange, completeContextRange, assertComplete, assertCompleteContext, leadingFragment };
