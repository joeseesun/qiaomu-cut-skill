# HappyHorse Video Model Reference

## Models

| Model ID | Mode | Description |
|----------|------|-------------|
| `happyhorse-1.0-t2v` | Text-to-Video | Pure text prompt generation |
| `happyhorse-1.0-i2v` | Image-to-Video | First-frame animation |
| `happyhorse-1.0-r2v` | Reference-Image | Style/character transfer with [Image N] syntax |
| `happyhorse-1.0-video-edit` | Video Edit | Edit existing video with prompt guidance |

## CLI Mapping

The CLI uses `--model happyhorse` and auto-selects the appropriate sub-model based on input:

- No media → `t2v`
- `--first-frame` → `i2v`
- `--reference-image` (without video) → `r2v`
- `--reference-video` → `video-edit`

## Parameters by Mode

### Text-to-Video (`t2v`)

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| prompt | `--prompt` | ≤2500 中文 / ≤5000 非中文 | (required) |
| resolution | `--resolution` | 720p, 1080p | 1080p |
| ratio | `--ratio` | 16:9, 9:16, 1:1, 4:3, 3:4, 4:5, 5:4 | 16:9 |
| duration | `--duration` | 3–15 (integer) | 5 |
| seed | `--seed` | 0–2147483647 | (random) |

### Image-to-Video (`i2v`)

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| prompt | `--prompt` | optional | — |
| first-frame | `--first-frame` | jpg/png/webp, ≥300px, ≤20MB | (required) |
| resolution | `--resolution` | 720p, 1080p | 1080p |
| duration | `--duration` | 3–15 | 5 |
| seed | `--seed` | 0–2147483647 | (random) |

**No `ratio` param** — determined by input image.

### Reference-Image (`r2v`)

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| prompt | `--prompt` | required, supports [Image N] syntax | (required) |
| reference-image | `--reference-image` | 1–9 images, ≥400px short edge, ≤20MB | (required) |
| resolution | `--resolution` | 720p, 1080p | 1080p |
| ratio | `--ratio` | 16:9, 9:16, 1:1, 4:3, 3:4, 4:5, 5:4 | 16:9 |
| duration | `--duration` | 3–15 | 5 |
| seed | `--seed` | 0–2147483647 | (random) |

**Prompt [Image N] syntax:** `[Image 1]` refers to the first `--reference-image`, `[Image 2]` the second, etc.

### Video Edit

| Parameter | CLI Flag | Values | Default |
|-----------|----------|--------|---------|
| prompt | `--prompt` | required, describe edit intent | (required) |
| reference-video | `--reference-video` | 1 video, mp4/mov, 3–60s, ≤100MB | (required) |
| reference-image | `--reference-image` | 0–5 images, ≤20MB | — |
| resolution | `--resolution` | 720p, 1080p | 1080p |
| audio-setting | `--audio-setting` | auto, origin | auto |
| seed | `--seed` | 0–2147483647 | (random) |

**No `ratio` or `duration`** — output matches input video (capped at 15s).

## Input Constraints

### Images (all modes)
- Formats: JPEG, JPG, PNG, WEBP
- Size: ≤ 20MB
- First-frame: ≥ 300px width & height, ratio 1:2.5 ~ 2.5:1
- Reference: short edge ≥ 400px recommended

### Video (video-edit only)
- Formats: MP4, MOV (H.264 recommended)
- Duration: 3–60s (output capped at 15s)
- Resolution: short edge ≥ 360px, long edge ≤ 4096px
- Ratio: 1:2.5 ~ 2.5:1
- Size: ≤ 100MB
- Frame rate: > 8fps
- URL only (no base64)

## Output

- Format: MP4 (H.264), 24fps
- URL valid for 24 hours — download promptly
