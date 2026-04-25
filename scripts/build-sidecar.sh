#!/usr/bin/env bash
# Stage the daemon as a Tauri sidecar.
#
# Output layout under packages/desktop/src-tauri/binaries/:
#   ottie-daemon-<target-triple>        # wrapper (shell script on Unix, .bat
#                                       # on Windows) that exec's `node`
#                                       # against the bundled JS.
#   resources/server.mjs                # esbuild output
#   resources/server.mjs.map
#   resources/node_modules/...          # native packages excluded from bundle
#
# Tauri v2's externalBin must point at a single executable file. The wrapper
# IS that executable; everything else lives in the sibling resources/ dir.
# In bundled builds the resources/ tree must be added via tauri.conf.json
# bundle.resources — this script only stages the dev-time layout.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/packages/server"
BUNDLE_DIR="$SERVER_DIR/dist-bundle"
OUT_DIR="$REPO_ROOT/packages/desktop/src-tauri/binaries"

if ! command -v rustc >/dev/null 2>&1; then
  echo "error: rustc is required to detect the Tauri target triple." >&2
  echo "install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "warning: 'node' is not on PATH. The daemon wrapper will fail at runtime." >&2
fi

TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
if [[ -z "$TARGET_TRIPLE" ]]; then
  echo "error: failed to determine target triple via rustc -vV" >&2
  exit 1
fi

# Step 1: build the JS bundle and stage native modules.
echo "==> esbuild bundle"
( cd "$REPO_ROOT" && pnpm --filter @ottie/server bundle )

echo "==> copy native packages"
( cd "$REPO_ROOT" && pnpm --filter @ottie/server bundle:copy-natives )

if [[ ! -f "$BUNDLE_DIR/server.mjs" ]]; then
  echo "error: $BUNDLE_DIR/server.mjs missing after bundle step" >&2
  exit 1
fi

# Step 2: lay out the sidecar tree.
mkdir -p "$OUT_DIR/resources"
rm -rf "$OUT_DIR/resources"
mkdir -p "$OUT_DIR/resources"

cp -p "$BUNDLE_DIR/server.mjs" "$OUT_DIR/resources/"
[[ -f "$BUNDLE_DIR/server.mjs.map" ]] && cp -p "$BUNDLE_DIR/server.mjs.map" "$OUT_DIR/resources/"
cp -RLp "$BUNDLE_DIR/node_modules" "$OUT_DIR/resources/node_modules"

# The daemon's resolveDaemonVersion() walks parent directories looking for a
# package.json with name === "@ottie/server" to read the version. Synthesize
# one next to the bundle so the lookup succeeds at runtime.
SERVER_VERSION="$(node -p "require('$SERVER_DIR/package.json').version")"
cat > "$OUT_DIR/resources/package.json" <<EOF
{
  "name": "@ottie/server",
  "version": "$SERVER_VERSION",
  "type": "module",
  "private": true
}
EOF

# Step 3: drop the wrapper script under the per-triple name Tauri expects.
case "$TARGET_TRIPLE" in
  *-pc-windows-*)
    WRAPPER_SRC="$REPO_ROOT/scripts/ottie-daemon-wrapper.bat"
    OUT_NAME="ottie-daemon-$TARGET_TRIPLE.exe"
    ;;
  *)
    WRAPPER_SRC="$REPO_ROOT/scripts/ottie-daemon-wrapper.sh"
    OUT_NAME="ottie-daemon-$TARGET_TRIPLE"
    ;;
esac

OUT_PATH="$OUT_DIR/$OUT_NAME"
cp -p "$WRAPPER_SRC" "$OUT_PATH"
chmod +x "$OUT_PATH"

# Drop a stale single-binary build from the previous bun-based pipeline so
# Tauri does not pick up the wrong file.
for stale in "$OUT_DIR"/ottie-daemon-*-apple-darwin "$OUT_DIR"/ottie-daemon-*-linux-* "$OUT_DIR"/ottie-daemon-*-windows-*.exe; do
  if [[ -f "$stale" && "$stale" != "$OUT_PATH" ]]; then
    rm -f "$stale"
  fi
done

size_human="$(du -sh "$OUT_DIR/resources" 2>/dev/null | awk '{print $1}')"
wrapper_size="$(wc -c <"$OUT_PATH" | tr -d ' ')"
echo "==> done"
echo "  wrapper: $OUT_PATH ($wrapper_size bytes)"
echo "  resources: $OUT_DIR/resources ($size_human)"
echo "  target:  $TARGET_TRIPLE"
