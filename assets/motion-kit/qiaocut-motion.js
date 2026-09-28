/*
 * QiaoCut Motion Kit — pure-time helpers for code-drawn video scenes.
 *
 * Contract: every visual value is a pure function of time t (seconds).
 * No CSS transitions, timers, requestAnimationFrame state, Math.random or
 * values carried between frames. The renderer may seek to any t in any order.
 *
 * Works in the browser (window.QiaoCutMotion) and in Node (module.exports)
 * so the same math can be unit-tested.
 *
 * Copyright (c) 向阳乔木 — MIT
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QiaoCutMotion = api;
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, p) => a + (b - a) * p;
  const progress = (t, start, end) => (end <= start ? (t >= end ? 1 : 0) : clamp((t - start) / (end - start)));
  const mix = (a, b, p) => (Array.isArray(a) ? a.map((value, index) => lerp(value, b[index], p)) : lerp(a, b, p));

  // Deliberately no bounce/elastic easing: overshoot comes only from springs.
  const ease = {
    linear: (p) => p,
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outQuart: (p) => 1 - Math.pow(1 - p, 4),
    inOutQuart: (p) => (p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2),
    outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOutExpo: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
    inExpo: (p) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10))
  };

  function tween(t, start, end, from, to, easing = ease.inOutCubic) {
    return mix(from, to, easing(progress(t, start, end)));
  }

  /*
   * Closed-form damped spring. `response` is the undamped period in seconds
   * (Apple-style), `damping` is the damping ratio (1 = critical, <1 overshoot).
   * Returns position/velocity for an arbitrary start state at elapsed time dt.
   */
  function springState(dt, from, to, velocity = 0, options = {}) {
    const response = Math.max(0.01, options.response == null ? 0.45 : options.response);
    const zeta = Math.max(0.05, options.damping == null ? 0.86 : options.damping);
    if (dt <= 0) return { value: from, velocity };
    const w0 = (2 * Math.PI) / response;
    const x0 = from - to;
    const v0 = velocity;
    let x;
    let v;
    if (Math.abs(zeta - 1) < 1e-6) {
      const e = Math.exp(-w0 * dt);
      const b = v0 + w0 * x0;
      x = (x0 + b * dt) * e;
      v = (b - w0 * (x0 + b * dt)) * e;
    } else if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      const e = Math.exp(-zeta * w0 * dt);
      const a = x0;
      const b = (v0 + zeta * w0 * x0) / wd;
      const cos = Math.cos(wd * dt);
      const sin = Math.sin(wd * dt);
      x = e * (a * cos + b * sin);
      v = e * ((b * wd - zeta * w0 * a) * cos - (a * wd + zeta * w0 * b) * sin);
    } else {
      const s = w0 * Math.sqrt(zeta * zeta - 1);
      const r1 = -zeta * w0 + s;
      const r2 = -zeta * w0 - s;
      const c2 = (v0 - r1 * x0) / (r2 - r1);
      const c1 = x0 - c2;
      x = c1 * Math.exp(r1 * dt) + c2 * Math.exp(r2 * dt);
      v = c1 * r1 * Math.exp(r1 * dt) + c2 * r2 * Math.exp(r2 * dt);
    }
    return { value: to + x, velocity: v };
  }

  // Unit step response 0 → 1.
  function spring(dt, options) {
    return springState(dt, 0, 1, 0, options).value;
  }

  /*
   * A value whose target changes many times. keys = [{ t, value }] sorted by t.
   * The result is the sum of one spring per change (superposition of a linear
   * system), so it stays an exact pure function of time.
   */
  function springTrack(t, keys, options) {
    if (!keys || !keys.length) return 0;
    let value = keys[0].value;
    for (let index = 1; index < keys.length; index += 1) {
      const key = keys[index];
      if (t <= key.t) break;
      value += (key.value - keys[index - 1].value) * spring(t - key.t, key.spring || options);
    }
    return value;
  }

  // Settling time until |error| < tolerance of the jump (useful for timing budgets).
  function settleTime(options, tolerance = 0.01) {
    for (let dt = 0; dt < 10; dt += 1 / 240) {
      let settled = true;
      for (let probe = dt; probe < dt + 0.25; probe += 1 / 240) {
        if (Math.abs(1 - spring(probe, options)) > tolerance) { settled = false; break; }
      }
      if (settled) return dt;
    }
    return 10;
  }

  /*
   * Direct manipulation: while held, value follows the pointer function; after
   * release it springs back from the exact position and velocity it had.
   */
  function dragRelease(t, holdStart, releaseAt, pointer, restValue, options) {
    if (t < holdStart) return restValue;
    if (t <= releaseAt) return pointer(t);
    const h = 1 / 240;
    const from = pointer(releaseAt);
    const velocity = (pointer(releaseAt) - pointer(releaseAt - h)) / h;
    return springState(t - releaseAt, from, restValue, velocity, options).value;
  }

  // Stateless deterministic noise: same (index, seed) always gives the same value.
  function random(index, seed = 1) {
    let x = (Math.imul(index | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  function stagger(t, start, each, count, duration, easing = ease.outCubic) {
    const values = [];
    for (let index = 0; index < count; index += 1) values.push(easing(progress(t, start + index * each, start + index * each + duration)));
    return values;
  }

  // Beat grid helpers. grid = { bpm, firstBeat, beats: [seconds...] } from qcut audio beats.
  function beatGrid(bpm, firstBeat = 0) {
    const period = 60 / bpm;
    return {
      bpm,
      period,
      firstBeat,
      beat: (n) => firstBeat + n * period,
      bar: (n, beatsPerBar = 4) => firstBeat + n * beatsPerBar * period,
      index: (t) => Math.floor((t - firstBeat) / period + 1e-9),
      phase: (t) => {
        const raw = (t - firstBeat) / period;
        return raw - Math.floor(raw);
      }
    };
  }

  // Short swap blur for content changing inside a morphing container.
  function swap(t, at, duration = 0.18) {
    const p = progress(t, at - duration / 2, at + duration / 2);
    return {
      outgoing: 1 - ease.outCubic(clamp(p * 2)),
      incoming: ease.outCubic(clamp(p * 2 - 1)),
      blur: Math.sin(Math.PI * p) * 8
    };
  }

  /*
   * Register the scene. seek(t) may return a Promise (e.g. awaiting image decodes).
   * In capture, QiaoCut calls window.__QIAOCUT_SET_TIME__(ms). In a normal browser
   * tab the scene plays in real time for preview (add ?t=2.5 to freeze a frame).
   */
  function register(seek, options = {}) {
    if (typeof window === 'undefined') return seek;
    const duration = options.duration || 10;
    window.__QIAOCUT_SET_TIME__ = (ms) => seek(ms / 1000);
    window.__QIAOCUT_DURATION__ = duration;
    const params = new URLSearchParams(window.location.search);
    const captured = navigator.webdriver === true;
    if (captured) return seek;
    if (params.has('t')) {
      seek(Number(params.get('t')) || 0);
      return seek;
    }
    const startedAt = performance.now();
    const loop = () => {
      const elapsed = ((performance.now() - startedAt) / 1000) % duration;
      Promise.resolve(seek(elapsed)).then(() => requestAnimationFrame(loop));
    };
    requestAnimationFrame(loop);
    return seek;
  }

  // Real footage as a JPEG sequence (ffmpeg -vf fps=30 clip/%04d.jpg). at(t) awaits decode.
  function imageSequence(img, pattern, count, fps = 30) {
    let current = null;
    return {
      at(t) {
        const index = clamp(Math.floor(t * fps), 0, count - 1) + 1;
        const src = pattern.replace(/%0?(\d*)d/, (_, width) => String(index).padStart(Number(width) || 0, '0'));
        if (src === current) return Promise.resolve();
        current = src;
        img.src = src;
        return img.decode().catch(() => {});
      }
    };
  }

  return {
    clamp, lerp, mix, progress, ease, tween,
    spring, springState, springTrack, settleTime, dragRelease,
    random, stagger, beatGrid, swap, register, imageSequence
  };
}));
