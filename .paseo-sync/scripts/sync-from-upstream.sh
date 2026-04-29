#!/bin/bash
#
# Pull the latest paseo/main and overwrite every locally-tracked shared file
# with its upstream version (applying the rename transform where required).
#
# Does NOT commit. After running:
#   git diff                  # review the upstream changes
#   ./node_modules/.bin/biome check --write packages/server  # if formatting drifted
#   npm run typecheck         # sanity check
#   npm run lint
#   git checkout <path>       # revert any change you don't want
#   git add -p                # stage selectively
#   git commit -m "chore: sync from paseo/main @ <sha>"
#
# Flags:
#   --dry-run    print what would change without writing
#   --bucket=X   limit to one bucket: identical|renamed-content|renamed-paths
#                (default: all three)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

MANIFEST_DIR=".paseo-sync/manifest"
TRANSFORM=".paseo-sync/transform.sed"

dry_run=0
buckets="identical renamed-content renamed-paths"
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --bucket=*) buckets="${arg#--bucket=}" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Refresh upstream.
if ! git remote get-url paseo >/dev/null 2>&1; then
  echo "error: 'paseo' git remote not configured." >&2
  echo "  git remote add paseo https://github.com/getpaseo/paseo.git" >&2
  exit 2
fi
git fetch --quiet paseo main || { echo "error: failed to fetch paseo/main" >&2; exit 2; }
upstream_sha=$(git rev-parse --short paseo/main)
echo "syncing from paseo/main @ $upstream_sha"
echo

written=0
skipped=0

write_file() {
  local path="$1" content="$2"
  if [ "$dry_run" -eq 1 ]; then
    echo "  WOULD WRITE  $path"
  else
    mkdir -p "$(dirname "$path")"
    printf '%s' "$content" > "$path"
    echo "  wrote        $path"
  fi
  written=$((written + 1))
}

run_identical() {
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    upstream=$(git show "paseo/main:$path" 2>/dev/null) || {
      echo "  SKIP (missing upstream)  $path"
      skipped=$((skipped + 1))
      continue
    }
    if [ -f "$path" ] && [ "$upstream" = "$(cat "$path")" ]; then
      skipped=$((skipped + 1))
      continue
    fi
    write_file "$path" "$upstream"
  done < "$MANIFEST_DIR/identical.txt"
}

run_renamed_content() {
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    upstream=$(git show "paseo/main:$path" 2>/dev/null | sed -f "$TRANSFORM") || {
      echo "  SKIP (missing upstream)  $path"
      skipped=$((skipped + 1))
      continue
    }
    if [ -f "$path" ] && [ "$upstream" = "$(cat "$path")" ]; then
      skipped=$((skipped + 1))
      continue
    fi
    write_file "$path" "$upstream"
  done < "$MANIFEST_DIR/renamed-content.txt"
}

run_renamed_paths() {
  while IFS=$'\t' read -r paseo_path ottie_path; do
    [ -z "$paseo_path" ] && continue
    upstream=$(git show "paseo/main:$paseo_path" 2>/dev/null | sed -f "$TRANSFORM") || {
      echo "  SKIP (missing upstream)  $ottie_path"
      skipped=$((skipped + 1))
      continue
    }
    if [ -f "$ottie_path" ] && [ "$upstream" = "$(cat "$ottie_path")" ]; then
      skipped=$((skipped + 1))
      continue
    fi
    write_file "$ottie_path" "$upstream"
  done < "$MANIFEST_DIR/renamed-paths.tsv"
}

for b in $buckets; do
  case "$b" in
    identical)        echo "== bucket: identical ==";        run_identical ;;
    renamed-content)  echo "== bucket: renamed-content ==";  run_renamed_content ;;
    renamed-paths)    echo "== bucket: renamed-paths ==";    run_renamed_paths ;;
    *) echo "unknown bucket: $b" >&2; exit 2 ;;
  esac
done

echo
if [ "$dry_run" -eq 1 ]; then
  echo "DRY RUN — would write $written files, $skipped already up to date"
else
  echo "wrote $written files, $skipped already up to date"
  if [ "$written" -gt 0 ]; then
    echo
    echo "next steps:"
    echo "  git diff"
    echo "  npm run format && npm run typecheck && npm run lint"
    echo "  git add -p && git commit -m 'chore: sync from paseo/main @ $upstream_sha'"
  fi
fi
