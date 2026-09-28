/* QiaoCut parameterized explainer components — Copyright (c) 向阳乔木 */
'use strict';

/* 纯函数运动学：Node 冒烟测试与浏览器运行时共用，不触碰 DOM。
   所有动效都由 __QIAOCUT_SET_TIME__(ms) 按帧驱动，保证渲染管线确定性。 */
const QiaoCutMotion = (() => {
  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const easeOutExpo = (t) => {
    const x = clamp01(t);
    return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
  };
  const easeOutBack = (t) => {
    const x = clamp01(t);
    const c = 1.70158;
    const u = x - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  };
  const smoothstep = (t) => {
    const x = clamp01(t);
    return x * x * (3 - 2 * x);
  };
  /** progress 落在 [start, end] 窗口内的 0..1 位置。 */
  const seg = (progress, start, end) => clamp01((clamp01(progress) - start) / Math.max(1e-6, end - start));

  /** 解析 payload.beats：归一化为按动作分组的进度表（0..1）。非法条目静默丢弃。 */
  function parseBeats(beats, durationMs) {
    const result = { activate: new Map(), swapAt: null, pulses: [] };
    const total = Math.max(1, Number(durationMs) || 1);
    if (!Array.isArray(beats)) return result;
    for (const beat of beats) {
      if (!beat || typeof beat !== 'object') continue;
      const at = Number(beat.at);
      if (!Number.isFinite(at) || at < 0) continue;
      const progress = clamp01((at * 1000) / total);
      const action = String(beat.action || '').trim();
      if (action === 'activate') {
        const key = beat.target != null ? String(beat.target) : '';
        if (key) result.activate.set(key, progress);
      } else if (action === 'swap') {
        if (result.swapAt == null) result.swapAt = progress;
      } else if (action === 'pulse') {
        result.pulses.push(progress);
      }
    }
    return result;
  }

  /** process 场景：第 index 步（共 count 步）的激活窗口。beats 可按步骤序号覆盖起点。 */
  function activationWindow(index, count, beatsActivate) {
    const total = Math.max(1, Number(count) || 1);
    const override = beatsActivate && typeof beatsActivate.get === 'function'
      ? beatsActivate.get(String(index))
      : undefined;
    const start = override != null ? clamp01(override) : 0.15 + (0.72 * index) / total;
    const span = override != null ? 0.08 : Math.min(0.14, 0.72 / total);
    return { start, span };
  }

  /** state 场景：from→to 变形窗口。 */
  function swapWindow(swapAt) {
    const start = swapAt != null ? clamp01(swapAt) : 0.45;
    return { start, end: Math.min(0.95, start + 0.2) };
  }

  /** pulse beats 对当前 progress 的增量（0..1），用于旁白重音点的额外脉冲。 */
  function pulseBoost(progress, pulses) {
    let boost = 0;
    for (const p of pulses || []) {
      boost = Math.max(boost, clamp01(1 - Math.abs(clamp01(progress) - p) / 0.06));
    }
    return boost;
  }

  /** snap 落位后的磁吸衰减微振：postMs 为动作完成后的毫秒数，返回 -1..1 的衰减振荡。 */
  function settle(postMs) {
    const t = Number(postMs) || 0;
    if (t <= 0 || t > 700) return 0;
    return Math.sin(t / 45) * Math.exp(-t / 90);
  }

  return { clamp01, easeOutExpo, easeOutBack, smoothstep, seg, parseBeats, activationWindow, swapWindow, pulseBoost, settle };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QiaoCutMotion;

if (typeof window !== 'undefined' && typeof document !== 'undefined') (() => {
  const M = QiaoCutMotion;
  const data = window.__QIAOCUT_SCENE__ || {};
  const root = document.querySelector('[data-qiaocut-component]');
  if (!root) return;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const items = Array.isArray(data.items) ? data.items : [];
  const durationMs = Math.max(1, Number(data.durationMs || 4000));
  const parseItem = (value, index = 0) => {
    const parts = String(value == null ? '' : value).split('|').map((part) => part.trim());
    const numeric = Number(String(parts[1] || '').replace(/[^\d.]+/g, ''));
    return {
      label: parts[0] || `项目 ${index + 1}`,
      value: Number.isFinite(numeric) ? numeric : Math.max(12, 78 - index * 14),
      meta: parts[1] || '',
      status: String(parts[2] || parts[1] || '').toLowerCase()
    };
  };
  let componentAnimate = null;

  const header = make('header', 'component-header reveal');
  header.append(make('div', 'eyebrow', data.eyebrow || '概念科普'));
  const title = make('h1', 'title component-title', data.title || data.keyword || '概念');
  title.id = 'focus-title';
  header.append(title);
  root.append(header);

  // stage 入场由 SET_TIME 逐帧驱动，不用 CSS .reveal（动画会盖过内联样式）。
  const stage = make('section', `component-stage component-${data.component || 'definition'}`);
  stage.id = 'focus-stage';
  const card = (label, value, tone = '', focusId = '') => {
    const node = make('article', `component-card card ${tone}`.trim());
    if (focusId) node.id = focusId;
    node.append(make('span', 'component-label', label));
    node.append(make('strong', 'component-value', value));
    return node;
  };
  /** 可绘制连接符：本体随进度生长，箭头头部延迟弹出；替代静态 → ↓ VS 字符。 */
  const connector = (orientation, glyph, focusId = '') => {
    const node = make('span', `connector connector-${orientation}`);
    if (focusId) node.id = focusId;
    node.dataset.connector = orientation;
    node.append(make('span', 'connector-body'));
    node.append(make('span', 'connector-head', glyph));
    return node;
  };

  switch (data.component) {
    case 'evidence-photo': {
      const figure = make('figure', 'evidence-photo-lab');
      figure.id = 'focus-photo';
      const image = make('img', 'evidence-photo-image');
      image.src = data.assetPath || '';
      image.alt = data.assetCredit || data.keyword || data.title || '来源图像';
      image.style.objectPosition = data.assetObjectPosition || 'center center';
      const shade = make('div', 'evidence-photo-shade');
      const annotation = make('figcaption', 'evidence-photo-caption');
      annotation.id = 'focus-caption';
      annotation.append(make('strong', '', data.keyword || data.body || '现场证据'));
      if (data.assetCredit || data.assetLicenseStatus) {
        const licenseLabels = { 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'public-domain': 'Public domain', 'official-permission': 'Official permission', 'user-provided': 'User provided', 'ai-generated': 'AI generated' };
        annotation.append(make('span', '', [data.assetCredit, licenseLabels[data.assetLicenseStatus] || data.assetLicenseStatus].filter(Boolean).join(' · ')));
      }
      figure.append(image, shade, annotation);
      stage.append(figure);
      componentAnimate = ({ progress }) => {
        const reveal = M.smoothstep(M.seg(progress, 0.05, 0.48));
        const settle = M.smoothstep(M.seg(progress, 0.42, 0.92));
        const motion = data.photoMotion || 'hold';
        image.style.transform = 'none';
        image.style.clipPath = 'none';
        image.style.opacity = '1';
        image.style.filter = `saturate(${(0.72 + 0.28 * reveal).toFixed(3)}) contrast(${(0.92 + 0.08 * reveal).toFixed(3)})`;
        if (motion === 'reveal-left') {
          image.style.clipPath = `inset(0 ${(100 * (1 - reveal)).toFixed(3)}% 0 0 round 30px)`;
        } else if (motion === 'reveal-right') {
          image.style.clipPath = `inset(0 0 0 ${(100 * (1 - reveal)).toFixed(3)}% round 30px)`;
        } else if (motion === 'pan-up') {
          image.style.objectPosition = `center ${(100 - 28 * settle).toFixed(3)}%`;
        } else if (motion === 'pan-down') {
          image.style.objectPosition = `center ${(18 + 28 * settle).toFixed(3)}%`;
        } else if (motion === 'rack-focus') {
          image.style.filter = `blur(${((1 - reveal) * 12).toFixed(3)}px) saturate(${(0.68 + 0.32 * reveal).toFixed(3)}) contrast(${(0.88 + 0.12 * reveal).toFixed(3)})`;
          image.style.opacity = String((0.62 + 0.38 * reveal).toFixed(4));
        }
        annotation.style.opacity = String(reveal.toFixed(4));
        annotation.style.transform = `translateY(${((1 - reveal) * 24).toFixed(2)}px)`;
        return { phase: settle > 0.7 ? 'evidence-held' : reveal > 0.5 ? 'evidence-revealed' : 'evidence-entering', motion };
      };
      break;
    }
    case 'timeline-story': {
      const lab = make('div', 'timeline-story-lab');
      lab.id = 'focus-timeline';
      const rail = make('div', 'timeline-story-rail');
      const progressLine = make('span', 'timeline-story-progress');
      rail.append(progressLine);
      const source = items.length ? items : ['1898|起点', '1912|更名', '2000|新阶段', '今天|持续生长'];
      const nodes = source.slice(0, 7).map((item, index) => {
        const parts = String(item).split('|').map((part) => part.trim());
        const node = make('article', 'timeline-story-node');
        node.dataset.index = String(index);
        node.append(make('strong', 'timeline-story-year', parts[0] || `T${index + 1}`));
        node.append(make('span', 'timeline-story-label', parts.slice(1).join(' · ') || '关键节点'));
        rail.append(node);
        return node;
      });
      const summary = make('p', 'timeline-story-summary', data.body || data.keyword || '时间把变化连成一条可读的路径');
      lab.append(rail, summary);
      stage.append(lab);
      componentAnimate = ({ progress }) => {
        const grow = M.smoothstep(M.seg(progress, 0.08, 0.82));
        progressLine.style.width = `${(grow * 100).toFixed(2)}%`;
        let active = 0;
        nodes.forEach((node, index) => {
          const local = M.easeOutBack(M.seg(progress, 0.12 + index * 0.09, 0.30 + index * 0.09));
          node.style.opacity = String(M.clamp01(local).toFixed(4));
          node.style.transform = `translateY(${((1 - M.clamp01(local)) * 34).toFixed(2)}px) scale(${(0.9 + 0.1 * local).toFixed(4)})`;
          node.classList.toggle('is-active', local > 0.85);
          if (local > 0.85) active += 1;
        });
        summary.style.opacity = String(M.smoothstep(M.seg(progress, 0.68, 0.94)).toFixed(4));
        return { phase: active === nodes.length ? 'timeline-complete' : 'timeline-growing', active, total: nodes.length };
      };
      break;
    }
    case 'relationship-map': {
      const lab = make('div', 'relationship-map-lab');
      lab.id = 'focus-network';
      const core = make('div', 'relationship-map-core', data.keyword || '核心问题');
      core.id = 'focus-core';
      lab.append(core);
      const source = items.length ? items : ['人文', '科学', '工程', '医学', '社会'];
      const nodes = source.slice(0, 7).map((item, index, list) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / list.length;
        const radiusX = 38;
        const radiusY = 36;
        const x = 50 + Math.cos(angle) * radiusX;
        const y = 50 + Math.sin(angle) * radiusY;
        const link = make('span', 'relationship-map-link');
        link.style.setProperty('--angle', `${(angle * 180 / Math.PI).toFixed(2)}deg`);
        link.style.setProperty('--length', '240px');
        lab.append(link);
        const node = make('span', 'relationship-map-node', parseItem(item, index).label);
        node.dataset.x = x.toFixed(4);
        node.dataset.y = y.toFixed(4);
        lab.append(node);
        return { node, link };
      });
      const sequence = make('div', 'relationship-map-sequence');
      sequence.id = 'focus-sequence';
      lab.append(sequence);
      stage.append(lab);
      componentAnimate = ({ progress }) => {
        const coreIn = M.easeOutBack(M.seg(progress, 0.05, 0.30));
        core.style.transform = `translate(-50%,-50%) scale(${(0.82 + 0.18 * coreIn).toFixed(4)})`;
        nodes.forEach(({ node, link }, index) => {
          const local = M.smoothstep(M.seg(progress, 0.18 + index * 0.065, 0.48 + index * 0.065));
          node.style.left = `${(50 + (Number(node.dataset.x) - 50) * local).toFixed(3)}%`;
          node.style.top = `${(50 + (Number(node.dataset.y) - 50) * local).toFixed(3)}%`;
          node.style.opacity = String(local.toFixed(4));
          link.style.transform = `rotate(${link.style.getPropertyValue('--angle')}) scaleX(${local.toFixed(4)})`;
          link.style.opacity = String((local * 0.7).toFixed(4));
        });
        const pulse = 1 + 0.035 * Math.sin(progress * Math.PI * 8) * M.smoothstep(M.seg(progress, 0.58, 0.9));
        core.style.scale = String(pulse.toFixed(4));
        return { phase: progress > 0.8 ? 'relationships-visible' : 'network-forming', nodes: nodes.length };
      };
      break;
    }
    case 'prediction-field': {
      const lab = make('div', 'prediction-lab');
      const prompt = make('div', 'prediction-prompt');
      prompt.id = 'focus-prompt';
      prompt.append(make('span', 'prediction-context', data.body || '大模型最先学会的是'));
      const blank = make('span', 'prediction-blank', '____');
      const answer = make('span', 'prediction-answer', data.keyword || '预测');
      blank.append(answer);
      prompt.append(blank);
      const candidates = make('div', 'prediction-candidates');
      candidates.id = 'focus-candidates';
      const candidateRows = (items.length ? items : ['模型|62', '世界|23', '答案|9']).slice(0, 5).map((item, index) => {
        const parsed = parseItem(item, index);
        const row = make('div', 'prediction-candidate');
        row.dataset.value = String(Math.max(4, Math.min(96, parsed.value)));
        row.append(make('span', 'candidate-token', parsed.label));
        const track = make('span', 'candidate-track');
        track.append(make('span', 'candidate-fill'));
        row.append(track);
        row.append(make('b', 'candidate-percent', `${Math.round(parsed.value)}%`));
        candidates.append(row);
        return row;
      });
      const winner = make('div', 'prediction-winner', data.keyword || parseItem(items[0] || '预测', 0).label);
      winner.id = 'focus-winner';
      lab.append(prompt, candidates, winner);
      stage.append(lab);
      componentAnimate = ({ progress }) => {
        const scan = M.smoothstep(M.seg(progress, 0.08, 0.52));
        candidateRows.forEach((row, index) => {
          const local = M.smoothstep(M.seg(progress, 0.10 + index * 0.055, 0.34 + index * 0.055));
          row.style.opacity = String((0.18 + 0.82 * local).toFixed(4));
          row.style.transform = `translateX(${((1 - local) * 70).toFixed(2)}px)`;
          row.querySelector('.candidate-fill').style.width = `${(Number(row.dataset.value) * scan).toFixed(2)}%`;
        });
        const choose = M.easeOutBack(M.seg(progress, 0.52, 0.76));
        winner.style.opacity = String(M.clamp01(choose).toFixed(4));
        winner.style.transform = `translateY(${((1 - M.clamp01(choose)) * 46).toFixed(2)}px) scale(${(0.88 + 0.12 * choose).toFixed(4)})`;
        answer.style.opacity = String(M.clamp01(choose).toFixed(4));
        answer.style.transform = `translateY(${((1 - M.clamp01(choose)) * 22).toFixed(2)}px)`;
        blank.classList.toggle('is-filled', choose > 0.7);
        return { phase: choose > 0.7 ? 'winner-selected' : scan > 0.5 ? 'probabilities-growing' : 'reading-context', winner: winner.textContent };
      };
      break;
    }
    case 'segmentation-flow': {
      const lab = make('div', 'segmentation-lab');
      const source = make('div', 'segmentation-source', data.body || '大模型正在学习语言');
      source.id = 'focus-source';
      const cutter = make('div', 'segmentation-cutter');
      const tokenRail = make('div', 'segmentation-tokens');
      tokenRail.id = 'focus-tokens';
      const tokenNodes = (items.length ? items : ['大', '模型', '正在', '学习', '语言']).slice(0, 8).map((item) => {
        const token = make('span', 'segmentation-token', parseItem(item).label);
        tokenRail.append(token);
        return token;
      });
      const embedding = make('div', 'embedding-grid');
      embedding.id = 'focus-embedding';
      const cells = Array.from({ length: 24 }, (_, index) => {
        const cell = make('span', 'embedding-cell');
        cell.dataset.index = String(index);
        embedding.append(cell);
        return cell;
      });
      lab.append(source, cutter, tokenRail, embedding);
      stage.append(lab);
      componentAnimate = ({ progress }) => {
        const cut = M.smoothstep(M.seg(progress, 0.10, 0.48));
        cutter.style.left = `${(5 + 90 * cut).toFixed(2)}%`;
        cutter.style.opacity = String((cut < 0.99 ? 0.9 : 0.18).toFixed(3));
        tokenNodes.forEach((token, index) => {
          const local = M.easeOutBack(M.seg(progress, 0.20 + index * 0.055, 0.42 + index * 0.055));
          token.style.opacity = String(M.clamp01(local).toFixed(4));
          token.style.transform = `translateY(${((1 - M.clamp01(local)) * -90).toFixed(2)}px) rotate(${((1 - M.clamp01(local)) * (index % 2 ? 5 : -5)).toFixed(2)}deg)`;
        });
        const encode = M.smoothstep(M.seg(progress, 0.58, 0.92));
        cells.forEach((cell, index) => {
          const wave = 0.35 + 0.65 * Math.sin(index * 1.73 + encode * Math.PI * 2) ** 2;
          cell.style.opacity = String((0.12 + 0.88 * encode * wave).toFixed(4));
          cell.style.transform = `scale(${(0.72 + 0.28 * encode * wave).toFixed(4)})`;
        });
        return { phase: encode > 0.7 ? 'encoded' : cut > 0.6 ? 'tokens-separated' : 'cutting', tokens: tokenNodes.length };
      };
      break;
    }
    case 'optimization-loop': {
      const lab = make('div', 'optimization-lab');
      const forward = make('div', 'optimization-forward');
      forward.id = 'focus-forward';
      const stepLabels = (items.length ? items : ['Token', 'Embedding', 'Transformer', 'Logits', '预测']).slice(0, 6).map((item) => parseItem(item).label);
      const forwardNodes = [];
      stepLabels.forEach((label, index) => {
        const node = make('span', 'optimization-node', label);
        forward.append(node);
        forwardNodes.push(node);
        if (index < stepLabels.length - 1) forward.append(make('span', 'optimization-link'));
      });
      const loss = make('div', 'optimization-loss');
      loss.id = 'focus-loss';
      loss.append(make('span', 'loss-label', '交叉熵 Loss'));
      const lossValue = make('strong', 'loss-value', '2.40');
      loss.append(lossValue);
      const gradient = make('div', 'optimization-gradient');
      gradient.id = 'focus-gradient';
      const gradientParticles = Array.from({ length: 7 }, (_, index) => {
        const particle = make('span', 'gradient-particle');
        particle.dataset.index = String(index);
        gradient.append(particle);
        return particle;
      });
      const weights = make('div', 'optimization-weights', data.keyword || '参数更新');
      weights.id = 'focus-weights';
      lab.append(forward, loss, gradient, weights);
      stage.append(lab);
      componentAnimate = ({ progress }) => {
        forwardNodes.forEach((node, index) => {
          const local = M.smoothstep(M.seg(progress, 0.06 + index * 0.055, 0.22 + index * 0.055));
          node.style.opacity = String((0.18 + 0.82 * local).toFixed(4));
          node.style.transform = `scale(${(0.86 + 0.14 * local).toFixed(4)})`;
          node.classList.toggle('is-active', local > 0.72);
        });
        const error = M.smoothstep(M.seg(progress, 0.34, 0.52));
        loss.style.transform = `scale(${(0.9 + 0.1 * error).toFixed(4)})`;
        loss.classList.toggle('is-hot', error > 0.55 && progress < 0.82);
        const back = M.smoothstep(M.seg(progress, 0.50, 0.88));
        gradientParticles.forEach((particle, index) => {
          const phase = (back * 1.35 + index / gradientParticles.length) % 1;
          particle.style.left = `${(96 - phase * 92).toFixed(2)}%`;
          particle.style.opacity = String((back * (0.35 + 0.65 * Math.sin(phase * Math.PI))).toFixed(4));
        });
        const settle = M.smoothstep(M.seg(progress, 0.78, 0.96));
        lossValue.textContent = (2.4 - settle * 1.96).toFixed(2);
        weights.style.opacity = String((0.2 + 0.8 * back).toFixed(4));
        weights.style.transform = `scale(${(0.92 + 0.08 * M.easeOutBack(back)).toFixed(4)})`;
        return { phase: settle > 0.7 ? 'loss-reduced' : back > 0.45 ? 'gradient-returning' : error > 0.5 ? 'loss-computed' : 'forward-pass', loss: lossValue.textContent };
      };
      break;
    }
    case 'filter-conveyor': {
      const lab = make('div', 'refinery-lab');
      const input = make('div', 'refinery-input', data.leftLabel || '混杂语料');
      input.id = 'focus-input';
      const belt = make('div', 'refinery-belt');
      const documents = (items.length ? items : ['优质文本|keep', '重复网页|drop', '垃圾内容|drop', '代码文档|keep', '多语言|keep']).slice(0, 7).map((item, index) => {
        const parsed = parseItem(item, index);
        const doc = make('span', 'refinery-document', parsed.label);
        doc.dataset.status = /drop|reject|删|丢/.test(parsed.status) ? 'drop' : 'keep';
        doc.dataset.index = String(index);
        belt.append(doc);
        return doc;
      });
      const gates = make('div', 'refinery-gates');
      gates.id = 'focus-gates';
      ['去重', '过滤', '配比'].forEach((label) => gates.append(make('span', 'refinery-gate', label)));
      const clean = make('div', 'refinery-clean');
      clean.id = 'focus-clean';
      clean.append(make('span', 'clean-label', data.rightLabel || '可训练数据'));
      const cleanCount = make('strong', 'clean-count', '0');
      clean.append(cleanCount);
      lab.append(input, belt, gates, clean);
      stage.append(lab);
      componentAnimate = ({ progress }) => {
        let kept = 0;
        documents.forEach((doc, index) => {
          const local = M.seg(progress, index * 0.075, 0.52 + index * 0.075);
          const x = 3 + local * 90;
          const dropped = doc.dataset.status === 'drop' && x > 56;
          doc.style.left = `${x.toFixed(2)}%`;
          doc.style.opacity = String((local < 1 ? 1 : 0.2).toFixed(3));
          doc.style.transform = `translate(-50%, ${dropped ? ((x - 56) * 5).toFixed(1) : '0'}px) rotate(${dropped ? '12' : '0'}deg)`;
          doc.classList.toggle('is-rejected', dropped);
          if (doc.dataset.status === 'keep' && local > 0.82) kept += 1;
        });
        const gateProgress = M.smoothstep(M.seg(progress, 0.25, 0.78));
        [...gates.children].forEach((gate, index) => {
          const local = M.seg(gateProgress, index / 3, (index + 1) / 3);
          gate.classList.toggle('is-active', local > 0.4);
        });
        cleanCount.textContent = String(kept);
        clean.style.transform = `scale(${(0.94 + 0.06 * M.smoothstep(M.seg(progress, 0.62, 0.92))).toFixed(4)})`;
        return { phase: progress > 0.82 ? 'clean-corpus-ready' : 'filtering', kept, total: documents.length };
      };
      break;
    }
    case 'balance-system': {
      const lab = make('div', 'balance-lab');
      const balance = make('div', 'balance-orbit');
      balance.id = 'focus-balance';
      const balanceItems = (items.length ? items : ['参数|70', '数据|86', '算力|78']).slice(0, 3).map((item, index) => parseItem(item, index));
      const ids = ['focus-params', 'focus-data', 'focus-compute'];
      const nodes = balanceItems.map((item, index) => {
        const node = make('div', `balance-node balance-node-${index + 1}`);
        node.id = ids[index];
        node.append(make('span', 'balance-label', item.label));
        node.append(make('strong', 'balance-value', item.meta || String(Math.round(item.value))));
        balance.append(node);
        return node;
      });
      const core = make('div', 'balance-core', data.keyword || '计算最优区');
      balance.append(core);
      const beam = make('div', 'balance-beam');
      const needle = make('span', 'balance-needle');
      beam.append(needle);
      lab.append(balance, beam);
      stage.append(lab);
      componentAnimate = ({ progress }) => {
        const settle = M.smoothstep(M.seg(progress, 0.18, 0.86));
        const wobble = (1 - settle) * Math.sin(progress * Math.PI * 8) * 16;
        balance.style.transform = `rotate(${wobble.toFixed(2)}deg)`;
        needle.style.transform = `rotate(${(-24 + 24 * settle + wobble * 0.3).toFixed(2)}deg)`;
        nodes.forEach((node, index) => {
          const pulse = 1 + 0.04 * Math.sin(progress * Math.PI * 6 + index * 2.1) * (0.3 + 0.7 * settle);
          node.style.transform = `scale(${pulse.toFixed(4)})`;
          node.classList.toggle('is-balanced', settle > 0.78);
        });
        core.style.opacity = String((0.2 + 0.8 * settle).toFixed(4));
        core.style.transform = `translate(-50%, -50%) scale(${(0.84 + 0.16 * settle).toFixed(4)})`;
        return { phase: settle > 0.82 ? 'balanced' : 'seeking-balance', balance: settle };
      };
      break;
    }
    case 'state-morph': {
      const lab = make('div', 'morph-lab');
      const before = make('div', 'morph-panel morph-before');
      before.id = 'focus-before';
      before.append(make('span', 'morph-label', data.leftLabel || '训练之前'));
      const beforeValue = make('strong', 'morph-value', data.leftValue || '随机噪声');
      before.append(beforeValue);
      const transition = make('div', 'morph-transition');
      transition.id = 'focus-transition';
      Array.from({ length: 12 }, (_, index) => {
        const dot = make('span', 'morph-particle');
        dot.dataset.index = String(index);
        transition.append(dot);
      });
      const after = make('div', 'morph-panel morph-after');
      after.id = 'focus-after';
      after.append(make('span', 'morph-label', data.rightLabel || '训练之后'));
      const afterValue = make('strong', 'morph-value', data.rightValue || data.keyword || '连贯续写');
      after.append(afterValue);
      lab.append(before, transition, after);
      stage.append(lab);
      componentAnimate = ({ progress }) => {
        const morph = M.smoothstep(M.seg(progress, 0.22, 0.82));
        before.style.opacity = String((1 - 0.78 * morph).toFixed(4));
        beforeValue.style.letterSpacing = `${(morph * 0.35).toFixed(3)}em`;
        [...transition.children].forEach((dot, index) => {
          const phase = (morph * 1.25 + index / 12) % 1;
          dot.style.left = `${(phase * 100).toFixed(2)}%`;
          dot.style.top = `${(50 + Math.sin(index * 1.7 + progress * 9) * 32).toFixed(2)}%`;
          dot.style.opacity = String((0.2 + 0.8 * morph * Math.sin(phase * Math.PI)).toFixed(4));
        });
        after.style.opacity = String((0.12 + 0.88 * morph).toFixed(4));
        afterValue.style.clipPath = `inset(0 ${(100 - morph * 100).toFixed(2)}% 0 0)`;
        after.style.transform = `translateX(${((1 - morph) * 36).toFixed(2)}px)`;
        return { phase: morph > 0.8 ? 'coherent-state' : 'morphing', progress: morph };
      };
      break;
    }
    case 'risk-dashboard': {
      const lab = make('div', 'risk-lab');
      lab.id = 'focus-risk';
      const risks = (items.length ? items : ['幻觉|72', '偏差|58', '训练成本|88']).slice(0, 3).map((item, index) => parseItem(item, index));
      const ids = ['focus-hallucination', 'focus-bias', 'focus-cost'];
      const gauges = risks.map((risk, index) => {
        const gauge = make('div', 'risk-gauge');
        gauge.id = ids[index];
        gauge.dataset.target = String(Math.max(1, Math.min(99, risk.value)));
        const dial = make('div', 'risk-dial');
        const number = make('strong', 'risk-number', '0');
        dial.append(number);
        gauge.append(dial, make('span', 'risk-label', risk.label));
        lab.append(gauge);
        return gauge;
      });
      const warning = make('div', 'risk-warning', data.keyword || '预训练 ≠ 对齐');
      lab.append(warning);
      stage.append(lab);
      componentAnimate = ({ progress }) => {
        const rise = M.smoothstep(M.seg(progress, 0.16, 0.76));
        gauges.forEach((gauge, index) => {
          const target = Number(gauge.dataset.target);
          const value = target * M.smoothstep(M.seg(rise, index * 0.12, 0.62 + index * 0.12));
          const dial = gauge.querySelector('.risk-dial');
          dial.style.background = `conic-gradient(var(--warning) ${(value * 3.6).toFixed(1)}deg, rgba(241,234,223,.08) 0deg)`;
          gauge.querySelector('.risk-number').textContent = `${Math.round(value)}`;
          gauge.style.transform = `translateY(${((1 - M.clamp01(rise * 1.5 - index * 0.12)) * 38).toFixed(2)}px)`;
        });
        const stamp = M.easeOutBack(M.seg(progress, 0.70, 0.92));
        warning.style.opacity = String(M.clamp01(stamp).toFixed(4));
        warning.style.transform = `rotate(-4deg) scale(${(0.78 + 0.22 * stamp).toFixed(4)})`;
        return { phase: stamp > 0.8 ? 'limits-stamped' : 'risks-rising', gauges: gauges.length };
      };
      break;
    }
    case 'teacher-student-transfer':
      stage.append(card(data.leftLabel || '教师模型', data.leftValue || '大模型', 'teacher-surface', 'focus-left'));
      stage.append(connector('horizontal', '→', 'focus-relationship'));
      stage.append(card(data.rightLabel || '学生模型', data.rightValue || '小模型', 'student-surface', 'focus-right'));
      break;
    case 'reward-loop': {
      const labels = items.length ? items : ['状态', '动作', '奖励', '更新策略'];
      const loop = make('div', 'reward-loop');
      loop.id = 'focus-sequence';
      labels.slice(0, 6).forEach((item, index) => loop.append(card(String(index + 1).padStart(2, '0'), item)));
      stage.append(loop);
      break;
    }
    case 'comparison':
      stage.append(card(data.leftLabel || '之前', data.leftValue || items[0] || '输入', '', 'focus-left'));
      stage.append(connector('pop', 'VS', 'focus-relationship'));
      stage.append(card(data.rightLabel || '之后', data.rightValue || items[1] || '输出', '', 'focus-right'));
      break;
    case 'pipeline': {
      const flow = make('div', 'component-pipeline');
      flow.id = 'focus-sequence';
      (items.length ? items : ['输入', '处理', '结果']).slice(0, 6).forEach((item, index, source) => {
        flow.append(card(String(index + 1).padStart(2, '0'), item));
        if (index < source.length - 1) flow.append(connector('vertical', '↓'));
      });
      stage.append(flow);
      break;
    }
    case 'benefit-risk':
      stage.append(card(data.leftLabel || '收益', data.leftValue || items[0] || '更高效率', 'student-surface', 'focus-left'));
      stage.append(card(data.rightLabel || '代价', data.rightValue || items[1] || '能力边界', 'warning-surface', 'focus-right'));
      break;
    case 'outro': {
      const brand = make('div', 'outro-brand', data.keyword || '向阳乔木');
      brand.id = 'focus-brand';
      stage.append(brand);
      stage.append(make('p', 'component-copy', data.body || '@vista8 · 关注我，继续拆解 AI 关键词'));
      break;
    }
    default: {
      const keyword = make('div', 'component-keyword', data.keyword || items[0] || '核心概念');
      keyword.id = 'focus-keyword';
      stage.append(keyword);
      if (data.body) stage.append(make('p', 'component-copy', data.body));
      if (items.length) {
        const chips = make('div', 'component-chips');
        chips.id = 'focus-sequence';
        items.slice(0, 8).forEach((item) => chips.append(make('span', 'component-chip', item)));
        stage.append(chips);
      }
    }
  }
  root.append(stage);
  // 页脚只放品牌。场景 ID、模板编号等调试标签禁止进入公开画面，
  // 它们保留在 window.__QIAOCUT_SCENE__ 和工程元数据里供审查使用。
  const footer = make('footer', 'footer');
  footer.append(make('span', '', '向阳乔木'));
  footer.append(make('span', 'footer-rule'));
  footer.append(make('span', '', '@vista8'));
  root.append(footer);

  const change = data.visibleChange && typeof data.visibleChange === 'object'
    ? data.visibleChange
    : { kind: 'none', from: '', to: '' };
  const focus = document.getElementById(String(data.primaryFocus || 'focus-stage'));
  root.dataset.cognitiveTask = String(data.cognitiveTask || '');
  root.dataset.primaryFocus = String(data.primaryFocus || 'focus-stage');
  root.dataset.visibleChangeKind = String(change.kind || 'none');
  root.dataset.visibleChangeFrom = String(change.from || '');
  root.dataset.visibleChangeTo = String(change.to || '');
  if (focus) focus.dataset.primaryFocus = 'true';

  const beats = M.parseBeats(data.beats, durationMs);
  const isProcess = change.kind === 'process';
  const isState = change.kind === 'state';

  // process 语义：序列节点（reward-loop 卡片、pipeline 卡片、chips）全程逐个激活。
  const sequence = stage.querySelector('#focus-sequence');
  const stepNodes = sequence
    ? [...sequence.children].filter((el) => el.classList.contains('component-card') || el.classList.contains('component-chip'))
    : [];
  const connectorNodes = [...stage.querySelectorAll('.connector')];

  // 聚光：焦点非整个 stage 且焦点在 stage 内时，其余舞台元素让位。
  const spotlight = Boolean(focus && focus.id !== 'focus-stage' && stage.contains(focus));
  const cssVars = getComputedStyle(document.documentElement);
  const accent = (cssVars.getPropertyValue('--student') || '').trim() || '#8fd3ff';
  const glowShadow = (alpha) => `0 0 0 3px color-mix(in srgb, ${accent} ${Math.round(M.clamp01(alpha) * 100)}%, transparent), 0 18px 60px rgba(0,0,0,0.30)`;

  // state 语义：焦点文本 from→to 变形；焦点无文本层（如连接符）时退化为左右高亮迁移。
  const findTextEl = (node) => {
    if (!node) return null;
    if (node.classList && ['component-value', 'component-keyword', 'outro-brand', 'component-chip'].some((c) => node.classList.contains(c))) return node;
    return node.querySelector ? node.querySelector('.component-value, .component-keyword, .outro-brand') : null;
  };
  let swapLayers = null;
  let swapMigration = null;
  let swapRing = null;
  if (isState) {
    const textHost = findTextEl(focus);
    if (textHost) {
      textHost.classList.add('state-swap');
      const fromLayer = make('span', 'state-from', String(change.from || textHost.textContent || ''));
      const toLayer = make('span', 'state-to', String(change.to || ''));
      textHost.textContent = '';
      textHost.append(fromLayer, toLayer);
      const hostCard = focus.classList.contains('component-card') ? focus : (focus.querySelector('.component-card') || focus);
      swapLayers = { from: fromLayer, to: toLayer, card: hostCard };
      hostCard.classList.add('swap-anchor');
      swapRing = make('span', 'swap-ring');
      hostCard.append(swapRing);
    } else {
      const left = document.getElementById('focus-left');
      const right = document.getElementById('focus-right');
      if (left && right) {
        swapMigration = { left, right };
        right.classList.add('swap-anchor');
        swapRing = make('span', 'swap-ring');
        right.append(swapRing);
      }
    }
  }
  const focusGroup = new Set();
  if (focus) focusGroup.add(focus);
  if (swapMigration) { focusGroup.add(swapMigration.left); focusGroup.add(swapMigration.right); }
  const dimmable = (el) => {
    if (!spotlight) return false;
    for (const node of focusGroup) {
      if (el === node || node.contains(el) || el.contains(node)) return false;
    }
    return true;
  };

  window.__QIAOCUT_SET_TIME__ = (milliseconds) => {
    const ms = Number(milliseconds || 0);
    const progress = M.clamp01(ms / durationMs);
    document.documentElement.style.setProperty('--scene-progress', progress.toFixed(5));

    // 舞台入场：前 1/3 用 easeOutExpo 浮入。
    const enter = M.easeOutExpo(M.seg(progress, 0, 0.33));
    stage.style.opacity = String(enter.toFixed(4));
    stage.style.transform = `translateY(${((1 - enter) * 34).toFixed(2)}px)`;

    // 聚光强度：入场完成后 0.30→0.45 渐入。
    const spot = spotlight ? M.smoothstep(M.seg(progress, 0.30, 0.45)) : 0;

    // 舞台直系子元素：入场可见度 × 让位压暗（嵌套步骤的激活在父级之上叠乘）。
    for (const el of stage.children) {
      const dim = dimmable(el) ? spot : 0;
      el.style.opacity = String((enter * (1 - 0.72 * dim)).toFixed(4));
      el.style.filter = dim > 0.01 ? `saturate(${(1 - 0.45 * dim).toFixed(3)})` : '';
    }

    // process：步骤在 0.15→0.87 全程逐个弹出激活，已激活保持点亮。
    let activeSteps = stepNodes.length;
    if (isProcess && stepNodes.length) {
      activeSteps = 0;
      stepNodes.forEach((node, index) => {
        const { start, span } = M.activationWindow(index, stepNodes.length, beats.activate);
        const local = M.seg(progress, start, start + span);
        const pop = M.easeOutBack(local);
        /* 磁吸 settle：激活完成后约 300ms 衰减微振，入格更"肉" */
        const postMs = (progress - (start + span)) * durationMs;
        const wobble = local >= 1 ? M.settle(postMs) : 0;
        node.style.opacity = String(M.clamp01(local * 1.4).toFixed(4));
        node.style.transform = `translateY(${((1 - M.clamp01(pop)) * 18 + wobble * 3).toFixed(2)}px) scale(${(0.94 + 0.06 * pop + wobble * 0.008).toFixed(4)})`;
        const active = local >= 1;
        node.classList.toggle('step-active', active);
        if (active) activeSteps += 1;
      });
    } else {
      stepNodes.forEach((node) => node.classList.remove('step-active'));
    }

    // 连接符：pipeline 内的跟随前序步骤生长，其余在入场期生长。
    for (const node of connectorNodes) {
      let grow;
      if (isProcess && sequence && node.parentElement === sequence) {
        let prevStep = 0;
        for (const sibling of sequence.children) {
          if (sibling === node) break;
          if (sibling.classList.contains('component-card') || sibling.classList.contains('component-chip')) prevStep += 1;
        }
        const { start, span } = M.activationWindow(Math.max(0, prevStep - 1), stepNodes.length, beats.activate);
        grow = M.seg(progress, start + span * 0.6, start + span + 0.1);
      } else {
        grow = M.seg(progress, 0.18, 0.40);
      }
      const body = node.querySelector('.connector-body');
      const head = node.querySelector('.connector-head');
      const axis = node.dataset.connector === 'vertical' ? 'scaleY' : 'scaleX';
      if (body) body.style.transform = `${axis}(${M.clamp01(grow).toFixed(4)})`;
      if (head) {
        head.style.transform = `scale(${M.easeOutBack(grow).toFixed(4)})`;
        head.style.opacity = String(M.clamp01(grow * 1.6).toFixed(4));
      }
    }

    // state：from→to 变形 + 一次性高亮环闪现。
    let swapValue = null;
    if (isState) {
      const { start, end } = M.swapWindow(beats.swapAt);
      const swap = M.smoothstep(M.seg(progress, start, end));
      swapValue = swap;
      if (swapLayers) {
        swapLayers.from.style.opacity = String((1 - swap).toFixed(4));
        swapLayers.from.style.transform = `translateY(${(-16 * swap).toFixed(2)}px)`;
        swapLayers.to.style.opacity = String(swap.toFixed(4));
        swapLayers.to.style.transform = `translateY(${(16 * (1 - swap)).toFixed(2)}px)`;
        swapLayers.card.classList.toggle('state-changed', swap > 0.5);
      } else if (swapMigration) {
        swapMigration.left.style.boxShadow = glowShadow(0.55 * (1 - swap) * Math.max(spot, enter));
        swapMigration.right.style.boxShadow = glowShadow(0.55 * swap);
        swapMigration.right.classList.toggle('state-changed', swap > 0.5);
      }
      if (swapRing) {
        const flash = M.seg(progress, start, Math.min(0.98, end + 0.18));
        swapRing.style.opacity = String((0.75 * (1 - flash)).toFixed(4));
        swapRing.style.transform = `scale(${(1 + 0.35 * flash).toFixed(4)})`;
      }
    }

    // 焦点强调与 ambient 微脉冲：全程活着，尾帧不死。
    // focus-sequence 不画矩形光晕圈（强调由步骤激活态承担），只保留轻微呼吸。
    if (focus && stage.contains(focus) && !swapMigration) {
      const isSequence = focus.id === 'focus-sequence';
      const isPhotoFocus = data.component === 'evidence-photo' && focus.id === 'focus-photo';
      const wave = Math.sin((ms / 4000) * Math.PI * 2);
      const boost = M.pulseBoost(progress, beats.pulses);
      const emphasis = spotlight ? spot : enter;
      const scale = 1 + (spotlight && !isSequence ? 0.03 * spot : 0) + ((isSequence ? 0.006 : 0.012) * wave + 0.05 * boost) * emphasis;
      focus.style.transform = isPhotoFocus ? 'none' : `scale(${scale.toFixed(4)})`;
      focus.style.transformOrigin = 'center';
      if (spotlight && !isState && !isSequence) {
        focus.style.boxShadow = glowShadow((0.5 + 0.18 * wave + 0.3 * boost) * spot);
      }
    }

    const componentMotionState = componentAnimate
      ? componentAnimate({ progress, ms, enter, spot })
      : null;

    window.__QIAOCUT_REVIEW_STATE__ = {
      sceneId: data.sceneId || null,
      cognitiveTask: data.cognitiveTask || '',
      primaryFocus: data.primaryFocus || 'focus-stage',
      focusFound: Boolean(focus),
      visibleChange: change,
      visualMechanism: data.visualMechanism || null,
      component: data.component || null,
      componentMotionState,
      spotlight,
      activeSteps,
      totalSteps: stepNodes.length,
      swapProgress: swapValue,
      beats: { activate: beats.activate.size, swapAt: beats.swapAt, pulses: beats.pulses.length },
      progress
    };
  };
  window.__QIAOCUT_SET_TIME__(0);
})();
