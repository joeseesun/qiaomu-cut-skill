---
name: slides
description: |
  Create slide decks from topics, URLs, or text. Triggers on: "幻灯片", "PPT",
  "slides", "slide deck", "做幻灯片", "create slides", "presentation".
metadata:
  openclaw:
    emoji: "📊"
    requires:
      bin: ["listenhub"]
    primaryBin: "listenhub"
---

## When to Use

- User wants to create a slide deck or presentation
- User asks for "slides", "幻灯片", "PPT", or "presentation"
- User wants visual content organized into slides from a topic or URL

## When NOT to Use

- User wants a narrated video without slides (use `/explainer`)
- User wants audio-only content (use `/speech` or `/podcast`)
- User wants a podcast-style discussion (use `/podcast`)
- User wants to generate a standalone image (use `/image-gen`)

## Purpose

Generate slide decks with AI-generated visuals from topics, URLs, or text. By default, slides are generated without audio narration. Narration can be optionally enabled. Ideal for presentations, summaries, and visual storytelling.

## Hard Constraints

- Always read config following `shared/config-pattern.md` before any interaction
- Follow `shared/cli-patterns.md` for execution modes, error handling, and interaction patterns
- Always follow `shared/cli-authentication.md` for auth checks
- Follow `shared/speaker-selection.md` when narration is enabled
- Never hardcode speaker IDs — always fetch from the speakers CLI when the user wants to change voice
- Never save files to `~/Downloads/` or `.listenhub/` — save artifacts to the current working directory with friendly topic-based names (see `shared/config-pattern.md` § Artifact Naming)
- Mode is always `slides` — never `info` or `story` (those are for `/explainer`)
- Only 1 speaker supported (when narration is enabled)
- Default behavior: skip audio (no narration). Only add narration when the user explicitly requests it via `--no-skip-audio`

<HARD-GATE>
Use the AskUserQuestion tool for every multiple-choice step — do NOT print options as plain text. Ask one question at a time. Wait for the user's answer before proceeding to the next step. After all parameters are collected, summarize the choices and ask the user to confirm. Do NOT call any CLI command until the user has explicitly confirmed.

</HARD-GATE>

## Step -1: CLI Auth Check

Follow `shared/cli-authentication.md`. If the CLI is not installed or the user is not logged in, auto-install and auto-login — never ask the user to run commands manually.

## Step 0: Config Setup

Follow `shared/config-pattern.md` Step 0 (Zero-Question Boot).

**If file doesn't exist** — silently create with defaults and proceed:
```bash
mkdir -p ".listenhub/slides"
echo '{"outputMode":"inline","language":null,"defaultSpeakers":{}}' > ".listenhub/slides/config.json"
CONFIG_PATH=".listenhub/slides/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```
**Do NOT ask any setup questions.** Proceed directly to the Interaction Flow.

**If file exists** — read config silently and proceed:
```bash
CONFIG_PATH=".listenhub/slides/config.json"
[ ! -f "$CONFIG_PATH" ] && CONFIG_PATH="$HOME/.listenhub/slides/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

### Setup Flow (user-initiated reconfigure only)

Only run when the user explicitly asks to reconfigure. Display current settings:
```
当前配置 (slides)：
  输出方式：{inline / download / both}
  语言偏好：{zh / en / 未设置}
  默认主播：{speakerName / 使用内置默认}
```

Then ask:

1. **outputMode**: Follow `shared/output-mode.md` § Setup Flow Question.

2. **Language** (optional): "默认语言？"
   - "中文 (zh)"
   - "English (en)"
   - "每次手动选择" → keep `null`

After collecting answers, save immediately:
```bash
NEW_CONFIG=$(echo "$CONFIG" | jq --arg m "$OUTPUT_MODE" '. + {"outputMode": $m}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
CONFIG=$(cat "$CONFIG_PATH")
```

## Interaction Flow

### Step 1: Topic / Content

Free text input. Ask the user:

> What would you like to create slides about?

Accept: topic description, text content, URL(s), or any combination.

### Step 2: Language

If `config.language` is set, pre-fill and show in summary — skip this question.
Otherwise ask:

```
Question: "What language?"
Options:
  - "Chinese (zh)" — Content in Mandarin Chinese
  - "English (en)" — Content in English
  - "Japanese (ja)" — Content in Japanese
```

### Step 3: Narration

Ask:

```
Question: "需要语音旁白吗？（默认否）"
Options:
  - "不需要" — Slides only, no narration
  - "需要" — Add voice narration to slides
```

Default is no narration. If the user says yes, proceed to Step 4. Otherwise skip to Step 5.

### Step 4: Speaker Selection (only if narration enabled)

**Skip this step entirely if narration is not enabled.**

Follow `shared/speaker-selection.md`:
- If `config.defaultSpeakers.{language}` is set → use saved speaker silently
- If not set → use **built-in default** from `shared/speaker-selection.md` for the language
- Show the speaker in the confirmation summary (Step 5) — user can change from there if desired
- Only show the full speaker list if the user explicitly asks to change voice

Only 1 speaker is supported for slides narration.

### Step 5: Confirm & Generate

Summarize all choices:

**Without narration:**
```
Ready to generate slides:

  Topic: {topic}
  Language: {language}
  Narration: No

  Proceed?
```

**With narration:**
```
Ready to generate slides:

  Topic: {topic}
  Language: {language}
  Narration: Yes
  Speaker: {speaker name}

  Proceed?
```

Wait for explicit confirmation before running any CLI command.

## Workflow

1. **Submit (background)**: Run the CLI command with `run_in_background: true` and `timeout: 660000`:

   **Without narration (default):**
   ```bash
   listenhub slides create \
     --query "{topic}" \
     --lang {en|zh|ja} \
     --image-size 2K \
     --aspect-ratio 16:9 \
     --timeout 600 \
     --json
   ```

   **With narration:**
   ```bash
   listenhub slides create \
     --query "{topic}" \
     --lang {en|zh|ja} \
     --image-size 2K \
     --aspect-ratio 16:9 \
     --no-skip-audio \
     --speaker "{name}" \
     --timeout 600 \
     --json
   ```

   If the user provided a source URL, add `--source-url "{url}"`.

   The CLI handles polling internally and returns the final result when generation completes.

2. Tell the user the task is submitted and that they will be notified when it finishes.

3. When notified of completion, **parse and present the result**:

   Parse the CLI JSON output for key fields:
   ```bash
   EPISODE_ID=$(echo "$RESULT" | jq -r '.episodeId')
   AUDIO_URL=$(echo "$RESULT" | jq -r '.audioUrl // empty')
   CREDITS=$(echo "$RESULT" | jq -r '.credits // empty')
   ```

   Read `OUTPUT_MODE` from config. Follow `shared/output-mode.md` for behavior.

   **Without narration:**

   **`inline` or `both`**: Present the online link.

   ```
   幻灯片已生成！

   在线查看：https://listenhub.ai/app/slides/{episodeId}
   消耗积分：{credits}
   ```

   **`download` or `both`**: Also save the script file. Generate a topic slug following `shared/config-pattern.md` § Artifact Naming.
   - Save as `{slug}-slides.md` in cwd (dedup if exists)
   - Present the save path in addition to the above summary.

   **With narration:**

   **`inline` or `both`**: Display audio URL as a clickable link.

   ```
   幻灯片已生成！

   在线查看：https://listenhub.ai/app/slides/{episodeId}
   音频链接：{audioUrl}
   消耗积分：{credits}
   ```

   **`download` or `both`**: Also save files. Generate a topic slug following `shared/config-pattern.md` § Artifact Naming.
   - Create `{slug}-slides/` folder (dedup if exists)
   - Write `script.md` inside
   - Download audio:
     ```bash
     curl -sS -o "{slug}-slides/audio.mp3" "{audioUrl}"
     ```
   - Present:
     ```
     已保存到当前目录：
       {slug}-slides/
         script.md
         audio.mp3
     ```

### After Successful Generation

Update config with the choices made this session:

```bash
NEW_CONFIG=$(echo "$CONFIG" | jq \
  --arg lang "{language}" \
  '. + {"language": $lang}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
```

If narration was used, also save the speaker:
```bash
NEW_CONFIG=$(echo "$CONFIG" | jq \
  --arg lang "{language}" \
  --arg speakerId "{speakerId}" \
  '. + {"language": $lang, "defaultSpeakers": (.defaultSpeakers + {($lang): [$speakerId]})}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
```

**Estimated times**:
- Slides without narration: 2-4 minutes
- Slides with narration: 4-8 minutes

## Resources

- CLI authentication: `shared/cli-authentication.md`
- CLI patterns: `shared/cli-patterns.md`
- Speaker query: `shared/cli-speakers.md`
- Speaker selection guide: `shared/speaker-selection.md`
- Config pattern: `shared/config-pattern.md`
- Output mode: `shared/output-mode.md`

## Composability

- **Invokes**: speakers CLI (for speaker selection when narration enabled)
- **Invoked by**: content-planner (Phase 3)

## Example

**User**: "帮我做一个关于量子计算的幻灯片"

**Agent workflow**:
1. Topic: "量子计算"
2. Language: pre-filled from config or ask → "zh"
3. Narration: ask → "不需要"
4. Confirm and generate

```bash
listenhub slides create \
  --query "量子计算" \
  --lang zh \
  --image-size 2K \
  --aspect-ratio 16:9 \
  --timeout 600 \
  --json
```

Wait for CLI to return result, then present the online link.

**User**: "Create slides about React hooks with narration"

**Agent workflow**:
1. Topic: "React hooks"
2. Language: ask → "en"
3. Narration: ask → "需要"
4. Speaker: use built-in default for English
5. Confirm and generate

```bash
listenhub slides create \
  --query "React hooks" \
  --lang en \
  --image-size 2K \
  --aspect-ratio 16:9 \
  --no-skip-audio \
  --speaker "Mars" \
  --timeout 600 \
  --json
```

Wait for CLI to return result, then present the online link and audio link.
