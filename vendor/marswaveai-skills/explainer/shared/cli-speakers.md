# CLI Speakers

Query and use voice speakers via the ListenHub CLI. Commands work with both auth modes — use `$CMD_PREFIX` from the session's auth mode detection (see `cli-authentication.md` § Auth Mode Detection).

## Listing Speakers

```bash
# Determine speakers command prefix based on auth mode
if [ "$AUTH_MODE" = "openapi" ]; then
  SPEAKERS_CMD="listenhub openapi speakers"
else
  SPEAKERS_CMD="listenhub speakers"
fi

# All speakers
$SPEAKERS_CMD list --json

# Chinese speakers only
$SPEAKERS_CMD list --lang zh --json

# English speakers only
$SPEAKERS_CMD list --lang en --json
```

### Parsing the Response

```bash
SPEAKERS=$($SPEAKERS_CMD list --lang en --json)

# List all speaker names
echo "$SPEAKERS" | jq -r '.[].name'

# Get a specific speaker's ID
echo "$SPEAKERS" | jq -r '.[] | select(.name == "Mars") | .speakerId'

# Count available speakers
echo "$SPEAKERS" | jq 'length'
```

### Speaker Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | Display name (e.g., "Mars") |
| speakerId | string | ID to use in create commands |
| gender | string | `male` or `female` |
| language | string | `zh` or `en` |
| demoAudioUrl | string | Preview audio URL |

## Using Speakers in Create Commands

### By name

```bash
listenhub podcast create --topic "AI" --speaker "Mars" --lang en --json
```

### By ID

```bash
listenhub podcast create --topic "AI" --speaker-id "cozy-man-english" --lang en --json
```

### Multi-speaker (podcast, up to 2)

Repeat the `--speaker` flag:

```bash
listenhub podcast create --topic "AI" --speaker "Mars" --speaker "Mia" --lang en --json
```

Or with IDs:

```bash
listenhub podcast create --topic "AI" --speaker-id "cozy-man-english" --speaker-id "travel-girl-english" --lang en --json
```

## Integration with Speaker Selection

The interactive speaker selection flow in [speaker-selection.md](./speaker-selection.md) remains unchanged. The only difference is the underlying query mechanism:

- **Before**: `GET /speakers/list?language={language}` via curl
- **Now**: `listenhub speakers list --lang {language} --json`

The selection UI, default speakers, input matching, and config persistence all work the same way.
