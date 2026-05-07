#!/bin/bash
# Phase 3 manual testing helper — boot two daemons on one machine
# (different ports + different OTTIE_HOMEs) so you can pair them as
# friends and chat through the real Expo UI.
#
# Usage:
#   ./scripts/two-daemon-dev.sh alice          # boots daemon "alice" on port 6868
#   ./scripts/two-daemon-dev.sh bob            # boots daemon "bob" on port 6869
#   ./scripts/two-daemon-dev.sh reset          # delete both homes and exit
#
# Run them in TWO separate terminal tabs so both stay live.
#
# After both daemons are up:
#   1. Open Chrome → http://localhost:8081 → "scan to pair" daemon "alice"
#      (the daemon shows its pair-link in its terminal output on first boot)
#   2. Open Chrome INCOGNITO (separate localStorage) →
#      http://localhost:8081 → pair daemon "bob"
#   3. In the alice browser: Settings → Identity → Add friend → copy the
#      ottie://friend-pair#... link
#   4. In the bob browser: + → Pair with a friend → paste link → submit
#   5. Switch to alice browser: Pending friend requests → Approve
#   6. Both browsers now show the friend in their Friends list →
#      Open chat → type → see each other's messages within ~2s

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$SERVER_DIR/../.." && pwd)"

ALICE_HOME="$HOME/.ottie-test-alice"
BOB_HOME="$HOME/.ottie-test-bob"
ALICE_PORT=6868
BOB_PORT=6869

case "${1:-}" in
  alice)
    HOME_DIR="$ALICE_HOME"
    PORT="$ALICE_PORT"
    LABEL="alice"
    ;;
  bob)
    HOME_DIR="$BOB_HOME"
    PORT="$BOB_PORT"
    LABEL="bob"
    ;;
  reset)
    echo "Removing $ALICE_HOME and $BOB_HOME"
    rm -rf "$ALICE_HOME" "$BOB_HOME"
    echo "Done. Next 'alice' / 'bob' boots will start with fresh identities."
    exit 0
    ;;
  *)
    echo "Usage: $0 {alice|bob|reset}"
    exit 1
    ;;
esac

# Seed a config.json with the right listen port if missing.
mkdir -p "$HOME_DIR"
CONFIG="$HOME_DIR/config.json"
if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<EOF
{
  "version": 1,
  "daemon": {
    "listen": "127.0.0.1:${PORT}",
    "cors": { "allowedOrigins": ["*"] },
    "relay": { "enabled": true }
  },
  "app": {
    "baseUrl": "https://app.claws.company"
  }
}
EOF
  echo "Seeded $CONFIG (listen 127.0.0.1:${PORT})"
fi

echo "════════════════════════════════════════"
echo "  Ottie test daemon: $LABEL"
echo "  HOME:  $HOME_DIR"
echo "  PORT:  $PORT"
echo "════════════════════════════════════════"
echo ""
echo "Watch this terminal for the local-token / pairing-link logs."
echo "Stop with Ctrl+C."
echo ""

export OTTIE_HOME="$HOME_DIR"
export OTTIE_CORS_ORIGINS="*"
cd "$SERVER_DIR"
exec pnpm run dev:server
