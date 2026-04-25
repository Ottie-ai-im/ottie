#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"
configure_dev_ottie_home

if [ -z "${OTTIE_LOCAL_MODELS_DIR}" ]; then
  export OTTIE_LOCAL_MODELS_DIR="$HOME/.ottie/models/local-speech"
  mkdir -p "$OTTIE_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Ottie Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${OTTIE_HOME}"
echo "  Models:  ${OTTIE_LOCAL_MODELS_DIR}"
echo "══════════════════════════════════════════════════════"

export OTTIE_CORS_ORIGINS="${OTTIE_CORS_ORIGINS:-*}"
export OTTIE_NODE_INSPECT="${OTTIE_NODE_INSPECT:---inspect=0}"

exec pnpm run dev:server
