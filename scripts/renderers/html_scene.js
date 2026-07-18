'use strict';

const fs = require('fs');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateHtmlScene(scene, options = {}) {
  const title = scene && scene.text ? scene.text.content : options.title || 'QiaoCut Scene';
  const visual = scene && scene.visual ? scene.visual : options.visual || '';
  const aspectInput = String(options.aspect || '16 / 9').trim();
  if (!/^\d+(?:\.\d+)?\s*(?:\/|:)\s*\d+(?:\.\d+)?$/.test(aspectInput)) {
    throw new Error('aspect must be a numeric ratio such as 16/9 or 9:16.');
  }
  const aspect = aspectInput.replace(':', '/');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #09090b;
      --fg: #f8fafc;
      --muted: #c4b5fd;
      --accent: #facc15;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at 20% 20%, #312e81 0, transparent 32%),
                  radial-gradient(circle at 85% 75%, #7e22ce 0, transparent 30%),
                  var(--bg);
      font-family: Inter, "SF Pro Display", "PingFang SC", "Noto Sans CJK SC", sans-serif;
    }
    .stage {
      width: min(92vw, 1280px);
      aspect-ratio: ${aspect};
      position: relative;
      overflow: hidden;
      border-radius: 34px;
      padding: 7%;
      background: linear-gradient(135deg, rgba(255,255,255,.14), rgba(255,255,255,.04));
      box-shadow: 0 30px 80px rgba(0,0,0,.45);
      isolation: isolate;
    }
    .stage::before {
      content: "";
      position: absolute;
      inset: -20%;
      background: conic-gradient(from 120deg, transparent, rgba(250,204,21,.16), transparent, rgba(56,189,248,.14), transparent);
      animation: drift 12s linear infinite;
      z-index: -1;
    }
    .kicker {
      color: var(--muted);
      font-size: clamp(18px, 2.2vw, 34px);
      letter-spacing: .16em;
      text-transform: uppercase;
      margin-bottom: 3vh;
    }
    h1 {
      margin: 0;
      color: var(--fg);
      font-size: clamp(44px, 8vw, 120px);
      line-height: .94;
      letter-spacing: -.06em;
      text-wrap: balance;
    }
    p {
      position: absolute;
      left: 7%;
      right: 7%;
      bottom: 7%;
      margin: 0;
      color: rgba(248,250,252,.76);
      font-size: clamp(18px, 2.1vw, 32px);
      line-height: 1.35;
    }
    .accent { color: var(--accent); }
    @keyframes drift {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <main class="stage">
    <div class="kicker">${escapeHtml(scene && scene.purpose ? scene.purpose : 'qiaomu-cut')}</div>
    <h1>${escapeHtml(title).replace(/ /g, ' <span class="accent">·</span> ')}</h1>
    <p>${escapeHtml(visual)}</p>
  </main>
</body>
</html>
`;
}

function sceneFromIr(file, sceneId) {
  const ir = JSON.parse(fs.readFileSync(file, 'utf8'));
  const scenes = ir.scenes || [];
  if (!sceneId) return scenes[0];
  return scenes.find((scene) => scene.id === sceneId) || scenes[Number(sceneId) - 1];
}

module.exports = {
  generateHtmlScene,
  sceneFromIr
};

if (require.main === module) {
  const input = process.argv[2];
  const output = process.argv[3];
  const sceneId = process.argv[4];
  if (!input || !output) {
    console.error('Usage: html_scene.js qiaocut-ir.json scene.html [scene-id]');
    process.exit(2);
  }
  const scene = sceneFromIr(input, sceneId);
  if (!scene) {
    console.error('Scene not found.');
    process.exit(1);
  }
  fs.writeFileSync(output, generateHtmlScene(scene));
  console.log(output);
}
