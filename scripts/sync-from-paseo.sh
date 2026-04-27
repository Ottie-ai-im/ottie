#!/usr/bin/env bash
# sync-from-paseo.sh
#
# Surveys upstream getpaseo/paseo for commits that have landed since this
# Ottie fork last sync'd, ranks them by stability/security/bugfix relevance,
# and prints a punch list of cherry-pick candidates. Also writes a JSON
# report under .paseo-sync/ for follow-up tooling.
#
# This script ONLY reads — it never auto-cherry-picks. The goal is to make
# the monthly review cheap, not to make merge decisions for you.
#
# Usage:
#   scripts/sync-from-paseo.sh                  # since last sync (or 30d)
#   scripts/sync-from-paseo.sh --since 2026-04-01
#   scripts/sync-from-paseo.sh --since 60d
#   scripts/sync-from-paseo.sh --apply-marker   # mark "synced up to HEAD"
#                                                  after you've cherry-picked
#
# Requires: gh CLI, git, jq
set -euo pipefail

UPSTREAM_REPO="getpaseo/paseo"
MARKER_DIR=".paseo-sync"
MARKER_FILE="$MARKER_DIR/last-synced-sha"

cd "$(git rev-parse --show-toplevel)"

# ---- args ----
SINCE_ARG=""
APPLY_MARKER=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE_ARG="$2"; shift 2 ;;
    --apply-marker) APPLY_MARKER=1; shift ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---- prerequisites ----
for cmd in gh git jq; do
  command -v "$cmd" >/dev/null || { echo "missing dep: $cmd" >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated. run: gh auth login" >&2; exit 1; }

mkdir -p "$MARKER_DIR"

# ---- resolve "since" ----
if [[ -z "$SINCE_ARG" && -f "$MARKER_FILE" ]]; then
  LAST_SHA="$(cat "$MARKER_FILE")"
  SINCE_DATE="$(gh api "repos/$UPSTREAM_REPO/commits/$LAST_SHA" --jq '.commit.committer.date')"
  echo "→ resuming from marker $LAST_SHA ($SINCE_DATE)"
elif [[ "$SINCE_ARG" =~ ^[0-9]+d$ ]]; then
  DAYS="${SINCE_ARG%d}"
  SINCE_DATE="$(date -u -v -"${DAYS}"d +%Y-%m-%dT00:00:00Z 2>/dev/null \
                || date -u -d "${DAYS} days ago" +%Y-%m-%dT00:00:00Z)"
  echo "→ since $SINCE_ARG → $SINCE_DATE"
elif [[ -n "$SINCE_ARG" ]]; then
  SINCE_DATE="${SINCE_ARG}T00:00:00Z"
  echo "→ since $SINCE_DATE"
else
  SINCE_DATE="$(date -u -v -30d +%Y-%m-%dT00:00:00Z 2>/dev/null \
                || date -u -d "30 days ago" +%Y-%m-%dT00:00:00Z)"
  echo "→ no marker, defaulting to last 30 days ($SINCE_DATE)"
fi

# ---- fetch upstream commits ----
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ fetching upstream commits since $SINCE_DATE …"
PAGE=1
: > "$TMP/all.jsonl"
while :; do
  PAGE_JSON="$(gh api "repos/$UPSTREAM_REPO/commits?since=$SINCE_DATE&per_page=100&page=$PAGE")"
  COUNT="$(echo "$PAGE_JSON" | jq 'length')"
  [[ "$COUNT" == "0" ]] && break
  echo "$PAGE_JSON" | jq -c '.[] | {
    sha: .sha,
    short: (.sha[0:7]),
    date: .commit.author.date,
    msg: (.commit.message | split("\n")[0]),
    author: (.commit.author.name),
    url: .html_url
  }' >> "$TMP/all.jsonl"
  PAGE=$((PAGE + 1))
  [[ "$COUNT" -lt 100 ]] && break
done

TOTAL="$(wc -l < "$TMP/all.jsonl" | tr -d ' ')"
echo "→ $TOTAL upstream commits in range"

# ---- categorize by relevance ----
# Priority buckets (high = pick first). Keywords are word-bounded so e.g.
# "ping" matches "ping/pong" but not "grouping", and "hang" matches "hang"
# but not "changelog".
HIGH_KW='security|cve|vuln|leak|crash|hang|deadlock|race|panic|stall|stalls|relay|websocket|reconnect|disconnect|stability|heartbeat|ping|keepalive|backoff|jitter|netinfo|appstate'
MED_KW='fix|bug|regression|timeout|retry|offline|background|foreground|wifi|notarize|signing|gatekeeper|sandbox|cors|stuck|freeze|frozen|hangs?'
LOW_KW='feat|feature|add|chore|docs|test|refactor|style|build|deps|ci'

word_match() { # $1=msg $2=keywords. Allow trailing s/es so "leak" matches "leaks".
  echo "$1" | grep -iqE "(^|[^[:alnum:]])($2)(s|es)?([^[:alnum:]]|\$)"
}

bucket_of() {
  local msg="$1"
  if   word_match "$msg" "$HIGH_KW"; then echo "high"
  elif word_match "$msg" "$MED_KW";  then echo "med"
  elif word_match "$msg" "$LOW_KW";  then echo "low"
  else echo "other"
  fi
}

: > "$TMP/scored.jsonl"
while IFS= read -r line; do
  msg="$(echo "$line" | jq -r '.msg')"
  bucket="$(bucket_of "$msg")"
  echo "$line" | jq --arg b "$bucket" '. + {bucket: $b}' >> "$TMP/scored.jsonl"
done < "$TMP/all.jsonl"

# ---- write report ----
REPORT="$MARKER_DIR/report-$(date -u +%Y%m%d-%H%M).json"
jq -s '{
  generated_at: now | todateiso8601,
  upstream: "'"$UPSTREAM_REPO"'",
  since: "'"$SINCE_DATE"'",
  total: length,
  by_bucket: group_by(.bucket) | map({bucket: .[0].bucket, count: length}),
  commits: .
}' "$TMP/scored.jsonl" > "$REPORT"
echo "→ wrote $REPORT"

# ---- print human summary ----
echo
echo "=========================================="
echo " Paseo upstream sync — punch list"
echo "=========================================="
for b in high med low other; do
  N="$(jq -c --arg b "$b" 'select(.bucket == $b)' "$TMP/scored.jsonl" | wc -l | tr -d ' ')"
  [[ "$N" == "0" ]] && continue
  echo
  echo "## $(echo "$b" | tr '[:lower:]' '[:upper:]') priority ($N)"
  jq -r --arg b "$b" \
    'select(.bucket == $b) | "  \(.short)  \(.date[0:10])  \(.msg)"' \
    "$TMP/scored.jsonl" | head -40
  if [[ "$N" -gt 40 ]]; then
    echo "  … and $((N - 40)) more (see $REPORT)"
  fi
done

echo
echo "=========================================="
echo " Suggested workflow"
echo "=========================================="
cat <<'EOF'
  1. Add upstream remote once:
       git remote add paseo https://github.com/getpaseo/paseo.git
       git fetch paseo

  2. For each HIGH/MED commit you want, dry-run a cherry-pick:
       git cherry-pick -n <sha>          # stage without commit
       # inspect: git diff --stat
       # if it touches branding files (logos, names), revert those hunks
       git cherry-pick --continue        # or --abort

  3. After the batch is in, mark the sync point:
       scripts/sync-from-paseo.sh --apply-marker

  Tip: skip commits that touch packages/website (Paseo's marketing site),
  branding assets, or anything mentioning "Paseo" in the message — those
  are cosmetic to the upstream's brand and would re-introduce drift.
EOF

# ---- marker write ----
if [[ "$APPLY_MARKER" == "1" ]]; then
  HEAD_SHA="$(gh api "repos/$UPSTREAM_REPO/commits/main" --jq '.sha')"
  echo "$HEAD_SHA" > "$MARKER_FILE"
  echo
  echo "→ marker updated to $HEAD_SHA"
fi
