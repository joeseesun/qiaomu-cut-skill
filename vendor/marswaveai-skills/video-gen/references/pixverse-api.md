# PixVerse Video Model Reference

PixVerse is exposed through a dedicated **Agent API** with nine atomic capabilities (plus a marketing agent). Unlike HappyHorse/SeeDance — which infer the sub-mode from the inputs — PixVerse requires an explicit `--capability` and uses its own CLI namespace:

```
listenhub openapi video pixverse generate --capability <cap> ...
listenhub openapi video pixverse estimate --capability <cap> ...
```

PixVerse is **OpenAPI-only** (`lh_sk_...` key) and all media inputs must be **public URLs** (no local file upload).

## Capabilities

| Capability | Description | Required inputs |
|------------|-------------|-----------------|
| `text_to_video` | Pure text prompt generation | prompt |
| `image_to_video` | Animate a still image | 1 image + prompt |
| `transition` | Single first→last transition | 2 images (first + last) |
| `multi_transition` | Multi-keyframe transition | `--pixverse-json` 携带 `multiTransition[]`（2–7 个关键帧；top-level `--image` 必须为空，默认 quality 360p） |
| `fusion` | Reference-image fusion with `@refName` prompt syntax | `--pixverse-json` 携带 `imageReferences[]`（1–8 个，每个 `{type,imageUrl,refName}`；prompt 须为每个 refName 写 `@refName`；top-level `--image` 必须为空） |
| `restyle` | Restyle a prior PixVerse video | `--source-video-id` (or `--source-task-id`) + `--restyle-id` |
| `mimic` | Mimic a video's motion onto an image | 1 image + 1 video (locked to 720p) |
| `lip_sync` | Drive a video's lips from audio or TTS | source video (`--source-video-id`/`--source-task-id`) + EITHER 1 audio OR TTS（TTS 必须走 `--pixverse-json '{"tts":{"speakerId":"…","content":"…"}}'`，见下方说明）。audio 与 tts 二选一，不能同时给 |
| `agent` | Marketing agent (ad_master / promo_mix) | `--agent-type`; quality 720p/1080p, duration 20/30/60 |

## Capability → CLI Flag Mapping

| Concept | CLI Flag | Notes |
|---------|----------|-------|
| capability | `--capability` | **required**, one of the nine above |
| model | `--model` | `pixverse` (default), `v6`, `v5`, `v4.5` |
| service region | `--language` | `zh` / `en` (default `en`) |
| prompt | `--prompt` | max 2048 chars |
| quality | `--quality` | `360p` / `540p` / `720p` / `1080p` (default `720p`) |
| aspect ratio | `--aspect-ratio` | `9:16` / `16:9` / `1:1` / `4:3` / `3:4` (default `16:9`) |
| duration | `--duration` | integer 1–60 (default 5) |
| image asset | `--image <url[:duration]>` | repeatable, max 10（top-level images；**fusion / multi_transition 必须留空**，参考帧走 `--pixverse-json`） |
| video asset | `--video <url[:duration]>` | repeatable, max 2 |
| audio asset | `--audio <url[:duration]>` | repeatable, max 1 |
| reuse prior task | `--source-task-id` | restyle / lip_sync source |
| agent type | `--agent-type` | `ad_master` / `promo_mix` (capability=agent) |
| restyle source video | `--source-video-id` | restyle / lip_sync |
| restyle id | `--restyle-id` | restyle |
| escape hatch | `--pixverse-json` | raw JSON for the nested `pixverse` object（fusion `imageReferences`、multi_transition `multiTransition`、lip_sync TTS `tts` 都靠它；dedicated flags override individual fields） |

> `--lip-sync-tts/--lip-sync-speaker-id/--lip-sync-content` 三个 flag 当前映射到 `lipSyncTts*` 字段，校验器/provider 不认（见 `lip_sync` 小节），**勿用**；TTS 走 `--pixverse-json` 的嵌套 `tts`。

Asset duration: append `:N` to a URL (e.g. `https://x.com/a.mp4:6`) to attach a per-asset duration in seconds; the URL may contain colons, only a trailing `:<integer>` is parsed as duration.

## Parameters by Capability

### `text_to_video`

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| prompt | `--prompt` | ≤2048 chars | (required) |
| quality | `--quality` | 360p / 540p / 720p / 1080p | 720p |
| aspectRatio | `--aspect-ratio` | 9:16 / 16:9 / 1:1 / 4:3 / 3:4 | 16:9 |
| duration | `--duration` | 1–60 | 5 |

### `image_to_video`

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| prompt | `--prompt` | ≤2048 chars | (recommended) |
| image | `--image` | 1 image URL | (required) |
| quality | `--quality` | 360p / 540p / 720p / 1080p | 720p |
| aspectRatio | `--aspect-ratio` | 9:16 / 16:9 / 1:1 / 4:3 / 3:4 | 16:9 |
| duration | `--duration` | 1–60 | 5 |

### `transition`

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| image | `--image` | 2 images (first + last, in order) | (required) |
| prompt | `--prompt` | ≤2048 chars | (optional) |
| quality | `--quality` | 360p / 540p / 720p / 1080p | 720p |
| duration | `--duration` | 1–60 | 5 |

### `multi_transition`

关键帧不走 top-level `--image`。契约要求 `pixverse.multiTransition[]`，且 top-level images **必须为空**（否则 `any.invalid` 拒绝）。通过 `--pixverse-json` 逃生舱传：

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| keyframes | `--pixverse-json` → `multiTransition[]` | 2–7 个，每个 `{imageUrl, duration, prompt}`（duration 为 0–30 整数，prompt 必填） | (required) |
| quality | `--quality` | 360p / 540p / 720p / 1080p | **360p** |
| duration | `--duration` | 1–60 | 5 |

```bash
--pixverse-json '{"multiTransition":[{"imageUrl":"https://example.com/k1.png","duration":3,"prompt":"第一段"},{"imageUrl":"https://example.com/k2.png","duration":3,"prompt":"第二段"}]}'
```

**Default quality is 360p** for multi_transition (override with `--quality` if needed). top-level `--image` 必须为空。

### `fusion`

参考图不走 top-level `--image`。契约要求 `pixverse.imageReferences[]`，且 top-level images **必须为空**（否则 `any.invalid` 拒绝）。通过 `--pixverse-json` 逃生舱传：

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| references | `--pixverse-json` → `imageReferences[]` | 1–8 个，每个 `{type, imageUrl, refName}`；`type` 为 `subject`/`background`；`refName` 须匹配 `/^[A-Za-z][A-Za-z0-9_]{0,31}$/` | (required) |
| prompt | `--prompt` | must contain `@refName` per reference | (required) |
| quality | `--quality` | 360p / 540p / 720p / 1080p | 720p |
| duration | `--duration` | 1–60 | 5 |

```bash
--pixverse-json '{"imageReferences":[{"type":"subject","imageUrl":"https://example.com/cat.png","refName":"cat"},{"type":"background","imageUrl":"https://example.com/city.png","refName":"city"}]}'
```

**Prompt `@refName` syntax:** every `imageReferences` entry must be referenced in the prompt with `@refName` (e.g. `让 @cat 在 @city 里奔跑`). Missing references are rejected by the contract. top-level `--image` 必须为空。

### `restyle`

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| source video | `--source-video-id` or `--source-task-id` | a prior PixVerse video | (required) |
| restyle id | `--restyle-id` | a PixVerse restyle preset id | (required) |
| prompt | `--prompt` | ≤2048 chars | (optional) |
| quality | `--quality` | 360p / 540p / 720p / 1080p | 720p |

### `mimic`

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| image | `--image` | 1 image (subject) | (required) |
| video | `--video <url[:duration]>` | 1 video (motion source)，时长 **5–30s** | (required) |
| quality | `--quality` | **720p (locked)** | 720p |
| duration | `--duration` | 1–60 | 5 |

**Quality is locked to 720p** for mimic — other values are rejected (prevents pricing NaN). 运动源视频时长须落在 **5–30s**（用 `--video <url>:N` 附带每素材时长；超出区间被契约拒绝）。

### `lip_sync`

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| source video | `--source-video-id` or `--source-task-id` | the video to drive | (required) |
| audio (option A) | `--audio <url[:duration]>` | 1 external audio URL，时长 **5–60s** | one of A/B required |
| TTS (option B) | `--pixverse-json` → `tts` | `{"speakerId":"…","content":"…"}` | one of A/B required |
| quality | `--quality` | 360p / 540p / 720p / 1080p | 720p |

**Source + EITHER audio OR TTS:** supply a source video (`--source-video-id` or `--source-task-id`) plus *either* one external audio file *or* nested TTS. 二选一，**不能同时给 audio 和 tts**（契约 `audioCount===1 && pixverse.tts` 直接拒绝）。

⚠️ **TTS 必须走 `--pixverse-json` 的嵌套 `tts` 字段，不要用 `--lip-sync-tts/--lip-sync-speaker-id/--lip-sync-content`。** 那三个 flag 在当前 CLI 里映射到 `lipSyncTtsSwitch/lipSyncTtsSpeakerId/lipSyncTtsContent`，而 lip_sync 校验器与 provider 只认嵌套的 `pixverse.tts={speakerId,content}`，所以那条路径端到端不通（无 audio + 无 `pixverse.tts` → `any.invalid`）。这是上游 listenhub-cli #250 的 flag→字段错配，待 CLI 修复前一律用 `--pixverse-json`：

```bash
--pixverse-json '{"tts":{"speakerId":"speaker_01","content":"大家好，欢迎来到本期节目"}}'
```

audio 须落在 **5–60s**（用 `--audio <url>:N` 附带时长；超出区间被契约拒绝）。

### `agent`

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| agent type | `--agent-type` | `ad_master` / `promo_mix` | (required) |
| image | `--image` | source materials (`promo_mix` requires ≥4) | per type |
| prompt | `--prompt` | brief / product description | (recommended) |
| quality | `--quality` | **720p / 1080p only** | 720p |
| duration | `--duration` | **20 / 30 / 60 only** | per type |

**Agent constraints:** quality is restricted to 720p/1080p and duration to 20/30/60. `promo_mix` requires **≥4 images**.

## Input Asset Constraints

- All assets are **public URLs** (OpenAPI mode — no local upload).
- Images: max 10 (`--image`, repeatable).
- Videos: max 2 (`--video`, repeatable).
- Audio: max 1 (`--audio`).
- Per-asset duration: append `:<seconds>` to the URL.

## Rate Limit

5 RPM per user (aligned with SeeDance).

## Output

- Format: MP4 (H.264).
- Result is polled with `listenhub openapi video get <taskId> --json` (PixVerse tasks share the standard video task store).
- URL valid for a limited window — download promptly.
