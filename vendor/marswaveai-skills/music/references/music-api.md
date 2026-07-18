# ListenHub Music API Reference

The `music` skill is driven by the `listenhub music` CLI. Default provider is **Mureka**.

## Models

| Model ID | Notes |
|----------|-------|
| `auto` | Let the provider pick the best model (default) |
| `mureka-7.6` | Mureka 7.6 |
| `mureka-8` | Mureka 8 |
| `mureka-9` | Mureka 9 |
| `mureka-o2` | Mureka O2 |

Models apply to the generation commands (`generate`, `remix`, `instrumental`, `soundtrack`, `track`, `extend`). `stem` uses its own separation models (see below).

## Commands

| Command | Kind | Inputs | Constraints | Output |
|---------|------|--------|-------------|--------|
| `generate` | async (task) | `--prompt` and/or `--lyrics`; `--model`, `--style`, `--title`, `--instrumental`, `--vocal-id` | At least one of `--prompt` / `--lyrics` | Task → song (audio URL, title, duration, credits) |
| `remix` | async (task) | one input source: `--audio <file>` XOR `--audio-url` XOR `--provider-song-id`; `--lyrics`, `--prompt`; `--model`, `--style`, `--title` | Exactly one input source. `--lyrics` and `--prompt` required | Task → re-created song |
| `instrumental` | async (task) | `--prompt` XOR `--reference-audio`; `--model`, `--title` | Exactly one of `--prompt` / `--reference-audio` | Task → instrumental track |
| `soundtrack` | async (task) | `--image` XOR `--video`; `--prompt`, `--model`, `--title` | Exactly one of `--image` / `--video` | Task → music scored to the media |
| `track` | async (task) | `--audio` XOR `--provider-song-id`; `--generate-type`; `--prompt`; `--lyrics` (when type is Vocals); `--vocal-gender`; `--generate-start` / `--generate-end` (seconds); `--model` | Exactly one input source. `--lyrics` only valid when `--generate-type Vocals` | Task → single isolated/generated track |
| `extend` | async (task) | `--audio` XOR `--provider-song-id`; `--prompt`, `--model` | One input source | Task → extended (longer) song |
| `cover` *(deprecated)* | async (task) | `--audio`; `--prompt`, `--style`, `--title`, `--instrumental` | Deprecated — prefer `remix` | Task → cover version |
| `recognize` | sync | `--audio` | — | Lyrics with line-level timestamps |
| `describe` | sync | `--audio` | — | Description, tags, genres, instruments |
| `stem` | sync | `--audio`; `--model audio-separation-1` \| `audio-separation-2` | — | ZIP download URL(s) of separated stems |
| `list` | sync | — | — | Recent music tasks and statuses |
| `get <taskId>` | sync | positional `taskId` | — | Status / result of one task |

## `--generate-type` values (track)

`Vocals`, `Instrumental`, `Drums`, `Bass`, `Guitar`, `Keyboard`, `Percussion`, `Strings`, `Synth`, `FX`, `Brass`, `Woodwinds`.

`--vocal-gender` accepts `male` | `female`.

## File constraints

| Input | Allowed formats | Max size |
|-------|-----------------|----------|
| Audio (most commands) | mp3, m4a | 10 MB |
| Audio (`track`) | mp3, m4a, wav | 10 MB |
| Image (`soundtrack`) | jpg, jpeg, png, webp | 10 MB |
| Video (`soundtrack`) | mp4, mov, avi, mkv, webm | 10 MB |

Time-range flags (`--generate-start`, `--generate-end`) are in **seconds**.

## Async vs sync

- **Async** (`generate`, `remix`, `instrumental`, `soundtrack`, `track`, `extend`, `cover`): return a task. Poll with `listenhub music get <taskId>` or let the CLI poll internally. Music generation can take up to ~10 minutes.
- **Sync** (`recognize`, `describe`, `stem`): return results directly in the same call.

## Output URLs

Generated audio and `stem` ZIP URLs are time-limited — download promptly when in `download` / `both` output mode.

## Output fields

A completed task's song(s) are in `tracks[]` (each with `audioUrl`, `title`, `duration`, `providerSongId`), and the spent credit is the top-level `creditCost`. Track `duration` (and the sync `recognize` result's `duration`) is reported in **seconds**.
