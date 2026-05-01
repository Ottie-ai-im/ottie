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
