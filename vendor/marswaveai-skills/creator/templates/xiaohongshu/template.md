# Xiaohongshu Template

## Pipeline Steps

### 1. Prepare Material

Same as WeChat — material from dispatcher (URL extraction or direct input).

### 2. Determine Mode

Read `preferences.xiaohongshu.mode` from config:
- `"both"` (default): Generate cards AND long text
- `"cards"`: Cards only
- `"long-text"`: Long text only

### 3. Select Visual Preset (if mode includes cards)

The preset was already selected in SKILL.md Step 3b (before the confirmation gate). Use the preset chosen there.

Available presets and topic-matching hints (used by SKILL.md Step 3b for ordering recommendations):

| Content Signals | Recommended Preset |
|---|---|
| 美妆, 护肤, 穿搭, 可爱 | cute |
| 健康, 养生, 自然, 清爽 | fresh |
| 生活故事, 情感, 治愈, 温馨 | warm |
| 避坑, 警告, 必看, 重要 | bold |
| 职场, 商务, 高端, 简约 | minimal |
| 怀旧, 经典, 复古, 老 | retro |
| 好物, 惊喜, 有趣, 推荐 | pop |
| 知识, 科普, 效率, 概念 | notion |
| 教程, 学习方法, 教学 | chalkboard |
| 笔记, 考试, 学习, 框架 | study-notes |

Read the full preset file to get Color Palette, Typography, Decorations, and Prompt Fragment for use in Step 5.

### 3.5. Load Writing Context

Before writing, read and internalize:
- `../../writing-engine/forbidden-words.md` — 禁用词表
- `../../writing-engine/rhetoric.md` — 修辞技巧库
- `style.md` — 小红书风格规则
- `content-prototypes.md` — 使用 Step 3a 中用户选定的内容原型

Apply the prototype's narrative structure when planning content.

### 4. Generate Content Plan

Based on material:
- **For cards**: Distill into 4-7 key points. Each point becomes one card (plus cover = 5-8 cards total).
- **For long text**: Plan a hook-first short article (500-1000 chars).
- **Cover**: Design a cover card with attention-grabbing title.

### 5. Write Long Text (if mode includes long text)

Write `long-text.md` following `style.md` § Long Text structure. Apply any user style directives from `.listenhub/creator/styles/xiaohongshu.md` (if exists) and `sessionStyle` (from style reference) on top of the baseline style. `sessionStyle` takes priority over the user style file, which takes priority over `style.md`.

Include:
- Hook title with number/emotional hook
- Short punchy paragraphs
- Strategic emoji
- 3-5 hashtags at the end

### 5.5. Self-Review Loop

Execute the L1-L4 quality review per `../../writing-engine/quality-review.md`.

1. Run L1 (forbidden words scan against `../../writing-engine/forbidden-words.md`). Auto-fix any hits.
2. Run L2 (style consistency against `style.md` § Review Thresholds). Auto-fix any failures.
3. Run L3 (content quality, including L3-5 prototype-specific checks from `content-prototypes.md`). Auto-fix any failures.
4. Run L4 (aliveness review). Auto-fix any failures.

If any layer fails, auto-fix and re-run from L1. Maximum 3 full iterations.
If all layers pass: proceed silently to the next step.
If cap hit: show user the cap-hit report per `../../writing-engine/quality-review.md` and await decision.

**Mode-dependent placement:**
- If mode is `"long-text"` only or `"both"`: self-review applies here (after Write Long Text).
- If mode is `"cards"` only: self-review applies to card copy text after Step 6 (Design Card Prompts).

### 6. Design Card Prompts (if mode includes cards)

**Card content density:** Each card has a density level that determines how much text it carries:

| Density | Text Amount | Use For |
|---------|-------------|---------|
| sparse | headline only, or headline + 1 short line | cover, ending/CTA |
| balanced | headline + 2-3 bullet points with brief explanation | standard content pages |
| dense | headline + 4-6 points, or comparison table | knowledge cards, checklists, summaries |

**Assign density per card:**
- Page 1 (cover): always `sparse`
- Last page (CTA/ending): `sparse` or `balanced`
- Content pages: `balanced` by default, `dense` for list/comparison/summary cards

**For each card**, apply the selected preset's visual style (from Step 3) and user style directives from `.listenhub/creator/styles/xiaohongshu.md` (if exists) and `sessionStyle`:

1. Write the card content following the density level
2. Write an English image generation prompt that:
   - Starts with the preset's **Prompt Fragment** as the visual foundation
   - Describes the text content and its layout position on the card
   - Specifies density-appropriate composition (sparse = large text centered, balanced = headline + bullet list, dense = structured grid/list)
   - Includes the preset's color palette and decorative elements

Save all prompts to `{output}/cards/prompts.json`:
```json
[
  {
    "page": 1,
    "type": "cover",
    "density": "sparse",
    "headline": "5个信号说明你正在被AI淘汰",
    "body": [],
    "footnote": null,
    "prompt": "<preset prompt fragment> + card-specific layout description..."
  },
  {
    "page": 2,
    "type": "content",
    "density": "balanced",
    "headline": "信号1：你的工作全是照做",
    "body": ["领导给模板你填数据", "客户给需求你套方案", "AI做这些比你快100倍"],
    "footnote": "执行者最先被替代",
    "prompt": "<preset prompt fragment> + card-specific layout description..."
  },
  {
    "page": 7,
    "type": "ending",
    "density": "balanced",
    "headline": "自救指南",
    "body": ["做决策者不做执行者", "培养AI做不了的能力", "学会用AI不怕AI", "保持核心手感"],
    "footnote": "你属于哪种？评论区聊聊",
    "prompt": "<preset prompt fragment> + card-specific layout description..."
  }
]
```

### 7. Generate Card Images (if mode includes cards)

For each prompt in `prompts.json`:
- **Model**: `gemini-3-pro-image`
- **Aspect ratio**: `3:4` (portrait, standard Xiaohongshu card)
- **Size**: `2K`
- **Timeout**: `--timeout 600` (use `listenhub image create --json`)

Save to `{output}/cards/01-cover.jpg`, `{output}/cards/02-page.jpg`, etc.

Generate sequentially. On 429: exponential backoff (wait 15s → 30s → 60s), retry up to 3 times. After 3 retries, skip and note.

### 8. Write meta.json

```json
{
  "title": "...",
  "tags": ["#tag1", "#tag2", "#tag3"],
  "platform": "xiaohongshu",
  "date": "YYYY-MM-DD",
  "modes": ["cards", "long-text"],
  "preset": "cute",
  "cardCount": N
}
```

### Output Structure

```
{slug}-xiaohongshu/
├── cards/              (if mode includes cards)
│   ├── 01-cover.jpg
│   ├── 02-page.jpg
│   ├── ...
│   └── prompts.json
├── long-text.md        (if mode includes long text)
└── meta.json
```
