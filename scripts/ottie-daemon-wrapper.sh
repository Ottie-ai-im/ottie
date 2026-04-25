#!/bin/bash
# Wrapper that exec's the bundled daemon under the system Node runtime.
# Tauri sidecars must be a single executable file; this is that file. The
# real daemon JS sits in resources/ next to this wrapper.
set -e
DIR="$(cd "$(dirname "$0")" && pwd -P)"
exec node "$DIR/resources/server.mjs" "$@"
