# WeChat Article Template

## Pipeline Steps

### 1. Prepare Material

If input is a URL, material has already been extracted by the dispatcher (content-parser).
If input is text/topic, use it directly.

### 1.5. Load Writing Context

Before writing, read and internalize:
- `../../writing-engine/forbidden-words.md` — 禁用词表
- `../../writing-engine/rhetoric.md` — 修辞技巧库
- `style.md` — 公众号风格规则
- `article-prototypes.md` — 使用 Step 3a 中用户选定的文章原型的叙事结构

Apply the prototype's narrative arc when generating the outline.

### 2. Generate Outline

Based on the material and `style.md`, generate:
- **Title**: Informative, attention-grabbing (see style.md § Title)
- **Sections**: 3-6 H2 sections, each with a brief description of what it covers
- **Estimated word count**: 1500-3000 characters

### 3. Write Article

Write the full article section by section, following `style.md` for tone, structure, and formatting.

Apply any user style directives from `.listenhub/creator/styles/wechat.md` (if exists) and `sessionStyle` (from style reference) on top of the baseline style. `sessionStyle` takes priority over the user style file, which takes priority over `style.md`.

Write the complete article as `article.md` in the output folder.

### 3.5. Self-Review Loop

Execute the L1-L4 quality review per `../../writing-engine/quality-review.md`.

1. Run L1 (forbidden words scan against `../../writing-engine/forbidden-words.md`). Auto-fix any hits.
2. Run L2 (style consistency against `style.md` § Review Thresholds). Auto-fix any failures.
3. Run L3 (content quality, including L3-5 prototype-specific checks from `article-prototypes.md`). Auto-fix any failures.
4. Run L4 (aliveness review). Auto-fix any failures.

If any layer fails, auto-fix and re-run from L1. Maximum 3 full iterations.
If all layers pass: proceed silently to Step 4.
If cap hit: show user the cap-hit report per `../../writing-engine/quality-review.md` and await decision.

### 4. Select Illustration Preset

The preset was already selected in SKILL.md Step 3b (before the confirmation gate). Use the preset chosen there.

Available presets and topic-matching hints (used by SKILL.md Step 3b for ordering recommendations):

| Content Signals | Recommended Preset |
|---|---|
| 科技, 职场, 效率, 工具, 通用 | flat |
| 文化, 读书, 情感, 文艺, 哲学 | watercolor |
| 商业, 产品, 前沿科技, 城市 | photo-realistic |

Read the full preset file to get the Prompt Fragment for use in Step 5.

### 5. Plan Illustrations

After writing, identify illustration positions:
- **Cover image**: Always required. Placed at the top.
- **Section images**: One every 300-500 characters. Place after the paragraph that introduces a new concept or topic shift.
- For each image, write a detailed English prompt that starts with the selected preset's **Prompt Fragment** as the visual foundation, then adds scene-specific details.
- All prompts inherit the preset's color palette and style — ensuring visual consistency across the article.

### 6. Generate Images

For each planned illustration, call the image generation API:

- **Model**: `gemini-3-pro-image`
- **Cover**: aspect ratio `3:2`, size `2K`
- **Body images**: aspect ratio `3:2` or `16:9`, size `2K`
- **Timeout**: `--timeout 600` (use `listenhub image create --json`)

Save images to `{output}/images/cover.jpg`, `{output}/images/section-1.jpg`, etc.

Generate sequentially. On 429: exponential backoff (wait 15s → 30s → 60s), retry up to 3 times. After 3 retries, skip and note in output summary.

### 7. Insert Image References

Update `article.md` to reference images with relative paths:

```
![cover](images/cover.jpg)
```

Insert at the planned positions.

### 8. Write meta.json

```json
{
  "title": "...",
  "summary": "One-sentence summary",
  "tags": ["tag1", "tag2", "tag3"],
  "platform": "wechat",
  "date": "YYYY-MM-DD",
  "preset": "flat",
  "imageCount": N,
  "wordCount": N
}
```

### Output Structure

```
{slug}-wechat/
├── article.md
├── images/
│   ├── cover.jpg
│   ├── section-1.jpg
│   └── section-N.jpg
└── meta.json
```
