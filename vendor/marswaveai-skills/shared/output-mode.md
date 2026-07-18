# Output Mode

Reusable pattern for all skills that produce downloadable artifacts (audio, images).

## Config Field

Each skill stores `outputMode` in its `config.json`:

```json
{ "outputMode": "inline" }
```

Valid values: `"inline"` (default) | `"download"` | `"both"`

## Migration from `autoDownload`

When reading a config that has `autoDownload` but no `outputMode`, migrate silently:

```bash
CONFIG=$(cat "$CONFIG_PATH")
HAS_OUTPUT_MODE=$(echo "$CONFIG" | jq -r 'has("outputMode")')
if [ "$HAS_OUTPUT_MODE" = "false" ]; then
  OLD_DL=$(echo "$CONFIG" | jq -r '.autoDownload // true')
  if [ "$OLD_DL" = "true" ]; then NEW_MODE="download"; else NEW_MODE="inline"; fi
  CONFIG=$(echo "$CONFIG" | jq --arg m "$NEW_MODE" 'del(.autoDownload) + {"outputMode": $m}')
  echo "$CONFIG" > "$CONFIG_PATH"
fi
OUTPUT_MODE=$(echo "$CONFIG" | jq -r '.outputMode // "inline"')
```

## Setup Flow Question

Only asked during user-initiated reconfigure (not on first run — first run uses `"inline"` as default):

```
Question: "输出方式？"
Options:
  - "对话中展示（推荐）" — outputMode: "inline"
  - "下载到本地目录"     — outputMode: "download"
  - "两者都要"           — outputMode: "both"
```

Config summary display: `输出方式：inline / download / both`

## Save to Config

```bash
NEW_CONFIG=$(echo "$CONFIG" | jq --arg m "$OUTPUT_MODE" '. + {"outputMode": $m}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
CONFIG=$(cat "$CONFIG_PATH")
```

## Output Behavior Per Mode

### `inline` (default)

Show the result directly in the conversation. Do NOT save to `.listenhub/`.

- **Sync audio (TTS quick)**: Save to `/tmp/tts-{jobId}.mp3` during the curl call, then use the Read tool on that path. Clients that support audio show it inline; Claude Code terminal shows the file path.
- **Async audio (TTS script, podcast)**: Display the `audioUrl` as a clickable link. No download.
- **Async video (explainer)**: Display video URL + audio URL as clickable links. No download.
- **Image (image-gen)**: Save to `/tmp/image-gen-{jobId}.jpg` after base64 decode, then use the Read tool on that path. Image displays inline in all clients.

### `download`

Save to the **current working directory** with a friendly topic-based name. Follow `shared/config-pattern.md` § Artifact Naming for slug generation and dedup.

Each skill defines its own naming convention (see individual SKILL.md files).

Present:
```
已保存到当前目录：
  {filename or folder}/
```

### `both`

Execute `download` logic **and then** execute `inline` display logic for the same artifact.
