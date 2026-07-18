# TTS Guide

## Quick Mode vs Script Mode

| Feature | Quick (`/v1/tts`) | Script (`/v1/speech`) |
|---------|-------------------|----------------------|
| Speakers | 1 (single voice) | Multiple (per-segment) |
| Input | Plain text | `scripts` JSON array |
| Response | Sync MP3 stream | Sync JSON with `audioUrl` |
| Best for | Chat, notifications, quick reads | Dialogue, audiobooks, narrated scripts |

## When to Use Each

### Quick Mode (`/v1/tts`)

Use when:
- Single paragraph or short text
- User says "read this", "TTS this", "朗读"
- No character roles or speaker assignments needed
- Instant audio for in-conversation use

### Script Mode (`/v1/speech`)

Use when:
- User mentions multiple characters, roles, or voices
- Content is dialogue (A says X, B replies Y)
- User says "多角色", "脚本", "对话", "script", "dialogue"
- User provides or wants to create per-segment speaker assignments

## Script Format

```json
{
  "scripts": [
    {"content": "Hello everyone, welcome.", "speakerId": "EN-Man-General-01"},
    {"content": "Thanks for having me!", "speakerId": "EN-Woman-General-01"},
    {"content": "Today we are talking about...", "speakerId": "EN-Man-General-01"}
  ]
}
```

Tips:
- Keep segments at natural speech boundaries (sentences or short paragraphs)
- Alternate speakers for a natural dialogue feel
- All `speakerId` values must be valid IDs from the speakers API
- Speakers should share the same language

## Language Auto-Detection

- Read `user-config.json.language` first
- If null: detect from text content — Chinese characters → `zh`, Latin script → `en`
- Never ask the user about language

## Voice Preference Persistence

- `user-config.json.quickVoice` — used for Quick mode
- `user-config.json.scriptVoices` — list of voices for Script mode characters
- After a new selection, ask: "Save this voice as your default?" — update file on yes
- On next run, if config has a value, use it silently without asking
