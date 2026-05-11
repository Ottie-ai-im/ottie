#!/usr/bin/env bash
# Stage the wx-cli binary as a Tauri sidecar resource.
#
# Output layout under packages/desktop/src-tauri/binaries/resources/wx-cli/:
#   wx          # the wx-cli binary (or wx.exe on Windows) for the host triple
#   LICENSE     # Apache-2.0 NOTICE — required by §4 for binary redistribution
#
# The daemon wrapper (scripts/ottie-daemon-wrapper.sh) discovers this dir
# alongside server.mjs and exports OTTIE_WX_BINARY into the daemon's env so
# WechatService picks it up without falling back to PATH.
#
# Pinned to a known-good upstream release. Bump WX_CLI_VERSION when wx-cli
# ships a new wire-stable release; the daemon's zod schemas use passthrough
# so additive changes don't break parsing.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/packages/desktop/src-tauri/binaries/resources/wx-cli"

WX_CLI_VERSION="${WX_CLI_VERSION:-v0.1.10}"
WX_CLI_REPO="${WX_CLI_REPO:-jackwener/wx-cli}"

if ! command -v rustc >/dev/null 2>&1; then
  echo "error: rustc is required to detect the Tauri target triple." >&2
  echo "install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required to download the wx-cli release asset." >&2
  exit 1
fi

TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
if [[ -z "$TARGET_TRIPLE" ]]; then
  echo "error: failed to determine target triple via rustc -vV" >&2
  exit 1
fi

# Map rustc target triple → wx-cli release asset name.
# Asset names verified against
# https://github.com/jackwener/wx-cli/releases/tag/v0.1.10 (2026-05).
case "$TARGET_TRIPLE" in
  aarch64-apple-darwin)         WX_ASSET="wx-macos-arm64"        ; WX_OUT="wx"     ;;
  x86_64-apple-darwin)          WX_ASSET="wx-macos-x86_64"       ; WX_OUT="wx"     ;;
  aarch64-unknown-linux-gnu)    WX_ASSET="wx-linux-arm64"        ; WX_OUT="wx"     ;;
  x86_64-unknown-linux-gnu)     WX_ASSET="wx-linux-x86_64"       ; WX_OUT="wx"     ;;
  *-pc-windows-*)               WX_ASSET="wx-windows-x86_64.exe" ; WX_OUT="wx.exe" ;;
  *)
    echo "error: no wx-cli asset mapping for target $TARGET_TRIPLE" >&2
    echo "       supported: aarch64-apple-darwin, x86_64-apple-darwin," >&2
    echo "                  aarch64-unknown-linux-gnu, x86_64-unknown-linux-gnu," >&2
    echo "                  *-pc-windows-*" >&2
    exit 1
    ;;
esac

ASSET_URL="https://github.com/$WX_CLI_REPO/releases/download/$WX_CLI_VERSION/$WX_ASSET"
LICENSE_URL="https://raw.githubusercontent.com/$WX_CLI_REPO/$WX_CLI_VERSION/LICENSE"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/wx" "$OUT_DIR/wx.exe" "$OUT_DIR/LICENSE"

echo "==> download $WX_ASSET ($WX_CLI_VERSION) → $OUT_DIR/$WX_OUT"
curl -fsSL --retry 3 --retry-delay 2 -o "$OUT_DIR/$WX_OUT" "$ASSET_URL"
chmod +x "$OUT_DIR/$WX_OUT"

echo "==> download Apache-2.0 LICENSE → $OUT_DIR/LICENSE"
curl -fsSL --retry 3 --retry-delay 2 -o "$OUT_DIR/LICENSE" "$LICENSE_URL"

# Step 4: deep-sign the wx binary on macOS so it loads under Hardened Runtime
# without dyld rejecting it for Team-ID mismatch (same reasoning as
# scripts/build-sidecar.sh's deep-sign block — Tauri only signs the app's
# own executable + the daemon wrapper).
if [[ "$TARGET_TRIPLE" == *-apple-darwin && -n "${MACOS_SIGN_IDENTITY:-}" ]]; then
  ENTITLEMENTS="${MACOS_ENTITLEMENTS:-$REPO_ROOT/packages/desktop/src-tauri/entitlements.plist}"
  if [[ ! -f "$ENTITLEMENTS" ]]; then
    echo "error: MACOS_SIGN_IDENTITY set but entitlements file missing: $ENTITLEMENTS" >&2
    exit 1
  fi
  echo "==> codesign $OUT_DIR/$WX_OUT with '$MACOS_SIGN_IDENTITY'"
  codesign --force --options runtime --timestamp \
    --sign "$MACOS_SIGN_IDENTITY" \
    --entitlements "$ENTITLEMENTS" \
    "$OUT_DIR/$WX_OUT"
fi

asset_size_human="$(du -h "$OUT_DIR/$WX_OUT" 2>/dev/null | awk '{print $1}')"
echo "==> done"
echo "  binary:  $OUT_DIR/$WX_OUT ($asset_size_human)"
echo "  license: $OUT_DIR/LICENSE"
echo "  target:  $TARGET_TRIPLE"
