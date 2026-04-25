#!/usr/bin/env bash
# Build the daemon as a single-file executable for Tauri's externalBin.
#
# Tauri requires the sidecar binary at:
#   packages/desktop/src-tauri/binaries/ottie-daemon-<target-triple>
# where <target-triple> is `rustc -vV | grep host` of the build host.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$REPO_ROOT/packages/server/src/server/index.ts"
OUT_DIR="$REPO_ROOT/packages/desktop/src-tauri/binaries"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required to build the daemon sidecar." >&2
  echo "install: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

if ! command -v rustc >/dev/null 2>&1; then
  echo "error: rustc is required to detect the Tauri target triple." >&2
  echo "install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2
  exit 1
fi

TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
if [[ -z "$TARGET_TRIPLE" ]]; then
  echo "error: failed to determine target triple via rustc -vV" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

OUT_NAME="ottie-daemon-$TARGET_TRIPLE"
case "$TARGET_TRIPLE" in
  *-pc-windows-*) OUT_NAME="$OUT_NAME.exe" ;;
esac

OUT_PATH="$OUT_DIR/$OUT_NAME"

echo "building daemon sidecar"
echo "  entry:  $ENTRY"
echo "  target: $TARGET_TRIPLE"
echo "  output: $OUT_PATH"

bun build "$ENTRY" --compile --outfile "$OUT_PATH"

echo "done: $OUT_PATH ($(du -h "$OUT_PATH" | awk '{print $1}'))"
