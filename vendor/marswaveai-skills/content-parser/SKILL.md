---
name: content-parser
description: |
  Extract and parse content from URLs. Triggers on: user provides a URL to extract
  content from, another skill needs to parse source material, "parse this URL",
  "extract content", "解析链接", "提取内容".
metadata:
  openclaw:
    emoji: "🔗"
    requires:
      env: ["LISTENHUB_API_KEY"]
    primaryEnv: "LISTENHUB_API_KEY"
---

## When to Use

- User provides a URL and wants to extract/read its content
- Another skill needs to parse source material from a URL before generation
- User says "parse this URL", "extract content from this link"
- User says "解析链接", "提取内容"

## When NOT to Use

- User already has text content and doesn't need URL parsing
- User wants to generate audio/video content (not content extraction)
- User wants to read a local file (use standard file reading tools)

## Purpose

Extract and normalize content from URLs across supported platforms. Returns structured data including content body, metadata, and references. Useful as a preprocessing step for content generation skills or standalone content extraction.

## Hard Constraints

- No shell scripts. Construct curl commands from the API Reference (Inlined) section below
- See § API Reference (Inlined) below for API key and headers
- See § API Reference (Inlined) below for polling, errors, and interaction patterns
- URL must be a valid HTTP(S) URL
- Always read config following `shared/config-pattern.md` before any interaction
- Never save files to `~/Downloads/` or `.listenhub/` — save to the current working directory

<HARD-GATE>
Use the AskUserQuestion tool for every multiple-choice step — do NOT print options as plain text. Ask one question at a time. Wait for the user's answer before proceeding to the next step. After collecting URL and options, confirm with the user before calling the extraction API.
</HARD-GATE>

## Step -1: API Key Check

Follow `shared/config-pattern.md` § API Key Check. If the key is missing, stop immediately.

## Step 0: Config Setup

Follow `shared/config-pattern.md` Step 0 (Zero-Question Boot).

**If file doesn't exist** — silently create with defaults and proceed:
```bash
mkdir -p ".listenhub/content-parser"
echo '{"autoDownload":true}' > ".listenhub/content-parser/config.json"
CONFIG_PATH=".listenhub/content-parser/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```
**Do NOT ask any setup questions.** Proceed directly to the Interaction Flow.

**If file exists** — read config silently and proceed:
```bash
CONFIG_PATH=".listenhub/content-parser/config.json"
[ ! -f "$CONFIG_PATH" ] && CONFIG_PATH="$HOME/.listenhub/content-parser/config.json"
CONFIG=$(cat "$CONFIG_PATH")
```

### Setup Flow (user-initiated reconfigure only)

Only run when the user explicitly asks to reconfigure. Display current settings:
```
当前配置 (content-parser)：
  自动下载：{是 / 否}
```

Then ask:

1. **autoDownload**: "自动保存提取的内容到当前目录？"
   - "是（推荐）" → `autoDownload: true`
   - "否" → `autoDownload: false`

Save immediately:
```bash
NEW_CONFIG=$(echo "$CONFIG" | jq --argjson dl {true/false} '. + {"autoDownload": $dl}')
echo "$NEW_CONFIG" > "$CONFIG_PATH"
CONFIG=$(cat "$CONFIG_PATH")
```

## Interaction Flow

### Step 1: URL Input

Free text input. Ask the user:

> What URL would you like to extract content from?

### Step 2: Options (optional)

Ask if the user wants to configure extraction options:

```
Question: "Do you want to configure extraction options?"
Options:
  - "No, use defaults" — Extract with default settings
  - "Yes, configure options" — Set summarize, maxLength, or Twitter tweet count
```

If "Yes", ask follow-up questions:
- **Summarize**: "Generate a summary of the content?" (Yes/No)
- **Max Length**: "Set maximum content length?" (Free text, e.g., "5000")
- **Twitter count** (only if URL is Twitter/X profile): "How many tweets to fetch?" (1-100, default 20)

### Step 3: Confirm & Extract

Summarize:

```
Ready to extract content:

  URL: {url}
  Options: {summarize: true, maxLength: 5000, twitter.count: 50} / default

  Proceed?
```

Wait for explicit confirmation before calling the API.

## Workflow

1. **Validate URL**: Must be HTTP(S). Normalize if needed (see `references/supported-platforms.md`)
2. **Build request body**:
   ```json
   {
     "source": {
       "type": "url",
       "uri": "{url}"
     },
     "options": {
       "summarize": true/false,
       "maxLength": 5000,
       "twitter": {
         "count": 50
       }
     }
   }
   ```
   Omit `options` if user chose defaults.
3. **Submit (foreground)**: `POST /v1/content/extract` → extract `taskId`
4. Tell the user extraction is in progress
5. **Poll (background)**: Run the following **exact** bash command with `run_in_background: true` and `timeout: 300000`. Note: status field is `.data.status` (not `processStatus`), interval is 5s, values are `processing`/`completed`/`failed`:

   ```bash
   TASK_ID="<id-from-step-3>"
   for i in $(seq 1 60); do
     RESULT=$(curl -sS "https://api.marswave.ai/openapi/v1/content/extract/$TASK_ID" \
       -H "Authorization: Bearer $LISTENHUB_API_KEY" \
       -H "X-Source: skills" 2>/dev/null)
     STATUS=$(echo "$RESULT" | tr -d '\000-\037\177' | jq -r '.data.status // "processing"')
     case "$STATUS" in
       completed) echo "$RESULT"; exit 0 ;;
       failed) echo "FAILED: $RESULT" >&2; exit 1 ;;
       *) sleep 5 ;;
     esac
   done
   echo "TIMEOUT" >&2; exit 2
   ```
6. When notified, **download and present result**:

   If `autoDownload` is `true`, generate a slug from the extracted title (falling back to domain name if no title). Follow `shared/config-pattern.md` § Artifact Naming for slug generation and dedup.

   - Write `{slug}.md` to the **current directory** — full extracted content in markdown
   - Write `{slug}.json` to the **current directory** — full raw API response data

   ```bash
   SLUG="{title-slug}"  # e.g. "topology-wikipedia"
   # Dedup: check if files exist
   BASE="$SLUG"; i=2
   while [ -e "${SLUG}.md" ] || [ -e "${SLUG}.json" ]; do SLUG="${BASE}-${i}"; i=$((i+1)); done
   echo "$CONTENT_MD" > "${SLUG}.md"
   echo "$RESULT" > "${SLUG}.json"
   ```

   Present:
   ```
   内容提取完成！

   来源：{url}
   标题：{metadata.title}
   长度：~{character count} 字符
   消耗积分：{credits}

   已保存到当前目录：
     {slug}.md
     {slug}.json
   ```

7. Show a preview of the extracted content (first ~500 chars)
8. Offer to use content in another skill (e.g. `/podcast`, `/tts`)

**Estimated time**: 10-30 seconds depending on content size and platform.

## API Reference (Inlined)

### Authentication

**Environment variable**: `LISTENHUB_API_KEY` (format: `lh_sk_...`)

Store in `~/.zshrc` (macOS) or `~/.bashrc` (Linux):

```bash
export LISTENHUB_API_KEY="lh_sk_..."
```

**How to obtain**: Visit https://listenhub.ai/settings/api-keys (Pro plan required).

**Base URL**: `https://api.marswave.ai/openapi/v1`

**Required headers** (every request):

```
Authorization: Bearer $LISTENHUB_API_KEY
Content-Type: application/json
X-Source: skills
```

The `X-Source: skills` header identifies requests as coming from Claude Code skills (CLI tool).

**curl template:**

```bash
curl -sS -X POST "https://api.marswave.ai/openapi/v1/{endpoint}" \
  -H "Authorization: Bearer $LISTENHUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Source: skills" \
  -d '{ ... }'
```

For GET requests, omit `-d` and change `-X POST` to `-X GET`.

**Security notes:**
- Never log or display full API keys in output
- API keys are transmitted via HTTPS only
- Do not pass sensitive or confidential information as content input — it is sent to external APIs for processing

---

### POST /v1/content/extract

Create a content extraction task for a URL. Returns a `taskId` for polling.

**Request body:**

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| source | **Yes** | object | Source to extract from |
| source.type | **Yes** | string | Must be `"url"` |
| source.uri | **Yes** | string | Valid HTTP(S) URL to extract content from |
| options | No | object | Extraction options |
| options.summarize | No | boolean | Whether to generate a summary |
| options.maxLength | No | integer | Maximum content length |
| options.twitter | No | object | Twitter/X specific options |
| options.twitter.count | No | integer | Number of tweets to fetch (1-100, default 20) |

**Response:**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "taskId": "69a7dac700cf95938f86d9bb"
  }
}
```

**Error codes:**

| Code | Meaning |
|------|---------|
| 29003 | Validation error (`"source.uri" is required`, `"source.uri" must be a valid uri`) |
| 21007 | Invalid API key |

---

### GET /v1/content/extract/{taskId}

Get extraction task status and results.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| taskId | string | 24-char hex task ID |

**Response states:**

- **processing** — Task is still running
- **completed** — Extraction finished, data available
- **failed** — Extraction failed, check `failCode` and `message`

**Response (processing):**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "taskId": "69a7dac700cf95938f86d9bb",
    "status": "processing",
    "createdAt": "2025-04-09T12:00:00Z",
    "data": null,
    "credits": 0,
    "failCode": null,
    "message": null
  }
}
```

**Response (completed):**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "taskId": "69a7dac700cf95938f86d9bb",
    "status": "completed",
    "createdAt": "2025-04-09T12:00:00Z",
    "data": {
      "content": "Extracted text content...",
      "metadata": {
        "title": "Article Title",
        "author": "Author Name",
        "publishedAt": "2025-04-01T08:00:00Z"
      },
      "references": [
        "https://example.com/related-article"
      ]
    },
    "credits": 5,
    "failCode": null,
    "message": null
  }
}
```

**Response (failed):**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "taskId": "69a7dac700cf95938f86d9bb",
    "status": "failed",
    "createdAt": "2025-04-09T12:00:00Z",
    "data": null,
    "credits": 0,
    "failCode": "EXTRACT_FAILED",
    "message": "Unable to extract content from the provided URL"
  }
}
```

**Key fields:**

| Field | Type | Description |
|-------|------|-------------|
| status | string | `processing`, `completed`, or `failed` |
| data.data.content | string | Extracted text content |
| data.data.metadata | object | Page metadata (title, author, publishedAt) |
| data.data.references | array | Referenced URLs (array of strings) |
| credits | integer | Credits consumed |
| failCode | string | Error code (null on success) |
| message | string | Error message (null on success) |

**Error codes:**

| Code | Meaning |
|------|---------|
| 29003 | Invalid taskId format |
| 25002 | Task not found |

---

### Polling Pattern

5-second interval, 60 polls max. Run with `run_in_background: true` and `timeout: 300000`.

**Two-step pattern:**

1. **Submit (foreground)**: POST the creation request, extract `taskId` from the response.
2. **Poll (background)**: Run the polling loop with `run_in_background: true`. You will be notified automatically when it completes.

The exact polling bash command is already specified in the Workflow section (Step 5).

---

### Error Handling

**HTTP status codes:**

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Parse response body |
| 400 | Bad request | Check parameters |
| 401 | Invalid API key | Re-check `LISTENHUB_API_KEY` |
| 402 | Insufficient credits | Inform user to recharge |
| 403 | Forbidden | No permission for this resource |
| 429 | Rate limited | Exponential backoff, retry after delay |
| 500/502/503/504 | Server error | Retry up to 3 times |

**Retry strategy:**

- **429 rate limit**: Wait 15 seconds, then retry (exponential backoff)
- **5xx server errors**: Retry up to 3 times with 5-second intervals
- **Network errors**: Retry up to 3 times

**Application error codes:**

| Code | Meaning |
|------|---------|
| 21007 | Invalid user API key |
| 25429 | Rate limited (application-level) |

## Example

**User**: "Parse this article: https://en.wikipedia.org/wiki/Topology"

**Agent workflow**:
1. URL: `https://en.wikipedia.org/wiki/Topology`
2. Options: defaults (omit options)
3. Submit extraction

```bash
curl -sS -X POST "https://api.marswave.ai/openapi/v1/content/extract" \
  -H "Authorization: Bearer $LISTENHUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Source: skills" \
  -d '{
    "source": {
      "type": "url",
      "uri": "https://en.wikipedia.org/wiki/Topology"
    }
  }'
```

4. Poll until complete:

```bash
curl -sS "https://api.marswave.ai/openapi/v1/content/extract/69a7dac700cf95938f86d9bb" \
  -H "Authorization: Bearer $LISTENHUB_API_KEY" \
  -H "X-Source: skills"
```

5. Present extracted content preview and offer next actions.

---

**User**: "Extract recent tweets from @elonmusk, get 50 tweets"

**Agent workflow**:
1. URL: `https://x.com/elonmusk`
2. Options: `{"twitter": {"count": 50}}`
3. Submit extraction

```bash
curl -sS -X POST "https://api.marswave.ai/openapi/v1/content/extract" \
  -H "Authorization: Bearer $LISTENHUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Source: skills" \
  -d '{
    "source": {
      "type": "url",
      "uri": "https://x.com/elonmusk"
    },
    "options": {
      "twitter": {
        "count": 50
      }
    }
  }'
```

4. Poll until complete, present results.
