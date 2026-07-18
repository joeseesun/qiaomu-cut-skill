# Narration Script Template

## Pipeline Steps

### 1. Prepare Material

Same as other templates — material from dispatcher.

### 1.5. Load Writing Context

Before writing, read and internalize:
- `../../writing-engine/forbidden-words.md` — 禁用词表
- `../../writing-engine/rhetoric.md` — 修辞技巧库
- `style.md` — 口播风格规则
- `script-prototypes.md` — 使用 Step 3a 中用户选定的脚本原型

Apply the prototype's beat structure when writing the script.

### 2. Generate Script

Write a spoken-word script following `style.md`:
- Hook opening
- 2-4 talking points with clear transitions
- Strong closing

Apply any user style directives from `.listenhub/creator/styles/narration.md` (if exists) and `sessionStyle` (from style reference) on top of the baseline style. `sessionStyle` takes priority over the user style file, which takes priority over `style.md`.

Save as `script.md` in the output folder.

### 2.5. Self-Review Loop

Execute the L1-L4 quality review per `../../writing-engine/quality-review.md`.

1. Run L1 (forbidden words scan against `../../writing-engine/forbidden-words.md`). Auto-fix any hits.
2. Run L2 (style consistency against `style.md` § Review Thresholds). Auto-fix any failures.
3. Run L3 (content quality, including L3-5 prototype-specific checks from `script-prototypes.md`). Auto-fix any failures.
4. Run L4 (aliveness review). Auto-fix any failures.

If any layer fails, auto-fix and re-run from L1. Maximum 3 full iterations.
If all layers pass: proceed silently to Step 3.
If cap hit: show user the cap-hit report per `../../writing-engine/quality-review.md` and await decision.

### 3. TTS Audio (Optional)

TTS is offered only if:
- The pipeline requires it (user asked for audio)
- `LISTENHUB_API_KEY` is available

If generating audio:

1. Select speaker:
   - Check `preferences.narration.defaultSpeaker` in config — if set, use it
   - Otherwise use built-in defaults from `shared/speaker-selection.md`:
     - Chinese: "原野" (`CN-Man-Beijing-V2`)
     - English: "Mars" (`cozy-man-english`)
   - On first TTS use, ask the user via AskUserQuestion if they want to choose a different speaker. Save their choice to `preferences.narration.defaultSpeaker` for future runs.

2. Call TTS API:
```bash
listenhub tts create --text "$(cat /tmp/lh-content.txt)" --speaker "$SPEAKER_ID" --json \
  | jq -r '.data' | base64 -D > "{output}/audio.mp3"
```

Note: TTS max input is ~10,000 characters. For longer scripts, this is still well within limits for narration (typically 300-2000 chars).

If TTS fails: deliver script without audio, note in output summary.

### 4. Write meta.json

```json
{
  "title": "...",
  "platform": "narration",
  "date": "YYYY-MM-DD",
  "wordCount": N,
  "hasAudio": true/false,
  "speaker": "speaker-name"
}
```

### Output Structure

```
{slug}-narration/
├── script.md
├── audio.mp3          (if TTS was generated)
└── meta.json
```
