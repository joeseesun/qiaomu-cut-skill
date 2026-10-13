---
name: podcast
description: |
  Create podcasts from topics, URLs, or text. Triggers on: "做播客", "podcast",
  "播客", "录一期节目", "chat about", "discuss", "debate", "dialogue",
  "make a podcast about".
metadata:
  openclaw:
    emoji: "🎙️"
    requires:
      bin: ["listenhub"]
    primaryBin: "listenhub"
---

## When to Use

- User wants to create a podcast episode on any topic
- User provides a URL or text and wants it turned into a podcast discussion
- User asks for a "debate", "dialogue", or "discussion" format
- User says "podcast", "播客", or "录一期节目"

## When NOT to Use

- User wants text-to-speech reading (use `/speech`)
- User wants an explainer video with visuals (use `/explainer`)
- User wants to generate an image (use `/image-gen`)
- User only wants to extract content from a URL without generating audio (use `/content-parser`)

## Purpose

Generate podcast episodes with 1-2 AI speakers discussing a topic. Supports quick overviews, deep analysis, and debate formats. Input can be a topic description, URL(s), or text. Output is a full audio episode with transcript.

## Hard Constraints

- Always check CLI auth following `shared/cli-authentication.md`
- Follow `shared/cli-patterns.md` for command execution and error handling
- Never hardcode speaker IDs in API calls — use built-in defaults from `shared/speaker-selection.md` as fallback only; fetch from the speakers API when the user wants to change voice
- Never fabricate CLI commands or parameters
- Always read config following `shared/config-pattern.md` before any interaction
- Always follow `shared/speaker-selection.md` for speaker selection (text table + free-text input)
- Never save files to `~/Downloads/` or `.listenhub/` — save artifacts to the current working directory with friendly topic-based names (see `shared/config-pattern.md` § Artifact Naming)

<HARD-GATE>
Use the AskUserQuestion tool for every multiple-choice step — do NOT print options as plain text. Ask one question at a time. Wait for the user's answer before proceeding to the next step. After all parameters are collected, summarize the choices and ask the user to confirm. Do NOT call any generation API until the user has explicitly confirmed.

</HARD-GATE>

## Step -1: CLI Auth Check

Follow `shared/cli-authentication.md` § Auth Check. If the CLI is not installed or the user is not logged in, auto-install and auto-login — never ask the user to run commands manually.

Then follow `shared/cli-authentication.md` § Auth Mode Detection to determine `AUTH_MODE` and set:

```bash
if [ "$AUTH_MODE" = "openapi" ]; then
  CMD_PREFIX="listenhub openapi podcast"
else
  CMD_PREFIX="listenhub podcast"
fi
```

All subsequent CLI calls use `$CMD_PREFIX` instead of hardcoded `listenhub podcast`.

## Step 0: Config Setup

Follow `shared/config-pattern.md` Step 0 (Zero-Question Boot).

**If file doesn't exist** — silently create with defaults and proceed:
```bash
mkdir -p ".listenhub/podcast"
echo '{"outputMode":"inline","language":null,"defaultMode":"quick","defaultSpeakers":{}}' > ".listenhub/podcast/config.json"
CONFIG_PATH=".listenhub/podcast/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```
**Do NOT ask any setup questions.** Proceed directly to the Interaction Flow.

**If file exists** — read config silently and proceed:
```bash
CONFIG_PATH=".listenhub/podcast/config.json"
[ ! -f "$CONFIG_PATH" ] && CONFIG_PATH="$HOME/.listenhub/podcast/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

### Setup Flow (user-initiated reconfigure only)

Only run when the user explicitly asks to reconfigure. Display current settings:
```
当前配置 (podcast)：
  输出方式：{inline / download / both}
  语言偏好：{zh / en / 未设置}
  默认模式：{quick / deep / debate / 未设置}
  默认主播：{speakerName(s) / 使用内置默认}
```

Then ask these questions in order and save:

1. **outputMode**: Follow `shared/output-mode.md` § Setup Flow Question.

2. **Language** (optional): "默认语言？"
   - "中文 (zh)"
   - "English (en)"
   - "每次手动选择" → keep `null`

3. **Mode** (optional): "默认播客模式？"
   - "Quick — 简短概述"
   - "Deep — 深度分析"
   - "Debate — 辩论对话"
   - "每次手动选择" → keep `null`

After collecting answers, save immediately:
```bash
NEW_CONFIG=$(echo "$CONFIG" | jq --arg m "$OUTPUT_MODE" '. + {"outputMode": $m}')
# Save language if user chose one (not "每次手动选择")
if [ "$LANGUAGE" != "null" ]; then
  NEW_CONFIG=$(echo "$NEW_CONFIG" | jq --arg lang "$LANGUAGE" '. + {"language": $lang}')
fi
# Save mode if user chose one
if [ "$MODE" != "null" ]; then
  NEW_CONFIG=$(echo "$NEW_CONFIG" | jq --arg mode "$MODE" '. + {"defaultMode": $mode}')
fi
echo "$NEW_CONFIG" > "$CONFIG_PATH"
CONFIG=$(cat "$CONFIG_PATH")
```

## Interaction Flow

### Step 1: Topic + Reference Materials

Ask topic and optional reference materials **together in a single question** using AskUserQuestion with two sub-questions, or a single free-text prompt:

> What topic would you like to turn into a podcast? If you have reference materials (URLs or text), include them here too.

Accept: topic description, URL(s), pasted text, or any combination.

Examples of valid input:
- "AI developments in 2026"
- "https://example.com/article — discuss this"
- "The pros and cons of remote work. Reference: https://study.com/remote-work-2026"

### Step 2: Mode

**Default: "quick"** — skip this question unless:
- `config.defaultMode` is set to something else → use that value silently
- User explicitly mentioned a mode keyword in Step 1 (e.g. "deep dive", "debate", "in depth") → infer mode from intent

Only ask this question if the user's intent is ambiguous AND no default is configured. In most cases, just use "quick".

### Step 3: Language

**Default: match the user's interaction language.** Detect from the language the user used in Step 1:
- If the user wrote in Chinese → `zh`
- If the user wrote in English → `en`
- If `config.language` is set → use that value

**Never ask this question.** Always infer silently. Show in the confirmation summary so the user can override if needed.

### Step 4: Speaker Count

**Default: 2 speakers (dialogue)** — the most common and engaging format.

Skip this question. Debate mode requires 2 speakers. For quick/deep, default to 2 speakers as well.

Only use 1 speaker if the user explicitly requests a monologue or solo format.

### Step 5: Speaker Selection

Follow `shared/speaker-selection.md`:
- If `config.defaultSpeakers.{language}` is set → use saved speakers silently
- If not set → use **built-in defaults** from `shared/speaker-selection.md` (no question asked)
- Show the speaker(s) in the confirmation summary — user can change from there if desired
- Only show the full speaker list if the user explicitly asks to change voices

For 2-speaker mode (dialogue/debate): use Primary + Secondary defaults for the language.

### Step 6: Confirm & Generate

Summarize all choices:

```
Ready to generate podcast:

  Topic: {topic}
  Mode: {mode}
  Language: {language}
  Speakers: {speaker name(s)}
  References: {yes/no + brief description}

  Proceed?
```

Wait for explicit confirmation before calling any CLI command. The user can adjust any parameter here before confirming.

## Workflow

### Generation

1. **Submit (background)**: Run the CLI command with `run_in_background: true` and `timeout: 360000`:

   ```bash
   $CMD_PREFIX create \
     --query "{topic}" \
     --source-url "{url}" \
     --source-text "{text}" \
     --mode {quick|deep|debate} \
     --lang {en|zh|ja} \
     --speaker "{name}" \
     --speaker "{name2}" \
     --json
   ```

   Flag notes:
   - `--query` — the topic or question to discuss
   - `--source-url` — repeatable, one per URL reference
   - `--source-text` — repeatable, one per text block reference
   - `--mode` — one of `quick`, `deep`, `debate`
   - `--lang` — language code
   - `--speaker` — repeatable (max 2); use speaker display names
   - `--speaker-id` — alternative to `--speaker`; use speaker IDs instead of names
   - Omit `--source-url` / `--source-text` if the user provided no references

   The CLI handles polling internally and returns the final result when generation completes.

2. Tell the user the task is submitted and that they will be notified when it finishes.

3. When notified of completion, **Present result**:

   Parse the CLI JSON output to extract fields: `audioUrl`, `subtitlesUrl`, `audioDuration`, `credits`.

   Read `OUTPUT_MODE` from config. Follow `shared/output-mode.md` for behavior.

   **`inline` or `both`**: Display `audioUrl` as a clickable link.

   Present:
   ```
   播客已生成！

   在线收听：{audioUrl}
   字幕：{subtitlesUrl}（如有）
   时长：{audioDuration / 1000}s
   消耗积分：{credits}
   ```

   **`download` or `both`**: Also download the file. Generate a topic slug following `shared/config-pattern.md` § Artifact Naming.
   ```bash
   SLUG="{topic-slug}"  # e.g. "ai-developments"
   NAME="${SLUG}-podcast.mp3"
   # Dedup: if file exists, append -2, -3, etc.
   BASE="${NAME%.*}"; EXT="${NAME##*.}"; i=2
   while [ -e "$NAME" ]; do NAME="${BASE}-${i}.${EXT}"; i=$((i+1)); done
   curl -sS -o "$NAME" "{audioUrl}"
   ```
   Present:
   ```
   已保存到当前目录：
     {NAME}
   ```
4. Offer to show transcript or provide download URL on request

### After Successful Generation

Update config with the choices made this session:

```bash
NEW_CONFIG=$(echo "$CONFIG" | jq \
  --arg lang "{language}" \
  --arg mode "{mode}" \
  --argjson speakers '{"{language}": ["{speakerId}"]}' \
  '. + {"language": $lang, "defaultMode": $mode, "defaultSpeakers": (.defaultSpeakers + $speakers)}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
```

## API Reference

- Speaker list: `shared/cli-speakers.md`
- Speaker selection guide: `shared/speaker-selection.md`
- CLI patterns: `shared/cli-patterns.md`
- CLI authentication: `shared/cli-authentication.md`
- Config pattern: `shared/config-pattern.md`

## Composability

- **Invokes**: speakers API (for speaker selection)
- **Invoked by**: content-planner (Phase 3)

## Example

**User**: "Make a podcast about the latest AI developments"

**Agent workflow**:
1. Detect: podcast request, topic = "latest AI developments", no references
2. Infer: mode = "quick" (default), language = "en" (user wrote in English), 2 speakers (default)
3. Show confirmation summary → user confirms

```bash
$CMD_PREFIX create \
  --query "The latest AI developments" \
  --mode deep \
  --lang en \
  --speaker "Mars" \
  --speaker "Mia" \
  --json
```

Wait for CLI to return result, then present with title and listen link.
