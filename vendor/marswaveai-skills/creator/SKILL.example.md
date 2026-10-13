---
name: creator
description: |
  Creator workflow — generate platform-ready content packages. Triggers on:
  "创作", "写公众号", "小红书", "口播", "creator", "content workflow",
  "帮我写一篇", "生成内容", "write an article", "create content".
metadata:
  openclaw:
    emoji: "✍️"
---

## When to Use

- User wants a full content package for a specific platform (WeChat article, Xiaohongshu post, narration script)
- User says "帮我写篇公众号", "小红书图文", "口播稿", "create content"
- User provides a URL/text/topic and wants it turned into platform-ready content with images

## When NOT to Use

- User wants a single image without a content workflow → use image-gen directly
- User wants a single TTS audio → use tts directly
- User wants to transcribe audio → use asr directly
- User wants a podcast episode → use podcast directly
- User wants to extract content from a URL without further processing → use content-parser directly

Creator is for **multi-step content production** that combines writing + media generation into a platform-ready package.

## Purpose

Generate platform-specific content packages by orchestrating existing skills. Input: topic, URL, text, or audio/video file. Output: a folder with article/script, images, and metadata — ready to publish.

## Hard Constraints

- Use `listenhub` CLI commands for image-gen and TTS. Use curl for content-parser (see `content-parser/SKILL.md` § API Reference).
- Always read config following `shared/config-pattern.md` before any interaction
- Follow `shared/cli-patterns.md` for polling, errors, and interaction patterns
- Never save files to `~/Downloads/` or `.listenhub/` — save content packages to the current working directory
- JSON parsing: use `jq` only (no python3, awk)

<HARD-GATE>
Language Adaptation: All UI text follows the user's input language. Chinese input → Chinese output. English input → English output. Mixed → follow dominant language.
</HARD-GATE>

<HARD-GATE>
Use AskUserQuestion for every multiple-choice step. One question at a time. Wait for the answer. After template is selected and input is understood, show a confirmation summary and wait for explicit approval before executing the pipeline.
</HARD-GATE>

<HARD-GATE>
API Key Check at Confirmation Gate: If the pipeline includes any remote API call (image-gen, content-parser, tts), check authentication before proceeding. For CLI-based calls (image-gen, TTS), run `listenhub auth login` if not authenticated. For content-parser calls, configure `LISTENHUB_API_KEY` (see `content-parser/SKILL.md` § Authentication). Pure text-only pipelines (e.g., topic → narration script without TTS) can proceed without authentication.
</HARD-GATE>

## Step -1: API Key Check

Deferred. API key is checked at the confirmation gate (Step 4) only when the pipeline requires remote API calls. See Hard Constraints above.

## Step 0: Config Setup

Follow `shared/config-pattern.md` Step 0 (Zero-Question Boot).

**If file doesn't exist** — silently create with defaults and proceed:
```bash
mkdir -p ".listenhub/creator" ".listenhub/creator/styles"
cat > ".listenhub/creator/config.json" << 'EOF'
{"outputMode":"download","language":null,"preferences":{"wechat":{"history":[]},"xiaohongshu":{"mode":"both","history":[]},"narration":{"defaultSpeaker":null,"history":[]}}}
EOF
CONFIG_PATH=".listenhub/creator/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

User style preferences are stored as markdown files in `.listenhub/creator/styles/`:
- `.listenhub/creator/styles/wechat.md`
- `.listenhub/creator/styles/xiaohongshu.md`
- `.listenhub/creator/styles/narration.md`

These files are plain markdown — one directive per line. If the file does not exist, no custom style is applied. Users can edit these files directly.

Note: `outputMode` defaults to `"download"` (not the usual `"inline"`) because creator always produces multi-file output folders that must be saved to disk.

**If file exists** — read config silently and proceed:
```bash
CONFIG_PATH=".listenhub/creator/config.json"
[ ! -f "$CONFIG_PATH" ] && CONFIG_PATH="$HOME/.listenhub/creator/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

### Setup Flow (user-initiated reconfigure only)

Only when user explicitly asks to reconfigure. Display current settings:
```
当前配置 (creator)：
  输出方式：{outputMode}
  小红书模式：{both / cards / long-text}
```

Ask:
1. **outputMode**: Follow `shared/output-mode.md` § Setup Flow Question.
2. **xiaohongshu.mode**: "小红书默认模式？"
   - "图文 + 长文（both）"
   - "仅图文卡片（cards）"
   - "仅长文（long-text）"

## Interaction Flow

### Step 1: Understand Input

The user provides input along with their request. Classify the input:

| Input Type | Detection | Auto Action |
|-----------|-----------|-------------|
| URL (web/article) | `http(s)://` prefix, not an audio/video URL | Will call content-parser (requires API key) |
| URL (audio/video) | Extension `.mp3/.mp4/.wav/.m4a/.webm` or domain is youtube.com/bilibili.com/douyin.com | Will download + call `coli asr` to transcribe |
| Local audio file | File path exists, extension is audio/video | Will call `coli asr` directly |
| Local text file | File path exists, extension is `.txt/.md/.json` | Read file content |
| Raw text | Multi-line or >50 chars, not a URL/path | Use directly as material |
| Topic/keywords | Short text (<50 chars), no URL/path pattern | AI writes from scratch |

**Style reference detection:** If the user's prompt contains keywords like "参考", "风格", "照着…写", "style", "reference", the associated input (file path / URL / pasted text) should be classified as a **style reference** rather than content material. A single request may contain both material and a style reference — classify them separately. If only a style reference is provided with no material or topic, this is a **standalone style learning** request (see Step 2.5).

**For URL (audio/video) inputs:**
1. Download to `/tmp/creator-{slug}.{ext}` using `curl -L -o`
2. Check `coli` is available: `which coli 2>/dev/null && echo yes || echo no`
3. If `coli` missing: inform user to install (`npm install -g @marswave/coli`), ask them to paste text instead
4. Transcribe: `coli asr -j --model sensevoice "/tmp/creator-{slug}.{ext}"`
5. Extract text from JSON result
6. Cleanup: `rm "/tmp/creator-{slug}.{ext}"`

**For URL (web/article) inputs:**
Content-parser will be called during pipeline execution (after confirmation).

### Step 2: Template Matching

If the user specified a platform in their prompt, match directly:
- "公众号", "wechat", "微信" → wechat
- "小红书", "xiaohongshu", "xhs" → xiaohongshu
- "口播", "narration", "脚本" → narration

If no platform was specified, ask via AskUserQuestion:

Question: "Which content template?" / "用哪个创作模板？"
Options (adapt language to user's input):
- "WeChat article (公众号长文)" — Long-form article with AI illustrations
- "Xiaohongshu (小红书)" — Image cards + long text post
- "Narration script (口播稿)" — Spoken script with optional audio

### Step 2.5: Topic Assistance

This step runs only when the user's input is a topic or keywords (short text <50 chars, no URL/path). Skip if user provided a URL, file, or substantial text.

1. Read the selected platform's `methodology.md`:
   - WeChat: `creator/templates/wechat/methodology.md`
   - Xiaohongshu: `creator/templates/xiaohongshu/methodology.md`
   - Narration: `creator/templates/narration/methodology.md`

2. Evaluate the topic using the three-circle Venn model:
   - 用户的专业领域 (creator's expertise)
   - 读者的普遍兴趣 (reader interest)
   - 当下的时间节点 (current timing/relevance)

3. Run HKR quality filter:
   - **H (Happy)**: 足够有趣、有悬念？
   - **K (Knowledge)**: 有信息量？看完能学到新东西？
   - **R (Resonance)**: 能戳中情绪？让人"对对对我也这么想"？

4. If topic scores ≥2 of 3 HKR criteria: proceed with the topic.
5. If topic scores <2: proactively suggest 2-3 alternative angles to the user via AskUserQuestion.
6. If topic is vague: ask for more specifics — key points, personal experiences, what excites or frustrates them.

### Step 3: Style Extraction (if style reference provided)

This step runs only when the user provided a style reference in Step 1. If no style reference was detected, skip to Step 3b.

**Read the reference content:**
- Local file → Read tool
- URL → content-parser API (requires API key)
- Pasted text → use directly

**Analyze and extract style directives:**

AI reads the reference content and extracts 3-5 concrete style directives. Focus on observable patterns:
- Sentence length and paragraph structure
- Tone and register (formal/casual, first/third person)
- Use of rhetorical devices (questions, lists, bold, quotes)
- Vocabulary level and domain jargon
- Formatting habits (heading style, emoji usage, whitespace)

**Present to user for confirmation:**

```
从参考文章中提炼了以下风格特征：

  1. {directive 1}
  2. {directive 2}
  3. {directive 3}
  ...

你可以修改或删除其中的条目。确认后本次生成会应用这些规则。
```

Wait for user confirmation. The confirmed directives become `sessionStyle` — applied to this generation only.

After user confirms the style directives, proactively ask whether to persist:

```
要将这些风格规则保存吗？（保存后每次生成{platform}内容都会应用）
```

If yes → write to `.listenhub/creator/styles/{platform}.md`. If no → only apply to this generation.

**Standalone style learning:** If the user only provided a style reference without material/topic (e.g., "学习一下这篇文章的风格"), run the extraction above, then **persist directly** to `.listenhub/creator/styles/{platform}.md` without asking — the user's intent to save is already explicit. Confirm with a brief message: "已保存到 styles/{platform}.md". Do not proceed to content generation.

### Step 3a: Prototype Classification

Read the selected platform's prototype file:
- WeChat: `creator/templates/wechat/article-prototypes.md`
- Xiaohongshu: `creator/templates/xiaohongshu/content-prototypes.md`
- Narration: `creator/templates/narration/script-prototypes.md`

Based on the user's material/topic, auto-match the best-fit prototype using the matching heuristics table in the prototype file.

Present the recommendation to the user via AskUserQuestion:

Question: "这篇内容最适合哪种写法？" / "Which content prototype fits best?"
Options: [list all prototypes for the platform, recommended one first with "(Recommended)" suffix]

The selected prototype determines the narrative structure and L3-5 review criteria for writing.

### Step 3b: Preset Selection (if applicable)

If the selected template uses illustration or card presets **and** the mode requires images, the preset MUST be chosen **before** the confirmation gate so it can be displayed in the summary.

**Skip this step entirely** for:
- Narration template (no visual presets)
- Xiaohongshu with `preferences.xiaohongshu.mode` = `"long-text"` (no cards or images generated)

Otherwise:

1. Read the template's preset section to get available presets and the topic-matching table.
2. **If the user already specified a preset** in their prompt (e.g., "用水彩风格"): use that preset directly.
3. **If not specified**: ask the user via AskUserQuestion. Output a one-line hint first: "配图风格可以随时换，先选一个开始吧". List all available presets with their Chinese labels (from frontmatter `label` field). Use the topic-matching table to put the most relevant option first (marked "Recommended"), but always let the user choose.

### Step 4: Confirmation Gate

**Check API key** if the pipeline needs remote APIs:
- WeChat template always needs image-gen → requires API key
- Xiaohongshu cards mode needs image-gen → requires API key
- Xiaohongshu long-text only → no API key needed
- Narration without TTS → no API key needed
- Web/article URL input → needs content-parser → requires API key (audio/video URLs use local `coli asr`, no API key needed)

If API key required and missing: for CLI-based calls, run `listenhub auth login`. For content-parser calls, configure `LISTENHUB_API_KEY` (see `content-parser/SKILL.md` § Authentication).

**Show confirmation summary:**

```
准备生成内容：

  模板：{WeChat article / Xiaohongshu / Narration}
  输入：{topic description / URL / text excerpt...}
  输出目录：{slug}-{platform}/
  需要 API 调用：{content-parser, image-gen, ...}
  风格偏好：{styles/{platform}.md 已配置 / 使用默认风格}
  配图/卡片预设：{preset label / 不适用}
  文章/内容原型：{selected prototype name}
  本次风格参考：{M条来自参考文章 / 无}

确认开始？
```

Wait for explicit "yes" / confirmation before proceeding.

### Step 5: Execute Pipeline

Read the selected template file and execute:

```bash
# The template file path
TEMPLATE="creator/templates/$PLATFORM/template.md"
STYLE="creator/templates/$PLATFORM/style.md"
```

**For URL inputs — extract content first:**

```bash
# Submit content extraction
RESPONSE=$(curl -sS -X POST "https://api.marswave.ai/openapi/v1/content/extract" \
  -H "Authorization: Bearer $LISTENHUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Source: skills" \
  -d "{\"source\":{\"type\":\"url\",\"uri\":\"$INPUT_URL\"}}")
TASK_ID=$(echo "$RESPONSE" | jq -r '.data.taskId')
```

Then poll in background. Run this as a **separate Bash call** with `run_in_background: true` and `timeout: 600000` (per `shared/cli-patterns.md`). The polling loop itself runs up to 300s (60 polls × 5s); `timeout: 600000` is set higher at the tool level to give the Bash process headroom beyond the poll budget:

```bash
# Run with: run_in_background: true, timeout: 600000
TASK_ID="<id>"
for i in $(seq 1 60); do
  RESULT=$(curl -sS "https://api.marswave.ai/openapi/v1/content/extract/$TASK_ID" \
    -H "Authorization: Bearer $LISTENHUB_API_KEY" \
    -H "X-Source: skills" 2>/dev/null)
  STATUS=$(echo "$RESULT" | tr -d '\000-\037\177' | jq -r '.data.status // "processing"')
  case "$STATUS" in
    completed) echo "$RESULT"; exit 0 ;;
    failed) echo "FAILED: $RESULT" >&2; exit 1 ;;
    *) sleep 5 ;;
  esac
done
echo "TIMEOUT" >&2; exit 2
```

Extract content: `MATERIAL=$(echo "$RESULT" | jq -r '.data.data.content')`

If extraction fails: tell user "URL 解析失败，你可以直接粘贴文字内容给我" and stop.

**Then follow the platform template** — read `template.md` and execute each step. The template specifies the exact writing instructions and API calls. See `creator/templates/{platform}/template.md` for template contents.

**Writing engine integration:** Each platform's `template.md` now includes writing-engine references and a self-review loop. The template handles loading `writing-engine/` files, applying the selected prototype's narrative structure, and running L1-L4 quality review after writing. See each platform's `template.md` for details.

**Style application:** When writing content, apply style directives in this priority order (higher overrides lower):
1. `sessionStyle` — directives from the current style reference (Step 3), if any
2. `.listenhub/creator/styles/{platform}.md` — persisted user style directives (if file exists)
3. `templates/{platform}/style.md` — baseline platform style

**For image generation** (called by wechat and xiaohongshu templates):

```bash
RESPONSE=$(listenhub image create \
  --prompt "<generated prompt>" \
  --aspect-ratio "<ratio>" \
  --json)

BASE64_DATA=$(echo "$RESPONSE" | jq -r '.candidates[0].content.parts[0].inlineData.data // .data')
# macOS uses -D, Linux uses -d (detect platform)
if [[ "$(uname)" == "Darwin" ]]; then
  echo "$BASE64_DATA" | base64 -D > "{output-path}/{filename}.jpg"
else
  echo "$BASE64_DATA" | base64 -d > "{output-path}/{filename}.jpg"
fi
```

On 429: exponential backoff (wait 15s → 30s → 60s), retry up to 3 times. On failure after retries: skip this image, annotate in output summary.

Generate images **sequentially** (not parallel) to respect rate limits.

**For TTS** (called by narration template when user wants audio):

```bash
listenhub tts create --text "$(cat /tmp/lh-content.txt)" --speaker "$SPEAKER_ID" --json \
  | jq -r '.data' | base64 -D > "{slug}-narration/audio.mp3"
```

### Step 6: Assemble Output

Create the output folder and write all files:

```bash
SLUG="{topic-slug}"
OUTPUT_DIR="${SLUG}-{platform}"
# Dedup folder name
i=2; while [ -d "$OUTPUT_DIR" ]; do OUTPUT_DIR="${SLUG}-{platform}-${i}"; i=$((i+1)); done
mkdir -p "$OUTPUT_DIR"
```

Write content files per template spec. Then write `meta.json`:

```json
{
  "title": "...",
  "slug": "...",
  "platform": "wechat|xiaohongshu|narration",
  "date": "YYYY-MM-DD",
  "tags": ["...", "..."],
  "summary": "..."
}
```

### Step 7: Present Result

```
✅ 内容已生成！保存在 {OUTPUT_DIR}/

📄 {main files list}
🖼️ images/ — N 张配图（如有）
📋 meta.json — 标题、标签、摘要
```

(Adapt language to user's input language per Hard Constraints.)

### Step 8: Update Preferences

Record this generation in history:

```bash
NEW_CONFIG=$(echo "$CONFIG" | jq \
  --arg platform "$PLATFORM" \
  --arg date "$(date +%Y-%m-%d)" \
  --arg topic "$TOPIC" \
  '.preferences[$platform].history = (.preferences[$platform].history + [{"date": $date, "topic": $topic}])[-5:]')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
```

Keep only the last 5 history entries per platform.

Note: `cardStyle` from the spec is deferred — not implemented in V1 config. Can be added later when card style customization is needed.

### Manual Style Tuning

**Adding style directives:**

If the user says "记住：{style directive}" or "remember: {style directive}":

1. Detect which platform it applies to (from context or ask)
2. Append the directive as a new line to `.listenhub/creator/styles/{platform}.md` (create the file if it doesn't exist)

This also applies after Step 3 (Style Extraction): if the user says "记住这个风格" after reviewing extracted directives, write all confirmed directives to `.listenhub/creator/styles/{platform}.md`.

**Resetting style:**

If the user says "重置风格偏好" or "reset style":
1. Ask which platform (or all)
2. Delete `.listenhub/creator/styles/{platform}.md`

## API Reference

- Authentication: `shared/cli-authentication.md`
- Image generation: CLI: `listenhub image create` (see `shared/cli-patterns.md`)
- Content extraction: `content-parser/SKILL.md` § API Reference (Inlined)
- TTS (text-to-speech): CLI: `listenhub tts create` (see `shared/cli-patterns.md`)
- Speaker selection: `shared/speaker-selection.md`
- Config pattern: `shared/config-pattern.md`
- Common patterns (polling, errors): `shared/cli-patterns.md`
- Output mode: `shared/output-mode.md`

## Composability

- **Invokes**: content-parser (URL extraction), image-gen (illustrations/cards), tts (narration audio), asr (audio/video transcription via `coli`)
- **Invoked by**: standalone — user triggers directly
- **Templates**: `creator/templates/{wechat,xiaohongshu,narration}/template.md` define per-platform pipelines
- **Style guides**: `creator/templates/{wechat,xiaohongshu,narration}/style.md` define per-platform writing tone
