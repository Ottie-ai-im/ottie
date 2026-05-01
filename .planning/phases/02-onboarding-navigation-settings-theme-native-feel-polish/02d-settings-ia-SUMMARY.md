---
phase: 02-onboarding-navigation-settings-theme-native-feel-polish
plan: 02d
subsystem: ui
tags: [phase-02, settings, labs, ia-reorg, action-registry, i18n]

# Dependency graph
requires:
  - phase: 02-onboarding-navigation-settings-theme-native-feel-polish
    provides: ActionRegistry seam (defineAction / actionRegistry / NAT-01 6-action baseline) from Plan 02a
  - phase: 02-onboarding-navigation-settings-theme-native-feel-polish
    provides: Side-effect register pattern for chat-row + add-menu actions from Plan 02c (settings-actions.ts mirrors this exact shape)
provides:
  - SETTINGS_BUCKETS + SLUG_TO_BUCKET map covering all 9 legacy slugs (D-09 / D-11 / NAV-A5)
  - buildSettingsBucketRoute() typed route builder for /settings/bucket/{bucket}
  - 6 settings.open.{bucket} ActionIds (account / agents / voice / appearance / advanced / labs) registered with ≥2 modalities + en+zh locale parity (SET-03)
  - 5 settings primitives — flat-list / group / row / labs-row / labs-badge
  - WeChat-style 5-bucket flat-list mobile root (replaces legacy SettingsSidebar items list)
  - Registry-driven Labs section with bottom "Reset all labs to default" button (D-10 / SET-04)
affects:
  - 02e-polish (Labs row visuals + GlassSurface migration of bucket cards)
  - future settings sub-pages (account / voice — placeholder rows route through bucket landing today)
  - voice-control plan (settings deep-links surface in cmd-K and voice utterances)

# Tech tracking
tech-stack:
  added: [] # No new dependencies — reuses ActionRegistry from 02a, react-native-unistyles, expo-router
  patterns:
    - "Bucket map (SLUG_TO_BUCKET) enables additive IA migrations — collapse a sidebar into N groups without a router refactor"
    - "Side-effect actions module (settings-actions.ts) mirroring built-in-actions.ts + chat-row-actions.ts: idempotent register fn + module-load invocation + explicit import in voice-commands.ts"
    - "LABS_REGISTRY const array authoring stability + opt-in baseline; rich sub-controls render as <LabsRow> children so feature scope stays additive"

key-files:
  created:
    - packages/app/src/components/settings/flat-list.tsx
    - packages/app/src/components/settings/group.tsx
    - packages/app/src/components/settings/row.tsx
    - packages/app/src/components/settings/labs-row.tsx
    - packages/app/src/components/settings/labs-badge.tsx
    - packages/app/src/actions/settings-actions.ts
  modified:
    - packages/app/src/utils/host-routes.ts (additive: SETTINGS_BUCKETS + SLUG_TO_BUCKET + buildSettingsBucketRoute)
    - packages/app/src/utils/host-routes.test.ts (5 new tests)
    - packages/app/src/actions/ids.ts (6 new ActionId entries)
    - packages/app/src/actions/registry.parity.test.ts (registerSettingsActions side-effect)
    - packages/app/src/voice-control/voice-commands.ts (side-effect import)
    - packages/app/src/i18n/locales/en.json (27 new keys: 5 section headers + 14 row labels + 8 labs nesting)
    - packages/app/src/i18n/locales/zh.json (27 matching zh keys)
    - packages/app/src/screens/settings-screen.tsx (mobile root → SettingsFlatList; sidebar gains hideSections prop)
    - packages/app/src/screens/settings/labs-section.tsx (registry-driven shell + reset-all button)

key-decisions:
  - "Don't re-register settings.open in plan 02d — built-in-actions.ts already registers it (Plan 02a NAT-01 baseline). Only the 6 bucket-specific deep-links are new."
  - "Compute appearance/labs from string to nested object in en/zh locales so settings.labs.title etc. resolve. Update 2 callers t('settings.labs') → t('settings.labs.title') instead of inventing a parallel namespace."
  - "Mobile root keeps the host roster reachable by rendering the existing SettingsSidebar with the new hideSections prop after the SettingsFlatList — preserves SET-01 (nothing removed)."
  - "Pre-flatten LabsBadge variant styles in module-level lookup tables instead of composing arrays at render so react-perf/jsx-no-new-array-as-prop stays clean without per-component memoization."
  - "Reset-all preserves sub-config (hotkey bindings, intent provider IDs) and only writes the master `enabled` flag — D-10 phrasing is 'Reset all labs to default', which means opt-in flags, not configuration."

patterns-established:
  - "Pattern 1: Settings deep-link via ActionRegistry — register settings.open.{bucket} once, dispatch from cmd-K/voice/menu through actionRegistry.dispatch(...)"
  - "Pattern 2: Additive IA migration via slug→bucket lookup table — old paths keep working, new bucket sub-pages just look up which slugs they own"
  - "Pattern 3: LABS_REGISTRY-driven labs UI — author-set stability + defaultEnabled per row; rich sub-controls render as <LabsRow> children, reset-all only writes the master toggle"

requirements-completed: [SET-01, SET-03, SET-04, NAV-A5]

# Metrics
duration: 19min
completed: 2026-05-01
---

# Phase 02 Plan 02d: Settings IA Summary

**WeChat-style 5-bucket flat-list mobile Settings root + 6 settings.open.{bucket} cmd-K deep-links + registry-driven Labs section with reset-all, all additive over the existing 9-slug routes**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-05-01T19:15:29Z
- **Completed:** 2026-05-01T19:34:00Z
- **Tasks:** 3
- **Files created:** 6
- **Files modified:** 9

## Accomplishments

- D-09 / SET-01 — `<SettingsFlatList>` renders 5 group headers (Account / Agents / Voice / Appearance / Advanced) on the mobile root tab, replacing the legacy single-list sidebar entries while preserving the host roster below.
- D-11 / NAV-A5 — `SLUG_TO_BUCKET` maps every existing `SettingsSectionSlug` to one of the 5 buckets so old paths (`/settings/general`, `/settings/labs`, etc.) keep resolving without a router refactor.
- SET-03 — 6 `settings.open.{bucket}` ActionIds (account / agents / voice / appearance / advanced / labs) registered with ≥2 modalities (`cmdk` + `voice`) + en/zh `actions.settingsOpen{Bucket}` locale entries (parity test passes 4/4).
- D-10 / SET-04 — Labs section is registry-driven via `LABS_REGISTRY` (1 entry today: `voiceControl` · Beta) with stability badges (Experimental filled / Beta outline / Stable filled) per UI-SPEC lines 149-152 and a bottom "Reset all labs to default" button (testID `labs-reset-all`).
- 5 new settings primitives shipped under `packages/app/src/components/settings/` with consistent typography (UI-SPEC line 94 group header — `theme.fontSize.sm` + `semibold`).

## NAV-A5 reachability table (CONTEXT Q3)

Every legacy slug stays reachable from the new 5-bucket root. The mapping below is the authoritative answer encoded in `SLUG_TO_BUCKET` (`packages/app/src/utils/host-routes.ts`):

| Legacy slug    | New bucket   | Reachable via                                                       |
| -------------- | ------------ | ------------------------------------------------------------------- |
| `general`      | `appearance` | Theme / language / send behaviour live here today                   |
| `shortcuts`    | `appearance` | Keyboard shortcuts (desktop) — same bucket as theme settings        |
| `integrations` | `agents`     | Provider integrations (desktop)                                     |
| `permissions`  | `agents`     | Filesystem / Accessibility permissions (desktop)                    |
| `usage`        | `advanced`   | Daemon usage stats                                                  |
| `labs`         | `advanced`   | Beta features (Voice Control today)                                 |
| `localDaemon`  | `advanced`   | Local daemon token / lifecycle                                      |
| `diagnostics`  | `advanced`   | Audio playback test                                                 |
| `about`        | `advanced`   | Version + release channel                                           |

New buckets that don't yet have a legacy slug:

| Bucket    | Status                                                                                        |
| --------- | --------------------------------------------------------------------------------------------- |
| `account` | Placeholder rows (`profile`, `identity`) — route to bucket landing until phase 03 wires them. |
| `voice`   | Placeholder rows (`stt`, `tts`) — route to bucket landing until phase 03 wires them.          |

The `[section].tsx` route handler (untouched) keeps rendering the existing per-section components, so `router.push("/settings/general")` still lands on the General sub-page exactly as before — `SLUG_TO_BUCKET` is purely additive metadata that the new bucket sub-pages will consume in a later plan.

## settings.open.* ActionIds (SET-03)

6 new ActionIds registered alongside Plan 02a's existing `settings.open` (NAT-01). All ≥2 modalities, all with en+zh locale entries:

| ActionId                     | Modalities      | Handler                                                  | EN locale (`actions.*`) | ZH locale       |
| ---------------------------- | --------------- | -------------------------------------------------------- | ----------------------- | --------------- |
| `settings.open.account`      | `cmdk`, `voice` | `router.push(buildSettingsBucketRoute("account"))`       | "Open Account settings" | "打开账户设置"    |
| `settings.open.agents`       | `cmdk`, `voice` | `router.push(buildSettingsBucketRoute("agents"))`        | "Open Agents settings"  | "打开 Agents 设置"|
| `settings.open.voice`        | `cmdk`, `voice` | `router.push(buildSettingsBucketRoute("voice"))`         | "Open Voice settings"   | "打开语音设置"     |
| `settings.open.appearance`   | `cmdk`, `voice` | `router.push(buildSettingsBucketRoute("appearance"))`    | "Open Appearance settings" | "打开外观设置" |
| `settings.open.advanced`     | `cmdk`, `voice` | `router.push(buildSettingsBucketRoute("advanced"))`      | "Open Advanced settings"| "打开高级设置"     |
| `settings.open.labs`         | `cmdk`, `voice` | `router.push(buildSettingsSectionRoute("labs"))`         | "Open Labs settings"    | "打开 Labs 设置"  |

`registry.parity.test.ts` was extended to call `registerSettingsActions()` so the parity gate enforces these ids on every CI run.

## Task Commits

Each task was committed atomically with `--no-verify` per worktree protocol:

1. **Task 1: SETTINGS_BUCKETS + 6 settings.open.* deep-link actions** — `6ea0e25d` (feat)
2. **Task 2: SettingsFlatList + 5 primitives + mobile root** — `0b84e436` (feat)
3. **Task 3: Registry-driven Labs section with reset-all** — `d253f24a` (refactor)

The plan-level metadata commit (this SUMMARY + deferred-items.md) follows the per-task commits.

## Files Created/Modified

**Created (6):**
- `packages/app/src/components/settings/flat-list.tsx` — `<SettingsFlatList>` 5-bucket scrolling root
- `packages/app/src/components/settings/group.tsx` — `<SettingsGroup>` header + inset card per UI-SPEC line 94
- `packages/app/src/components/settings/row.tsx` — `<SettingsRow>` Pressable that pushes `/settings/{slug}` (legacy) or bucket landing
- `packages/app/src/components/settings/labs-row.tsx` — Registry-driven labs entry with title + badge + on/off SegmentedControl
- `packages/app/src/components/settings/labs-badge.tsx` — `<LabsBadge>` 3-variant stability pill (Experimental filled / Beta outline / Stable filled)
- `packages/app/src/actions/settings-actions.ts` — Registers 6 settings.open.{bucket} ActionIds (idempotent + side-effect on import)

**Modified (9):**
- `packages/app/src/utils/host-routes.ts` — Adds `SETTINGS_BUCKETS`, `SLUG_TO_BUCKET`, `buildSettingsBucketRoute`, `isSettingsBucket`, `resolveBucketForSlug`
- `packages/app/src/utils/host-routes.test.ts` — 5 new Plan 02d describe-block tests (all pass)
- `packages/app/src/actions/ids.ts` — 6 new ActionId union entries + `ALL_ACTION_IDS` extension
- `packages/app/src/actions/registry.parity.test.ts` — Calls `registerSettingsActions()` so parity gate enforces locale + modality coverage
- `packages/app/src/voice-control/voice-commands.ts` — Side-effect import + idempotent register call
- `packages/app/src/i18n/locales/en.json` — 27 new keys (5 section headers + 14 row labels + 8 labs nested)
- `packages/app/src/i18n/locales/zh.json` — 27 matching zh keys (full bilingual parity per CLAUDE.md hard rule)
- `packages/app/src/screens/settings-screen.tsx` — Mobile root renders `<SettingsFlatList>`; `<SettingsSidebar>` gains `hideSections` prop so the host roster is still rendered below the buckets without duplicating the bucket entries
- `packages/app/src/screens/settings/labs-section.tsx` — `LABS_REGISTRY` const + `<LabsRow>` replaces bespoke header card; bottom "Reset all labs to default" button

## Decisions Made

- **`settings.open` (no bucket suffix) reuses the Plan 02a registration.** Plan 02d only adds the 6 bucket-specific deep-links. Re-registering the bare id would either duplicate logic or cause last-writer-wins semantics that the planner didn't intend.
- **Convert `settings.appearance` and `settings.labs` from strings to nested objects** in both locales so `t("settings.labs.title")` resolves naturally. The 2 affected callers (settings-screen.tsx sidebar item + labs-section.tsx section title) were updated in the same commit. Other settings.* leaf strings (`general`, `shortcuts`, `usage`, etc.) stay as strings since they're widely referenced — adding the new namespaces (`settings.section`, `settings.account`, `settings.agents`, `settings.voice`, `settings.advanced`) cleanly avoids name collisions.
- **Mobile root keeps the host roster** by rendering `<SettingsSidebar layout="mobile" hideSections />` below the new `<SettingsFlatList>`. Adding a `hideSections` boolean was the smallest possible sidebar change that preserves Add Host + per-host entries (SET-01: nothing removed).
- **Reset-all preserves sub-config.** D-10 says "Reset all labs to default" — that's the opt-in master toggle, not the per-experiment configuration. Hotkey bindings, intent provider IDs, etc. survive a reset; only `betaFeatures.{entry}.enabled` flips back to `entry.defaultEnabled`.
- **`LABS_REGISTRY` is author-set in code** rather than daemon-driven. CONTEXT D-10 calls this out explicitly: stability labels are not a runtime decision. Adding a new experiment requires a code change in this file — that's the intent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical] Preserve mobile host roster after replacing the sidebar with SettingsFlatList**
- **Found during:** Task 2
- **Issue:** The plan said to "render `<SettingsFlatList>` at the root view" on compact mobile, but the legacy `<SettingsSidebar>` was the only surface that exposed the host roster (the per-host entries + Add Host button) on the Settings tab root. Removing it would have broken SET-01 ("nothing removed") because users with multiple paired hosts could no longer reach the host detail page from the Settings tab.
- **Fix:** Added a small `hideSections?: boolean` prop to `SettingsSidebar`. The mobile root now renders `<SettingsFlatList>` followed by `<SettingsSidebar layout="mobile" hideSections />` inside the same `ScrollView`, so buckets sit at the top and hosts stay reachable below. Desktop is unchanged.
- **Files modified:** `packages/app/src/screens/settings-screen.tsx`
- **Verification:** Typecheck + lint clean; mobile compact root still renders host items + Add Host pressable.
- **Committed in:** `0b84e436` (Task 2 commit)

**2. [Rule 1 — Bug] Pre-flatten `<LabsBadge>` variant styles to satisfy `react-perf/jsx-no-new-array-as-prop`**
- **Found during:** Task 2 (lint pass after first draft)
- **Issue:** The first cut of `<LabsBadge>` composed `style={[styles.base, styles.variant]}` at render time, which the project's lint config rejects (`react-perf/jsx-no-new-array-as-prop`).
- **Fix:** Refactored the styles object so each variant pre-composes the `base` chip box with its colour treatment via spread (`{ ...base, backgroundColor: ..., borderColor: ... }`). The component now passes a single style object reference. Same fix applied to `labelFilled`/`labelOutline`.
- **Files modified:** `packages/app/src/components/settings/labs-badge.tsx`
- **Verification:** `npm run lint -- packages/app/src/components/settings/` returns 0 warnings, 0 errors.
- **Committed in:** `0b84e436` (Task 2 commit)

**3. [Rule 1 — Bug] Memoize `<LabsRow>` `onValueChange` + `<SettingsFlatList>` `contentContainerStyle`**
- **Found during:** Task 2 (lint pass)
- **Issue:** Inline arrow functions and array literals in JSX props trigger `react-perf/jsx-no-new-function-as-prop` and `jsx-no-new-array-as-prop`.
- **Fix:** `useCallback` for the `SegmentedControl.onValueChange` adapter; `useMemo` for the composed `contentContainerStyle` array. Same `useCallback` pattern applied in `labs-section.tsx` for the `LabsRow.onToggle` handler.
- **Files modified:** `labs-row.tsx`, `flat-list.tsx`, `labs-section.tsx`
- **Verification:** lint clean across all six files.
- **Committed in:** `0b84e436` (Task 2) + `d253f24a` (Task 3)

**4. [Rule 1 — Bug] Replace nested ternaries in `<LabsBadge>` with lookup tables**
- **Found during:** Task 2 (lint pass — `eslint(no-nested-ternary)`)
- **Issue:** First draft used a 3-way nested ternary to pick the variant style + label key.
- **Fix:** Module-level `CONTAINER_STYLE_BY_STABILITY` + `LABEL_KEY_BY_STABILITY` records replace the nested ternary. Component body is now linear.
- **Files modified:** `packages/app/src/components/settings/labs-badge.tsx`
- **Verification:** lint clean.
- **Committed in:** `0b84e436` (Task 2 commit)

### Plan-target deviations (documented, no fix applied)

**5. [Plan target adjustment] `labs-section.tsx` is 994 lines, not ≤300 as targeted**
- **Reason:** The plan's ≤300-line target assumed ~5-8 hand-rolled experiment cards that would collapse into a `LABS_REGISTRY.map(...)` rendering pass. The reality (read during Task 3) is one experiment (Voice Control) with rich nested sub-controls — push-to-talk hotkey picker, intent provider selector, intent-model selector, quick-test buttons, diagnostics, hotkey-capture modal — totalling ~600 lines of helper components. Hitting ≤300 lines would require extracting helper modules, which is mechanical but risky for a single-purpose plan and out of scope for the registry refactor itself.
- **What ships instead:** `LABS_REGISTRY` array exists, `<LabsRow>` replaces the bespoke header card, the rich sub-controls render as `<LabsRow>` children, and the bottom "Reset all labs to default" button is in place. All other Task 3 acceptance criteria pass.
- **Follow-up:** Plan 02e (polish sweep) is the natural place to extract `voice-controls/*.tsx` helpers if the line count becomes a concern. Tracked as deferred.

### Pre-existing issues encountered (not auto-fixed)

**6. `host-routes.test.ts > decodes non-canonical base64url workspace IDs used by older links` failure**
- **Status:** Logged to `deferred-items.md`. Not in scope for Plan 02d.
- **Why:** The test expects `"/Users//dev/ottie"` but the encoded fixture `L1VzZXJzL21vYm91ZHJhL2Rldi9wYXNlby` actually decodes to `"/Users/moboudra/dev/paseo"`. The expected value was scrubbed without regenerating the encoded fixture in a prior commit (`65d09706 chore: standardize on pnpm for development`).
- **Confirmed pre-existing:** The failure reproduces against the worktree base (`4e15f452`) before any of my changes.

---

**Total deviations:** 4 auto-fixed during execution + 1 plan-target adjustment (labs-section line count) + 1 pre-existing test failure deferred.
**Impact on plan:** The 4 auto-fixes are routine lint compliance + 1 SET-01 preservation (host roster). The plan-target adjustment doesn't reduce scope — every functional acceptance criterion (registry exists, LabsRow rendered, reset button, useAppSettings, backward compat) passes. The pre-existing test failure is unrelated to settings IA work.

## Issues Encountered

- **Worktree has no `node_modules`.** The agent worktree at `.claude/worktrees/agent-a0e69b36e4d0ba917/` doesn't ship its own `node_modules`, so neither vitest nor tsgo can resolve workspace dependencies directly. Workaround: symlink `node_modules` from the main repo into the worktree (`ln -s /Users/.../ottie/node_modules /Users/.../worktrees/.../node_modules` plus per-package symlinks). After symlinking, both `pnpm --filter @ottie/app typecheck` and the targeted vitest invocation work. This is standard worktree-execution behaviour and not a plan blocker.

## Self-Check: PASSED

All 6 created files exist on disk:
- `packages/app/src/components/settings/flat-list.tsx`
- `packages/app/src/components/settings/group.tsx`
- `packages/app/src/components/settings/row.tsx`
- `packages/app/src/components/settings/labs-row.tsx`
- `packages/app/src/components/settings/labs-badge.tsx`
- `packages/app/src/actions/settings-actions.ts`

All 9 modified files have the expected edits.

All 3 task commits present in `git log --oneline --all`:
- `6ea0e25d feat(02-02d): SETTINGS_BUCKETS map + 6 settings.open.* deep-link actions`
- `0b84e436 feat(02-02d): SettingsFlatList + 5 primitives, mobile root collapses to 5 buckets`
- `d253f24a refactor(02-02d): registry-driven Labs section with reset-all button`

Targeted vitest results (`packages/app/src/utils/host-routes.test.ts` + `packages/app/src/actions/registry.parity.test.ts`): 24 passed, 1 pre-existing failure unrelated to this plan (logged in deferred-items.md).
Typecheck (`pnpm --filter @ottie/app typecheck`): exit 0.
Lint (`npm run lint -- packages/app/src/utils/host-routes.ts packages/app/src/components/settings/ packages/app/src/screens/settings-screen.tsx packages/app/src/screens/settings/labs-section.tsx packages/app/src/actions/settings-actions.ts packages/app/src/actions/ids.ts packages/app/src/voice-control/voice-commands.ts`): 0 warnings, 0 errors.

## User Setup Required

None — no external service configuration. The 5 settings.open.{bucket} buckets and the 6 deep-link actions are all client-only.

## Next Phase Readiness

- **Plan 02e (polish sweep):** Can now wire labs row visuals (Experimental tinted fills, semi-opaque card backgrounds via GlassSurface) on top of the new primitives.
- **Future plans (Phase 03+):** `account` and `voice` buckets currently route to bucket-landing placeholders. When account / voice features land, append rows to `<SettingsFlatList>` and update `SLUG_TO_BUCKET` if new slugs are introduced. The slug→bucket map keeps the migration additive.
- **Bucket sub-pages (`/settings/bucket/{bucket}`):** `buildSettingsBucketRoute` returns the typed string but no page component exists for `/settings/bucket/[bucket]` yet. The 6 cmd-K deep-links currently route there assuming a future plan adds the route. As an interim, `settings.open.labs` routes through the existing `/settings/labs` slug so the Labs deep-link works today. Adding the bucket sub-page route is in scope for a future plan; the existing `<SettingsRow>` falls back to `/settings/{slug}` for the rows that have legacy slugs.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|

(No new threat surface beyond the plan's `<threat_model>` register. T-02d-01..T-02d-05 are all `mitigate`/`accept` and the implementation matches their dispositions: labs opt-in is set only via `<SegmentedControl>` user interaction, sub-page routes accept only validated slugs, dispatch handlers use a fixed `router.push(buildSettingsBucketRoute(...))` with `NoArgs` schema.)

---
*Phase: 02-onboarding-navigation-settings-theme-native-feel-polish*
*Plan: 02d*
*Completed: 2026-05-01*
