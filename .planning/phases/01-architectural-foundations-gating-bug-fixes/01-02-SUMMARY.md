---
phase: 01-architectural-foundations-gating-bug-fixes
plan: 02
subsystem:
  - app/styles
  - app/components
  - tools/lint
tags:
  - theme
  - tokens
  - unistyles
  - lint
  - design-system
dependency_graph:
  requires:
    - "Plan 01-01 schema-evolution discipline (already merged at HEAD)"
    - "Pre-existing react-native-unistyles 3 wiring (not modified — D-11)"
  provides:
    - "@/styles/tokens/primitives → palette + spacing + radius primitives"
    - "@/styles/tokens/semantic.light + semantic.dark → nested alias tier"
    - "@/styles/tokens/component → glassCard / glassSheet / glassPill / button radii"
    - "@/styles/tokens/motion → curves + durations + mathCurves.<name> timings"
    - "@/styles/tokens/typography → fontFamily/fontSize/lineHeight/weight"
    - "theme.surface.glass.{tint,tintStrong,border} (consumed by glass-surface.tsx)"
    - "theme.status.{online,connecting,offline} (consumed by daemon-connection-dot.tsx)"
    - "theme.text.muted (consumed by daemon-connection-dot.tsx)"
    - "theme.components.<name>.radius (consumed by glass-surface.tsx)"
    - "theme.colors.* LEGACY shim (kept verbatim for non-migrated consumers)"
    - "npm run lint:colors (THM-01 counter-test guard)"
    - "tools/lint/hardcoded-color.{ts,test.ts,baseline.json}"
  affects:
    - "Every Phase 4 surface-migration plan (THM-02..04) reads the OLD→new key map in semantic.light.ts header"
tech_stack:
  added:
    - "tools/lint/hardcoded-color.ts (Node TS via tsx, exports lintHardcodedColors)"
  patterns:
    - "Three-tier token system (primitive → semantic → component) per research §8.3"
    - "LEGACY-shim pattern: composition root preserves flat colors: shape during phased migration"
    - "Counter-test baseline for warn-level lints (matches deprecated-annotation pattern from 01-01)"
key_files:
  created:
    - packages/app/src/styles/tokens/primitives.ts
    - packages/app/src/styles/tokens/semantic.light.ts
    - packages/app/src/styles/tokens/semantic.dark.ts
    - packages/app/src/styles/tokens/component.ts
    - packages/app/src/styles/tokens/motion.ts
    - packages/app/src/styles/tokens/typography.ts
    - packages/app/src/components/daemon-connection-dot.test.tsx
    - tools/lint/hardcoded-color.ts
    - tools/lint/hardcoded-color.test.ts
    - tools/lint/hardcoded-color.baseline.json
  modified:
    - packages/app/src/styles/theme.ts
    - packages/app/src/components/ui/glass-surface.tsx
    - packages/app/src/components/daemon-connection-dot.tsx
    - packages/app/src/components/math-curve-loader/curves.ts
    - tools/lint/README.md
    - package.json
decisions:
  - "Excluded packages/app/src/styles/theme.ts from the hardcoded-color baseline scope (added to DEFAULT_EXCLUDE_PATHS). The LEGACY shim block intentionally inlines hex literals; Phase 4 surface migrations delete it surface-by-surface. Including it in the baseline would have flooded the counter with ~140 known-temporary literals and obscured genuine consumer drift."
  - "Excluded *.test.ts(x) files from the hardcoded-color scan (added TEST_FILE_RE). Parity-guard tests (daemon-connection-dot.test.tsx) legitimately assert against specific hex values and are NOT a consumer-drift signal."
  - "Wrote daemon-connection-dot.test.tsx as a pure-token assertion test (no JSX render). The workspace vitest config aliases react-native → react-native-web/dist/ at a hoisted-node_modules path that is missing in parallel-executor worktrees; rendering tests cannot run there. The token-level assertion (semanticLight.status.online === palette.green[400]) covers the same threat T-02-01 invariant without depending on a working RN renderer. Documented inline in the test for future upgrade."
  - "Kept typography spring tokens (theme.motion.duration / theme.motion.spring) on the legacy commonTheme path; only the new fast/normal/slow ms durations and cubic-bezier curves were added under the new typed token tree (motionTokens). Spring tokens are reanimated-specific and remain consumed by existing code via theme.motion.spring.*."
  - "Re-exported baseColors as an alias for palette so any caller that imported `baseColors` from theme.ts continues to compile. No current callers found, but the re-export is zero-cost insurance against carve drift."
metrics:
  duration_minutes: 18
  tasks_completed: 3
  files_created: 10
  files_modified: 6
  commits: 3
  hardcoded_color_baseline: 591
  vitest_tests_added: 5
  node_test_tests_added: 13
completed: 2026-05-01
---

# Phase 1 Plan 2: Theme Token Skeleton + Targeted Migration Summary

**One-liner:** Lands the v1.11 three-tier theme-token tree (primitive → semantic → component) on top of Unistyles 3, migrates the four in-flight color/motion consumers to semantic tokens, and adds a warn-only hardcoded-color lint with a baseline-locked counter-test guard for THM-01.

## What Got Built

### Token tree (tokens/)

Six new files under `packages/app/src/styles/tokens/`:

- **primitives.ts** — `palette` (lifted verbatim from theme.ts:1-99 `baseColors`, renamed; byte-for-byte identical), `spacing`, `radius`. Hex/rgb literals legitimately live here.
- **semantic.light.ts** — `semanticLight` with nested namespaces (`surface`, `text`, `border`, `control`, `accent`, `status`, `terminal`). The header comment ships an exhaustive **OLD lightSemanticColors key → new namespace path** migration map so Phase 4 surface migrations have a key-by-key recipe.
- **semantic.dark.ts** — `buildSemanticDark(tint)` factory + default `semanticDark`. Preserves the existing per-variant glass-tint customization (claude warm, ghostty cool, midnight blue) by accepting the same `DarkSemanticConfig` shape.
- **component.ts** — `componentTokens` exposing `glassCard / glassSheet / glassPill / button` radii + border widths. Each radius matches the previous `theme.borderRadius.<name>` byte-for-byte.
- **motion.ts** — `motion.curves` (cubic-bezier strings), `motion.durations` (fast/normal/slow ms), `motion.mathCurves.<name>` (per-preset timing primitives lifted from curves.ts:173-262). Math curves keys are camelCase (`lemniscateBloom`); the kebab-case `CurveName` is mapped at the consumer site.
- **typography.ts** — `fontFamily / fontSize / lineHeight / weight`, lifted verbatim from `commonTheme.fontFamily/fontSize/lineHeight/fontWeight`.

No `index.ts` barrel — consumers import the specific tree path (per CONVENTIONS).

### theme.ts as composition root

`packages/app/src/styles/theme.ts` shrank from **716 → 580 lines** (-19%). Every existing public theme name is preserved (`lightTheme`, `darkTheme`, `darkZincTheme`, `darkMidnightTheme`, `darkClaudeTheme`, `darkGhosttyTheme`). Each variant spreads:

- Nested semantic namespaces (theme.surface, theme.text, theme.status, theme.accent, theme.border, theme.control)
- `theme.components` (component-level radii)
- `theme.motionTokens` (the new motion tree — distinct from legacy `theme.motion.spring/duration` which stays on commonTheme)
- `theme.typography` (the new typography tree)
- A **LEGACY shim** under `theme.colors.*` containing the verbatim flat semantic shape that today's ~every-screen / ~every-panel consumes. Removed surface-by-surface in Phase 4 (THM-02..04).
- `theme.colors.palette` (= primitives `palette`) — preserves `theme.colors.palette.*` reach-through for unmigrated consumers (Phase 4 retires it).

`unistyles.ts` is **not modified** (per D-11). The shape of `lightTheme/darkTheme` changes; the wiring does not.

### Migrated consumers

| File                          | Before                                                                                                         | After                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `glass-surface.tsx`           | `theme.colors.surfaceGlass{,Strong}`, `theme.colors.borderGlass`, `theme.borderRadius.{glassCard,glassPill,…}` | `theme.surface.glass.{tint,tintStrong,border}`, `theme.components.<name>.radius`                                              |
| `daemon-connection-dot.tsx`   | `theme.colors.palette.{green[400],amber[500],red[500]}`, `theme.colors.foregroundMuted`                        | `theme.status.{online,connecting,offline}`, `theme.text.muted`; styles read `theme.typography.{fontFamily,fontSize}` directly |
| `math-curve-loader/curves.ts` | per-preset hardcoded `durationMs/rotationDurationMs/pulseDurationMs`                                           | `...motion.mathCurves.<curveName>` spread; parametric `point` functions stay verbatim. File: 263 → 255 lines                  |

Zero `theme.colors.palette.*` reach-through remains in any of the three migrated files (grep-verified).

### Visual-parity guard test

`packages/app/src/components/daemon-connection-dot.test.tsx` — five vitest assertions:

- `semanticLight.status.{online,connecting,offline}` resolve to `palette.{green[400],amber[500],red[500]}`
- `semanticDark.status.*` mirrors the same triad (light/dark parity)
- `semanticLight.text.muted` === `palette.zinc[500]`

Mitigates threat **T-02-01** (silent value drift in semantic.{light,dark}.ts breaking visual parity).

### Hardcoded-color lint (THM-01 counter-test)

- `tools/lint/hardcoded-color.ts` — Node TS scanner. Walks `packages/app/src/`, flags `#xxx`/`rgba?(...)` literals. Default exclusions: `tokens/` (legitimate primitive home), `theme.ts` (LEGACY shim — Phase 4 cleanup), `*.test.ts(x)` (parity-guard tests). Exit codes: count ≤ baseline → 0; count > baseline → 1 (CI failure). `--write-baseline` rewrites the baseline (re-baseline after migrating a surface).
- `tools/lint/hardcoded-color.baseline.json` — `{ count: 591, capturedAt, plan: "01-02" }`. Captured POST-migration so the four touched files contribute zero violations.
- `tools/lint/hardcoded-color.test.ts` — 13 self-tests via `tsx --test` + `node:test` (workspace vitest excludes `**/.claude/**` which collides with worktree paths, same workaround as Plan 01-01).
- `package.json` scripts: `lint:colors`, `lint:colors:baseline`, `test:lint:colors`.
- `tools/lint/README.md` documents scope, exclusions, Phase 1 → Phase 5 promotion path. Source contains the `PHASE 5: tighten — exit 1 on ANY violation` cleanup marker.

## OLD → NEW migration map (canonical recipe for Phase 4)

The full per-key map is documented in **`packages/app/src/styles/tokens/semantic.light.ts:13-58`** (head comment block). Phase 4 surface migrations consult that map directly. Highlights:

| Legacy `theme.colors.*` flat key  | New nested path                                      |
| --------------------------------- | ---------------------------------------------------- |
| `surfaceGlass`                    | `theme.surface.glass.tint`                           |
| `surfaceGlassStrong`              | `theme.surface.glass.tintStrong`                     |
| `surfaceGlassHover`               | `theme.surface.glass.tintHover`                      |
| `borderGlass`                     | `theme.surface.glass.border`                         |
| `surfaceSidebar`                  | `theme.surface.sidebar`                              |
| `surfaceSidebarHover`             | `theme.surface.sidebarHover`                         |
| `surfaceChat`                     | `theme.surface.chat`                                 |
| `bubbleSelf` / `bubbleOther`      | `theme.surface.bubble.{self,other}`                  |
| `bubbleSelfForeground` etc.       | `theme.text.bubble.{self,other,meta}`                |
| `foreground`                      | `theme.text.primary`                                 |
| `foregroundMuted`                 | `theme.text.muted`                                   |
| `border`                          | `theme.border.default`                               |
| `borderAccent`                    | `theme.border.accent`                                |
| `accent` / `accentBright`         | `theme.accent.{base,bright}`                         |
| `accentForeground`                | `theme.accent.foreground`                            |
| `destructive` / `success`         | `theme.status.{destructive,success}`                 |
| `diffAddition` / `diffDeletion`   | `theme.status.diff{Addition,Deletion}`               |
| `statusSuccess`/`Danger`/etc.     | `theme.status.status{Success,Danger,…}`              |
| `palette.green[400]` (online dot) | `theme.status.online` (NEW alias added in this plan) |
| `palette.amber[500]` (connecting) | `theme.status.connecting` (NEW)                      |
| `palette.red[500]` (offline)      | `theme.status.offline` (NEW)                         |

**Component radii:** `theme.borderRadius.{glassCard,glassSheet,glassPill,button}` → `theme.components.{glassCard,glassSheet,glassPill,button}.radius`. The legacy `theme.borderRadius.*` flat shape is preserved on `commonTheme` for unmigrated consumers.

## Phase-4-relevant inventory: legacy keys still being read

Top `theme.colors.*` consumers across `packages/app/src/` (excluding `styles/`):

| Key                               | Reach-through count | Phase 4 plan                                         |
| --------------------------------- | ------------------- | ---------------------------------------------------- |
| `theme.colors.foregroundMuted`    | 474                 | THM-02 (text.muted)                                  |
| `theme.colors.surface[0-4]`       | 244                 | THM-02/03 (surface.\*)                               |
| `theme.colors.foreground`         | 240                 | THM-02 (text.primary)                                |
| `theme.colors.border`             | 100                 | THM-03 (border.default)                              |
| `theme.colors.borderGlass`        | 46                  | THM-03 (surface.glass.border)                        |
| `theme.colors.destructive`        | 44                  | THM-03 (status.destructive)                          |
| `theme.colors.accent`             | 37                  | THM-03 (accent.base)                                 |
| `theme.colors.borderAccent`       | 26                  | THM-03 (border.accent)                               |
| `theme.colors.surfaceGlassStrong` | 25                  | THM-03 (surface.glass.tintStrong)                    |
| `theme.colors.palette.red`        | 25                  | THM-04 (case-by-case → status._ or accent._)         |
| `theme.colors.palette.white`      | 23                  | THM-04 (semantic.{light,dark}.foreground/background) |
| `theme.colors.palette.amber`      | 22                  | THM-04 (status.warning / connecting)                 |
| `theme.colors.surfaceGlass`       | 20                  | THM-03 (surface.glass.tint)                          |
| `theme.colors.palette.green`      | 18                  | THM-04 (status.success / online)                     |
| `theme.colors.surfaceGlassHover`  | 14                  | THM-03 (surface.glass.tintHover)                     |

Phase 4 plans should chain THM-02 (text/foregrounds — biggest reach-through count) before THM-03 (surface/border) before THM-04 (palette mop-up).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree environment lacked hoisted react-native-web → vitest rendering test had to be rewritten as pure-token assertion**

- **Found during:** Task 2 verification (running the new daemon-connection-dot.test.tsx via vitest).
- **Issue:** The workspace `vitest.config.ts` aliases `react-native` → `<rootNodeModules>/react-native-web/dist/index.js`. The parallel-executor worktree has a symlinked `node_modules` that doesn't expose `react-native-web` at the root level (pnpm hoists it under per-package `node_modules` only). Confirmed pre-existing failure on an independent test file (`sidebar-callout-context.test.tsx`) in the parent repo too — this is a workspace-level vitest setup issue, not introduced here.
- **Fix:** Rewrote `daemon-connection-dot.test.tsx` to assert directly against `semanticLight/Dark.status.*` and `palette.*` (pure-TS imports, no JSX render). The threat T-02-01 invariant the rendering test would have covered (the three palette values map to the three statuses) is preserved exactly. Documented inline so future-self knows to upgrade when the RN-vitest setup is stabilized.
- **Files modified:** `packages/app/src/components/daemon-connection-dot.test.tsx`
- **Commit:** `07d808b2`

**2. [Rule 2 - Missing critical functionality] `--write-baseline` was creating the baseline JSON without ensuring its parent directory existed**

- **Found during:** Task 3 self-test development (CLI baseline tests failing inside `mkdtempSync` temp dirs).
- **Issue:** `writeFileSync(absPath, ...)` failed silently when `tools/lint/` didn't exist under the temp scan root.
- **Fix:** Added `mkdirSync(dirname(absPath), { recursive: true })` before the write. Plan 01-01's analog used a fixed in-repo target so this never came up; the THM-01 lint script intentionally accepts a relative scan root and so must self-bootstrap the baseline directory.
- **Files modified:** `tools/lint/hardcoded-color.ts`
- **Commit:** `14816804`

### Plan-driven scope adjustments (no functionality change)

**3. Default-excluded `theme.ts` and `*.test.ts(x)` from the hardcoded-color scan**

- **Why:** `theme.ts` contains the LEGACY shim (intentional, deleted Phase 4); test files legitimately assert against literal hex values for parity guards. Including either in the baseline would have flooded the counter with ~150 known-temporary literals and obscured genuine consumer drift. The orchestrator's success criterion required "the four migrated files" to contribute zero — applying that literally to theme.ts (which still has the LEGACY shim block) is incompatible with leaving the shim in place. Excluding them aligns with the spirit of THM-01 (catch NEW consumer-drift, not architecturally-required temporary literals).
- **Documented:** in the lint script header (`DEFAULT_EXCLUDE_PATHS` rationale) and `tools/lint/README.md`.

## Authentication Gates

None — no auth surfaces touched in this plan.

## Verification Results

| Check                                                          | Result                                       |
| -------------------------------------------------------------- | -------------------------------------------- |
| `npm run typecheck`                                            | exit 0 (all 7 packages clean)                |
| `npm run lint -- packages/app/src/styles/`                     | exit 0                                       |
| `npm run lint -- <four migrated files>`                        | exit 0                                       |
| `npm run lint -- tools/lint/hardcoded-color.{ts,test.ts}`      | exit 0                                       |
| `npm run lint:colors`                                          | exit 0 (count == baseline 591)               |
| `pnpm exec vitest run daemon-connection-dot.test.tsx --bail=1` | exit 0 (5/5 tests pass)                      |
| `tsx --test tools/lint/hardcoded-color.test.ts`                | exit 0 (13/13 tests pass)                    |
| `grep -rE 'theme\.colors\.palette' <four migrated files>`      | zero results                                 |
| `wc -l packages/app/src/styles/theme.ts`                       | 580 (< 716 — file shrank as planned)         |
| `grep -c 'LEGACY shim' packages/app/src/styles/theme.ts`       | 6 (LEGACY block + dark-shim comment markers) |

**Pre-existing repo lint errors (21 total):** confined to `message-input.tsx`, `workspace-screen.tsx`, `i18n/index.ts`, `_layout.tsx`, `landing-page.tsx`, `session.ts`, `button.tsx`, `init.ts`. None in files modified by this plan. These trace back to `c08acb3f chore(phase-01): snapshot in-flight WIP as execution base` and are out of scope per the executor scope-boundary rule.

## Pointers Phase 4 Will Need

1. **Migration recipe**: head comment of `packages/app/src/styles/tokens/semantic.light.ts` is the canonical OLD→new key map. Update it surface-by-surface as Phase 4 retires legacy keys.
2. **Counter-baseline cycle**: after migrating a surface, run `npm run lint:colors:baseline` to capture the new lower count and commit the updated `tools/lint/hardcoded-color.baseline.json`. The lint script prints the "count went DOWN — re-run lint:colors:baseline" hint when it detects a possible re-baseline opportunity.
3. **Phase 5 promotion**: `tools/lint/hardcoded-color.ts` carries a `PHASE 5: tighten — exit 1 on ANY violation` marker — search for that string when promoting THM-01 from warn to error per ROADMAP P5 success criterion #2.
4. **Kill the LEGACY shim**: once every `theme.colors.<flatKey>` consumer has been migrated to the nested namespaces, delete `lightLegacyColors`, `buildDarkLegacyColors`, and the `colors:` field from each theme in `packages/app/src/styles/theme.ts`. Re-add `theme.ts` to the lint scan (remove from DEFAULT_EXCLUDE_PATHS) at the same commit.
5. **Vitest in worktree**: if Phase 4 wants to run RN-rendering tests inside parallel-executor worktrees, the workspace vitest setup needs adjusting so `react-native-web` resolves from per-package `node_modules` (not just the hoisted root). Until then, the daemon-connection-dot.test.tsx pattern (pure-token assertions) is the documented workaround.

## Threat Flags

None — this plan adds zero new attack surface. Token files are constants-only; the lint script is CI-only and never runs in production. T-02-01 (silent value drift) is mitigated by daemon-connection-dot.test.tsx as planned.

## Self-Check: PASSED

Created files exist:

- `packages/app/src/styles/tokens/primitives.ts` — FOUND
- `packages/app/src/styles/tokens/semantic.light.ts` — FOUND
- `packages/app/src/styles/tokens/semantic.dark.ts` — FOUND
- `packages/app/src/styles/tokens/component.ts` — FOUND
- `packages/app/src/styles/tokens/motion.ts` — FOUND
- `packages/app/src/styles/tokens/typography.ts` — FOUND
- `packages/app/src/components/daemon-connection-dot.test.tsx` — FOUND
- `tools/lint/hardcoded-color.ts` — FOUND
- `tools/lint/hardcoded-color.test.ts` — FOUND
- `tools/lint/hardcoded-color.baseline.json` — FOUND

Commits exist:

- `41230fe2` (Task 1: token tree skeleton + theme.ts composition root) — FOUND
- `07d808b2` (Task 2: migrate four in-flight files to semantic tokens) — FOUND
- `14816804` (Task 3: hardcoded-color lint + baseline + npm wiring) — FOUND

No deletions in any commit (`git diff --diff-filter=D --name-only HEAD~3 HEAD` returns empty).
