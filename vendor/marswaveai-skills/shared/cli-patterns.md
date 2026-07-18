# CLI Patterns

Reusable patterns for all skills that use the ListenHub CLI.

<HARD-GATE>
**Language Adaptation**: Always respond in the user's language. Chinese input -> Chinese output. English input -> English output. Mixed -> follow dominant language. This applies to all UI text, questions, confirmations, and error messages.
</HARD-GATE>

## Command Pattern

```bash
listenhub <command> create [options] --json
```

All creation commands follow this shape. The `--json` flag ensures machine-readable output for parsing with jq.

## Execution Modes

### Synchronous (default)

The CLI blocks until the task completes and returns the final result:

```bash
RESULT=$(listenhub podcast create --topic "AI trends" --lang zh --json)
echo "$RESULT" | jq -r '.audioUrl'
```

This is the simplest approach. Use it when the expected duration is short or when you want to wait for the result.

### Async with `--no-wait`

Returns a creation ID immediately without waiting for completion:

```bash
RESULT=$(listenhub podcast create --topic "AI trends" --lang zh --no-wait --json)
ID=$(echo "$RESULT" | jq -r '.id')
echo "Submitted: $ID"
```

Check status later:

```bash
listenhub creation get "$ID" --json
```

The `.status` field will be one of: `processing`, `completed`, `failed`.

### Timeout Reference

| Content type | Default timeout |
|-------------|----------------|
| podcast | 300s |
| tts | 300s |
| explainer | 600s |
| slides | 600s |
| image | 120s |
| music | 600s |

### Background Execution

For long-running commands, use the Bash tool's `run_in_background: true` parameter. This keeps the terminal responsive while the CLI waits for completion.

**Two-step pattern:**

1. **Submit (foreground)** with `--no-wait` to get the ID. Tell the user the task is submitted.
2. **Poll (background)** with `run_in_background: true`:

```bash
# Run with run_in_background: true
ID="<id-from-step-1>"
for i in $(seq 1 60); do
  RESULT=$(listenhub creation get "$ID" --json 2>/dev/null)
  STATUS=$(echo "$RESULT" | jq -r '.status // "processing"')

  case "$STATUS" in
    completed) echo "$RESULT"; exit 0 ;;
    failed) echo "FAILED: $RESULT" >&2; exit 1 ;;
    *) sleep 10 ;;
  esac
done
echo "TIMEOUT" >&2; exit 2
```

When the background task finishes, you will be notified with the output. Parse the result and present it to the user. If the task failed or timed out, report the error.

## JSON Output Parsing

All CLI commands with `--json` produce structured JSON. Parse with jq:

```bash
RESULT=$(listenhub tts create --text "Hello" --lang en --json)
AUDIO_URL=$(echo "$RESULT" | jq -r '.audioUrl')
STATUS=$(echo "$RESULT" | jq -r '.status')
```

## Error Handling

### Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Parse JSON output |
| 1 | General error | Check stderr for details |
| 2 | Auth error | Run `listenhub auth login` |
| 3 | Timeout | Retry or use `--no-wait` |

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `command not found: listenhub` | CLI not installed | Auto-install: run `npm install -g @marswave/listenhub-cli` silently, then retry |
| `Not authenticated` | Not logged in | Auto-login: run `listenhub auth login` directly |
| `Insufficient credits` | Account has no credits | Tell user to recharge at listenhub.ai |
| `Rate limited` | Too many requests | Wait and retry |
| `Invalid speaker` | Speaker ID not found | Re-query speakers list |
| `Request timeout` | Generation took too long | Retry or use `--no-wait` for async |

### Error Checking Pattern

```bash
RESULT=$(listenhub podcast create --topic "AI" --lang zh --json 2>/tmp/lh-err)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  ERROR=$(cat /tmp/lh-err)
  case $EXIT_CODE in
    2) echo "Auth error: run 'listenhub auth login'" ;;
    3) echo "Timeout: try --no-wait" ;;
    *) echo "Error: $ERROR" ;;
  esac
  rm -f /tmp/lh-err
  # Handle error appropriately
fi
rm -f /tmp/lh-err
```

## Interactive Parameter Collection

Skills must use the **AskUserQuestion tool** for all enumerable parameters, following a **conversational, step-by-step** approach. This renders an interactive picker in the terminal that users can navigate with arrow keys.

### Conversation Behavior (mandatory)

1. **One question at a time.** Ask a single question, then STOP and wait for the user's answer before proceeding to the next step. Do not batch multiple steps into one message unless the parameters are explicitly independent (e.g., resolution + aspect ratio).
2. **Wait for the answer.** Never assume a default and skip ahead. If the user hasn't answered, do not proceed.
3. **Confirm before executing.** After all parameters are collected, summarize the choices and ask the user to confirm before running any CLI command. This is the final gate.
4. **Be ready to go back.** If the user changes their mind or says something doesn't look right, revise and re-ask instead of pushing forward.

### How to Ask

**Always use the AskUserQuestion tool** -- do NOT print questions as plain text. Each step's `Question` and `Options` map directly to AskUserQuestion parameters:

```
Step definition in SKILL.md:          ->  AskUserQuestion tool call:

Question: "What language?"            ->  question: "What language?"
  - "Chinese (zh)" -- Mandarin         ->  options: [{label: "Chinese (zh)", description: "Mandarin"}
  - "English (en)" -- English          ->           {label: "English (en)", description: "English"}]
```

For **free text** steps (topic, URL, prompt), just ask the question in a normal text message and wait for the user to type their answer.

### Parameter Types

- **Multiple-choice -> AskUserQuestion**: language, mode, speaker count, generation style, resolution, aspect ratio
- **Free text -> normal message**: topic, content body, URL, image prompt
- **Sequential when dependent**: e.g., speaker list depends on language choice -- ask language first, then fetch speakers and present list
- **Batch when independent**: e.g., resolution + aspect ratio can be asked together in one AskUserQuestion call (multiple questions)
- **Options include descriptions**: not just labels -- explain what each choice means

## Long Text Input

When text content is long (e.g., a full article for TTS), passing it inline may hit shell argument length limits. Write to a temp file and use shell substitution:

```bash
# Write content to temp file
cat > /tmp/lh-content.txt << 'ENDCONTENT'
Very long text content goes here...
ENDCONTENT

# Use shell substitution to pass the file content
listenhub tts create --text "$(cat /tmp/lh-content.txt)" --lang zh --json

# Clean up
rm -f /tmp/lh-content.txt
```

**When to use temp files**: Always use this approach when text content exceeds a few KB.
