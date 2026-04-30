# Phase 1: Architectural Foundations & Gating Bug Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-30
**Phase:** 1-Architectural Foundations & Gating Bug Fixes
**Areas discussed:** Carve safety strategy, chromeEnabled split + migration, Theme token migration scope, Local-token UX surface

---

## Carve Safety Strategy

### Q1 — How should we gate the C-1/C-2/C-3 carve steps for rollback?

| Option                   | Description                                                                                                                                                                          | Selected |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Per-step env flag        | Each carve step ships behind its own boolean (e.g. `OTTIE_USE_NEW_ROUTER`). Default ON in CI/dev; can flip OFF in production via env var without revert. Removed in Phase 5 cleanup. | ✓        |
| Single global carve flag | One `OTTIE_USE_NEW_ROUTER=1` flips the entire new dispatch graph. Simpler, but rolling back one bad handler falls back to the old monolith for everything.                           |          |
| No flag, direct merge    | Trust the green CI line + frozen-fixture parse tests. Each PR replaces old code in place; rollback = git revert. Fastest velocity, no in-prod kill switch.                           |          |

**User's choice:** Per-step env flag (Recommended)
**Notes:** Aligns with `.planning/research/ARCHITECTURE.md` §3.3 Strangler-Fig discipline.

### Q2 — Which carve states must stay green at every commit? (multi-select)

| Option                                               | Description                                                                                                                                             | Selected |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Frozen-fixture parse tests (v1.8/v1.9/v1.10)         | Every carve commit re-runs locked-in parse fixtures so we catch any accidental schema narrowing that breaks old clients. CI-blocking.                   | ✓        |
| Permission flow E2E                                  | Existing permission approval E2E must stay green through C-3. Treats PermissionHandler carve as behavior-preserving refactor.                           | ✓        |
| session.ts line count monotonically decreasing       | After each carve commit, `wc -l session.ts` strictly less than previous. Forces real extraction (no copy-paste); makes the ≤500-line target measurable. | ✓        |
| Old + new dispatch produce identical broadcast bytes | Per-message diff harness running both routers in shadow during C-1–C-3 dev (test-only, gated). Heaviest investment, strongest guarantee.                |          |

**User's choice:** Frozen-fixture + permission E2E + monotonic line count
**Notes:** Shadow-comparison harness rejected — bar set at three pragmatic invariants without the heaviest investment.

### Q3 — Where does the new code live during the carve transition?

| Option                                             | Description                                                                                                                                           | Selected |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `packages/server/src/server/session/`              | New subdirectory sibling to existing `session.ts`. Final deletion in C-9 collapses `session.ts` into `session/index.ts`. Diff stays domain-localized. | ✓        |
| `packages/server/src/server/router/` + `handlers/` | MessageRouter at top level, handlers in a parallel `handlers/` directory. Cleaner final shape, but carve diff sprawls across more directories.        |          |
| You decide                                         | Pick whichever the planner thinks reads cleaner once C-9 lands.                                                                                       |          |

**User's choice:** `packages/server/src/server/session/` (Recommended)
**Notes:** —

### Q4 — What runs the kill-switch flag in CI?

| Option                                  | Description                                                                                                                                   | Selected |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Matrix: flag ON + flag OFF              | CI runs both configurations on every PR for the carve duration. Catches regressions in either path. ~30% CI time overhead.                    | ✓        |
| Flag ON only in CI; OFF tested manually | Default-on in CI; kill-switch path verified by hand at each step boundary. Faster CI, weaker guarantee.                                       |          |
| Run shadow-comparison harness only      | Skip flag-OFF runs; test harness from Q2 runs both routers in parallel asserting byte-equal output. Stronger correctness, no env permutation. |          |

**User's choice:** Matrix: flag ON + flag OFF (Recommended)
**Notes:** Pays for itself the first time we need to flip back.

---

## chromeEnabled Split + Migration (CONCERNS C11)

### Q1 — Flag names

| Option                                             | Description                                                                             | Selected |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | -------- |
| `chromeLayoutEnabled` + `keyboardShortcutsEnabled` | Keeps `chrome` prefix on layout half (continuity); names keyboard half by what it does. | ✓        |
| `showAppChrome` + `enableHotkeys`                  | Drops `chrome` baggage; clearer at call sites but breaks string-search continuity.      |          |
| `uiChromeVisible` + `commandShortcutsEnabled`      | More semantic; `commandShortcuts` ties to upcoming Phase 2 ActionRegistry vocabulary.   |          |

**User's choice:** `chromeLayoutEnabled` + `keyboardShortcutsEnabled` (Recommended)

### Q2 — Migration semantics

| Option                                                  | Description                                                                                                                                    | Selected |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Both new flags inherit old value                        | If user had `chromeEnabled = false`, both new flags default to `false`. Zero behavior change. Migration runs once on first launch of v1.11.    | ✓        |
| Inherit only the layout half; keyboard defaults to true | Layout flag inherits; keyboard shortcuts default ON for everyone. Riskier — changes behavior for users who deliberately turned everything off. |          |
| Reset both to defaults; show one-time prompt            | Show a 'we split this setting' onboarding callout on first v1.11 launch. Most explicit, most disruptive.                                       |          |

**User's choice:** Both new flags inherit old value (Recommended)

### Q3 — Migration location

| Option                                        | Description                                                                                                                                              | Selected |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Client-side, on first read                    | Flag store reads `chromeEnabled` once if new flags are absent, writes both, leaves old field as deprecated read-only per ARCH-02. No daemon involvement. | ✓        |
| Client-side with versioned settings migration | Add `settingsSchemaVersion` field; explicit migration step on version bump.                                                                              |          |
| Daemon-side, broadcast on connect             | Daemon reads old flag, computes split, broadcasts new values. Wrong shape — these are client-only UI flags.                                              |          |

**User's choice:** Client-side, on first read (Recommended)

### Q4 — Old field disposition

| Option                             | Description                                                                                                                                                | Selected |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- | --- |
| Deprecated, schedule removal v1.16 | Keep `chromeEnabled` accepting writes (but stop sending it), annotate `@deprecated since=v1.11 removeAfter=v1.16`, add to `RESERVED_FIELDS` after removal. | ✓        |
| Remove immediately                 | Drop from settings schema in v1.11. Violates CLAUDE.md 'never remove'.                                                                                     |          |
| Keep forever as alias              | `chromeEnabled` permanently aliases to (layout                                                                                                             |          | keyboard). Conflicts with ARCH-02 'every deprecation must specify removeAfter'. |     |

**User's choice:** Deprecated, schedule removal v1.16 (Recommended)

---

## Theme Token Migration Scope (THM-01)

### Q1 — Migration scope in Phase 1

| Option                                            | Description                                                                                                                                                                                                              | Selected |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Skeleton + targeted in-flight files               | Write `tokens/` (primitives, semantic light/dark, component, motion, typography), wire Unistyles, migrate ONLY `theme.ts`, `glass-surface.tsx`, `daemon-connection-dot.tsx`, `math-curve-loader`. Phase 4 owns the rest. | ✓        |
| Skeleton only — migrate zero files                | Write tokens, wire Unistyles, ship warn lint. Touch no existing components. Phase 4 owns 100% of migration.                                                                                                              |          |
| Skeleton + opportunistic                          | Migrate any file we touch for OTHER reasons in Phase 1 (e.g. `message.tsx` for chevron fix, resize-handle for C12).                                                                                                      |          |
| Skeleton + token names for everything (no values) | Define every semantic token a downstream phase will need; only migrate in-flight values. Locks vocabulary early.                                                                                                         |          |

**User's choice:** Skeleton + targeted in-flight files (Recommended)

### Q2 — Lint rule scope

| Option                                | Description                                                                                                                                                                                               | Selected |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| New files only, plus warn on existing | Lint blocks (warn-level) hardcoded `#xxx`/`rgb()`/`rgba()` in any NEW file under `packages/app/src/`. Existing files emit warnings but don't fail. CI counter-test guarantees warn count never increases. | ✓        |
| All files, warn-only                  | Lint warns on every hardcoded color anywhere. No new-file vs existing distinction.                                                                                                                        |          |
| New files only, ignore existing       | Lint only inspects new files; existing hardcoded colors invisible until Phase 4. Loses 'never increase' guarantee.                                                                                        |          |

**User's choice:** New files only, plus warn on existing (Recommended)

### Q3 — Theme wiring

| Option                                            | Description                                                                                                                                                        | Selected |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Two flat themes via `UnistylesRegistry.addThemes` | `semanticLight` and `semanticDark` pre-resolved at build time, registered as `light`/`dark`. Components consume `theme.surface.background`. Matches research §8.3. | ✓        |
| One theme, runtime palette switch                 | Single Unistyles theme references runtime palette swapping light/dark. Redundant — Unistyles 3 already handles theme listeners.                                    |          |
| You decide                                        | Defer to planner.                                                                                                                                                  |          |

**User's choice:** Two flat themes via `UnistylesRegistry.addThemes` (Recommended)

### Q4 — DTCG JSON export pipeline

| Option                                        | Description                                                                                               | Selected |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| No, TS-only for v1.11                         | Per research §0: DTCG is a target for export, not a build dependency. Phase 1 keeps tokens as TypeScript. | ✓        |
| Yes, ship a `tokens-export.json` build target | Add a script that emits DTCG JSON from TS source. Adds maintenance surface with no v1.11 consumer.        |          |
| Skeleton only — leave a TODO                  | Define empty `scripts/export-tokens-dtcg.ts` stub. Tends to rot.                                          |          |

**User's choice:** No, TS-only for v1.11 (Recommended)

---

## Local-Token UX Surface (ARCH-03)

### Q1 — Token visibility in UI

| Option                                    | Description                                                                                                                                                                           | Selected |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Power-user surface in Settings → Advanced | 'Local daemon' panel under Settings → Advanced: token status, 'View token' (revealed on tap with confirmation), 'Regenerate token' (with re-pairing warning). Hidden behind Advanced. | ✓        |
| Completely invisible                      | Token exists only at `$OTTIE_HOME/local-token`. CLI/desktop bundle reads it; no UI exposure. Power users binding 0.0.0.0 must use Mode C env-var or open the file manually.           |          |
| Visible in onboarding too                 | Show token (and a 'connect another browser' QR/copy affordance) during first-run desktop setup, plus the Advanced panel. Most discoverable; risks frightening users.                  |          |

**User's choice:** Power-user surface in Settings → Advanced (Recommended)

### Q2 — Auth-fail UX

| Option                                                   | Description                                                                                                                                                           | Selected |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 401 + inline 'enter token' prompt with `daemon.log` hint | Daemon returns 401 + `WWW-Authenticate: Bearer`. Client surfaces token-file path and `daemon.log` reference. Matches `daemon.log` canonical-debug-surface convention. | ✓        |
| 401 + relay-fallback nudge                               | Same 401, but client says 'Try connecting via relay' and offers QR pair. Steers users away from direct WS for non-loopback.                                           |          |
| Generic 'connection failed' message                      | Hide the auth distinction. Bad — power users binding 0.0.0.0 will have no idea why.                                                                                   |          |

**User's choice:** 401 + inline 'enter token' prompt with daemon.log hint (Recommended)

### Q3 — Token generation timing

| Option                                  | Description                                                                                                                                                     | Selected |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Tauri startup, before daemon spawn      | Tauri startup writes the token file before spawning daemon subprocess; daemon reads on boot. No race. File mode 0600. Regenerated only on explicit user action. | ✓        |
| Daemon-side, lazy on first auth attempt | Daemon writes token first time a non-loopback request is rejected. Chicken-and-egg if first connection is non-loopback.                                         |          |
| On every Tauri start                    | Regenerate token each launch. Forces re-pairing on every restart — unacceptable UX.                                                                             |          |

**User's choice:** Tauri startup, before daemon spawn (Recommended)

### Q4 — SECURITY.md scope

| Option                                  | Description                                                                                                                                                            | Selected |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| All three modes documented now          | Per ROADMAP.md success criterion 3: 'SECURITY.md reflects all three modes.' Add Mode A/B/C sections, file path, mode 0600, regeneration semantics, threat-model delta. | ✓        |
| Phase 1 ships code; Phase 5 writes docs | Defer documentation to milestone-end audit. Faster Phase 1 ship but violates the success criterion.                                                                    |          |
| Inline header comment only              | Document modes in `local-token.ts` JSDoc; skip SECURITY.md. Discoverability suffers.                                                                                   |          |

**User's choice:** All three modes documented now (Recommended)

---

## Claude's Discretion

Areas where the planner has flexibility:

- Specific env-var names (`OTTIE_USE_NEW_ROUTER` vs `OTTIE_USE_MESSAGE_ROUTER` etc.) — keep grep-continuity with research §13 mitigation row.
- Internal naming of new `session/` subdirectory files (`router.ts` vs `message-router.ts`).
- Token-file layout details inside `$OTTIE_HOME` (permission-check helper location).
- The exact wording of the Settings → Advanced "Local daemon" panel copy (must be bilingual en + zh per CLAUDE.md).
- Whether bug-fix PRs ship as one bundle or atomic-per-bug — leaning atomic for clean blame.

## Deferred Ideas

- Bug-fix PR shape (one bundle vs four atomic) — not discussed; planner default = atomic-per-bug.
- OpenCode recovery UX banner ("Recovered N OpenCode sessions") — Phase 4 polish; Phase 1 only fixes the daemon-side stub.
- Lint enforcement levels per rule — all four ship warn-level per ROADMAP.md; promoted to error in Phase 5.
- MessageRouter dispatch table format (Map vs Record vs match-statement) — planner-level choice.
- DTCG JSON export pipeline — explicit defer to future milestone.
- Settings IA reorganization (Account / Agents / Voice / Appearance / Advanced) — Phase 4 (SET-01).
- `SCHEMA_EVOLUTION.md` document — Phase 5; Phase 1 only lays the foundation.
