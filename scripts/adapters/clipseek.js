#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const https = require('https');

const API_BASE = 'https://clip-seek-api.agilestudio.cn';
const CDN_BASE = 'https://cdn-clipseek.agilestudio.cn';

const TYPE_MAP = {
  video: 0,
  videos: 0,
  视频: 0,
  0: 0,
  photo: 1,
  photos: 1,
  image: 1,
  images: 1,
  picture: 1,
  照片: 1,
  图片: 1,
  1: 1,
  illustration: 2,
  illustrations: 2,
  vector: 2,
  插画: 2,
  矢量: 2,
  2: 2
};

function mediaTypeFromCode(type) {
  if (Number(type) === 0) return 'video';
  if (Number(type) === 1) return 'photo';
  if (Number(type) === 2) return 'illustration';
  return 'unknown';
}

function normalizeType(input) {
  if (input === undefined || input === null || input === '') return 0;
  const key = String(input).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TYPE_MAP, key)) return TYPE_MAP[key];
  throw new Error(`Unsupported ClipSeek type: ${input}. Use video, photo, illustration, 0, 1, or 2.`);
}

function signParams() {
  const params = {
    _platform: 'web-clipseek',
    _versioin: '0.1',
    _ts: Date.now() - 9999
  };
  const canonical = Object.keys(params)
    .sort()
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .map((key) => `${key}=${params[key]},`)
    .join('');
  return {
    params,
    signature: crypto.createHash('md5').update(canonical).digest('hex')
  };
}

function postJson(url, body, headers) {
  if (typeof fetch === 'function') {
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }).then(async (res) => {
      const text = await res.text();
      if (!res.ok) throw new Error(`ClipSeek request failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      return JSON.parse(text);
    });
  }

  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': payload.length
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`ClipSeek request failed: HTTP ${res.statusCode} ${text.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function inferProvider(linkUrl) {
  try {
    const host = new URL(linkUrl).hostname.replace(/^www\./, '');
    if (host.includes('pexels.com')) return 'pexels';
    if (host.includes('pixabay.com')) return 'pixabay';
    if (host.includes('unsplash.com')) return 'unsplash';
    if (host.includes('wikimedia.org') || host.includes('wikipedia.org')) return 'wikimedia';
    return host;
  } catch {
    return 'unknown';
  }
}

function cdnUrl(key) {
  if (!key) return null;
  if (String(key).startsWith('http')) return key;
  return `${CDN_BASE}${key}`;
}

function normalizeItem(item, typeCode, index, includeRaw = false) {
  const sourcePage = item.link_url || item.url || null;
  const provider = inferProvider(sourcePage);
  return {
    id: String(item.id ?? `${provider}-${index}`),
    source: 'clipseek',
    provider,
    mediaType: mediaTypeFromCode(typeCode),
    title: item.title || item.zh_title || '',
    sourcePage,
    thumbnail: cdnUrl(item.cover_key || item.pic_key),
    downloadMode: 'provider_source_page',
    licenseStatus: 'verify_at_provider',
    attribution: provider === 'unknown'
      ? 'Unknown provider; verify source page before publishing.'
      : `Verify and record license on ${provider} source page before publishing.`,
    ...(includeRaw ? { raw: item } : {})
  };
}

async function searchClipSeek(options) {
  const text = (options && options.text ? String(options.text) : '').trim();
  if (!text) throw new Error('ClipSeek search requires text.');
  const typeCode = normalizeType(options.type);
  const page = Math.max(1, Number(options.page || 1));
  const limit = options.limit ? Math.max(1, Number(options.limit)) : undefined;
  const { params, signature } = signParams();
  const url = `${API_BASE}/search?${new URLSearchParams(params).toString()}`;
  const payload = { text, type: typeCode, page };
  const response = await postJson(url, payload, {
    'Content-Type': 'application/json',
    'X-Signature': signature,
    'User-Agent': 'qiaomu-cut/0.1'
  });
  if (!response || response.code !== 0) {
    throw new Error(response && response.msg ? response.msg : 'ClipSeek request failed.');
  }
  const items = Array.isArray(response.data) ? response.data : [];
  const normalized = items.map((item, index) => normalizeItem(item, typeCode, index, Boolean(options.debug)));
  return limit ? normalized.slice(0, limit) : normalized;
}

module.exports = {
  searchClipSeek,
  normalizeType,
  mediaTypeFromCode,
  inferProvider,
  TYPE_MAP
};

if (require.main === module) {
  const [, , text, type = 'video'] = process.argv;
  searchClipSeek({ text, type }).then((items) => {
    process.stdout.write(JSON.stringify(items, null, 2) + '\n');
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
