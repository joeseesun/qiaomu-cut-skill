---
name: explainer
description: |
  Create explainer videos with narration and AI-generated visuals. Triggers on:
  "解说视频", "explainer video", "explain this as a video", "tutorial video",
  "introduce X (video)", "解释一下XX（视频形式）".
metadata:
  openclaw:
    emoji: "🎬"
    requires:
      bin: ["listenhub"]
    primaryBin: "listenhub"
---

## When to Use

- User wants to create an explainer or tutorial video
- User asks to "explain" something in video form
- User wants narrated content with AI-generated visuals
- User says "explainer video", "解说视频", "tutorial video"

## When NOT to Use

- User wants audio-only content without visuals (use `/speech` or `/podcast`)
- User wants a podcast-style discussion (use `/podcast`)
- User wants to generate a standalone image (use `/image-gen`)
- User wants to read text aloud without video (use `/speech`)

## Purpose

Generate explainer videos that combine a single narrator's voiceover with AI-generated visuals. Ideal for product introductions, concept explanations, and tutorials. Supports text-only script generation or full text + video output.

## Hard Constraints

- Always read config following `shared/config-pattern.md` before any interaction
- Follow `shared/cli-patterns.md` for execution modes, error handling, and interaction patterns
- Always follow `shared/cli-authentication.md` for auth checks
- Never hardcode speaker IDs — always fetch from the speakers CLI when the user wants to change voice
- Never save files to `~/Downloads/` or `.listenhub/` — save artifacts to the current working directory with friendly topic-based names (see `shared/config-pattern.md` § Artifact Naming)
- Explainer uses exactly 1 speaker
- Mode must be `info` (for Info style) or `story` (for Story style) — never `slides` (use `/slides` skill instead)

<HARD-GATE>
Use the AskUserQuestion tool for every multiple-choice step — do NOT print options as plain text. Ask one question at a time. Wait for the user's answer before proceeding to the next step. After all parameters are collected, summarize the choices and ask the user to confirm. Do NOT call any CLI command until the user has explicitly confirmed.

</HARD-GATE>

## Step -1: CLI Auth Check

Follow `shared/cli-authentication.md` § Auth Check. If the CLI is not installed or the user is not logged in, auto-install and auto-login — never ask the user to run commands manually.

Then follow `shared/cli-authentication.md` § Auth Mode Detection to determine `AUTH_MODE` and set:

```bash
if [ "$AUTH_MODE" = "openapi" ]; then
  CMD_PREFIX="listenhub openapi storybook"
else
  CMD_PREFIX="listenhub explainer"
fi
```

All subsequent CLI calls use `$CMD_PREFIX` instead of hardcoded `listenhub explainer`.

**Note:** The OpenAPI command is `storybook` (not `explainer`) — same backend, different naming.

## Step 0: Config Setup

Follow `shared/config-pattern.md` Step 0 (Zero-Question Boot).

**If file doesn't exist** — silently create with defaults and proceed:
```bash
mkdir -p ".listenhub/explainer"
echo '{"outputMode":"inline","language":null,"defaultStyle":null,"defaultSpeakers":{}}' > ".listenhub/explainer/config.json"
CONFIG_PATH=".listenhub/explainer/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```
**Do NOT ask any setup questions.** Proceed directly to the Interaction Flow.

**If file exists** — read config silently and proceed:
```bash
CONFIG_PATH=".listenhub/explainer/config.json"
[ ! -f "$CONFIG_PATH" ] && CONFIG_PATH="$HOME/.listenhub/explainer/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

### Setup Flow (user-initiated reconfigure only)

Only run when the user explicitly asks to reconfigure. Display current settings:
```
当前配置 (explainer)：
  输出方式：{inline / download / both}
  语言偏好：{zh / en / 未设置}
  默认风格：{info / story / 未设置}
  默认主播：{speakerName / 使用内置默认}
```

Then ask:

1. **outputMode**: Follow `shared/output-mode.md` § Setup Flow Question.

2. **Language** (optional): "默认语言？"
   - "中文 (zh)"
   - "English (en)"
   - "每次手动选择" → keep `null`

3. **Style** (optional): "默认风格？"
   - "Info — 信息展示型"
   - "Story — 故事叙述型"
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

> What would you like to explain or introduce?

Accept: topic description, text content, or concept to explain.

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

### Step 3: Style

If `config.defaultStyle` is set, pre-fill and show in summary — skip this question.
Otherwise ask:

```
Question: "What style of explainer?"
Options:
  - "Info" — Informational, factual presentation style
  - "Story" — Narrative, storytelling approach
```

### Step 4: Speaker Selection

Follow `shared/speaker-selection.md`:
- If `config.defaultSpeakers.{language}` is set → use saved speaker silently
- If not set → use **built-in default** from `shared/speaker-selection.md` for the language
- Show the speaker in the confirmation summary (Step 6) — user can change from there if desired
- Only show the full speaker list if the user explicitly asks to change voice

Speaker query: see `shared/cli-speakers.md` for listing and filtering speakers.

Only 1 speaker is supported for explainer videos.

### Step 5: Output Type

```
Question: "What output do you want?"
Options:
  - "Text script only" — Generate narration script, no video
  - "Text + Video" — Generate full explainer video with AI visuals
```

### Step 6: Confirm & Generate

Summarize all choices:

```
Ready to generate explainer:

  Topic: {topic}
  Language: {language}
  Style: {info/story}
  Speaker: {speaker name}
  Output: {text only / text + video}

  Proceed?
```

Wait for explicit confirmation before running any CLI command.

## Workflow

Run the CLI command with `run_in_background: true` and `timeout: 660000`. The CLI blocks until generation completes and returns the final result as JSON:

```bash
$CMD_PREFIX create \
  --query "{topic}" \
  --mode {info|story} \
  --lang {en|zh|ja} \
  --speaker "{name}" \
  --speaker-id "{id}" \
  --timeout 600 \
  --json
```

If the command fails (non-zero exit), check stderr for error details. See `shared/cli-patterns.md` § Error Handling for exit codes and common errors.

**Optional flags** (add when applicable):
- `--source-url "{url}"` — if the user provided a reference URL
- `--skip-audio` — if text-only output (no video)
- `--image-size {2K|4K}` — image resolution (default: 2K)
- `--aspect-ratio {16:9|9:16|1:1}` — video aspect ratio (default: 16:9)
- `--style "{style}"` — visual style for AI-generated images

Tell the user the task is submitted. When notified of completion, **parse and present result**:

   Parse the CLI JSON output for key fields:
   ```bash
   EPISODE_ID=$(echo "$RESULT" | jq -r '.episodeId')
   AUDIO_URL=$(echo "$RESULT" | jq -r '.audioUrl // empty')
   VIDEO_URL=$(echo "$RESULT" | jq -r '.videoUrl // empty')
   CREDITS=$(echo "$RESULT" | jq -r '.credits // empty')
   ```

   Read `OUTPUT_MODE` from config. Follow `shared/output-mode.md` for behavior.

   **If text-only output**:

   **`inline` or `both`**: Present the script inline.

   Present:
   ```
   解说脚本已生成！

   「{title}」

   在线查看：https://listenhub.ai/app/explainer/{episodeId}
   ```

   **`download` or `both`**: Also save the script file. Generate a topic slug following `shared/config-pattern.md` § Artifact Naming.
   - Save as `{slug}-explainer.md` in cwd (dedup if exists)
   - Present the save path in addition to the above summary.

   **If text + video output**:

   **`inline` or `both`**: Display video URL and audio URL as clickable links.

   Present:
   ```
   解说视频已生成！

   视频链接：{videoUrl}
   音频链接：{audioUrl}
   消耗积分：{credits}
   ```

   **`download` or `both`**: Also save files. Generate a topic slug following `shared/config-pattern.md` § Artifact Naming.
   - Create `{slug}-explainer/` folder (dedup if exists)
   - Write `script.md` inside
   - Download audio:
     ```bash
     listenhub download "{audioUrl}" -o "{slug}-explainer/audio.mp3"
     ```
   - Present:
     ```
     已保存到当前目录：
       {slug}-explainer/
         script.md
         audio.mp3
     ```

### After Successful Generation

Update config with the choices made this session:

```bash
NEW_CONFIG=$(echo "$CONFIG" | jq \
  --arg lang "{language}" \
  --arg style "{info/story}" \
  --arg speakerId "{speakerId}" \
  '. + {"language": $lang, "defaultStyle": $style, "defaultSpeakers": (.defaultSpeakers + {($lang): [$speakerId]})}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
```

**Estimated times**:
- Text script only: 2-3 minutes
- Text + Video: 5-10 minutes

## Resources

- CLI authentication: `shared/cli-authentication.md`
- CLI patterns: `shared/cli-patterns.md`
- Speaker query: `shared/cli-speakers.md`
- Speaker selection guide: `shared/speaker-selection.md`
- Config pattern: `shared/config-pattern.md`
- Output mode: `shared/output-mode.md`

## Composability

- **Invokes**: speakers CLI (for speaker selection); may invoke `/speech` for voiceover
- **Invoked by**: content-planner (Phase 3)

## Example

**User**: "Create an explainer video introducing Claude Code"

**Agent workflow**:
1. Topic: "Claude Code introduction"
2. Ask language → "English"
3. Ask style → "Info"
4. Use default speaker "Mars" (cozy-man-english)
5. Ask output → "Text + Video"

```bash
# Run with run_in_background: true, timeout: 660000
$CMD_PREFIX create \
  --query "Introduce Claude Code: what it is, key features, and how to get started" \
  --mode info \
  --lang en \
  --speaker "Mars" \
  --speaker-id "cozy-man-english" \
  --timeout 600 \
  --json
```

Parse result for `episodeId`, `audioUrl`, `videoUrl`, `credits`, and present to user.
