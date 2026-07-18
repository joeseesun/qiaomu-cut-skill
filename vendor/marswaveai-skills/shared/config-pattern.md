# Config Pattern

Reusable pattern for per-skill config lookup, creation, and update.

## CLI Auth Check

Run this **before Step 0** in every skill that uses the ListenHub CLI.

Follow `shared/cli-authentication.md` § Auth Check.

If CLI is not installed or not logged in, auto-install and auto-login as described in `shared/cli-authentication.md` — never ask the user to run commands manually.

## Config Location

Each skill stores config at:

```
.listenhub/{skill}/config.json
```

## Step 0: Config Setup (Zero-Question Boot)

Run before any interaction in every skill. The goal is **zero questions on first run** — create config silently with sensible defaults and proceed directly to the task.

### State A — File Doesn't Exist (first run)

**Do NOT ask any questions.** Silently create the config in the current directory with the skill's default values:

```bash
mkdir -p ".listenhub/{skill}"
echo '{...skill initial defaults...}' > ".listenhub/{skill}/config.json"
CONFIG_PATH=".listenhub/{skill}/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

Then proceed directly to the skill's **Interaction Flow** (skip Setup Flow entirely).

### State B — File Exists

Read the config silently and proceed:

```bash
CONFIG_PATH=".listenhub/{skill}/config.json"
[ ! -f "$CONFIG_PATH" ] && CONFIG_PATH="$HOME/.listenhub/{skill}/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

**Do NOT display config summary or ask for confirmation.** Proceed directly to the skill's Interaction Flow.

### Reconfigure (user-initiated only)

If the user explicitly asks to reconfigure (e.g., "reconfigure", "change settings", "重新配置"), then:

1. Display the current settings in a readable summary (skill-specific format)
2. Run the skill's **Setup Flow** to collect new preferences
3. Save updated values

This is the **only** time Setup Flow questions are asked.

## Setup Flow

Each skill defines its own Setup Flow — questions to collect preferences when the user explicitly requests reconfiguration. After answers are collected, **save immediately** using the merge pattern:

```bash
NEW_CONFIG=$(echo "$CONFIG" | jq '. + {"key": "value"}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
```

Never overwrite keys you didn't change — always use `jq '. + {...}'` merge.

## Reading Config Fields

```bash
CONFIG=$(cat "$CONFIG_PATH" 2>/dev/null || echo "{}")
OUTPUT_MODE=$(echo "$CONFIG" | jq -r '.outputMode // "inline"')
LANGUAGE=$(echo "$CONFIG" | jq -r '.language // empty')
```

## Writing Config

Merge pattern for updating individual fields after a session:

```bash
NEW_CONFIG=$(echo "$CONFIG" | jq '. + {"language": "zh", "defaultMode": "deep"}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
```

## Artifact Naming

Artifacts are saved to the **current working directory** with friendly, topic-based names.

### Slug Generation

After the topic/title is confirmed, generate a short filesystem-safe slug:

- Summarize the topic into 2-5 words
- Lowercase, hyphens for spaces, keep CJK characters
- Strip characters unsafe for filenames: `/ \ : * ? " < > |`
- Examples: `ai-developments`, `量子计算入门`, `react-hooks-tutorial`

### Dedup

Before saving, check for naming conflicts:

```bash
# For single files:
NAME="{slug}-podcast.mp3"
BASE="${NAME%.*}"; EXT="${NAME##*.}"
i=2; while [ -e "$NAME" ]; do NAME="${BASE}-${i}.${EXT}"; i=$((i+1)); done

# For folders:
DIR="{slug}-podcast"
i=2; while [ -d "$DIR" ]; do DIR="{slug}-podcast-${i}"; i=$((i+1)); done
```

### Single-File vs Folder

- **Single artifact** (one mp3, one md): save as `{slug}{suffix}.{ext}` in cwd
- **Multiple artifacts** (draft + final, script + audio): create `{slug}{suffix}/` folder in cwd

Each skill defines its own suffix and structure — see individual skill files.

## Output Mode

Read `outputMode` from config, then follow `shared/output-mode.md` for behavior.

```bash
OUTPUT_MODE=$(echo "$CONFIG" | jq -r '.outputMode // "inline"')
```
