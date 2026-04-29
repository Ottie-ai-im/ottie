# CLAUDE.md — Paseo sync

For agents touching files under `packages/server/src/`. Read [README.md](README.md)
for the full workflow; this is the cheat sheet.

## Before editing a file in `packages/server/`

```bash
grep -F "<path>" .paseo-sync/manifest/identical.txt \
                 .paseo-sync/manifest/renamed-content.txt \
                 .paseo-sync/manifest/renamed-paths.tsv
```

If the file appears in any of those three manifests, **it is shared with
upstream**. Editing it will be undone by the next `sync-from-upstream.sh`.

Two correct moves:

1. **Push the fix upstream first.** Open a PR against `getpaseo/paseo`, get it
   merged, then run `.paseo-sync/scripts/sync-from-upstream.sh` here.
2. **Fork the file deliberately.** In the same commit that edits the file,
   move its path out of `identical.txt` / `renamed-content.txt` / `renamed-paths.tsv`
   and add it to `diverged.tsv` with a residual line count. The CI drift check
   will then leave it alone.

## Don't

- Don't silently modify a shared file. CI will flag it.
- Don't extend `transform.sed` for one-off renames — it runs on every shared
  file and any over-eager rule corrupts unrelated code. Add a rule only when
  multiple files in `diverged.tsv` would converge after it.
- Don't import an `upstream-only.txt` file by hand-typing it. Use the recipe
  in README.md so the transform is applied consistently.

## Common operations

```bash
# Is this file shared?
.paseo-sync/scripts/check-drift.sh | grep <path>

# Pull upstream now.
.paseo-sync/scripts/sync-from-upstream.sh --dry-run
.paseo-sync/scripts/sync-from-upstream.sh

# Re-bucket after big changes.
.paseo-sync/scripts/regenerate-manifest.sh
```
