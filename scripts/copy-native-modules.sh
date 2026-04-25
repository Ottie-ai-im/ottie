#!/usr/bin/env bash
# Materialize a self-contained node_modules/ tree next to the bundled daemon
# so the Node runtime can `require()` native packages at runtime.
#
# The bundle marks these packages as --external (esbuild does not embed
# them), so they must be reachable from the bundle's directory via Node's
# normal module resolution.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/packages/server"
DEST_NM="$SERVER_DIR/dist-bundle/node_modules"

# Packages we excluded from the bundle. Their full directories must be
# shipped because they contain platform-specific .node addons, .dylib /
# .so files, or do dynamic require() based on __dirname.
EXTERNALS=(
  "node-pty"
  "sherpa-onnx"
  "sherpa-onnx-node"
  "onnxruntime-node"
)

# Optional platform-specific native packages that sherpa-onnx-node loads at
# runtime via require(). pnpm only installs the matching one for the host.
PLATFORM_OPTIONALS=(
  "sherpa-onnx-darwin-arm64"
  "sherpa-onnx-darwin-x64"
  "sherpa-onnx-linux-x64"
  "sherpa-onnx-linux-arm64"
  "sherpa-onnx-win-x64"
  "sherpa-onnx-win-ia32"
)

# pnpm hides indirect deps under <repo>/node_modules/.pnpm/node_modules/.
# Search both the server's own node_modules and the workspace hoist.
SEARCH_PATHS=(
  "$SERVER_DIR/node_modules"
  "$REPO_ROOT/node_modules"
  "$REPO_ROOT/node_modules/.pnpm/node_modules"
)

resolve_pkg() {
  local pkg="$1"
  for base in "${SEARCH_PATHS[@]}"; do
    if [[ -d "$base/$pkg" ]]; then
      echo "$base/$pkg"
      return 0
    fi
  done
  return 1
}

rm -rf "$DEST_NM"
mkdir -p "$DEST_NM"

copy_pkg() {
  local pkg="$1"
  local src
  if ! src="$(resolve_pkg "$pkg")"; then
    return 1
  fi
  local dest="$DEST_NM/$pkg"
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  # -L: dereference symlinks (pnpm uses them); -R: recurse; -p: preserve modes.
  cp -RLp "$src" "$dest"
  return 0
}

missing=()
for pkg in "${EXTERNALS[@]}"; do
  if copy_pkg "$pkg"; then
    echo "  ✓ $pkg"
  else
    missing+=("$pkg")
    echo "  ✗ $pkg (not found in any node_modules)" >&2
  fi
done

# Platform optionals: only the host-matching one is installed by pnpm; copy
# whichever ones we find without warning about the rest.
for pkg in "${PLATFORM_OPTIONALS[@]}"; do
  if copy_pkg "$pkg" 2>/dev/null; then
    echo "  ✓ $pkg (platform optional)"
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: required external packages missing: ${missing[*]}" >&2
  echo "       run 'pnpm install' first" >&2
  exit 1
fi

size_human="$(du -sh "$DEST_NM" 2>/dev/null | awk '{print $1}')"
echo "node_modules tree size: $size_human"
echo "destination: $DEST_NM"
