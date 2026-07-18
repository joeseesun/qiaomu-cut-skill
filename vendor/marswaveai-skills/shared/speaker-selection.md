# Speaker Selection Guide

## Built-in Default Speakers

When no user preference is saved, use these built-in defaults. This eliminates the need to ask about speakers on first use.

| Language | Role | Name | Speaker ID |
|----------|------|------|------------|
| `zh` | Primary (male) | 原野 | `CN-Man-Beijing-V2` |
| `zh` | Secondary (female) | 高晴 | `gaoqing3-bfb5c88a` |
| `en` | Primary (male) | Mars | `cozy-man-english` |
| `en` | Secondary (female) | Mia | `travel-girl-english` |

### How to use defaults

1. Check `config.defaultSpeakers.{language}` first
2. If not set, use the built-in defaults from the table above
3. Only show speaker selection UI if the user explicitly asks to change voices

**Single speaker**: use Primary for the language.
**Two speakers**: use Primary + Secondary for the language.

## Fetching Speakers

Always query the speaker list before presenting options (when user requests to change voice):

```bash
listenhub speakers list --lang {language} --json
```

See `shared/cli-speakers.md` for full query patterns.

Never hardcode speaker IDs — use the defaults above only as fallback when no user preference exists.

## Speaker Properties

Each speaker has:
- **name**: Display name (e.g., "Mars")
- **speakerId**: Technical ID to pass to API (e.g., "cozy-man-english")
- **gender**: `male` or `female`
- **language**: `zh` or `en`
- **demoAudioUrl**: Preview audio URL

## Presenting Options (user-initiated only)

Only show the speaker selection UI when the user explicitly asks to change voices (e.g., "change voice", "换个声音", "pick a different speaker").

### Step 1 — Output the full text table

Print the complete speaker list as a markdown table, then wait for the user to type their choice.

```
Available voices (N total):

| # | Name        | Gender | ID                  |
|---|-------------|--------|---------------------|
| 1 | Mars        | male   | cozy-man-english    |
| 2 | Mia         | female | travel-girl-english |
| 3 | Leo         | male   | leo-9328b6d2        |
| ...                                             |

Type a name, number, or ID to select.
```

Adapt the table header language to match the user's language (Chinese users -> Chinese headers, English users -> English headers).

Do NOT use `AskUserQuestion` for speaker selection — just show the table and wait for free-text input.

### Step 2 — Input matching

| Input | Matching rule |
|---|---|
| Number (e.g. "3") | Match by row index in the table |
| Exact `speakerId` | Exact string match |
| Name text | Case-insensitive substring match on `name` |
| No match | Reply in user's language: "{input} not found, please try again" and re-prompt |

If multiple speakers match the name substring, print the matches as a short table and ask again.

## Default Behavior (no user preference)

If the config has `defaultSpeakers.{language}` set:
1. Skip the selection step
2. Use the saved speaker(s) directly
3. Show the speaker(s) in the confirmation summary — user can change from the summary if desired

If no default is saved in config:
1. Use the **built-in defaults** from the table above
2. Show the speaker(s) in the confirmation summary — user can change if desired
3. Do NOT show the full speaker list or ask for selection

## After Selection — Persist to Config

After the user explicitly selects a voice (not when using defaults), update `defaultSpeakers.{language}` in the skill's config:

```bash
NEW_CONFIG=$(echo "$CONFIG" | jq \
  --arg lang "en" \
  --argjson ids '["cozy-man-english"]' \
  '.defaultSpeakers[$lang] = $ids')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
```

For 2-speaker mode: array holds two IDs. If only one is saved, use the built-in secondary default for the language.
