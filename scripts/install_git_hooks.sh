#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "[hooks] ERROR: not inside a git repository." >&2
  exit 1
fi

chmod +x .githooks/pre-commit scripts/check_ios_commit_safety.sh
git config core.hooksPath .githooks

echo "[hooks] Installed repo hooks via core.hooksPath=.githooks"
echo "[hooks] Active hooks:"
echo "  - .githooks/pre-commit"
