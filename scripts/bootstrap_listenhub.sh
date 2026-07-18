#!/usr/bin/env bash
set -euo pipefail

LISTENHUB_PACKAGE_NAME='@marswave/listenhub-cli'
LISTENHUB_PACKAGE_VERSION='0.0.15'
LISTENHUB_PROTOCOL_VERSION='0.1.0'
LISTENHUB_PACKAGE="${LISTENHUB_PACKAGE_NAME}@${LISTENHUB_PACKAGE_VERSION}"
COLI_PACKAGE_NAME='@marswave/coli'
COLI_PACKAGE_VERSION='0.0.20'
COLI_PACKAGE="${COLI_PACKAGE_NAME}@${COLI_PACKAGE_VERSION}"
MODE="${1:---check}"

if [[ "$MODE" != '--check' && "$MODE" != '--install' ]]; then
  echo 'Usage: bootstrap_listenhub.sh --check|--install' >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is required. Install Node.js 20 or newer first.' >&2
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "ListenHub requires Node.js 20 or newer; found $(node --version)." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo 'npm is required to install the ListenHub and Coli CLIs.' >&2
  exit 1
fi

package_version_for_executable() {
  local executable="$1"
  local expected_name="$2"

  node -e '
    const fs = require("fs");
    const path = require("path");
    const executable = process.argv[1];
    const expectedName = process.argv[2];
    let cursor;
    try {
      cursor = path.dirname(fs.realpathSync(executable));
    } catch {
      process.exit(1);
    }
    while (true) {
      const candidate = path.join(cursor, "package.json");
      if (fs.existsSync(candidate)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(candidate, "utf8"));
          if (metadata.name === expectedName && typeof metadata.version === "string") {
            process.stdout.write(metadata.version);
            process.exit(0);
          }
        } catch {}
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    process.exit(1);
  ' "$executable" "$expected_name"
}

LISTENHUB_STATUS='missing'
LISTENHUB_PACKAGE_FOUND=''
LISTENHUB_PROTOCOL_FOUND=''
COLI_STATUS='missing'
COLI_PACKAGE_FOUND=''

inspect_listenhub() {
  local executable=''
  LISTENHUB_STATUS='missing'
  LISTENHUB_PACKAGE_FOUND=''
  LISTENHUB_PROTOCOL_FOUND=''

  if ! executable="$(command -v listenhub 2>/dev/null)"; then
    return
  fi
  if ! LISTENHUB_PACKAGE_FOUND="$(package_version_for_executable "$executable" "$LISTENHUB_PACKAGE_NAME" 2>/dev/null)"; then
    LISTENHUB_STATUS='unverified-package'
    return
  fi
  if [[ ! "$LISTENHUB_PACKAGE_FOUND" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    LISTENHUB_PACKAGE_FOUND=''
    LISTENHUB_STATUS='unverified-package'
    return
  fi
  if [[ "$LISTENHUB_PACKAGE_FOUND" != "$LISTENHUB_PACKAGE_VERSION" ]]; then
    LISTENHUB_STATUS='wrong-package-version'
    return
  fi
  LISTENHUB_PROTOCOL_FOUND="$(env -u LISTENHUB_API_KEY "$executable" --version 2>/dev/null | tr -d '\r\n' || true)"
  if [[ ! "$LISTENHUB_PROTOCOL_FOUND" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    LISTENHUB_PROTOCOL_FOUND=''
    LISTENHUB_STATUS='unverified-protocol-version'
    return
  fi
  if [[ "$LISTENHUB_PROTOCOL_FOUND" != "$LISTENHUB_PROTOCOL_VERSION" ]]; then
    LISTENHUB_STATUS='wrong-protocol-version'
    return
  fi
  LISTENHUB_STATUS='ready'
}

inspect_coli() {
  local executable=''
  COLI_STATUS='missing'
  COLI_PACKAGE_FOUND=''

  if ! executable="$(command -v coli 2>/dev/null)"; then
    return
  fi
  if ! COLI_PACKAGE_FOUND="$(package_version_for_executable "$executable" "$COLI_PACKAGE_NAME" 2>/dev/null)"; then
    COLI_STATUS='unverified-package'
    return
  fi
  if [[ ! "$COLI_PACKAGE_FOUND" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    COLI_PACKAGE_FOUND=''
    COLI_STATUS='unverified-package'
    return
  fi
  if [[ "$COLI_PACKAGE_FOUND" != "$COLI_PACKAGE_VERSION" ]]; then
    COLI_STATUS='wrong-package-version'
    return
  fi
  if ! env -u LISTENHUB_API_KEY "$executable" asr --help >/dev/null 2>&1; then
    COLI_STATUS='asr-unavailable'
    return
  fi
  COLI_STATUS='ready'
}

inspect_listenhub
inspect_coli

if [[ "$MODE" == '--install' ]]; then
  if [[ "$LISTENHUB_STATUS" != 'ready' ]]; then
    env -u LISTENHUB_API_KEY npm install -g "$LISTENHUB_PACKAGE"
  fi
  if [[ "$COLI_STATUS" != 'ready' ]]; then
    env -u LISTENHUB_API_KEY npm install -g "$COLI_PACKAGE"
  fi
  inspect_listenhub
  inspect_coli
fi

OPENAPI_STATUS="$(node -e 'process.stdout.write(process.env.LISTENHUB_API_KEY ? "configured-in-environment" : "unset")')"

echo "Node: $(node --version)"
echo "ListenHub npm package: $LISTENHUB_STATUS (${LISTENHUB_PACKAGE_NAME} ${LISTENHUB_PACKAGE_FOUND:-not-verified}; expected ${LISTENHUB_PACKAGE_VERSION})"
echo "ListenHub CLI protocol: ${LISTENHUB_PROTOCOL_FOUND:-not-verified} (expected ${LISTENHUB_PROTOCOL_VERSION})"
echo "Coli npm package: $COLI_STATUS (${COLI_PACKAGE_NAME} ${COLI_PACKAGE_FOUND:-not-verified}; expected ${COLI_PACKAGE_VERSION})"
echo "LISTENHUB_API_KEY: $OPENAPI_STATUS"
echo 'Normal execution does not print credential values. Never enable shell xtrace while credentials are present.'
echo 'OpenAPI commands use LISTENHUB_API_KEY or the official local credential store; top-level internal commands use explicit OAuth login.'

if [[ "$LISTENHUB_STATUS" != 'ready' || "$COLI_STATUS" != 'ready' ]]; then
  if [[ "$MODE" == '--check' ]]; then
    echo 'Run bootstrap_listenhub.sh --install to install or repair the exact audited package versions.' >&2
  else
    echo 'Pinned package installation did not produce the audited CLI contract; check PATH and npm global prefix.' >&2
  fi
  exit 1
fi
