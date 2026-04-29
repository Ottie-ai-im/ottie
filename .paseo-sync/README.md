# Paseo Upstream Sync

Ottie was forked from [getpaseo/paseo](https://github.com/getpaseo/paseo).
A large portion of `packages/server/` is still byte-identical (or differs only
by `paseo` → `ottie` rename) between the two repos. This directory tracks
which files are "shared with upstream" so we can keep pulling Paseo's bug
fixes for free without touching Ottie's diverged code.

**Initial scan as of the manifest checkin:**

| Bucket            | Count | Sync direction                  |
| ----------------- | ----: | ------------------------------- |
| `identical`       |   220 | upstream → local, byte-for-byte |
| `renamed-content` |   119 | upstream → local, via transform |
| `renamed-paths`   |     5 | upstream → local, via transform |
| `diverged`        |    85 | review only, no auto-sync       |
| `upstream-only`   |    15 | candidates to import            |

**344 of ~440 server files are tracked as auto-syncable.**

---

## Workflow

### Weekly (run by CI)

```bash
.paseo-sync/scripts/check-drift.sh
```

Compares every file in `manifest/identical.txt`, `manifest/renamed-content.txt`,
and `manifest/renamed-paths.tsv` against `paseo/main`. Exits non-zero if any
drift is detected — either upstream changed (a new fix to pull) or someone
modified a shared file locally (revert or move it out of the manifest).

### When CI reports drift — pull upstream

```bash
git fetch paseo main

# Dry-run first to see what would change.
.paseo-sync/scripts/sync-from-upstream.sh --dry-run

# Apply.
.paseo-sync/scripts/sync-from-upstream.sh

# Review.
git diff
npm run typecheck
npm run lint
npm run test:unit -- --bail=1   # smoke test

# Commit.
git add -p
git commit -m "chore: sync from paseo/main @ $(git rev-parse --short paseo/main)"
```

If a single file's upstream change broke something Ottie-specific, just
`git checkout <path>` to revert that one file and move it out of `identical.txt`
into a new bucket (or to `diverged.tsv`).

### Quarterly — regenerate the manifest

```bash
.paseo-sync/scripts/regenerate-manifest.sh
git diff .paseo-sync/manifest/
```

This re-runs the full bucketing scan against current HEAD and `paseo/main`.
Files that have converged (someone rewrote a `diverged` file and it now matches
upstream) get promoted to `renamed-content`. Files that have diverged (someone
modified an `identical` file locally) get demoted to `diverged`.

---

## The four manifest files

### `manifest/identical.txt`

220 paths, one per line. Byte-for-byte identical between Ottie's HEAD and
`paseo/main`. **Don't modify these locally** — the next sync will overwrite
your change. If you need to fork one, move the path to `manifest/diverged.tsv`
in the same commit.

### `manifest/renamed-content.txt`

119 paths, same path on both sides, identical after `transform.sed` rewrites
`paseo` → `ottie` (and `@getpaseo/` → `@ottie/`). Treated like `identical.txt`
but with the transform applied during sync.

### `manifest/renamed-paths.tsv`

5 path pairs, format `<paseo-path>\t<ottie-path>`. Upstream file at the paseo
path, after transform, is identical to the local file at the ottie path.
Example: `packages/server/src/server/paseo-home.ts` ↔
`packages/server/src/server/ottie-home.ts`.

### `manifest/diverged.tsv`

85 paths, format `<residual-line-count>\t<path>`. Sorted by how big the diff
is after applying the transform. **No auto-sync.** Useful as a review queue:

- residual ≤ 5 lines: probably an Ottie tweak that may or may not be worth
  keeping. Easy to evaluate — these are quickest review wins.
- residual 6–20: small intentional differences.
- residual > 100: real Ottie features. Touch with care.

When upstream changes a `diverged` file in a way you want, you have to merge
by hand:

```bash
# See what upstream changed since the last sync.
git log paseo/main -- <path>

# Cherry-pick the relevant upstream commit and resolve conflicts.
git show paseo/main:<path> > /tmp/upstream
diff /tmp/upstream <path>
```

### `manifest/upstream-only.txt`

15 files Paseo has that Ottie doesn't. Candidates for import. The most
notable today:

- `daemon-config-store.test.ts` — Ottie has the impl, missing the test
- `paseo-env.test.ts` / `paseo-env.ts` — env handling, no Ottie equivalent
- `session.workspace-resolution-invariants.test.ts` — invariant tests
- `utils/github-remote.ts` + `.test.ts` — git remote helpers
- `utils/windows-command.ts` — windows shell quoting

To import one:

```bash
# Same path.
git show paseo/main:<path> | sed -f .paseo-sync/transform.sed > <path>
# Different path (paseo-foo.ts → ottie-foo.ts).
git show paseo/main:packages/.../paseo-foo.ts | sed -f .paseo-sync/transform.sed > packages/.../ottie-foo.ts
```

After importing, run `regenerate-manifest.sh` to add the new file to the
right bucket.

---

## The rename transform

`.paseo-sync/transform.sed`:

```sed
s|@getpaseo/|@ottie/|g
s/PASEO/OTTIE/g
s/Paseo/Ottie/g
s/paseo/ottie/g
```

Order matters: `@getpaseo/` is matched before plain `paseo` because once the
scope rewrite has happened the standalone `paseo` rule won't double-match.

If you find a file in `diverged.tsv` whose only difference is a rename pattern
the transform doesn't catch yet (e.g. a new Ottie-flavor of a Paseo identifier),
extend the transform first, then re-run `regenerate-manifest.sh`.

---

## Why this exists

The Paseo team writes high-quality regression tests every time they fix a
bug (`*-regression.test.ts`, `*-timeout.test.ts`, etc.). 76% of Ottie's
server code is the same as Paseo's. Without a sync pipeline those fixes
stay upstream and Ottie's stability silently lags behind.

This is a **fork-and-track** setup, not fork-and-forget. Ottie diverges where
it makes product sense (chat rooms, loops, schedules, voice) and stays in
lockstep where it doesn't.
