#!/bin/bash
#
# Re-bucket every file under packages/server/src/ against paseo/main and rewrite
# the four manifest files in .paseo-sync/manifest/.
#
# When to run:
#   - Quarterly, to pick up files Ottie has added that converged with upstream
#     (e.g. a once-diverged file got rewritten and is now mergeable).
#   - After a big upstream sync, to confirm the manifest still matches reality.
#   - After resolving a divergence locally — to either promote a "diverged"
#     entry to "renamed-content" or to demote a sync target.
#
# This script regenerates the manifest from the CURRENT state of HEAD and
# paseo/main. It does NOT modify any source files. Review the diff with:
#   git diff .paseo-sync/manifest/

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

MANIFEST_DIR=".paseo-sync/manifest"
TRANSFORM=".paseo-sync/transform.sed"

if ! git remote get-url paseo >/dev/null 2>&1; then
  echo "error: 'paseo' git remote not configured." >&2
  exit 2
fi
git fetch --quiet paseo main

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# All paseo + ottie files under packages/server/src/
git ls-tree -r --name-only paseo/main -- packages/server/src/ | sort > "$tmp/paseo.txt"
git ls-tree -r --name-only HEAD       -- packages/server/src/ | sort > "$tmp/ottie.txt"

# Buckets:
#   identical          — same path, byte-identical
#   renamed-content    — same path, identical after transform
#   renamed-paths      — different path (paseo-* ↔ ottie-*), identical after transform
#   diverged           — same path, real residual diff
#   upstream-only      — paseo has it, ottie doesn't (and no rename pair found)
> "$tmp/identical.txt"
> "$tmp/renamed-content.txt"
> "$tmp/renamed-paths.tsv"
> "$tmp/diverged.tsv"
> "$tmp/upstream-only.txt"

# Same-path comparison.
comm -12 "$tmp/paseo.txt" "$tmp/ottie.txt" | while IFS= read -r path; do
  upstream=$(git show "paseo/main:$path" 2>/dev/null) || continue
  local=$(cat "$path" 2>/dev/null) || continue
  if [ "$upstream" = "$local" ]; then
    echo "$path" >> "$tmp/identical.txt"
    continue
  fi
  upstream_t=$(printf '%s' "$upstream" | sed -f "$TRANSFORM")
  if [ "$upstream_t" = "$local" ]; then
    echo "$path" >> "$tmp/renamed-content.txt"
    continue
  fi
  residual=$(diff <(printf '%s' "$upstream_t") <(printf '%s' "$local") 2>/dev/null | grep -cE '^[<>]' || true)
  printf "%s\t%s\n" "$residual" "$path" >> "$tmp/diverged.tsv"
done

# Path-rename detection: paseo-only files where s/paseo/ottie/g produces an
# existing local path with content matching after transform.
comm -23 "$tmp/paseo.txt" "$tmp/ottie.txt" | while IFS= read -r p; do
  case "$p" in
    *paseo*)
      o=$(echo "$p" | sed 's/paseo/ottie/g')
      if [ -f "$o" ]; then
        upstream_t=$(git show "paseo/main:$p" 2>/dev/null | sed -f "$TRANSFORM")
        if [ "$upstream_t" = "$(cat "$o")" ]; then
          printf "%s\t%s\n" "$p" "$o" >> "$tmp/renamed-paths.tsv"
          continue
        fi
      fi
      ;;
  esac
  echo "$p" >> "$tmp/upstream-only.txt"
done

# Sort + install.
sort "$tmp/identical.txt"          > "$MANIFEST_DIR/identical.txt"
sort "$tmp/renamed-content.txt"    > "$MANIFEST_DIR/renamed-content.txt"
sort "$tmp/renamed-paths.tsv"      > "$MANIFEST_DIR/renamed-paths.tsv"
sort -n "$tmp/diverged.tsv"        > "$MANIFEST_DIR/diverged.tsv"
sort "$tmp/upstream-only.txt"      > "$MANIFEST_DIR/upstream-only.txt"

echo "regenerated manifest:"
for f in identical.txt renamed-content.txt renamed-paths.tsv diverged.tsv upstream-only.txt; do
  printf "  %-25s %d\n" "$f" "$(wc -l < "$MANIFEST_DIR/$f")"
done
echo
echo "review with: git diff .paseo-sync/manifest/"
