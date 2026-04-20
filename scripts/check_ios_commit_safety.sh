#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOCAL_CONFIG="src-tauri/tauri.ios.local.conf.json"
PROJECT_FILE="src-tauri/gen/apple/codex-monitor.xcodeproj/project.pbxproj"
INFO_PLIST="src-tauri/gen/apple/codex-monitor_iOS/Info.plist"
SCHEME_FILE="src-tauri/gen/apple/codex-monitor.xcodeproj/xcshareddata/xcschemes/codex-monitor_iOS.xcscheme"

declare -a findings=()

has_staged_change() {
  local path="$1"
  ! git diff --cached --quiet -- "$path"
}

staged_diff_contains() {
  local path="$1"
  local pattern="$2"

  git diff --cached --unified=0 -- "$path" | grep -E "$pattern" >/dev/null 2>&1
}

if has_staged_change "$LOCAL_CONFIG"; then
  findings+=("Do not commit ${LOCAL_CONFIG}. It contains per-machine iOS signing values.")
fi

if has_staged_change "$PROJECT_FILE" && staged_diff_contains "$PROJECT_FILE" '^\+.*(DEVELOPMENT_TEAM =|PRODUCT_BUNDLE_IDENTIFIER =|PROVISIONING_PROFILE|PROVISIONING_PROFILE_SPECIFIER|CODE_SIGN_STYLE =|CODE_SIGN_IDENTITY =|ProvisioningStyle =|DevelopmentTeam =)' ; then
  findings+=("Do not commit local iOS signing or bundle identifier drift in ${PROJECT_FILE}.")
fi

if has_staged_change "$INFO_PLIST"; then
  findings+=("Do not commit generated iOS Info.plist drift in ${INFO_PLIST} unless it is an intentional shared metadata change.")
fi

if has_staged_change "$SCHEME_FILE"; then
  findings+=("Do not commit generated Xcode scheme drift in ${SCHEME_FILE} unless it is an intentional shared scheme change.")
fi

if [[ ${#findings[@]} -eq 0 ]]; then
  exit 0
fi

{
  echo "[ios-guard] Refusing commit because staged changes look like local iOS signing or generated Xcode drift:"
  for finding in "${findings[@]}"; do
    echo "- $finding"
  done
  echo
  echo "Common recovery:"
  echo "  git restore --staged ${LOCAL_CONFIG} ${PROJECT_FILE} ${INFO_PLIST} ${SCHEME_FILE} 2>/dev/null || true"
  echo "  git restore ${PROJECT_FILE} ${INFO_PLIST} ${SCHEME_FILE} 2>/dev/null || true"
  echo
  echo "If a generated iOS file change is truly intentional, review it carefully and commit with --no-verify."
} >&2

exit 1
