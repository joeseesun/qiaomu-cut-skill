# CLI Authentication

## Prerequisites

- **Node.js >= 20**
- **ListenHub CLI** (auto-installed if missing)

## Auth Check

Run this before any CLI operation. The check handles both installation and login automatically — never ask the user to run install commands manually.

```bash
# 1. Auto-install if missing
if ! command -v listenhub &>/dev/null; then
  npm install -g @marswave/listenhub-cli
fi

# 2. Verify install succeeded
if ! command -v listenhub &>/dev/null; then
  echo "INSTALL_FAILED"
  # Stop here — tell user their Node.js/npm setup needs attention
fi

# 3. Check for updates (skip if just installed)
CURRENT_V=$(listenhub --version 2>/dev/null)
LATEST_V=$(npm view @marswave/listenhub-cli version 2>/dev/null)
if [ -n "$CURRENT_V" ] && [ -n "$LATEST_V" ] && [ "$CURRENT_V" != "$LATEST_V" ]; then
  npm install -g @marswave/listenhub-cli
fi

# 4. Check auth
AUTH=$(listenhub auth status --json 2>/dev/null)
AUTHED=$(echo "$AUTH" | jq -r '.authenticated // false')
```

### If install fails

If `npm install -g` fails (e.g., permission issues, Node.js not available), tell the user:

> ListenHub CLI auto-install failed. Please check your Node.js (>= 20) and npm setup, then retry.

Do **not** ask them to run `npm install -g @marswave/listenhub-cli` manually — diagnose the issue first (permissions, PATH, Node version).

### If not logged in

If `.authenticated` is `false`, run `listenhub auth login` directly — this opens the browser for OAuth. Wait for completion, then re-check auth status.

```bash
if [ "$AUTHED" != "true" ]; then
  listenhub auth login
  # Re-verify after login
  AUTH=$(listenhub auth status --json 2>/dev/null)
  AUTHED=$(echo "$AUTH" | jq -r '.authenticated // false')
fi
```

### If update check is slow

The `npm view` call is typically fast (< 2s). If it fails (network issues, npm registry down), silently skip the update and proceed with the installed version. Never block the user on a version check failure.

## Auth Mode Detection (Dual-Mode)

The CLI supports two auth modes. After confirming the CLI is installed, detect which is active and set a command prefix for the session:

```bash
# Check if OpenAPI key is configured
OPENAPI_STATUS=$(listenhub openapi config show --json 2>/dev/null)
HAS_OPENAPI=$(echo "$OPENAPI_STATUS" | jq -r '.source // empty')

# Check if internal auth is active
AUTH=$(listenhub auth status --json 2>/dev/null)
HAS_INTERNAL=$(echo "$AUTH" | jq -r '.authenticated // false')
```

**Priority:** If both are configured, prefer internal auth (richer features, local file upload support).

```bash
if [ "$HAS_INTERNAL" = "true" ]; then
  AUTH_MODE="internal"
elif [ -n "$HAS_OPENAPI" ]; then
  AUTH_MODE="openapi"
else
  # Neither configured — trigger internal auth login
  listenhub auth login
  AUTH_MODE="internal"
fi
```

### Command Prefix Mapping

Each skill maps to different subcommands depending on auth mode:

| Skill | Internal (`AUTH_MODE=internal`) | OpenAPI (`AUTH_MODE=openapi`) |
|-------|-------------------------------|------------------------------|
| tts | `listenhub tts` | `listenhub openapi tts` |
| podcast | `listenhub podcast` | `listenhub openapi podcast` |
| image | `listenhub image` | `listenhub openapi image` |
| video | `listenhub video` | `listenhub openapi video` |
| explainer | `listenhub explainer` | `listenhub openapi storybook` |

Set `CMD_PREFIX` based on `AUTH_MODE` and skill type (see individual skill docs).

### OpenAPI Mode Constraints

- Media input support depends on the command. Check the individual skill docs before rejecting local paths.
- `listenhub openapi video create` supports local image/video/audio paths and uploads them before task creation; PixVerse (`listenhub openapi video pixverse ...`) remains URL/ID based.
- For commands that still require public URLs, if user provides local paths, inform them: "这个 OpenAPI 命令需要公网 URL，请先上传文件后提供链接。"
- API Key format: `lh_sk_...`, configured via `listenhub openapi config set-key` or env `LISTENHUB_API_KEY`
- On auth error (exit code 2): check key with `listenhub openapi config show`

## Security

- Credentials are stored at `~/.config/listenhub/credentials.json` (file mode `0600`)
- Tokens refresh automatically — no manual rotation needed
- Never log or display tokens in output
