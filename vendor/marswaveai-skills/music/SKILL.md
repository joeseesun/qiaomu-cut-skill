---
name: music
description: |
  Generate, remix, extend, edit, and analyze AI music (Mureka). Triggers on:
  "音乐", "music", "生成音乐", "generate music", "翻唱", "cover", "混音", "remix",
  "续写", "extend", "纯音乐", "instrumental", "配乐", "soundtrack", "分轨", "stem",
  "识别歌词", "recognize lyrics", "作曲", "compose",
  "create a song", "做一首歌".
metadata:
  openclaw:
    emoji: "🎵"
    requires:
      bin: ["listenhub"]
    primaryBin: "listenhub"
---

## When to Use

- User wants to generate original AI music from a prompt and/or lyrics
- User wants to remix / re-create an existing song with new lyrics
- User wants a pure instrumental, or a soundtrack scored to an image or video
- User wants to extend a song or isolate/generate a single track
- User wants to analyze audio — recognize lyrics, describe a song, or split stems
- User says "音乐", "music", "生成音乐", "generate music", "翻唱"/"混音"/"remix", "续写"/"extend", "纯音乐"/"instrumental", "配乐"/"soundtrack", "分轨"/"stem", "识别歌词", "作曲", "compose", "create a song", or "做一首歌"

## When NOT to Use

- User wants text-to-speech reading (use `/speech`)
- User wants a podcast discussion (use `/podcast`)
- User wants an explainer video with narration (use `/explainer`)
- User wants to transcribe spoken audio to text — not song lyrics (use `/asr`)

## Purpose

Full ListenHub music toolkit, powered by the **Mureka** provider via the `listenhub music` CLI. Capabilities:

**Generation (async — return a task to poll):**

1. **generate** — text and/or lyrics → a new song. Optional style, title, instrumental, and a cloned `--vocal-id`.
2. **remix** — an existing song + new lyrics → a re-creation. Input is one of an audio file, an audio URL, or a provider song ID.
3. **instrumental** — a pure instrumental from a prompt, or guided by a reference audio.
4. **soundtrack** — music scored to an image or a video.
5. **track** — isolate or generate a single instrument/vocal track from a song.
6. **extend** — make a song longer.
7. **cover** *(deprecated)* — older cover flow; prefer **remix**.

**Analysis (sync — return results immediately):**

8. **recognize** — lyrics with line-level timestamps.
9. **describe** — description, tags, genres, instruments.
10. **stem** — split a song into separated stems (ZIP download URLs).

**Task management:** `list` (recent tasks) and `get <taskId>` (status/result of one task).

Models for generation commands: `auto` (default), `mureka-7.6`, `mureka-8`, `mureka-9`, `mureka-o2`. See `references/music-api.md` for the full per-command parameter reference.

## Hard Constraints

- Always read config following `shared/config-pattern.md` before any interaction
- Follow `shared/cli-patterns.md` for execution modes, error handling, and interaction patterns
- Always follow `shared/cli-authentication.md` for auth checks
- Never save files to `~/Downloads/` or `.listenhub/` — save artifacts to the current working directory with friendly topic-based names (see `shared/config-pattern.md` § Artifact Naming)
- No speakers involved — music generation does not use speaker selection
- File limits (all max 10 MB): audio mp3/m4a (`track` also accepts wav); image jpg/jpeg/png/webp; video mp4/mov/avi/mkv/webm
- All time-range flags are in **seconds** (`--generate-start/--generate-end`)
- For async generation commands, use a long timeout: `run_in_background: true` with `timeout: 660000` (600s+). Sync commands (`recognize`, `describe`, `stem`) return immediately
- `cover` is deprecated — steer users to `remix` unless they explicitly ask for `cover`

<HARD-GATE>
Use the AskUserQuestion tool for every multiple-choice step — do NOT print options as plain text. Ask one question at a time. Wait for the user's answer before proceeding to the next step. After all parameters are collected, summarize the choices and ask the user to confirm. Do NOT call any CLI command until the user has explicitly confirmed.

</HARD-GATE>

## Step -1: CLI Auth Check

Follow `shared/cli-authentication.md`. If the CLI is not installed or the user is not logged in, auto-install and auto-login — never ask the user to run commands manually.

## Step 0: Config Setup

Follow `shared/config-pattern.md` Step 0 (Zero-Question Boot).

**If file doesn't exist** — silently create with defaults and proceed:
```bash
mkdir -p ".listenhub/music"
echo '{"outputMode":"download","language":null}' > ".listenhub/music/config.json"
CONFIG_PATH=".listenhub/music/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```
**Do NOT ask any setup questions.** Proceed directly to the Interaction Flow.

**If file exists** — read config silently and proceed:
```bash
CONFIG_PATH=".listenhub/music/config.json"
[ ! -f "$CONFIG_PATH" ] && CONFIG_PATH="$HOME/.listenhub/music/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

### Setup Flow (user-initiated reconfigure only)

Only run when the user explicitly asks to reconfigure. Display current settings:
```
当前配置 (music)：
  输出方式：{inline / download / both}
  语言偏好：{zh / en / 未设置}
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
if [ "$LANGUAGE" != "null" ]; then
  NEW_CONFIG=$(echo "$NEW_CONFIG" | jq --arg lang "$LANGUAGE" '. + {"language": $lang}')
fi
echo "$NEW_CONFIG" > "$CONFIG_PATH"
CONFIG=$(cat "$CONFIG_PATH")
```

## Interaction Flow

### Step 1: Capability

Pick the capability. Skip the question if the user's intent is already clear (e.g., "翻唱"/"混音"/"remix" → remix; "作曲"/"compose"/"做一首歌" → generate; "纯音乐"/"instrumental" → instrumental; "续写"/"extend" → extend; "分轨"/"stem" → stem; "识别歌词" → recognize).

```
Question: "想做什么？"
Options:
  - "原创 (Generate)" — 用文字 / 歌词生成全新歌曲
  - "混音 (Remix)" — 基于已有歌曲 + 新歌词重新创作
  - "纯音乐 (Instrumental)" — 生成无人声的器乐
  - "配乐 (Soundtrack)" — 为图片或视频配乐
  - "其他" — 续写 / 单轨 / 识别歌词 / 描述 / 分轨
```

If the user picks "其他", follow up with a second AskUserQuestion listing: 续写 (Extend)、单轨 (Track)、识别歌词 (Recognize)、描述 (Describe)、分轨 (Stem).

`get <taskId>` and `list` are not interactive flows — run them directly when the user asks about a task's status.

### Step 2: Gather inputs (per capability)

Use the per-capability fields below. Ask for required inputs; offer optional ones. For any audio/image/video file, **validate** before confirming:

- Local path: verify the file exists and the extension matches the allowed list for that command (see Hard Constraints / `references/music-api.md`).
- URL: accept as-is (the CLI validates).
- Size: reject local files over 10 MB.

```bash
FILE_SIZE=$(stat -f%z "{path}" 2>/dev/null || stat -c%s "{path}" 2>/dev/null)
if [ "$FILE_SIZE" -gt 10485760 ]; then echo "File exceeds 10 MB limit"; fi
```

**generate** — `--prompt` and/or `--lyrics` (at least one); optional `--style`, `--title`, `--model`, `--instrumental`, `--vocal-id`.

**remix** — exactly one input source: `--audio` (file) / `--audio-url` / `--provider-song-id`; plus `--lyrics` and `--prompt` (both required); optional `--style`, `--title`, `--model`.

**instrumental** — exactly one of `--prompt` / `--reference-audio`; optional `--title`, `--model`.

**soundtrack** — exactly one of `--image` / `--video`; optional `--prompt`, `--title`, `--model`.

**track** — exactly one input source `--audio` / `--provider-song-id`; `--generate-type` (one of Vocals|Instrumental|Drums|Bass|Guitar|Keyboard|Percussion|Strings|Synth|FX|Brass|Woodwinds); optional `--prompt`; `--lyrics` only when type is Vocals; `--vocal-gender male|female`; `--generate-start`/`--generate-end` (seconds); `--model`.

**extend** — one input source `--audio` / `--provider-song-id`; optional `--prompt`, `--model`.

**recognize** / **describe** / **stem** — `--audio` only. `stem` also takes `--model audio-separation-1|audio-separation-2`.

For multi-choice fields (model, generate-type, vocal-gender, instrumental yes/no) use the AskUserQuestion tool. Free-text fields (prompt, lyrics, style, title) accept plain text.

### Step 3: Confirm

Summarize the capability and every collected parameter, then ask the user to confirm. Examples:

**generate:**
```
准备生成音乐：
  能力：原创 (Generate)
  描述：{prompt / 无}
  歌词：{lyrics / 无}
  风格：{style / 自动}
  标题：{title / 自动}
  模型：{model / auto}
  人声：{带人声 / 纯音乐}
  Vocal ID：{vocal-id / 无}
  确认？
```

**remix:**
```
准备混音：
  能力：混音 (Remix)
  原曲：{audio / audio-url / provider-song-id}
  新歌词：{lyrics}
  描述：{prompt}
  风格：{style / 自动}
  标题：{title / 自动}
  模型：{model / auto}
  确认？
```

For analysis capabilities (recognize / describe / stem) the summary is just the capability + the input audio (+ separation model for stem); these run synchronously, so confirmation can be lightweight.

Wait for explicit confirmation before running any CLI command.

## Workflow

### Async generation commands

`generate`, `remix`, `instrumental`, `soundtrack`, `track`, `extend`, `cover`.

1. **Submit (background)** with `run_in_background: true` and `timeout: 660000`. Always pass `--json`. Include only the flags the user provided; omit the rest.

   **generate:**
   ```bash
   listenhub music generate \
     --prompt "{prompt}" \
     --lyrics "{lyrics}" \
     --model "{model}" \
     --style "{style}" \
     --title "{title}" \
     --instrumental \
     --vocal-id "{vocal-id}" \
     --json
   ```

   **remix:**
   ```bash
   listenhub music remix \
     --audio "{path}" \
     --lyrics "{lyrics}" \
     --prompt "{prompt}" \
     --style "{style}" \
     --title "{title}" \
     --json
   ```
   (use exactly one of `--audio` / `--audio-url` / `--provider-song-id`)

   **instrumental:**
   ```bash
   listenhub music instrumental \
     --prompt "{prompt}" \
     --model "{model}" \
     --json
   ```
   (or `--reference-audio "{path}"` instead of `--prompt`)

   **soundtrack:**
   ```bash
   listenhub music soundtrack \
     --image "{path}" \
     --prompt "{prompt}" \
     --json
   ```
   (or `--video "{path}"` instead of `--image`)

   **track:**
   ```bash
   listenhub music track \
     --audio "{path}" \
     --generate-type "Vocals" \
     --lyrics "{lyrics}" \
     --vocal-gender "female" \
     --generate-start 0 --generate-end 30 \
     --json
   ```
   (or `--provider-song-id`; `--lyrics` only when `--generate-type Vocals`)

   **extend:**
   ```bash
   listenhub music extend \
     --audio "{path}" \
     --prompt "{how to continue}" \
     --json
   ```

   The CLI handles polling internally. Generation can take up to ~10 minutes.

2. Tell the user the task is submitted and that they'll be notified when it finishes. If they only have a `taskId`, they can check with `listenhub music get <taskId> --json` or `listenhub music list --json`.

3. When notified of completion, **present the result**. The CLI JSON is a task object — the song is in `tracks[0]`, credit is `creditCost`, and `duration` is in **seconds**. Parse the key fields:
   ```bash
   AUDIO_URL=$(echo "$RESULT" | jq -r '.tracks[0].audioUrl // empty')
   TITLE=$(echo "$RESULT" | jq -r '[.tracks[0].title, .params.title, "Untitled"] | map(select(. != null and . != "")) | .[0]')
   # duration is seconds (older pre-rollout Mureka tasks may still be ms → a value ≥ 3600 means ms)
   DURATION=$(echo "$RESULT" | jq -r '.tracks[0].duration // 0' \
     | awk '{d=$1; if (d>=3600) d/=1000; printf "%d:%02d", int(d/60), int(d%60)}')
   CREDITS=$(echo "$RESULT" | jq -r '.creditCost // empty')
   ```

   Read `OUTPUT_MODE` from config. Follow `shared/output-mode.md` for behavior.

   **`inline` or `both`**: Display the audio URL as a clickable link.
   ```
   音乐已生成！

   标题：{title}
   在线收听：{audioUrl}
   时长：{duration}
   消耗积分：{credits}
   ```

   **`download` or `both`**: Also download the file. Generate a slug from the title following `shared/config-pattern.md` § Artifact Naming.
   ```bash
   SLUG="{slug}"  # e.g. "summer-breeze"
   NAME="${SLUG}.mp3"
   # Dedup: if file exists, append -2, -3, etc.
   BASE="${NAME%.*}"; EXT="${NAME##*.}"; i=2
   while [ -e "$NAME" ]; do NAME="${BASE}-${i}.${EXT}"; i=$((i+1)); done
   curl -sS -o "$NAME" "{audioUrl}"
   ```
   ```
   已保存到当前目录：
     {NAME}
   ```

### Sync analysis commands

`recognize`, `describe`, `stem` return results in the same call — run them in the foreground (no background, no long timeout) and present immediately.

   **recognize** (lyrics + timestamps):
   ```bash
   listenhub music recognize --audio "{path}" --json
   ```

   **describe** (description, tags, genres, instruments):
   ```bash
   listenhub music describe --audio "{path}" --json
   ```

   **stem** (separated stems → ZIP download URLs):
   ```bash
   listenhub music stem --audio "{path}" --model "audio-separation-2" --json
   ```
   In `download`/`both` mode, download the ZIP URL(s) promptly to cwd.

### Task management

```bash
listenhub music list --json            # recent tasks
listenhub music get "{taskId}" --json   # one task's status / result
```

### After Successful Generation

Update config with the language used this session if the user explicitly specified one:

```bash
if [ -n "$LANGUAGE" ]; then
  NEW_CONFIG=$(echo "$CONFIG" | jq --arg lang "$LANGUAGE" '. + {"language": $lang}')
  echo "$NEW_CONFIG" > "$CONFIG_PATH"
fi
```

**Estimated times**:
- Music generation: 5-10 minutes

## Resources

- Per-command parameter reference: `references/music-api.md`
- CLI authentication: `shared/cli-authentication.md`
- CLI patterns: `shared/cli-patterns.md`
- Config pattern: `shared/config-pattern.md`
- Output mode: `shared/output-mode.md`

## Composability

- **Invokes**: nothing
- **Invoked by**: content-planner (Phase 3)

## Examples

**Generate original:**

> "帮我做一首关于夏天海边的歌"

1. Detect: generate mode ("做一首歌")
2. Read config (first run: create defaults with `outputMode: "download"`)
3. Infer: mode = generate, prompt = "夏天海边的歌"
4. Ask: style? title? instrumental?
5. Confirm summary → user confirms

```bash
listenhub music generate \
  --prompt "关于夏天海边的歌" \
  --json
```

Wait for CLI to return result, then download `{slug}.mp3` to cwd.

**Remix an existing song:**

> "用 demo.mp3 重新填词混音，把它做成 city pop 风格"

1. Detect: remix capability ("混音")
2. Validate: `demo.mp3` exists, is mp3/m4a, under 10 MB
3. Ask: new lyrics (`--lyrics`, required), prompt/direction (`--prompt`, required), style, title
4. Confirm summary → user confirms

```bash
listenhub music remix \
  --audio "demo.mp3" \
  --lyrics "{new lyrics}" \
  --prompt "rework as upbeat city pop" \
  --style "city pop" \
  --json
```

Wait for the CLI result, then download `{slug}.mp3` to cwd.

**Generate instrumental:**

> "Create an instrumental electronic track for a game intro"

1. Detect: instrumental capability ("instrumental")
2. Infer: prompt = "electronic track for a game intro"
3. Confirm summary → user confirms

```bash
listenhub music instrumental \
  --prompt "electronic track for a game intro" \
  --json
```

Wait for the CLI result, then download `{slug}.mp3` to cwd.

**Soundtrack for a video:**

> "给这段 clip.mp4 配一段紧张的背景音乐"

1. Detect: soundtrack capability ("配乐"), input is a video
2. Validate: `clip.mp4` exists (mp4/mov/avi/mkv/webm), under 10 MB
3. Infer: prompt = "紧张的背景音乐"
4. Confirm summary → user confirms

```bash
listenhub music soundtrack \
  --video "clip.mp4" \
  --prompt "tense, suspenseful background score" \
  --json
```

**Recognize lyrics (sync):**

> "帮我识别 song.mp3 里的歌词"

1. Detect: recognize capability ("识别歌词")
2. Validate: `song.mp3` exists, under 10 MB
3. Run in foreground and show lyrics with timestamps

```bash
listenhub music recognize --audio "song.mp3" --json
```

**Split stems (sync):**

> "把 track.mp3 分轨"

1. Detect: stem capability ("分轨")
2. Ask: separation model (audio-separation-1 / audio-separation-2)
3. Run in foreground; in download mode, fetch the ZIP URL to cwd

```bash
listenhub music stem --audio "track.mp3" --model "audio-separation-2" --json
```
