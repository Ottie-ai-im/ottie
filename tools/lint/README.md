# tools/lint

Custom lint scripts that complement oxlint with rules tied to Ottie's
schema-evolution discipline (ARCH-02).

## deprecated-annotation

Asserts that every `@deprecated` annotation inside a Zod `.describe(...)`
string includes both a `since=vX.Y` and a `removeAfter=vX.Y` marker, per the
convention in `.planning/research/ARCHITECTURE.md` §4.3.

**Run:** `npm run lint:schema`

**Scope (Phase 01):** `packages/server/src/shared/messages.ts` only.

**Enforcement:**

- Phase 01 — warn-only. Violations print to stderr; the process exits 0.
- Phase 05 — promoted to error. Per ROADMAP P5 success criterion #2, the exit
  code flips to 1 once the project-wide annotation backfill is complete.
  Search the source for `PHASE 5:` to find the exact line to flip.

**Why a custom script and not an oxlint plugin?**

Per `01-PATTERNS.md` §"No Analog Found", there's no in-repo precedent for
custom oxlint rules. A single-file Node TypeScript scan keeps the surface
trivial (no AST parser dependency) and matches the warn-only Phase 1 scope.
When scope broadens in Phase 5, this script either grows or is replaced by
an oxlint plugin — that decision belongs to that phase.

**Add a file to the scope:**

Pass it as the first argument: `tsx tools/lint/deprecated-annotation.ts <path>`.
The npm script defaults to `messages.ts`. Broaden the script's `DEFAULT_TARGET`
or wire additional npm targets when widening scope.

**Self-tests:** `tools/lint/deprecated-annotation.test.ts` covers compliant
annotations, missing markers (each individually and both), `@deprecated`
mentioned in plain comments (must be ignored), non-deprecated lines,
line-number reporting, and disk-read mode.

Run with: `npm run test:lint:schema` (uses `tsx --test`, Node's built-in
runner). The workspace vitest configs exclude `**/.claude/**`, which
collides with worktree paths under `.claude/worktrees/`; `node:test` has
no exclude list and runs anywhere TypeScript runs via tsx.

## hardcoded-color

Scans every `.ts` / `.tsx` file under `packages/app/src/` for inline hex
(`#xxx` / `#xxxxxx` / `#xxxxxxxx`) and `rgba?(...)` literals. Asserts the
count never increases against the baseline at
`tools/lint/hardcoded-color.baseline.json` — the THM-01 counter-test
guard per Plan 01-02 / D-10.

**Run:** `npm run lint:colors` (default — fails CI when count grows).

**Re-capture baseline:** `npm run lint:colors:baseline` (intentional after
migrating an existing surface to semantic tokens; check the count went
down before committing).

**Scope (Phase 01):** `packages/app/src/` only.

**Default exclusions:**

- `packages/app/src/styles/tokens/` — primitive/semantic/component
  tokens are where literals legitimately live (per PITFALLS pitfall 5).
- `packages/app/src/styles/theme.ts` — composition root + LEGACY shim;
  raw literals here are dead-code that Phase 4 (THM-02..04) deletes
  surface-by-surface.
- `*.test.ts(x)` / `*.spec.ts(x)` — tests legitimately assert against
  specific palette values for parity guards.
- `node_modules`, build outputs (`dist`, `.expo`, `.tsbuild`, `.next`,
  `.turbo`, `ios`, `android`, `__snapshots__`).

**Enforcement:**

- Phase 01 — counter-test (warn-only against the baseline). Violations
  print to stderr; the process exits 0 if `current_count <= baseline`.
- Phase 05 — promoted to error. Per ROADMAP P5 success criterion #2,
  the exit code flips to 1 on ANY violation in non-tokens files.
  Search the source for `PHASE 5:` to find the exact line to flip.

**Why a custom script?** Same reasoning as `deprecated-annotation` — no
in-repo precedent for custom oxlint plugins, single-file Node TS scan
keeps the surface trivial.

**Self-tests:** `tools/lint/hardcoded-color.test.ts` covers single-file
hex / `rgb()` / `rgba()` detection, semantic-token consumption (no false
positives), 1-based line reporting, directory walk with the default
tokens-tree exclusion, and the four CLI baseline-comparison branches
(no baseline → exit 1 with hint; `--write-baseline` writes count;
count == baseline → exit 0; count > baseline → exit 1 with regression
message; count < baseline → exit 0 with re-baseline hint).

Run with: `npm run test:lint:colors`.
