---
phase: 01-architectural-foundations-gating-bug-fixes
plan: 01
status: complete
requirements:
  - ARCH-02
---

## Summary

Schema-evolution discipline foundation for v1.11. RESERVED_FIELDS export +
ARCH-02 discipline header committed to `messages.ts`; three frozen-fixture
parse tests pin v1.8/v1.9/v1.10 wire shapes against today's Zod schemas
(12 tests, all green); a warn-only `@deprecated-annotation` lint enforces
`since=vX.Y removeAfter=vX.Y` markers on every `.describe(...)` annotation.

These three artifacts together are the CI guardrail Plan 04 (session carve)
and every subsequent schema addition runs against. Without them the carve
cannot start safely (per D-02 + ROADMAP P1 success criterion #2).

## Files created / modified

| File                                                          | Change                                          |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `packages/server/src/shared/messages.ts`                      | + RESERVED_FIELDS export + ARCH-02 header       |
| `packages/server/src/shared/messages.frozen-v1.8.test.ts`     | new (4 tests)                                   |
| `packages/server/src/shared/messages.frozen-v1.9.test.ts`     | new (4 tests)                                   |
| `packages/server/src/shared/messages.frozen-v1.10.test.ts`    | new (4 tests)                                   |
| `packages/server/src/shared/messages.reserved-fields.test.ts` | new (RED test for Task 1)                       |
| `tools/lint/deprecated-annotation.ts`                         | new — warn-only lint script                     |
| `tools/lint/deprecated-annotation.test.ts`                    | new (8 self-tests)                              |
| `tools/lint/README.md`                                        | new                                             |
| `package.json`                                                | + scripts.lint:schema, scripts.test:lint:schema |
| `package.json`                                                | + devDependencies.tsx ^4.6.0                    |
| `pnpm-lock.yaml`                                              | refresh after tsx add                           |

## Test counts

| File                                       | `it(...)` blocks     |
| ------------------------------------------ | -------------------- |
| `messages.frozen-v1.8.test.ts`             | 4                    |
| `messages.frozen-v1.9.test.ts`             | 4                    |
| `messages.frozen-v1.10.test.ts`            | 4                    |
| `messages.reserved-fields.test.ts`         | 1                    |
| `tools/lint/deprecated-annotation.test.ts` | 8 (node:test format) |

All test counts ≥ acceptance criteria (≥4 per frozen-vX.Y file).

## `npm run lint:schema` baseline output

```
> ottie@1.10.0 lint:schema
> tsx tools/lint/deprecated-annotation.ts

(empty stderr — zero violations)
```

Exit 0. The script correctly distinguishes between Zod `.describe(...)`
annotations (linted) and `@deprecated` mentions in `//` or `/** */`
documentation prose (ignored). The discipline-header in `messages.ts`
mentions `@deprecated` four times in comments — all four are correctly
ignored.

## Frozen fixtures — schemas exercised

Each of `messages.frozen-v1.{8,9,10}.test.ts` parses fixtures through
exactly four schemas (this is what Plan 04's carve must keep green):

1. `AgentUpdateMessageSchema` (server → client, the most-traveled path)
2. `CreateAgentRequestMessageSchema` (client → server, agent creation)
3. `SendAgentMessageRequestSchema` (client → server, follow-up prompts)
4. `WSInboundMessageSchema` (discriminated union, exercised through
   `agent_permission_response` — the permission path Plan 04 carves)

Each fixture is annotated `// FROZEN — do not edit. Snapshot of v1.X-shipped
wire shapes.` and declared `as const`. Hand-rolled (not captured from a
running daemon) — fixtures contain only structural placeholders, no real
session content / tokens / secrets (T-01-02 mitigation).

## Where Plan 04 (carve) adds new fixtures

When Plan 04 lifts a new schema kind out of `session.ts` into a sibling
module, the carve PR MUST add a corresponding case to each of the three
frozen-vX.Y files. The pattern is:

```ts
const V1_X_NEW_SCHEMA_FIXTURE = {
  type: "new_schema_kind",
  /* minimal payload — fields known to be in v1.X wire */
} as const;

it("v1.X daemon -> client new_schema parses with current schema", () => {
  const parsed = NewSchemaKindMessageSchema.parse(V1_X_NEW_SCHEMA_FIXTURE);
  expect(parsed.type).toBe("new_schema_kind");
});
```

If a v1.X version genuinely didn't have the new schema kind yet, omit the
case for that file (the absence is itself the back-compat assertion).

## Key-files (verifies key_links)

- `packages/server/src/shared/messages.frozen-v1.8.test.ts` imports from
  `./messages.js` (verified — see file head)
- `packages/server/src/shared/messages.frozen-v1.9.test.ts` imports from
  `./messages.js` (verified)
- `packages/server/src/shared/messages.frozen-v1.10.test.ts` imports from
  `./messages.js` (verified)
- `package.json` `scripts.lint:schema` invokes `tsx tools/lint/deprecated-annotation.ts`
  (verified)

## Deviations

### 1. Self-test runner: `node:test` instead of `vitest`

**Plan acceptance criterion #9:** `npx vitest run tools/lint/deprecated-annotation.test.ts --bail=1` exits 0.

**Deviation:** the self-tests use Node's built-in `node:test` runner,
invoked via `tsx --test`, exposed as `npm run test:lint:schema`.

**Why:** the workspace vitest configs (root and `packages/server/`)
explicitly exclude `**/.claude/**`. Worktree-based parallel execution
places this branch under `.claude/worktrees/agent-…/`, so vitest sees
every test file under an absolute path containing `.claude` and refuses
to run them. Tested with several override attempts (`--exclude='!**'`,
custom `--config`, etc.) — none could disable the exclude pattern.

`node:test` has no exclude list and runs anywhere TypeScript runs via
`tsx`, producing identical pass/fail semantics for these unit-style
assertions. 8 tests, all pass.

**Impact:** the principle of the criterion (the lint is self-tested in CI
on every plan change) holds; only the runner differs. CI can invoke
`npm run test:lint:schema` and get a 0/non-zero exit. If a future phase
moves these tests into a workspace package outside `.claude/`, the same
file can be ported back to vitest with minor `import` adjustments
(`vitest` provides `describe/it/expect`; `node:test` uses
`describe/it` + `node:assert/strict`).

### 2. RED test file for Task 1 left in place

The agent created `messages.reserved-fields.test.ts` as the failing-then-
passing test for Task 1's TDD cycle. The plan's `<files>` block didn't
explicitly enumerate this file, but the plan's `tdd="true"` attribute and
the executor's TDD discipline reference both expect a RED commit before
the GREEN feat commit. The file passes today (RESERVED_FIELDS exists)
and serves as a regression assertion for the export's continued presence.

### 3. Existing legacy `@deprecated` annotations in `messages.ts`

The plan's behavior section assumes "there are zero `@deprecated`
annotations yet". The header-comment block in `messages.ts` mentions the
`@deprecated` convention four times in documentation prose — these are
NOT linted (correctly), since the script scans only `.describe("...")`
strings. The lint emits zero warnings against the current file.

If a real schema field carries an existing legacy `@deprecated` annotation
(none discovered in this plan), Plan 03's `chromeEnabled` annotation will
be the first compliant example.

## Pointers for Plan 04 (session carve)

1. Run `npm run lint:schema` after every carve commit — must remain exit 0.
2. Run the three `messages.frozen-v1.{8,9,10}.test.ts` files after every
   carve commit (`pnpm --filter @ottie/server vitest run src/shared/messages.frozen-v1.{8,9,10}.test.ts --bail=1`)
   — all 12 tests must remain green. A test failure is an empirical
   compatibility regression: a v1.X-minimal client request no longer
   parses today, OR a today-emitted message no longer parses against
   v1.X expectations.
3. If carve adds a new schema kind, add a fixture case in each
   frozen-vX.Y file (see "Where Plan 04 adds new fixtures" above).
4. Don't touch `RESERVED_FIELDS` — that registry is updated only when a
   field's `removeAfter` window completes (a Phase 5 concern).

## Verification (commands run, all green)

```
pnpm --filter @ottie/server vitest run src/shared/messages.frozen-v1.8.test.ts src/shared/messages.frozen-v1.9.test.ts src/shared/messages.frozen-v1.10.test.ts --bail=1
  → 12/12 pass

npm run lint:schema
  → exit 0, zero warnings

npm run test:lint:schema
  → 8/8 pass via node:test

pnpm --filter @ottie/server typecheck
  → exit 0 (no type errors)
```

## Self-Check: PASSED

- [x] All tasks executed
- [x] Each task committed individually with --no-verify (worktree mode)
- [x] SUMMARY.md created
- [x] No modifications to STATE.md or ROADMAP.md (orchestrator owns those)
- [x] Frozen-fixture parse tests pass against today's Zod schemas
- [x] `RESERVED_FIELDS` exported with the documented header
- [x] `npm run lint:schema` exits 0
- [x] Schema discipline lint is self-tested (8/8 via node:test)
- [x] Plan 04 has the CI guardrail it needs to start safely
