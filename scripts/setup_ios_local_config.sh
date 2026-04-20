#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/ios-config.sh
. "${ROOT_DIR}/scripts/lib/ios-config.sh"

TEAM_ID=""
BUNDLE_ID=""
FORCE=0

usage() {
  cat <<'EOF'
Usage: scripts/setup_ios_local_config.sh [options]

Creates or updates src-tauri/tauri.ios.local.conf.json for local iOS signing.

Options:
  --team <id>         Apple development team ID (example: ABCDE12345)
  --bundle-id <id>    iOS bundle identifier (example: com.example.codexmonitor.ios)
  --force             Overwrite existing local config without prompting
  -h, --help          Show this help
EOF
}

fail() {
  echo "[ios-setup] ERROR: $*" >&2
  exit 1
}

prompt_value() {
  local prompt="$1"
  local default_value="${2:-}"
  local response=""

  if [[ -n "$default_value" ]]; then
    read -r -p "$prompt [$default_value]: " response
    printf '%s' "${response:-$default_value}"
    return
  fi

  read -r -p "$prompt: " response
  printf '%s' "$response"
}

validate_team_id() {
  local value="$1"

  [[ "$value" =~ ^[A-Z0-9]{10}$ ]] || fail "Apple team ID must be 10 uppercase letters/numbers. Received: $value"
}

validate_bundle_id() {
  local value="$1"

  [[ "$value" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]] || fail "Bundle ID must look like com.example.codexmonitor.ios. Received: $value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --team)
      TEAM_ID="${2:-}"
      shift 2
      ;;
    --bundle-id)
      BUNDLE_ID="${2:-}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is required to write ${IOS_LOCAL_CONFIG_PATH}."
fi

existing_team=""
existing_bundle=""
if ios_has_local_config; then
  existing_team="$(ios_local_config_value team)"
  existing_bundle="$(ios_local_config_value identifier)"
fi

if [[ -z "$TEAM_ID" ]]; then
  TEAM_ID="$(prompt_value "Apple development team ID" "$existing_team")"
fi
if [[ -z "$BUNDLE_ID" ]]; then
  BUNDLE_ID="$(prompt_value "iOS bundle identifier" "$existing_bundle")"
fi

[[ -n "$TEAM_ID" ]] || fail "Apple development team ID is required."
[[ -n "$BUNDLE_ID" ]] || fail "iOS bundle identifier is required."

validate_team_id "$TEAM_ID"
validate_bundle_id "$BUNDLE_ID"

if ios_has_local_config && [[ "$FORCE" -ne 1 ]]; then
  if [[ "$existing_team" != "$TEAM_ID" || "$existing_bundle" != "$BUNDLE_ID" ]]; then
    fail "${IOS_LOCAL_CONFIG_PATH} already exists. Re-run with --force to replace it."
  fi
fi

OUTPUT_PATH="$IOS_LOCAL_CONFIG_PATH" TEAM_ID="$TEAM_ID" BUNDLE_ID="$BUNDLE_ID" node <<'NODE'
const fs = require("fs");

const outputPath = process.env.OUTPUT_PATH;
const teamId = process.env.TEAM_ID;
const bundleId = process.env.BUNDLE_ID;

const payload = {
  $schema: "https://schema.tauri.app/config/2",
  identifier: bundleId,
  bundle: {
    iOS: {
      developmentTeam: teamId,
    },
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
NODE

echo "[ios-setup] Wrote ${IOS_LOCAL_CONFIG_PATH}"
echo "[ios-setup] Team:      ${TEAM_ID}"
echo "[ios-setup] Bundle ID: ${BUNDLE_ID}"

cat <<'EOF'

Next steps:
1. Open docs/ios-local-setup.md and follow the first-time Xcode bootstrap.
2. If this Mac has never provisioned your phone for this app, run:
   ./scripts/build_run_ios_device.sh --open-xcode
3. After the Xcode build succeeds once, use the CLI flow:
   ./scripts/build_run_ios_device.sh --list-devices
   ./scripts/build_run_ios_device.sh --device "<device name or identifier>"
EOF
