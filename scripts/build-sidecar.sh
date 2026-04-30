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

# Node version bundled with the daemon. Pinning this guarantees better-sqlite3
# (and other prebuilt native modules) match the runtime at execution time,
# regardless of what the user has installed on PATH.
BUNDLED_NODE_VERSION="${BUNDLED_NODE_VERSION:-22.18.0}"

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

# The bundled server.mjs resolves runtime assets relative to itself via
# `new URL("./assets/<file>", import.meta.url)`, so we mirror those assets
# next to it. silero_vad.onnx is the only one today; new ones can be added
# under packages/server/src/.../assets/ and they'll get picked up here.
SHERPA_ASSETS_SRC="$SERVER_DIR/src/server/speech/providers/local/sherpa/assets"
if [[ -d "$SHERPA_ASSETS_SRC" ]]; then
  mkdir -p "$OUT_DIR/resources/assets"
  cp -p "$SHERPA_ASSETS_SRC"/* "$OUT_DIR/resources/assets/"
fi

# Step 2.5: bundle a pinned Node runtime so the daemon doesn't depend on the
# user having any specific (or any) Node on PATH. The Node ABI dictates which
# prebuilt native bindings work at runtime, so we recompile better-sqlite3
# below for this exact version.
case "$TARGET_TRIPLE" in
  aarch64-apple-darwin)   NODE_OS="darwin"; NODE_ARCH="arm64" ;;
  x86_64-apple-darwin)    NODE_OS="darwin"; NODE_ARCH="x64" ;;
  aarch64-unknown-linux-gnu) NODE_OS="linux"; NODE_ARCH="arm64" ;;
  x86_64-unknown-linux-gnu)  NODE_OS="linux"; NODE_ARCH="x64" ;;
  *-pc-windows-*)         NODE_OS="win"; NODE_ARCH="x64" ;;
  *)
    echo "error: no bundled-Node mapping for target $TARGET_TRIPLE" >&2
    exit 1
    ;;
esac

if [[ "$NODE_OS" == "win" ]]; then
  NODE_PKG="node-v$BUNDLED_NODE_VERSION-$NODE_OS-$NODE_ARCH.zip"
  NODE_BIN_NAME="node.exe"
else
  NODE_PKG="node-v$BUNDLED_NODE_VERSION-$NODE_OS-$NODE_ARCH.tar.gz"
  NODE_BIN_NAME="node"
fi
NODE_URL="https://nodejs.org/dist/v$BUNDLED_NODE_VERSION/$NODE_PKG"

echo "==> bundle Node $BUNDLED_NODE_VERSION ($NODE_OS-$NODE_ARCH)"
TMP_NODE_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_NODE_DIR"' EXIT
curl -fsSL "$NODE_URL" -o "$TMP_NODE_DIR/$NODE_PKG"
if [[ "$NODE_OS" == "win" ]]; then
  unzip -q "$TMP_NODE_DIR/$NODE_PKG" -d "$TMP_NODE_DIR"
  cp -p "$TMP_NODE_DIR/node-v$BUNDLED_NODE_VERSION-$NODE_OS-$NODE_ARCH/$NODE_BIN_NAME" "$OUT_DIR/resources/$NODE_BIN_NAME"
else
  tar -xzf "$TMP_NODE_DIR/$NODE_PKG" -C "$TMP_NODE_DIR"
  cp -p "$TMP_NODE_DIR/node-v$BUNDLED_NODE_VERSION-$NODE_OS-$NODE_ARCH/bin/$NODE_BIN_NAME" "$OUT_DIR/resources/$NODE_BIN_NAME"
fi
chmod +x "$OUT_DIR/resources/$NODE_BIN_NAME"

# Step 2.6: recompile better-sqlite3's prebuild against the bundled Node
# ABI. Otherwise we ship a .node file built for whatever Node the developer
# happened to have on PATH at install time — which is exactly the bug that
# necessitated bundling Node in the first place.
BSQ_DIR="$OUT_DIR/resources/node_modules/better-sqlite3"
if [[ -d "$BSQ_DIR" ]]; then
  echo "==> rebuild better-sqlite3 prebuild for Node $BUNDLED_NODE_VERSION"
  # The .bin shim copied alongside better-sqlite3 is a pnpm symlink relative to
  # the original store layout, so it can't find prebuild-install once the
  # package is flattened into resources/node_modules. Locate the script in
  # pnpm's content-addressable store and invoke it directly via the bundled
  # Node so the rebuild targets that ABI.
  PREBUILD_INSTALL_JS="$(find "$REPO_ROOT/node_modules/.pnpm" -path "*/prebuild-install/bin.js" -type f -print -quit 2>/dev/null)"
  if [[ -z "$PREBUILD_INSTALL_JS" ]]; then
    echo "error: prebuild-install/bin.js not found in node_modules/.pnpm" >&2
    exit 1
  fi
  ( cd "$BSQ_DIR" && \
    rm -rf build/Release && \
    "$OUT_DIR/resources/node" "$PREBUILD_INSTALL_JS" \
      --target="$BUNDLED_NODE_VERSION" \
      --runtime=node \
      --platform="$NODE_OS" \
      --arch="$NODE_ARCH" \
      --tag-prefix=v )
fi

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

# Step 4: deep-sign every Mach-O inside resources/ on macOS.
#
# Tauri's tauri build only signs Ottie.app's own executable + the wrapper
# script. Anything inside Resources/binaries/resources/ — the bundled Node,
# the Anthropic `claude` CLI, every *.node, every *.dylib — keeps whatever
# signature it shipped with (mostly ad-hoc or a third-party Team ID).
#
# Once the host process runs under Hardened Runtime, dyld enforces Library
# Validation: it refuses to load any Mach-O whose Team ID differs from the
# host. Even with `disable-library-validation` in entitlements, Gatekeeper
# at first launch still verifies that every embedded executable is properly
# signed (notarization staples to the .app, not to nested binaries).
#
# Re-signing every Mach-O here with our Developer ID + Hardened Runtime +
# entitlements is what makes the bundle launch cleanly on a fresh Mac.
if [[ "$NODE_OS" == "darwin" && -n "${MACOS_SIGN_IDENTITY:-}" ]]; then
  ENTITLEMENTS="${MACOS_ENTITLEMENTS:-$REPO_ROOT/packages/desktop/src-tauri/entitlements.plist}"
  if [[ ! -f "$ENTITLEMENTS" ]]; then
    echo "error: MACOS_SIGN_IDENTITY set but entitlements file missing: $ENTITLEMENTS" >&2
    exit 1
  fi
  echo "==> deep-sign embedded binaries with '$MACOS_SIGN_IDENTITY'"
  sign_one() {
    local target="$1"
    codesign --force --options runtime --timestamp \
      --sign "$MACOS_SIGN_IDENTITY" \
      --entitlements "$ENTITLEMENTS" \
      "$target" >/dev/null 2>&1 || {
        echo "error: codesign failed for $target" >&2
        codesign --force --options runtime --timestamp \
          --sign "$MACOS_SIGN_IDENTITY" \
          --entitlements "$ENTITLEMENTS" \
          "$target"
        exit 1
      }
  }

  # All native modules (.node) and shared libraries (.dylib).
  while IFS= read -r -d '' lib; do sign_one "$lib"; done < <(
    find "$OUT_DIR/resources" \( -name "*.node" -o -name "*.dylib" \) -type f -print0
  )

  # The bundled Node runtime.
  if [[ -f "$OUT_DIR/resources/node" ]]; then
    sign_one "$OUT_DIR/resources/node"
  fi

  # The Anthropic claude CLI binary (every platform-specific package
  # ships its own; only the host's was actually copied).
  while IFS= read -r -d '' claude_bin; do sign_one "$claude_bin"; done < <(
    find "$OUT_DIR/resources/node_modules/@anthropic-ai" \
      -type f -name claude -perm -u+x -print0 2>/dev/null
  )

  echo "  ✓ all embedded Mach-Os re-signed"
fi

size_human="$(du -sh "$OUT_DIR/resources" 2>/dev/null | awk '{print $1}')"
wrapper_size="$(wc -c <"$OUT_PATH" | tr -d ' ')"
echo "==> done"
echo "  wrapper: $OUT_PATH ($wrapper_size bytes)"
echo "  resources: $OUT_DIR/resources ($size_human)"
echo "  target:  $TARGET_TRIPLE"
