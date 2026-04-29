#!/bin/bash
#
# Check whether files tracked under .paseo-sync/manifest/ have drifted from
# their upstream counterparts in paseo/main.
#
# Exits 0 if everything is in sync, 1 if any drift was detected.
#
# Reasons drift happens:
#   - Upstream paseo fixed a bug in a file we declared "shared". Pull it.
#   - Someone edited a shared file locally without updating the manifest.
#     Either revert, or move the file out of the shared list.
#
# Run by .github/workflows/paseo-drift.yml weekly.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

MANIFEST_DIR=".paseo-sync/manifest"
TRANSFORM=".paseo-sync/transform.sed"

# Make sure the paseo remote exists and is up to date.
if ! git remote get-url paseo >/dev/null 2>&1; then
  echo "error: 'paseo' git remote not configured." >&2
  echo "  git remote add paseo https://github.com/getpaseo/paseo.git" >&2
  exit 2
fi
git fetch --quiet paseo main || {
  echo "error: failed to fetch paseo/main" >&2
  exit 2
}

drift_count=0
checked=0

print_drift() {
  local path="$1" reason="$2"
  printf "  DRIFT  %-70s  %s\n" "$path" "$reason"
}

# 1. Files synced byte-for-byte at the same path.
while IFS= read -r path; do
  [ -z "$path" ] && continue
  [ ! -f "$path" ] && { print_drift "$path" "missing locally"; drift_count=$((drift_count + 1)); continue; }
  upstream=$(git show "paseo/main:$path" 2>/dev/null) || {
    print_drift "$path" "missing upstream"
    drift_count=$((drift_count + 1))
    continue
  }
  if [ "$upstream" != "$(cat "$path")" ]; then
    print_drift "$path" "byte mismatch"
    drift_count=$((drift_count + 1))
  fi
  checked=$((checked + 1))
done < "$MANIFEST_DIR/identical.txt"

# 2. Files synced via rename transform at the same path.
while IFS= read -r path; do
  [ -z "$path" ] && continue
  [ ! -f "$path" ] && { print_drift "$path" "missing locally"; drift_count=$((drift_count + 1)); continue; }
  upstream=$(git show "paseo/main:$path" 2>/dev/null | sed -f "$TRANSFORM") || {
    print_drift "$path" "missing upstream"
    drift_count=$((drift_count + 1))
    continue
  }
  if [ "$upstream" != "$(cat "$path")" ]; then
    print_drift "$path" "transform mismatch"
    drift_count=$((drift_count + 1))
  fi
  checked=$((checked + 1))
done < "$MANIFEST_DIR/renamed-content.txt"

# 3. Files synced via rename transform at a renamed path.
while IFS=$'\t' read -r paseo_path ottie_path; do
  [ -z "$paseo_path" ] && continue
  [ ! -f "$ottie_path" ] && { print_drift "$ottie_path" "missing locally"; drift_count=$((drift_count + 1)); continue; }
  upstream=$(git show "paseo/main:$paseo_path" 2>/dev/null | sed -f "$TRANSFORM") || {
    print_drift "$ottie_path" "missing upstream ($paseo_path)"
    drift_count=$((drift_count + 1))
    continue
  }
  if [ "$upstream" != "$(cat "$ottie_path")" ]; then
    print_drift "$ottie_path" "transform mismatch (vs $paseo_path)"
    drift_count=$((drift_count + 1))
  fi
  checked=$((checked + 1))
done < "$MANIFEST_DIR/renamed-paths.tsv"

echo
echo "checked $checked files, $drift_count drift"

exit $((drift_count > 0 ? 1 : 0))
