#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="${1:-$ROOT_DIR/src-tauri/icons/pulse-console-master.svg}"
TRAY_SOURCE_ICON="$ROOT_DIR/src-tauri/icons/pulse-console-tray.svg"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Missing source icon: $SOURCE_ICON" >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick is required (missing 'magick')." >&2
  exit 1
fi

cd "$ROOT_DIR"

npx tauri icon "$SOURCE_ICON" -o "$TMP_DIR"

while IFS= read -r generated_file; do
  cp -f "$generated_file" "$ROOT_DIR/src-tauri/icons/"
done < <(find "$TMP_DIR" -maxdepth 1 -type f | sort)

while IFS= read -r generated_file; do
  cp -f "$generated_file" "$ROOT_DIR/src-tauri/icons/ios/"
  cp -f "$generated_file" "$ROOT_DIR/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/"
done < <(find "$TMP_DIR/ios" -maxdepth 1 -type f | sort)

while IFS= read -r generated_file; do
  relative_path="${generated_file#"$TMP_DIR/"}"
  mkdir -p "$ROOT_DIR/src-tauri/icons/$(dirname "$relative_path")"
  cp -f "$generated_file" "$ROOT_DIR/src-tauri/icons/$relative_path"
done < <(find "$TMP_DIR/android" -type f | sort)

if [[ -f "$TRAY_SOURCE_ICON" ]]; then
  magick -background none "$TRAY_SOURCE_ICON" -resize 64x64 "$ROOT_DIR/src-tauri/icons/tray-icon.png"
fi

cp -f "$TMP_DIR/ios/AppIcon-512@2x.png" "$ROOT_DIR/public/app-icon.png"
cp -f "$TMP_DIR/ios/AppIcon-512@2x.png" "$ROOT_DIR/docs/assets/app-icon.png"

echo "Generated icon assets from $SOURCE_ICON"
