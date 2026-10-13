---
name: tts
metadata:
  openclaw:
    emoji: "🔊"
    requires:
      bin: ["listenhub"]
    primaryBin: "listenhub"
description: |
  Text-to-speech and voice narration. Triggers on: "朗读这段", "配音", "TTS",
  "语音合成", "text to speech", "read this aloud", "convert to speech",
  "voice narration", "read aloud".
---

## When to Use

- User wants to convert text to spoken audio
- User asks for "read aloud", "TTS", "text to speech", "voice narration"
- User says "朗读", "配音", "语音合成"
- User wants multi-speaker scripted audio or dialogue

## When NOT to Use

- User wants a podcast-style discussion with topic exploration (use `/podcast`)
- User wants an explainer video with visuals (use `/explainer`)
- User wants to generate an image (use `/image-gen`)

## Purpose

Convert text into natural-sounding speech audio. Two paths:

1. **Quick mode** (`--mode direct`): Single voice, low-latency, sync. For casual chat, reading snippets, instant audio.
2. **Script mode** (`--mode smart`): Multi-speaker, per-segment voice assignment. For dialogue, audiobooks, scripted content.

## Hard Constraints

- Always check CLI auth following `shared/cli-authentication.md`
- Follow `shared/cli-patterns.md` for CLI execution, errors, and interaction patterns
- Never hardcode speaker IDs in CLI calls — use built-in defaults from `shared/speaker-selection.md` as fallback only; fetch from the speakers CLI when the user wants to change voice
- Always read config following `shared/config-pattern.md` before any interaction
- Always follow `shared/speaker-selection.md` for speaker selection (text table + free-text input)
- Never save files to `~/Downloads/` or `/tmp/` as primary output — save artifacts to the current working directory with friendly topic-based names (see `shared/config-pattern.md` § Artifact Naming)

<HARD-GATE>
Use the AskUserQuestion tool for every multiple-choice step — do NOT print options as plain text. Ask one question at a time. Wait for the user's answer before proceeding to the next step. After all parameters are collected, summarize the choices and ask the user to confirm. Do NOT call any generation CLI command until the user has explicitly confirmed.

</HARD-GATE>

## Mode Detection

Determine the mode from the user's input **automatically** before asking any questions:

| Signal | Mode |
|--------|------|
| "多角色", "脚本", "对话", "script", "dialogue", "multi-speaker" | Script |
| Multiple characters mentioned by name or role | Script |
| Input contains structured segments (A: ..., B: ...) | Script |
| Single paragraph of text, no character markers | Quick |
| "读一下", "read this", "TTS", "朗读" with plain text | Quick |
| Ambiguous | Quick (default) |

## Interaction Flow

### Step -1: CLI Auth Check

Follow `shared/cli-authentication.md`. If the CLI is not installed or the user is not logged in, auto-install and auto-login — never ask the user to run commands manually.

Then follow `shared/cli-authentication.md` § Auth Mode Detection to determine `AUTH_MODE` and set:

```bash
if [ "$AUTH_MODE" = "openapi" ]; then
  CMD_PREFIX="listenhub openapi tts"
else
  CMD_PREFIX="listenhub tts"
fi
```

All subsequent CLI calls use `$CMD_PREFIX` instead of hardcoded `listenhub tts`.

### Step 0: Config Setup

Follow `shared/config-pattern.md` Step 0 (Zero-Question Boot).

**If file doesn't exist** — silently create with defaults and proceed:
```bash
mkdir -p ".listenhub/tts"
echo '{"outputMode":"inline","language":null,"defaultSpeakers":{}}' > ".listenhub/tts/config.json"
CONFIG_PATH=".listenhub/tts/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```
**Do NOT ask any setup questions.** Proceed directly to the Interaction Flow.

**If file exists** — read config silently and proceed:
```bash
CONFIG_PATH=".listenhub/tts/config.json"
[ ! -f "$CONFIG_PATH" ] && CONFIG_PATH="$HOME/.listenhub/tts/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

### Setup Flow (user-initiated reconfigure only)

Only run when the user explicitly asks to reconfigure. Display current settings:
```
当前配置 (tts)：
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
# Save language if user chose one (not "每次手动选择")
if [ "$LANGUAGE" != "null" ]; then
  NEW_CONFIG=$(echo "$NEW_CONFIG" | jq --arg lang "$LANGUAGE" '. + {"language": $lang}')
fi
echo "$NEW_CONFIG" > "$CONFIG_PATH"
CONFIG=$(cat "$CONFIG_PATH")
```

### Quick Mode — `$CMD_PREFIX create --mode direct`

**Step 1: Extract text**

Get the text to convert. If the user hasn't provided it, ask:

> "What text would you like me to read aloud?"

**Step 2: Determine voice**

- If `config.defaultSpeakers.{language}[0]` is set → use it silently (skip to Step 4)
- If not set → use the **built-in default** from `shared/speaker-selection.md` for the detected language (skip to Step 4)
- Only show speaker selection if the user explicitly asks to change voice

**Step 3: Save preference**

After the user explicitly selects a new voice (not when using defaults):

```
Question: "Save {voice name} as your default voice for {language}?"
Options:
  - "Yes" — update .listenhub/tts/config.json
  - "No" — use for this session only
```

**Step 4: Confirm**

```
Ready to generate:

  Text: "{first 80 chars}..."
  Voice: {voice name}

Proceed?
```

**Step 5: Generate**

For short text, pass inline:
```bash
RESULT=$($CMD_PREFIX create --text "{text}" --mode direct --speaker "{name}" --lang {lang} --json 2>/tmp/lh-err)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  ERROR=$(cat /tmp/lh-err)
  case $EXIT_CODE in
    2) echo "Auth error: run 'listenhub auth login'" ;;
    3) echo "Timeout: try --no-wait" ;;
    *) echo "Error: $ERROR" ;;
  esac
  rm -f /tmp/lh-err
fi
rm -f /tmp/lh-err

AUDIO_URL=$(echo "$RESULT" | jq -r '.audioUrl')
```

For long text, write to a temp file first (see `shared/cli-patterns.md` § Long Text Input):
```bash
cat > /tmp/lh-content.txt << 'ENDCONTENT'
Long text content goes here...
ENDCONTENT

RESULT=$($CMD_PREFIX create --text "$(cat /tmp/lh-content.txt)" --mode direct --speaker "{name}" --lang {lang} --json)
AUDIO_URL=$(echo "$RESULT" | jq -r '.audioUrl')

rm -f /tmp/lh-content.txt
```

**Step 6: Present result**

Read `OUTPUT_MODE` from config. Follow `shared/output-mode.md` for behavior.

**`inline` or `both`**: Display the `audioUrl` as a clickable link.

Present:
```
Audio generated!

在线收听：{audioUrl}
```

**`download` or `both`**: Also download the file. Generate a topic slug from the text content following `shared/config-pattern.md` § Artifact Naming.
```bash
SLUG="{topic-slug}"  # e.g. "server-maintenance-notice"
NAME="${SLUG}.mp3"
# Dedup: if file exists, append -2, -3, etc.
BASE="${NAME%.*}"; EXT="${NAME##*.}"; i=2
while [ -e "$NAME" ]; do NAME="${BASE}-${i}.${EXT}"; i=$((i+1)); done
curl -sS -o "$NAME" "$AUDIO_URL"
```
Present:
```
Audio generated!

已保存到当前目录：
  {NAME}
```

---

### Script Mode — `$CMD_PREFIX create --mode smart`

**Step 1: Get scripts**

Determine whether the user already has a scripts array:

- **Already provided** (JSON or clear segments): parse and display for confirmation
- **Not yet provided**: help the user structure segments. Ask:

  > "Please provide the script with speaker assignments. Format: each line as `SpeakerName: text content`. I'll convert it."

  Once the user provides the script, parse it into speaker-annotated text.

**Step 2: Assign voices per character**

For each unique character in the script:

- If `config.defaultSpeakers.{language}` has saved voices → auto-assign silently (one per character in order)
- If not set → use **built-in defaults** from `shared/speaker-selection.md` (Primary for first character, Secondary for second)
- Only show speaker selection if the user explicitly asks to change voices

**Step 3: Save preferences**

After all voices are assigned (if any were new):

```
Question: "Save these voice assignments for future sessions?"
Options:
  - "Yes" — update defaultSpeakers in .listenhub/tts/config.json
  - "No" — use for this session only
```

**Step 4: Confirm**

```
Ready to generate:

  Characters:
    {name}: {voice}
    {name}: {voice}
  Segments: {count}
  Title: (auto-generated)

Proceed?
```

**Step 5: Generate**

Format the script text with speaker markers and submit. For multi-speaker scripts, include speaker names inline in the text. Run with `run_in_background: true` since script mode may take longer.

**Submit (foreground)** with `--no-wait`:
```bash
RESULT=$($CMD_PREFIX create --text "{formatted script with speaker markers}" --mode smart --speaker "{name1}" --speaker "{name2}" --lang {lang} --no-wait --json)
ID=$(echo "$RESULT" | jq -r '.id')
echo "Submitted: $ID"
```

For long scripts, write to a temp file first:
```bash
cat > /tmp/lh-content.txt << 'ENDCONTENT'
SpeakerA: First line of dialogue
SpeakerB: Second line of dialogue
...
ENDCONTENT

RESULT=$($CMD_PREFIX create --text "$(cat /tmp/lh-content.txt)" --mode smart --speaker "{name1}" --speaker "{name2}" --lang {lang} --no-wait --json)
ID=$(echo "$RESULT" | jq -r '.id')

rm -f /tmp/lh-content.txt
```

**Poll (background)** with `run_in_background: true` and `timeout: 600000`:
```bash
ID="<id-from-above>"
for i in $(seq 1 60); do
  RESULT=$(listenhub creation get "$ID" --json 2>/dev/null)
  STATUS=$(echo "$RESULT" | jq -r '.status // "processing"')

  case "$STATUS" in
    completed) echo "$RESULT"; exit 0 ;;
    failed) echo "FAILED: $RESULT" >&2; exit 1 ;;
    *) sleep 10 ;;
  esac
done
echo "TIMEOUT" >&2; exit 2
```

**Step 6: Present result**

When the background task completes, parse the result:
```bash
AUDIO_URL=$(echo "$RESULT" | jq -r '.audioUrl')
SUBTITLES_URL=$(echo "$RESULT" | jq -r '.subtitlesUrl // empty')
DURATION=$(echo "$RESULT" | jq -r '.audioDuration // empty')
CREDITS=$(echo "$RESULT" | jq -r '.credits // empty')
```

Read `OUTPUT_MODE` from config. Follow `shared/output-mode.md` for behavior.

**`inline` or `both`**: Display the `audioUrl` and `subtitlesUrl` as clickable links.

Present:
```
Audio generated!

在线收听：{audioUrl}
字幕：{subtitlesUrl}
时长：{audioDuration / 1000}s
消耗积分：{credits}
```

**`download` or `both`**: Also download the file. Generate a topic slug following `shared/config-pattern.md` § Artifact Naming.
```bash
SLUG="{topic-slug}"  # e.g. "welcome-dialogue"
NAME="${SLUG}.mp3"
# Dedup: if file exists, append -2, -3, etc.
BASE="${NAME%.*}"; EXT="${NAME##*.}"; i=2
while [ -e "$NAME" ]; do NAME="${BASE}-${i}.${EXT}"; i=$((i+1)); done
curl -sS -o "$NAME" "$AUDIO_URL"
```
Present:
```
已保存到当前目录：
  {NAME}
```

---

## Updating Config

When saving preferences, merge into `.listenhub/tts/config.json` — do not overwrite unchanged keys.

- Quick voice: set `defaultSpeakers.{language}[0]` to the selected `speakerId`
- Script voices: set `defaultSpeakers.{language}` to the full array assigned this session
- Language: set `language` if the user explicitly specifies it

## API Reference

- CLI execution patterns: `shared/cli-patterns.md`
- CLI authentication: `shared/cli-authentication.md`
- Speaker list: `shared/cli-speakers.md`
- Speaker selection guide: `shared/speaker-selection.md`
- Config pattern: `shared/config-pattern.md`
- Output mode: `shared/output-mode.md`

## Composability

- **Invokes**: speakers CLI (for speaker selection)
- **Invoked by**: explainer (for voiceover)

## Examples

**Quick mode:**

> "TTS this: The server will be down for maintenance at midnight."

1. Detect: Quick mode (plain text, "TTS this")
2. Read config: `defaultSpeakers.en` is empty
3. Use built-in default: Mars (`cozy-man-english`)
4. Confirm → user approves
5. Generate:
   ```bash
   RESULT=$($CMD_PREFIX create --text "The server will be down for maintenance at midnight." --mode direct --speaker "Mars" --lang en --json)
   AUDIO_URL=$(echo "$RESULT" | jq -r '.audioUrl')
   ```
6. Present: display `audioUrl` as link (inline mode)

**Script mode:**

> "帮我做一段双人对话配音，A说：欢迎大家，B说：谢谢邀请"

1. Detect: Script mode ("双人对话")
2. Parse segments: A -> "欢迎大家", B -> "谢谢邀请"
3. Read config: `defaultSpeakers.zh` empty
4. Use built-in defaults: 原野 (Primary) + 高晴 (Secondary)
5. Confirm → user approves
6. Generate:
   ```bash
   RESULT=$($CMD_PREFIX create --text "A: 欢迎大家
   B: 谢谢邀请" --mode smart --speaker "原野" --speaker "高晴" --lang zh --no-wait --json)
   ID=$(echo "$RESULT" | jq -r '.id')
   ```
7. Poll in background until complete
8. Present: `audioUrl`, `subtitlesUrl`, duration
