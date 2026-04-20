#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/ios-config.sh
. "${ROOT_DIR}/scripts/lib/ios-config.sh"

DEVICE=""
TARGET="${TARGET:-aarch64}"
BUNDLE_ID="${BUNDLE_ID:-}"
DEVELOPMENT_TEAM="${APPLE_DEVELOPMENT_TEAM:-}"
SKIP_BUILD=0
OPEN_XCODE=0
LIST_DEVICES=0
IOS_APP_ICONSET_DIR="src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset"
TAURI_CONFIG_ARGS=()
USE_DERIVED_DATA_APP=0
CURRENT_BUILD_DERIVED_DATA_APP=""
PROJECT_TARGET_BUILD_DIR=""
PROJECT_FULL_PRODUCT_NAME=""

usage() {
  cat <<'EOF'
Usage: scripts/build_run_ios_device.sh [options]

Builds the iOS app for physical devices, installs it to a USB-connected iPhone/iPad,
and launches it using devicectl.

Options:
  --device <id|name>   Required unless --list-devices is used.
                       Accepts UDID, serial, UUID, or device name.
  --target <target>    Tauri iOS target (default: aarch64)
  --bundle-id <id>     Bundle id to launch (default: resolved from Tauri iOS config)
  --team <id>          Apple development team ID (sets APPLE_DEVELOPMENT_TEAM)
  --skip-build         Skip build and only install + launch existing app
  --open-xcode         Open Xcode after build instead of install/launch via devicectl
  --list-devices       Print devices known by devicectl and exit
  -h, --help           Show this help
EOF
}

require_option_value() {
  local option_name="${1:?missing option name}"
  local option_value="${2:-}"

  if [[ -z "$option_value" || "$option_value" == --* ]]; then
    echo "Option ${option_name} requires a value." >&2
    exit 1
  fi

  printf '%s' "$option_value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      DEVICE="$(require_option_value "$1" "${2:-}")"
      shift 2
      ;;
    --target)
      TARGET="$(require_option_value "$1" "${2:-}")"
      shift 2
      ;;
    --bundle-id)
      BUNDLE_ID="$(require_option_value "$1" "${2:-}")"
      shift 2
      ;;
    --team)
      DEVELOPMENT_TEAM="$(require_option_value "$1" "${2:-}")"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --open-xcode)
      OPEN_XCODE=1
      shift
      ;;
    --list-devices)
      LIST_DEVICES=1
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

resolve_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return
  fi

  for candidate in /opt/homebrew/bin/npm /usr/local/bin/npm; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done

  if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "${NVM_DIR}/nvm.sh"
    if command -v npm >/dev/null 2>&1; then
      command -v npm
      return
    fi
  fi

  return 1
}

sync_ios_icons() {
  if [[ ! -d "$IOS_APP_ICONSET_DIR" ]]; then
    return
  fi
  if compgen -G "src-tauri/icons/ios/*.png" >/dev/null; then
    cp -f src-tauri/icons/ios/*.png "$IOS_APP_ICONSET_DIR"/
  fi
}

load_project_device_build_metadata() {
  local workspace="src-tauri/gen/apple/codex-monitor.xcodeproj/project.xcworkspace"
  local build_settings=""

  if [[ -n "$PROJECT_TARGET_BUILD_DIR" && -n "$PROJECT_FULL_PRODUCT_NAME" ]]; then
    return
  fi

  if [[ ! -d "$workspace" ]]; then
    return
  fi

  build_settings="$(xcodebuild \
    -workspace "$workspace" \
    -scheme codex-monitor_iOS \
    -configuration debug \
    -sdk iphoneos \
    -showBuildSettings 2>/dev/null || true)"

  if [[ -z "$build_settings" ]]; then
    return
  fi

  PROJECT_TARGET_BUILD_DIR="$(printf '%s\n' "$build_settings" | sed -n 's/^[[:space:]]*TARGET_BUILD_DIR = //p' | head -n 1)"
  PROJECT_FULL_PRODUCT_NAME="$(printf '%s\n' "$build_settings" | sed -n 's/^[[:space:]]*FULL_PRODUCT_NAME = //p' | head -n 1)"
}

derived_data_device_app_from_log() {
  local build_log="${1:-}"

  if [[ -z "$build_log" || ! -f "$build_log" ]]; then
    return
  fi

  sed -n 's#.*\([^"]*/Build/Products/[^/]*iphoneos/[^"]*\\.app\).*#\1#p' "$build_log" |
    sed 's#\\ # #g' |
    tail -n 1
}

project_derived_data_device_app() {
  local app_path=""

  load_project_device_build_metadata

  if [[ -z "$PROJECT_TARGET_BUILD_DIR" || -z "$PROJECT_FULL_PRODUCT_NAME" ]]; then
    return
  fi

  app_path="${PROJECT_TARGET_BUILD_DIR}/${PROJECT_FULL_PRODUCT_NAME}"
  if [[ -d "$app_path" ]]; then
    printf '%s' "$app_path"
  fi
}

latest_generated_build_app() {
  local build_root="src-tauri/gen/apple/build"
  local product_name=""
  local latest_path=""
  local latest_mtime=0

  if [[ ! -d "$build_root" ]]; then
    return
  fi

  load_project_device_build_metadata
  product_name="${PROJECT_FULL_PRODUCT_NAME:-Codex Monitor.app}"

  while IFS= read -r -d '' path; do
    local mtime
    mtime="$(stat -f '%m' "$path" 2>/dev/null || printf '0')"
    if [[ "$mtime" -gt "$latest_mtime" ]]; then
      latest_mtime="$mtime"
      latest_path="$path"
    fi
  done < <(find "$build_root" -maxdepth 4 -type d -name "$product_name" -print0 2>/dev/null)

  printf '%s' "$latest_path"
}

app_bundle_identifier() {
  local app_path="${1:-}"
  local plist_path=""

  if [[ -z "$app_path" || ! -d "$app_path" ]]; then
    return
  fi

  plist_path="${app_path}/Info.plist"
  if [[ ! -f "$plist_path" ]]; then
    return
  fi

  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist_path" 2>/dev/null || true
}

resolve_device_app_path() {
  local app_path=""

  if [[ "$USE_DERIVED_DATA_APP" -eq 1 ]]; then
    app_path="$CURRENT_BUILD_DERIVED_DATA_APP"
    if [[ -n "$app_path" && -d "$app_path" ]]; then
      printf '%s' "$app_path"
      return
    fi

    app_path="$(project_derived_data_device_app)"
    if [[ -n "$app_path" && -d "$app_path" ]]; then
      printf '%s' "$app_path"
      return
    fi
  fi

  app_path="src-tauri/gen/apple/build/arm64/Codex Monitor.app"
  if [[ -d "$app_path" ]]; then
    printf '%s' "$app_path"
    return
  fi

  app_path="$(latest_generated_build_app)"
  if [[ -n "$app_path" && -d "$app_path" ]]; then
    printf '%s' "$app_path"
    return
  fi

  app_path="$(project_derived_data_device_app)"
  if [[ -n "$app_path" && -d "$app_path" ]]; then
    printf '%s' "$app_path"
  fi
}

if ! xcrun devicectl --help >/dev/null 2>&1; then
  echo "xcrun devicectl is unavailable. Update Xcode to a version that includes CoreDevice tooling." >&2
  exit 1
fi

if [[ "$LIST_DEVICES" -eq 1 ]]; then
  xcrun devicectl list devices --columns Name Identifier DeviceClass Platform | sed -n '1,200p'
  exit 0
fi

if [[ "$OPEN_XCODE" -eq 0 && -z "$DEVICE" ]]; then
  echo "--device is required for install/launch. Use --list-devices to discover IDs." >&2
  exit 1
fi

NPM_BIN="$(resolve_npm || true)"
if [[ -z "$NPM_BIN" ]]; then
  echo "Unable to find npm in PATH or common install locations." >&2
  echo "Install Node/npm, or run from a shell where npm is available." >&2
  exit 1
fi

if [[ "$(ios_resolve_config_value hasLocal)" == "1" ]]; then
  TAURI_CONFIG_ARGS+=(--config "$IOS_LOCAL_CONFIG_PATH")
fi

if [[ -z "$BUNDLE_ID" ]]; then
  BUNDLE_ID="$(ios_resolve_config_value identifier)"
fi
if [[ -z "$BUNDLE_ID" ]]; then
  BUNDLE_ID="$IOS_DEFAULT_BUNDLE_ID"
fi

if [[ -z "$DEVELOPMENT_TEAM" ]]; then
  DEVELOPMENT_TEAM="$(ios_resolve_config_value team)"
fi

if [[ -n "$DEVELOPMENT_TEAM" ]]; then
  export APPLE_DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM"
fi

if [[ "$SKIP_BUILD" -eq 0 && -z "${APPLE_DEVELOPMENT_TEAM:-}" ]]; then
  if [[ -z "$(ios_resolve_config_value team)" ]]; then
    echo "Missing iOS signing configuration." >&2
    echo "Run ./scripts/setup_ios_local_config.sh (preferred), or copy ${IOS_LOCAL_CONFIG_EXAMPLE_PATH} to ${IOS_LOCAL_CONFIG_PATH} and fill in your Apple team ID + iOS bundle ID." >&2
    echo "You can also pass --team <TEAM_ID> or export APPLE_DEVELOPMENT_TEAM for a one-off build." >&2
    echo "Then follow docs/ios-local-setup.md for the first Xcode bootstrap." >&2
    exit 1
  fi
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  sync_ios_icons
  BUILD_CMD=("$NPM_BIN" run tauri -- ios build -d -t "$TARGET")
  if [[ ${#TAURI_CONFIG_ARGS[@]} -gt 0 ]]; then
    BUILD_CMD+=("${TAURI_CONFIG_ARGS[@]}")
  fi
  if [[ "$OPEN_XCODE" -eq 1 ]]; then
    BUILD_CMD+=(--open)
    "${BUILD_CMD[@]}"
    exit 0
  fi
  BUILD_CMD+=(--ci)
  BUILD_LOG="$(mktemp)"
  if "${BUILD_CMD[@]}" 2>&1 | tee "$BUILD_LOG"; then
    :
  else
    if grep -q '\*\* BUILD SUCCEEDED \*\*' "$BUILD_LOG" && grep -q 'EXPORT FAILED' "$BUILD_LOG"; then
      CURRENT_BUILD_DERIVED_DATA_APP="$(derived_data_device_app_from_log "$BUILD_LOG")"
      echo "Tauri export failed after a successful Xcode device build." >&2
      echo "Falling back to the DerivedData app for install/launch." >&2
      USE_DERIVED_DATA_APP=1
    else
      rm -f "$BUILD_LOG"
      exit 1
    fi
  fi
  rm -f "$BUILD_LOG"
fi

APP_PATH="$(resolve_device_app_path)"

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Built app not found under src-tauri/gen/apple/build or Xcode DerivedData." >&2
  exit 1
fi

APP_BUNDLE_IDENTIFIER="$(app_bundle_identifier "$APP_PATH")"
if [[ -n "$BUNDLE_ID" && -n "$APP_BUNDLE_IDENTIFIER" && "$APP_BUNDLE_IDENTIFIER" != "$BUNDLE_ID" ]]; then
  echo "Resolved app bundle ID (${APP_BUNDLE_IDENTIFIER}) does not match expected bundle ID (${BUNDLE_ID})." >&2
  echo "Refusing to install a potentially stale or unrelated app bundle." >&2
  exit 1
fi

xcrun devicectl device install app --device "$DEVICE" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing "$BUNDLE_ID"

echo
echo "Installed and launched ${BUNDLE_ID} on device '${DEVICE}'."
