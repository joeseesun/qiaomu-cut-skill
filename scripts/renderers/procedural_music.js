#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BITS = 16;

function finite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function midiFrequency(midi) {
  return 440 * (2 ** ((midi - 69) / 12));
}

function wavHeader(samplesPerChannel) {
  const dataBytes = samplesPerChannel * CHANNELS * (BITS / 8);
  if (dataBytes > 0xffffffff - 36) {
    throw new Error('Procedural WAV exceeds the RIFF/WAV 4 GiB size limit.');
  }
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS / 8), 28);
  buffer.writeUInt16LE(CHANNELS * (BITS / 8), 32);
  buffer.writeUInt16LE(BITS, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function seededNoise(seed) {
  let state = Math.trunc(finite(seed, 1337)) >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

function normalizeMarkers(markers, duration) {
  return [...new Set((markers || [])
    .map((value) => finite(value, NaN))
    .filter((value) => Number.isFinite(value) && value >= 0 && value < duration)
    .map((value) => Math.round(value * 1000) / 1000))]
    .sort((a, b) => a - b);
}

function createScore(options = {}) {
  const duration = finite(options.duration, 60);
  if (!(duration > 0)) throw new Error('Procedural music duration must be greater than zero.');
  const bpm = clamp(finite(options.bpm, 88), 40, 180);
  const energy = clamp(finite(options.energy, 0.58), 0, 1);
  const volume = clamp(finite(options.volume, 0.82), 0, 1.5);
  const rootMidi = clamp(Math.round(finite(options.rootMidi, 50)), 24, 72);
  const seed = Math.trunc(finite(options.seed, 1337));
  const totalSamples = Math.round(duration * SAMPLE_RATE);
  const progression = Array.isArray(options.progression) && options.progression.length
    ? options.progression.map((value) => Math.round(finite(value, 0))).slice(0, 8)
    : [0, -3, -5, -2];
  const transitions = normalizeMarkers(options.transitions, duration);
  const chordSeconds = clamp(finite(options.chordSeconds, 8), 2, 24);

  return {
    bpm,
    chordSeconds,
    duration,
    energy,
    progression,
    rootMidi,
    seed,
    totalSamples,
    transitions,
    volume
  };
}

function synthesizeChunk(score, startSample, count, state) {
  const pcm = Buffer.alloc(count * CHANNELS * 2);
  const beatSeconds = 60 / score.bpm;
  const eighth = beatSeconds / 2;
  const kickLevel = 0.045 + score.energy * 0.075;
  const arpLevel = 0.012 + score.energy * 0.03;
  const padLevel = 0.045 + score.energy * 0.045;
  const bassLevel = 0.025 + score.energy * 0.045;

  for (let local = 0; local < count; local += 1) {
    const sampleIndex = startSample + local;
    const t = sampleIndex / SAMPLE_RATE;
    const chordIndex = Math.floor(t / score.chordSeconds) % score.progression.length;
    const root = score.rootMidi + score.progression[chordIndex];
    const chord = [root, root + 3, root + 7].map(midiFrequency);
    const sectionPhase = (t % score.chordSeconds) / score.chordSeconds;
    const padEnvelope = Math.min(1, sectionPhase * 5) * Math.min(1, (1 - sectionPhase) * 5);
    const pad = chord.reduce((sum, frequency, noteIndex) => {
      const detune = noteIndex === 1 ? 1.003 : noteIndex === 2 ? 0.997 : 1;
      return sum + Math.sin(2 * Math.PI * frequency * detune * t + noteIndex * 0.7);
    }, 0) / chord.length * padLevel * padEnvelope;

    const rootFrequency = midiFrequency(root - 12);
    const bass = Math.sin(2 * Math.PI * rootFrequency * t) * bassLevel;
    const beatPhase = t % beatSeconds;
    const kickEnvelope = Math.exp(-beatPhase * 16);
    const kickFrequency = 48 + 32 * Math.exp(-beatPhase * 22);
    const kick = Math.sin(2 * Math.PI * kickFrequency * beatPhase) * kickEnvelope * kickLevel;

    const step = Math.floor(t / eighth);
    const arpFrequency = chord[step % chord.length] * 2;
    const arpPhase = t % eighth;
    const arp = Math.sin(2 * Math.PI * arpFrequency * t) * Math.exp(-arpPhase * 9) * arpLevel;

    state.lowNoise = state.lowNoise * 0.986 + state.noise() * 0.014;
    let impact = 0;
    for (const marker of score.transitions) {
      const delta = t - marker;
      if (delta >= 0 && delta < 0.32) {
        impact += state.lowNoise * Math.exp(-delta * 13) * (0.06 + score.energy * 0.08);
        impact += Math.sin(2 * Math.PI * 42 * delta) * Math.exp(-delta * 18) * (0.055 + score.energy * 0.065);
      }
    }

    const openingFade = Math.min(1, t / 0.4);
    const closingFade = Math.min(1, (score.duration - t) / 1.2);
    const fade = Math.max(0, Math.min(openingFade, closingFade));
    const base = (pad + bass + kick + impact) * fade * score.volume;
    const pan = 0.5 + 0.34 * Math.sin(step * 1.7);
    const left = Math.tanh(base + arp * (1 - pan) * score.volume);
    const right = Math.tanh(base + arp * pan * score.volume);
    pcm.writeInt16LE(Math.round(clamp(left, -1, 1) * 32700), local * 4);
    pcm.writeInt16LE(Math.round(clamp(right, -1, 1) * 32700), local * 4 + 2);
  }
  return pcm;
}

function generateProceduralMusic(output, options = {}) {
  const score = createScore(options);
  const absoluteOutput = path.resolve(output);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  const file = fs.openSync(absoluteOutput, 'w');
  const state = { noise: seededNoise(score.seed), lowNoise: 0 };
  const chunkSamples = 65536;
  try {
    fs.writeSync(file, wavHeader(score.totalSamples));
    for (let start = 0; start < score.totalSamples; start += chunkSamples) {
      const count = Math.min(chunkSamples, score.totalSamples - start);
      fs.writeSync(file, synthesizeChunk(score, start, count, state));
    }
  } finally {
    fs.closeSync(file);
  }
  return {
    file: absoluteOutput,
    duration: score.duration,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bpm: score.bpm,
    seed: score.seed,
    transitions: score.transitions
  };
}

function parseArgs(argv) {
  const result = { positional: [], options: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      result.positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}.`);
    result.options[key] = value;
    index += 1;
  }
  return result;
}

function main(argv = process.argv.slice(2)) {
  const { positional, options } = parseArgs(argv);
  const output = positional[0];
  if (!output) {
    process.stderr.write('Usage: procedural_music.js output.wav --duration 60 [--bpm 88] [--seed 1337]\n');
    process.exitCode = 2;
    return;
  }
  const report = generateProceduralMusic(output, {
    duration: options.duration,
    bpm: options.bpm,
    seed: options.seed,
    energy: options.energy,
    rootMidi: options['root-midi']
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = {
  CHANNELS,
  SAMPLE_RATE,
  createScore,
  generateProceduralMusic,
  midiFrequency,
  normalizeMarkers
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
