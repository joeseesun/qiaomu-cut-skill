---
name: listenhub-voice
metadata:
  openclaw:
    emoji: "🎙️"
    requires:
      bin: ["listenhub"]
    primaryBin: "listenhub"
description: |
  End-to-end audio generation with ListenHub-Voice-1.0 (text / image → audio).
  Supports sound effects, multi-voice dialogue, reference-audio cloning, and a
  duration hint. Triggers on: "生成音频", "语音生成", "端到端音频", "图片转音频",
  "图片生成音频", "多音色对白", "参考音频克隆", "克隆音色", "音效生成", "生成音效".
---

## When to Use

- User wants end-to-end audio from text (with sound effects baked in by the model)
- User wants a multi-voice dialogue where each line is assigned to a different voice
- User wants to clone a voice from a reference audio clip
- User wants to turn a reference **image** into audio (image → audio)
- User wants pure sound-effect generation from a text description
- User says "生成音频", "端到端音频", "图片转音频", "多音色对白", "参考音频克隆", "音效"

## When NOT to Use

- User just wants a single registered ListenHub voice to read text aloud (use `/tts`) —
  `/tts` is lower-latency for plain narration with already-registered ListenHub speakers
- User wants a podcast-style discussion with topic exploration (use `/podcast`)
- User wants music or a cover song (use `/music`)
- User wants a video (use `/video-gen`)
- User wants to transcribe audio/video to text (use `/asr`)

`/tts` vs `/listenhub-voice`: `/listenhub-voice` is the ListenHub-Voice-1.0 **end-to-end** model —
text or image into a finished audio track that can include sound effects, multi-voice
dialogue, and reference-audio voice cloning, with an optional `durationHint` to target
an approximate length. Plain single-voice narration with an already-registered ListenHub
voice can still go through `/tts`.

## Purpose

Generate end-to-end audio with the **ListenHub-Voice-1.0** model. One async task takes a text
script (and optionally voices, a reference image, audio params, and a duration hint) and
returns a finished audio file. Modes:

- **Plain text / sound effects** — no `voices`, no `image`. The model synthesizes the text
  and any sound effects described in it.
- **Single voice** — `voices` with 1 item, either a registered ListenHub speaker / Official
  `voice_type` (`type: speaker`) or a reference-audio clone (`type: reference`).
- **Multi-voice dialogue** — `voices` with 2–3 items; the script assigns each line with
  `@音频1` / `@音频2` prefixes in `voices` array order. Every item in a multi-voice request
  must be reference-audio-capable (official `voice_type` is single-voice only).
- **Reference-audio cloning** — `voices` item of `type: reference` pointing at a public
  audio URL to clone that voice.
- **Image → audio** — an `image` (url or data). **Mutually exclusive with `voices`.**

## Hard Constraints

- Always check CLI auth following `shared/cli-authentication.md`
- Follow `shared/cli-patterns.md` for CLI execution, errors, and interaction patterns
- Always read config following `shared/config-pattern.md` before any interaction
- Follow `shared/output-mode.md` for result presentation — `download` mode saves
  `{slug}.{ext}` (ext = `audioConfig.format`: `mp3` default / `wav` / `pcm` / `ogg_opus`)
  to cwd with dedupe per `shared/config-pattern.md` § Artifact Naming
- Always use the async pattern: submit returns a `taskId`, then **poll** the task endpoint
  until `success` / `failed` — never block waiting on a single call
- `image` and `voices` are **mutually exclusive** — never send both in one request
- Multi-voice (`voices` length > 1): every item must be reference-audio-capable; a Official
  `voice_type` (`type: speaker`) is single-voice only and will be rejected in a multi-voice request
- Never expose provider routing, credentials, internal status names, DAO, MongoDB, or
  callback internals — work only from the public 3-endpoint contract below

<HARD-GATE>
Use the AskUserQuestion tool for every multiple-choice step — do NOT print options
as plain text. Ask one question at a time. Wait for the user's answer before
proceeding to the next step. After all parameters are collected, summarize the
choices and ask the user to confirm. Do NOT call the generate endpoint until the
user has explicitly confirmed.
</HARD-GATE>

## Step -1: CLI Command Gate (ListenHub Voice HTTP fallback)

> ⚠️ **CLI status:** `listenhub-cli` does **not** yet ship a `listenhub-voice` subcommand.
> All examples below therefore call the OpenAPI HTTP contract directly with `curl` and a
> Bearer API Key (`lh_sk_...`). When a `listenhub-voice` CLI subcommand ships, this skill should
> be updated to prefer it (mirroring `/video-gen`'s `$CMD_PREFIX` pattern).

Detect whether a future CLI subcommand exists; if not, fall back to HTTP:

```bash
if listenhub listenhub-voice --help &>/dev/null; then
  LISTENHUB_VOICE_MODE="cli"
else
  echo "LISTENHUB_VOICE_COMMAND_UNAVAILABLE — falling back to OpenAPI HTTP (curl)"
  LISTENHUB_VOICE_MODE="http"
fi
```

For `http` mode, an OpenAPI API Key is required. Read it from config or env:

```bash
API_BASE="https://api.marswave.ai/openapi"   # OpenAPI base; see shared/cli-authentication.md
API_KEY="${LISTENHUB_API_KEY:-$(listenhub openapi config show --json 2>/dev/null | jq -r '.apiKey // empty')}"
if [ -z "$API_KEY" ]; then
  echo "需要 OpenAPI API Key（lh_sk_...）。请先用 listenhub openapi config set-key 配置，或设置 LISTENHUB_API_KEY 环境变量。"
fi
```

All requests authenticate with `Authorization: Bearer $API_KEY`.

## Step 0: Config Setup

Follow `shared/config-pattern.md` Step 0 (Zero-Question Boot).

**If file doesn't exist** — silently create with defaults and proceed:
```bash
mkdir -p ".listenhub/listenhub-voice"
echo '{"outputMode":"inline"}' > ".listenhub/listenhub-voice/config.json"
CONFIG_PATH=".listenhub/listenhub-voice/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

Session defaults (not persisted unless user reconfigures):
- model: `listenhub-voice-1.0` (the only valid value)
- audioConfig.format: `mp3`

**Do NOT ask any setup questions.** Proceed directly to the Interaction Flow.

**If file exists** — read config silently and proceed:
```bash
CONFIG_PATH=".listenhub/listenhub-voice/config.json"
[ ! -f "$CONFIG_PATH" ] && CONFIG_PATH="$HOME/.listenhub/listenhub-voice/config.json"
CONFIG=$(cat "$CONFIG_PATH")
OUTPUT_MODE=$(echo "$CONFIG" | jq -r '.outputMode // "inline"')
```

### Setup Flow (user-initiated reconfigure only)

Only run when the user explicitly asks to reconfigure. Ask:

1. **outputMode**: Follow `shared/output-mode.md` § Setup Flow Question.

Save immediately:
```bash
NEW_CONFIG=$(echo "$CONFIG" | jq --arg m "$OUTPUT_MODE" '. + {"outputMode": $m}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
CONFIG=$(cat "$CONFIG_PATH")
```

## Interaction Flow

### Step 1: Collect Text

Ask the user for the script / text to synthesize (required, ≤ 1400 characters, trimmed):

> 输入要合成的文本（≤1400 字）。需要音效就直接在文本里描述；多音色对白用 `@音频1` / `@音频2` 前缀指派每行台词。

Free text. Use as-is — do not modify unless the user asks for help.

### Step 2: Voice / Input Mode

```
Question: "音频用什么音色 / 输入方式？"
Options:
  - "无音色（纯文本 / 音效）" — No voices, no image → Step 3 (audio params)
  - "单个 ListenHub 音色" — voices=[{type:speaker, id:<ListenHub 代号>}] → Step 2a
  - "单个官方 voice_type" — voices=[{type:speaker, id:<voice_type>}] → Step 2a
  - "多音色对白（参考音频）" — voices=2–3 项，每项 type:reference → Step 2b
  - "参考音频克隆（单条）" — voices=[{type:reference, url:...}] → Step 2b
  - "图片 → 音频" — image (与 voices 互斥) → Step 2c
```

#### Step 2a: Single registered voice (`type: speaker`)

Collect one speaker `id`:
- **ListenHub voice code** — obtained from `GET /v1/speakers/list` (the registered
  ListenHub speakers). Follow `shared/speaker-selection.md` to let the user pick.
- **official `voice_type`** — e.g. `zh_female_vv_uranus_bigtts`. If the user already knows the
  `voice_type`, use it directly; the server auto-detects ListenHub vs Official codes.

Build: `voices = [{ "type": "speaker", "id": "<id>" }]`. Proceed to Step 3.

> Note: a official `voice_type` is **single-voice only** — it cannot be used in a multi-voice
> (>1 item) request.

#### Step 2b: Reference audio (`type: reference`)

Each reference item needs a **public** audio URL (`http`/`https`):
- ≤ 30s, ≤ 10MB, format `wav` / `mp3` / `pcm` / `ogg_opus`

For **single-clip cloning**: collect one URL → `voices = [{ "type": "reference", "url": "..." }]`.

For **multi-voice dialogue**: collect 2–3 reference URLs (max 3 total voices). Every item
must be reference-audio (or a mix of ListenHub speakers + reference audio — but **not** a
official `voice_type`). Then instruct the user to prefix each script line in `text` with
`@音频1` / `@音频2` / `@音频3` matching the `voices` array order (`@音频1` = `voices[0]`).

Build e.g.:
```json
"voices": [
  { "type": "reference", "url": "https://example.com/host.mp3" },
  { "type": "reference", "url": "https://example.com/guest.mp3" }
]
```
Proceed to Step 3.

#### Step 2c: Image → audio (`image`, mutually exclusive with `voices`)

Collect **one** image, either a public URL or Base64 (choose one — not both):
- Max 1 image, ≤ 10MB, format `jpeg` / `png` / `webp`

Build: `image = { "url": "https://..." }` **or** `image = { "data": "<base64>" }`.
Do **not** send `voices` in this mode. Proceed to Step 3.

### Step 3: Optional Audio Params

```
Question: "要调整音频参数吗？（默认：格式 mp3，语速/音量/音调不变）"
Options:
  - "用默认，跳过" — Skip, audioConfig omitted (server uses format mp3)
  - "我要调整" — Ask each below
```

If adjusting, ask one at a time (all optional, omit any the user doesn't set):

- **format**: `mp3`（默认） / `wav` / `pcm` / `ogg_opus`
- **speechRate** (语速): integer in **-50 .. 100**
- **loudnessRate** (音量): integer in **-50 .. 100**
- **pitchRate** (音调): integer in **-12 .. 12**

Build `audioConfig` with only the fields the user set.

### Step 4: Optional Duration Hint

```
Question: "要指定目标时长吗？（用于积分预估并提示模型生成「约 N 秒」）"
Options:
  - "不指定" — Omit durationHint
  - "指定秒数" — Collect an integer in 1 .. 110
```

### Step 5: Cost Note + Confirmation

> **计费**：按实际生成时长（秒）真扣，0.1125 积分/秒，向上取整、最低 1 积分。
> 创建时只做余额预检、不预占；出片后按真实音频时长结算。`durationHint` 可用于粗略预估
> （约 `ceil(durationHint × 0.1125)` 积分，实际以出片时长为准）。
> **限流**：60 秒内最多 5 次生成。

Present a summary and **wait for explicit confirmation** before calling generate:

```
准备生成音频：

  文本: {text 摘要}
  模式: {纯文本/音效 | 单音色(ListenHub/官方) | 多音色对白 | 参考音频克隆 | 图片→音频}
  voices: {无 | N 项}
  image: {无 | url/data}
  audioConfig: {默认 mp3 | 调整后的字段}
  durationHint: {无 | N 秒}
  预估: 约 {ceil(durationHint×0.1125) or "未指定时长，无预估"} 积分（按实结算）

  确认生成？
```

## Execution & Polling

### Submit (POST /v1/listenhub-voice/generate → 202)

Build the JSON body from collected values, then POST. The response is **202** with
`data.taskId` and `data.status = "pending"`.

```bash
BODY=$(jq -n \
  --arg text "$TEXT" \
  '{ model: "listenhub-voice-1.0", text: $text }')
# Add voices / image / audioConfig / durationHint / watermark only if set, e.g.:
# BODY=$(echo "$BODY" | jq --argjson v "$VOICES_JSON" '. + {voices: $v}')
# BODY=$(echo "$BODY" | jq --argjson img "$IMAGE_JSON" '. + {image: $img}')
# BODY=$(echo "$BODY" | jq --argjson ac "$AUDIOCONFIG_JSON" '. + {audioConfig: $ac}')
# BODY=$(echo "$BODY" | jq --argjson dh "$DURATION_HINT" '. + {durationHint: $dh}')

RESP=$(curl -sS -X POST "$API_BASE/v1/listenhub-voice/generate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY")
TASK_ID=$(echo "$RESP" | jq -r '.data.taskId // empty')
```

If `TASK_ID` is empty, surface the business error (`data` carries a `33xxx` code — see
Error Handling). Otherwise: "任务已提交，ID: {TASK_ID}，正在生成中…"

### Poll (GET /v1/listenhub-voice/tasks/{taskId})

Run with `run_in_background: true`. Poll until `success` / `failed`:

```bash
for i in $(seq 1 120); do
  RESULT=$(curl -sS "$API_BASE/v1/listenhub-voice/tasks/$TASK_ID" \
    -H "Authorization: Bearer $API_KEY" | jq -c '.data')
  STATUS=$(echo "$RESULT" | jq -r '.status')
  case "$STATUS" in
    success) echo "$RESULT"; exit 0 ;;
    failed)  echo "FAILED: $RESULT" >&2; exit 1 ;;
    *) sleep 5 ;;
  esac
done
echo "TIMEOUT" >&2; exit 2
```

Status flow: `pending` → `generating` → `uploading` → `success` | `failed`.
(Only these 5 public statuses exist — do not assume any other internal state.)

### Result Presentation

On `success`, parse the `ListenHubVoiceTask`:

```bash
AUDIO_URL=$(echo "$RESULT" | jq -r '.audioUrl')
AUDIO_DURATION=$(echo "$RESULT" | jq -r '.audioDuration')
CREDIT_CHARGED=$(echo "$RESULT" | jq -r '.creditCharged')
```

Read `OUTPUT_MODE` from config and follow `shared/output-mode.md`.

**`inline` or `both`** — display:
```
音频已生成！

  URL: {audioUrl}
  时长: {audioDuration}s（即计费时长）
  消耗: {creditCharged} 积分
```

**`download` or `both`** — save to cwd with a topic-based slug per
`shared/config-pattern.md` § Artifact Naming (ext = chosen `format`, default `mp3`):
```bash
SLUG="{topic-slug}"
EXT="${FORMAT:-mp3}"
NAME="${SLUG}.${EXT}"
BASE="${NAME%.*}"; i=2
while [ -e "$NAME" ]; do NAME="${BASE}-${i}.${EXT}"; i=$((i+1)); done
curl -sS -o "$NAME" "$AUDIO_URL"
echo "已保存到当前目录：$NAME"
```

**On `failed`**: read `errorMessage` (only present on failure) and show it; suggest checking
the script / voices / image and retrying.

**On timeout**: tell the user to check later with
`GET /v1/listenhub-voice/tasks/{taskId}`.

## Querying Past Tasks

List recent tasks (paginated, newest first):

```bash
# List (page/pageSize/status/keyword all optional)
curl -sS "$API_BASE/v1/listenhub-voice/tasks?page=1&pageSize=20" \
  -H "Authorization: Bearer $API_KEY" | jq '.data'

# Filter by status + fuzzy keyword on the script text (keyword ≤ 64 chars)
curl -sS "$API_BASE/v1/listenhub-voice/tasks?status=success&keyword=对白" \
  -H "Authorization: Bearer $API_KEY" | jq '.data.items'

# Get one task
curl -sS "$API_BASE/v1/listenhub-voice/tasks/$TASK_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '.data'
```

List response `data`: `{ items: [ListenHubVoiceTask], page, pageSize, total }`.
`status` filter accepts `pending | generating | uploading | success | failed`.

## API Contract (3 public endpoints)

All require `Authorization: Bearer lh_sk_...`.

### POST /v1/listenhub-voice/generate (async, returns 202)

Request body:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `model` | string | no | enum: only `listenhub-voice-1.0` (default `listenhub-voice-1.0`) |
| `text` | string | **yes** | trimmed, max 1400 chars; `@音频N` prefixes assign multi-voice lines |
| `voices` | array (1–3) | no | each item `{type}` + (`id` or `url`); see below. **Mutually exclusive with `image`** |
| `image` | object | no | `url` **or** `data` (exactly one); max 1, ≤10MB, jpeg/png/webp. **Mutually exclusive with `voices`** |
| `audioConfig` | object | no | `speechRate` -50..100, `loudnessRate` -50..100, `pitchRate` -12..12, `format` mp3\|wav\|pcm\|ogg_opus (default mp3) |
| `durationHint` | number | no | 1..110 (target seconds, for estimate + model hint) |
| `watermark` | boolean | no | add watermark |

`voices[]` item:
- `{ "type": "speaker", "id": "<code>" }` — `id` required. ListenHub voice code
  (from `GET /v1/speakers/list`) or a official `voice_type`. Server auto-detects.
- `{ "type": "reference", "url": "<http(s) url>" }` — `url` required. Public audio,
  ≤30s, ≤10MB, wav/mp3/pcm/ogg_opus.
- Multi-voice (>1 item): every item must be reference-audio-capable; official `voice_type`
  is single-voice only.

Response **202**: `{ data: { taskId, status: "pending" } }`.
Billing: 0.1125 credits/sec on actual duration (round up, min 1). Rate limit: 5 / 60s.

### GET /v1/listenhub-voice/tasks (list, newest first)

Query: `page` (default 1), `pageSize` (default 20, max 100),
`status` (`pending|generating|uploading|success|failed`), `keyword` (≤64, fuzzy match on script text).
Response `data`: `{ items: [ListenHubVoiceTask], page, pageSize, total }`.

### GET /v1/listenhub-voice/tasks/{taskId} (detail, own task only)

Response `data`: a single `ListenHubVoiceTask`.

### ListenHubVoiceTask (same contract for list items and detail)

| Field | Notes |
|-------|-------|
| `id` | task id |
| `status` | `pending → generating → uploading → success \| failed` |
| `model` | `listenhub-voice-1.0` |
| `params` | sanitized input params (no audio/image binary) |
| `audioUrl` | output audio URL — **only on `success`** |
| `audioDuration` | output duration in seconds = billed duration |
| `creditCharged` | actual credits charged (0 = not charged) |
| `creditRefunded` | refunded credits on failure (reconciliation only) |
| `errorMessage` | failure reason — **only on `failed`** |
| `createdAt` / `updatedAt` | millisecond timestamps |

> Endpoints intentionally **not** covered by this skill: `/v1/listenhub-voice/voices` and
> `/v1/listenhub-voice/estimate-credits`. To obtain a ListenHub voice code for `voices[].id`,
> use `GET /v1/speakers/list`.

## Error Handling

Standard HTTP/CLI error semantics plus business errors in the `data` payload:

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Parse JSON output |
| 1 | General error | Display stderr / response body to user |
| 2 | Auth error | Check API Key (`lh_sk_...`) via `listenhub openapi config show` or `LISTENHUB_API_KEY` |
| 3 | Timeout | Suggest checking task status later |

A `400` from generate carries a business error in `data` (insufficient credits, rate limit,
validation, etc.) — surface the `33xxx` business error code per `shared/cli-patterns.md`.

## Composability

| Direction | Description |
|-----------|-------------|
| `listenhub` router → `listenhub-voice` | Routed when user mentions end-to-end audio / 音效 / 多音色对白 / 图片转音频 via `/listenhub` |
| `listenhub-cli` router → `listenhub-voice` | Same routing via `/listenhub-cli` |
| `speakers (/v1/speakers/list)` → `listenhub-voice` | Source of ListenHub voice codes for `voices[].id` (`type: speaker`) |
| `listenhub-voice` → (none) | Independent terminal skill, no downstream dependencies |

## Examples

All examples authenticate with `-H "Authorization: Bearer lh_sk_..."` (omitted below for brevity).

### Single-voice narration (registered voice)

> "用这个 ListenHub 音色把这段文本读出来"

```bash
curl -sS -X POST "$API_BASE/v1/listenhub-voice/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "listenhub-voice-1.0",
    "text": "欢迎收听今天的节目。",
    "voices": [{ "type": "speaker", "id": "<listenhub-voice-code>" }]
  }'
```

### Reference-audio cloning

> "用这段参考音频的音色来念"

```bash
curl -sS -X POST "$API_BASE/v1/listenhub-voice/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "listenhub-voice-1.0",
    "text": "这是用参考音频克隆出来的声音。",
    "voices": [{ "type": "reference", "url": "https://example.com/voice.mp3" }]
  }'
```

### Multi-voice dialogue (@音频N)

> "做一段两个人的对白"

```bash
curl -sS -X POST "$API_BASE/v1/listenhub-voice/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "listenhub-voice-1.0",
    "text": "@音频1 你今天怎么样？\n@音频2 还不错，刚录完一集播客。",
    "voices": [
      { "type": "reference", "url": "https://example.com/host.mp3" },
      { "type": "reference", "url": "https://example.com/guest.mp3" }
    ]
  }'
```

### Image → audio

> "根据这张图片生成一段音频"

```bash
curl -sS -X POST "$API_BASE/v1/listenhub-voice/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "listenhub-voice-1.0",
    "text": "为这张图片配一段氛围音频。",
    "image": { "url": "https://example.com/scene.jpg" }
  }'
```

### Pure sound effects

> "生成一段下雨打雷的音效"

```bash
curl -sS -X POST "$API_BASE/v1/listenhub-voice/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "listenhub-voice-1.0",
    "text": "持续的中雨声，远处偶尔有雷声滚过，约 15 秒。",
    "durationHint": 15,
    "audioConfig": { "format": "mp3" }
  }'
```

## API Reference

- CLI authentication: `shared/cli-authentication.md`
- CLI execution patterns: `shared/cli-patterns.md`
- Config pattern: `shared/config-pattern.md`
- Output mode: `shared/output-mode.md`
- Speaker selection (ListenHub voice codes): `shared/speaker-selection.md`
