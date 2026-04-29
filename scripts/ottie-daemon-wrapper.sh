#!/bin/bash
# Wrapper that exec's the bundled daemon under the system Node runtime.
# Tauri sidecars must be a single executable file; this is that file. The
# real daemon JS sits in resources/ which can be at one of:
#   - $OTTIE_DAEMON_RESOURCES_DIR   (explicit override, always wins)
#   - <wrapper-dir>/resources       (manual invocation from binaries/)
#   - <wrapper-dir>/../binaries/resources
#                                   (Tauri dev: wrapper lives in target/debug)
set -e

DIR="$(cd "$(dirname "$0")" && pwd -P)"

CANDIDATES=()
[ -n "$OTTIE_DAEMON_RESOURCES_DIR" ] && CANDIDATES+=("$OTTIE_DAEMON_RESOURCES_DIR")
CANDIDATES+=("$DIR/resources")
CANDIDATES+=("$DIR/../binaries/resources")
CANDIDATES+=("$DIR/../../binaries/resources")
CANDIDATES+=("$DIR/../../src-tauri/binaries/resources")
CANDIDATES+=("$DIR/../Resources/_up_/binaries/resources")
CANDIDATES+=("$DIR/../Resources/binaries/resources")

RESOURCES=""
for cand in "${CANDIDATES[@]}"; do
  if [ -f "$cand/server.mjs" ]; then
    RESOURCES="$cand"
    break
  fi
done

if [ -z "$RESOURCES" ]; then
  echo "ottie-daemon-wrapper: cannot find resources/server.mjs near $DIR" >&2
  echo "  searched:" >&2
  for cand in "${CANDIDATES[@]}"; do echo "    $cand" >&2; done
  exit 1
fi

# Prefer the bundled Node next to resources/server.mjs. Falling back to system
# `node` is the legacy dev-time path; in production the bundled binary is
# always present and matches the ABI of better-sqlite3's compiled .node file.
if [ -x "$RESOURCES/node" ]; then
  NODE_BIN="$RESOURCES/node"
else
  NODE_BIN="node"
fi

exec "$NODE_BIN" "$RESOURCES/server.mjs" "$@"
