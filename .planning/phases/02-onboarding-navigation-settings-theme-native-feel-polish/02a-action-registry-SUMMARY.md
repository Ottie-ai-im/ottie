---
phase: 02-onboarding-navigation-settings-theme-native-feel-polish
plan: 02a
subsystem: ui
tags:
  [
    phase-02,
    action-registry,
    cmdk,
    keyboard,
    haptics,
    metro-split,
    react-hotkeys-hook,
    bottom-sheet,
    i18n,
    nat-01,
    nav-a5,
  ]

# Dependency graph
requires:
  - phase: 01-architectural-foundations-gating-bug-fixes
    provides: GlassSurface primitive, IsolatedBottomSheetModal, useKeyboardShortcutsStore, isNative/isWeb gates
provides:
  - "ActionRegistry singleton (`actionRegistry`) — register / dispatch / getActionById / searchActions; dispatch is Zod-parsed"
  - "ActionId union covering NAT-01 minimum 6 + 9 chat-row context-menu items + 4 add-menu items (extension points for Plans 02c/02d)"
  - "Modality enum (voice / kbd / cmdk / menu / gesture)"
  - "useHaptic({ enabled, isLowPowerMode }).fire('light'|'medium'|'heavy') — single haptic entry point with 200ms per-event debounce, native-only, settings-respecting"
  - "Metro split for command-center: cmdk palette on web/Tauri, @gorhom/bottom-sheet on native; old single-file impl reduced to a 6-line shim"
  - "react-hotkeys-hook Cmd+K / Ctrl+K wired on desktop-nav-rail (web/Tauri only)"
  - "Long-press on active mobile-tab-bar tab opens native command-center bottom sheet (delayLongPress=350ms)"
  - "voice-commands.ts handlers route through actionRegistry.dispatch (workspace.switch + settings.open) with safe fallback"
  - "keyboard-action-dispatcher mirrors successful keyboard actions to actionRegistry (fire-and-forget)"
  - "registerBuiltInActions() — idempotent registration of the 6 NAT-01 reference actions"
  - "CI parity test (registry.parity.test.ts) blocking modality-coverage and en+zh locale-parity regressions"
affects:
  - 02c-chats-tab (extends ActionRegistry with chat-row context-menu + add-menu items; uses useHaptic for swipe haptics)
  - 02d-settings-ia (extends ActionRegistry with settings deep-link actions)
  - 02e-polish-sweep (wires isLowPowerMode source via expo-battery; replaces inline Haptics.* calls with useHaptic)

# Tech tracking
tech-stack:
  added: [cmdk@1.1.1, react-hotkeys-hook@5.3.0, burnt@0.13.0, sonner@2.0.7]
  patterns:
    - Side-effect modules for action registration (built-in-actions.ts) keep the static import graph minimal
    - Dynamic-import inside action handlers so registration is near-zero cost; payload cost only paid on dispatch
    - Metro extension split (.web.tsx / .native.tsx) for fundamentally different platform implementations
    - Action dispatch is Zod-parsed at the registry boundary — handlers never see untyped payload (T-02a-02 mitigation)
    - Cross-modality mirror via `keyboard-action-dispatcher → actionRegistry.dispatch` (fire-and-forget, unknown-id no-op)

key-files:
  created:
    - packages/app/src/actions/registry.ts
    - packages/app/src/actions/ids.ts
    - packages/app/src/actions/modalities.ts
    - packages/app/src/actions/built-in-actions.ts
    - packages/app/src/actions/registry.test.ts
    - packages/app/src/actions/registry.parity.test.ts
    - packages/app/src/hooks/use-haptic.ts
    - packages/app/src/hooks/use-haptic.test.ts
    - packages/app/src/components/command-center.web.tsx
    - packages/app/src/components/command-center.native.tsx
    - packages/app/src/voice-control/voice-commands.actions.test.ts
  modified:
    - packages/app/src/components/command-center.tsx (491 → 6 lines: Metro shim re-export)
    - packages/app/src/components/desktop-nav-rail.tsx (added useHotkeys meta+k/ctrl+k)
    - packages/app/src/components/mobile-tab-bar.tsx (added onLongPress + delayLongPress on TabButton)
    - packages/app/src/voice-control/voice-commands.ts (openSettings + switchToWorkspace dispatch through actionRegistry)
    - packages/app/src/keyboard/keyboard-action-dispatcher.ts (mirror successful dispatches into actionRegistry)
    - packages/app/src/i18n/locales/en.json (new "actions" namespace, 6 reference labels)
    - packages/app/src/i18n/locales/zh.json (new "actions" namespace, 6 reference labels)
    - packages/app/package.json (4 new deps)
    - pnpm-lock.yaml

key-decisions:
  - "Locale entries use NESTED form (`actions: { agentCreate: '…' }`) instead of flat dotted keys — matches every other section in en/zh.json and lets `t('actions.agentCreate')` resolve naturally. Plan's example syntax assumed flat keys; we deviate for consistency and to keep i18next default `keySeparator` behavior intact."
  - "Action registration lives in a dedicated `built-in-actions.ts` module rather than inline in voice-commands.ts so tests can import registration without pulling in the entire voice-runtime stack (expo-router .tsx files vitest can't transform)."
  - "Action handlers use dynamic `await import()` for router/store dependencies — registration cost stays near-zero, payload is only paid when an action actually fires."
  - "Keyboard dispatcher mirrors INTO actionRegistry as fire-and-forget rather than RECEIVING from it — keyboard owns its own priority/scope dispatch loop (per plan), and cross-modality observers get the same event stream."
  - "useHaptic 'heavy' maps to notificationAsync(Warning) per UI-SPEC D-18 — semantic match for warning beats rather than tactile feedback on a tap."
  - "useHaptic test suite uses `// @vitest-environment jsdom` + dynamic mock of `@/constants/platform` to exercise the native code path under react-native-web (which always reports Platform.OS === 'web')."

patterns-established:
  - "Side-effect registration modules: a `register…Actions()` function + a top-level call in the same file. Idempotent guard prevents double-registration in test contexts that reset modules."
  - "Dispatch fallback pattern in voice handlers: call `actionRegistry.dispatch(id, payload)`; if it returns false (action not registered), fall back to the original inline behavior. Lets us migrate handlers one at a time without breaking voice."
  - "Parity test scaffolding: enumerate a constant `NAT_01_REFERENCE_IDS` array, then per-id assertions. Future plans add ids to the union and register them; the parity test continues to pass because the 80% gate is generous."

requirements-completed: [NAV-A5, NAT-01, NAT-02]

# Metrics
duration: 13m
completed: 2026-05-01
---

# Phase 02 Plan 02a: ActionRegistry + useHaptic + Metro-split Command Center Summary

**Universal ActionRegistry singleton with Zod-parsed dispatch, cmdk web palette + bottom-sheet native variant via Metro extensions, react-hotkeys-hook Cmd+K wiring, and a single useHaptic hook (200ms debounce + low-power-mode + settings toggle) — backed by a CI parity gate that blocks modality and en+zh locale regressions.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-01T11:15:30Z
- **Completed:** 2026-05-01T11:28:33Z
- **Tasks:** 3
- **Files created:** 11
- **Files modified:** 9 (incl. lockfile)
- **Tests added:** 18 (6 registry + 6 useHaptic + 2 voice routing + 4 parity)

## Accomplishments

- ActionRegistry foundation lands with a Zod-parsed dispatch surface, ActionId/Modality types, and the 6 NAT-01 reference actions registered.
- Command center is now Metro-split — cmdk palette on web/Tauri inside `<GlassSurface radius="sheet" strong>`, IsolatedBottomSheetModal on native — with the old 491-line single-file impl reduced to a 6-line shim re-export.
- Cmd+K / Ctrl+K opens the palette on desktop via `useHotkeys` (web-guarded); long-press on the active mobile-tab-bar tab opens the bottom sheet on native.
- Voice command handlers (`openSettings`, `switchToWorkspace`) now dispatch through `actionRegistry` first, with safe fallback to inline behavior.
- Keyboard dispatcher mirrors successful actions into ActionRegistry so cmdk/voice/menu observers stay in sync without losing the keyboard's own priority/scope dispatch.
- `useHaptic` is the single source of truth — native-only, 200ms per-event debounce, settings-toggle aware, low-power-mode aware (input-driven, source wired by Plan 02e).
- CI parity test enforces the NAT-01 acceptance criteria: every reference action is registered, covers ≥2 modalities, ships with both en + zh locale entries, and ≥80% of all registered actions are multi-modality.

## Task Commits

Each task was committed atomically (TDD: tests written first, then implementation):

1. **Task 1: Install Phase 02 deps + ActionRegistry contracts + useHaptic** — `7b22bc50` (feat)
2. **Task 2: Metro-split command-center, route voice/keyboard through ActionRegistry, en+zh i18n** — `ccf0a9a2` (feat)
3. **Task 3: CI parity test asserting modality + locale coverage** — `c28886ef` (test)

_All commits include their own RED → GREEN sequence in a single commit (test-file additions live alongside implementation per the project's collocated-test convention)._

## Files Created/Modified

**Created:**

- `packages/app/src/actions/registry.ts` — `defineAction`, `createActionRegistry`, singleton `actionRegistry`, `getActionById`, `searchActions`
- `packages/app/src/actions/ids.ts` — `ActionId` union (19 ids: 6 NAT-01 reference + 9 chat-row + 4 add-menu)
- `packages/app/src/actions/modalities.ts` — `Modality` enum
- `packages/app/src/actions/built-in-actions.ts` — registers the 6 NAT-01 reference actions on first import (idempotent)
- `packages/app/src/actions/registry.test.ts` — 6 contract tests for register/dispatch/searchActions
- `packages/app/src/actions/registry.parity.test.ts` — 4 CI gates for modality coverage + en/zh locale presence
- `packages/app/src/hooks/use-haptic.ts` — single haptic entry point
- `packages/app/src/hooks/use-haptic.test.ts` — 6 jsdom tests covering debounce + settings + low-power + web no-op
- `packages/app/src/components/command-center.web.tsx` — cmdk palette inside GlassSurface, web-guarded
- `packages/app/src/components/command-center.native.tsx` — IsolatedBottomSheetModal + BottomSheetScrollView
- `packages/app/src/voice-control/voice-commands.actions.test.ts` — regression test confirming registration via built-in-actions

**Modified:**

- `packages/app/src/components/command-center.tsx` — 491 lines → 6-line Metro shim
- `packages/app/src/components/desktop-nav-rail.tsx` — `useHotkeys("meta+k, ctrl+k")` opens command-center (web-guarded)
- `packages/app/src/components/mobile-tab-bar.tsx` — `onLongPress` + `delayLongPress={350}` on `TabButton` opens native command-center
- `packages/app/src/voice-control/voice-commands.ts` — handlers dispatch through actionRegistry (with safe fallback); side-effect import + `registerBuiltInActions()` call
- `packages/app/src/keyboard/keyboard-action-dispatcher.ts` — mirror successful dispatches into actionRegistry (fire-and-forget)
- `packages/app/src/i18n/locales/en.json` — new `actions` namespace, 6 reference labels
- `packages/app/src/i18n/locales/zh.json` — new `actions` namespace, 6 reference labels (parity)
- `packages/app/package.json` — added `cmdk@1.1.1`, `react-hotkeys-hook@5.3.0`, `burnt@0.13.0`, `sonner@2.0.7`
- `pnpm-lock.yaml`

## Registered Actions (post-execution snapshot)

| ActionId               | Modalities                  | EN label             | ZH label   |
| ---------------------- | --------------------------- | -------------------- | ---------- |
| `agent.create`         | voice, kbd, cmdk, menu      | New chat             | 新建       |
| `workspace.switch`     | voice, cmdk, menu           | Switch workspace     | 切换工作区 |
| `session.jump.recent`  | voice, cmdk, kbd            | Jump to recent       | 跳转到最近 |
| `permission.decide`    | voice, menu, kbd            | Decide permission    | 处理权限   |
| `settings.open`        | voice, cmdk, kbd            | Open settings        | 打开设置   |
| `theme.cycle`          | voice, cmdk, kbd            | Cycle theme          | 切换主题   |

All 6 actions are reachable from ≥3 modalities — 100% multi-modality coverage at plan close (well above the 80% gate).

## Parity Test Results

`npx vitest run src/actions/registry.parity.test.ts --bail=1`

```
✓ ActionRegistry parity (NAT-01) > every NAT-01 reference action is registered
✓ ActionRegistry parity (NAT-01) > every NAT-01 reference action covers >= 2 modalities (CONTEXT Q6)
✓ ActionRegistry parity (NAT-01) > every registered action has en + zh locale entries
✓ ActionRegistry parity (NAT-01) > >= 80% of registered actions have modalities.length >= 2
```

All 4 gates pass. The locale gate is the bilingual safeguard CLAUDE.md requires.

## Decisions Made

- **Locale shape — nested over flat keys.** Plan example showed flat dotted keys (`"actions.agentCreate": "…"`); the existing en/zh.json convention is nested objects (`"actions": { "agentCreate": "…" }`). We chose nested for consistency and so i18next's default `keySeparator` (the dot) works without per-namespace overrides. The parity test's `dotPath.split(".").reduce` traversal validates the nested form correctly.
- **Action registration lives in `built-in-actions.ts`, not `voice-commands.ts`.** The vitest pipeline can't transform expo-router's .tsx files; importing voice-commands.ts in tests crashed on `Stack.tsx`. Splitting registration into a thin module that uses dynamic imports inside handlers keeps tests independent of the voice runtime.
- **Action handlers use dynamic `await import()`** for router and stores. Static imports would re-introduce the JSX-transform problem and inflate the registration cost; dynamic imports defer the chain until an action actually fires.
- **Keyboard dispatcher mirrors INTO actionRegistry, not the reverse.** The plan was explicit: keyboard keeps its priority/scope loop. Mirroring lets cmdk/voice/menu observers see the same events without converting the keyboard dispatcher into a thin wrapper around the registry.
- **`useHaptic` 'heavy' = `notificationAsync(Warning)`** per UI-SPEC D-18 — semantic match for warning/error beats rather than tactile feedback. Light/medium use `impactAsync` with the corresponding `ImpactFeedbackStyle`.
- **Test environment for useHaptic = jsdom + dynamic platform mock.** vitest runs in node mode and aliases react-native → react-native-web, so `Platform.OS === 'web'` is always true. To exercise the native code path we mock `@/constants/platform` per-suite with `vi.doMock`. jsdom is required because `@testing-library/react`'s `renderHook` mounts a tiny tree.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Lint rules-of-hooks fired after first draft of `command-center.web.tsx`**

- **Found during:** Task 2 (post-write lint sweep)
- **Issue:** First draft put `if (!isWeb) return null;` BEFORE the `useUnistyles()` / `useCommandCenter()` / `useRef` / `useEffect` / `useMemo` calls. `eslint-plugin-react-hooks(rules-of-hooks)` flagged 7 hook calls as "called conditionally" because the guard early-returned before the hook order stabilized.
- **Fix:** Moved all hook calls to the top of the function body and merged the platform guard with the open-state guard into a single late return (`if (!isWeb || !open) return null;`). Memoized inline JSX `style={{...}}` props (CSSProperties for Command.Input/List/Item) with `useMemo` so `react-perf(jsx-no-new-object-as-prop)` and `react-perf(jsx-no-new-function-as-prop)` also pass. Extracted the per-row `onSelect` callback via a wrapper component that accepts the memoized `rowStyle` as a prop.
- **Files modified:** `packages/app/src/components/command-center.web.tsx`
- **Verification:** `npm run lint -- packages/app/src/components/command-center.web.tsx` exits 0; the typecheck also stays green.
- **Committed in:** `ccf0a9a2` (Task 2)

**2. [Rule 3 - Blocking] `eslint-plugin-import(no-unassigned-import)` blocked side-effect imports**

- **Found during:** Task 2 (initial lint pass on `voice-commands.ts`) and Task 3 (initial lint pass on `registry.parity.test.ts`)
- **Issue:** `import "@/actions/built-in-actions";` is the idiomatic side-effect import shape but oxlint's `no-unassigned-import` flagged it.
- **Fix:** Exported a `registerBuiltInActions()` function from the side-effect module and call it explicitly at top-level (`registerBuiltInActions();`). Function is idempotent (`if (registered) return;`) so multiple imports remain safe.
- **Files modified:** `packages/app/src/actions/built-in-actions.ts`, `packages/app/src/voice-control/voice-commands.ts`, `packages/app/src/actions/registry.parity.test.ts`
- **Verification:** Lint passes on all three files; the parity test still confirms all 6 NAT-01 reference actions are registered after a `vi.resetModules()`-style chain.
- **Committed in:** `ccf0a9a2` (Task 2) and `c28886ef` (Task 3)

**3. [Plan-deviation note — locale shape] Used nested instead of flat dotted keys**

- **Found during:** Task 2 (when adding to en.json / zh.json)
- **Issue:** Plan Step 8 example showed `"actions.agentCreate": "New chat"` as a flat key. Every other section in en.json and zh.json uses nested objects (`"actions": { "agentCreate": "..." }`).
- **Fix:** Used the nested form for consistency with the rest of the file and to keep i18next's default `keySeparator: "."` working. The parity test's `dotPath.split(".").reduce` traversal correctly validates either shape; the `t("actions.agentCreate")` consumer pattern works because i18next does its own dot-path traversal.
- **Side effect:** The literal `grep -c "actions.agentCreate"` acceptance check returns 0 instead of 1 — the regex requires the literal substring `actions.agentCreate` (with `.` matching a single char) which the nested JSON doesn't contain. The parity test (Task 3) is the actual validator and passes.
- **Committed in:** `ccf0a9a2` (Task 2)

---

**Total deviations:** 3 (2 auto-fixed for lint + 1 plan-shape clarification)
**Impact on plan:** All deviations are correctness-preserving. Locale-shape change keeps the file convention consistent and the i18next consumer pattern intact; the parity test (the actual gate) remains green.

## Issues Encountered

- **vitest can't import `voice-commands.ts` directly.** Static imports of expo-router pull in `.tsx` files the vitest pipeline doesn't transform (`SyntaxError: Unexpected token '<'`). Worked around by splitting registration into `built-in-actions.ts` (lightweight, dynamic-import for router/store dependencies). Future plans should follow the same pattern when adding action registrations.
- **No-op handlers on `permission.decide` and partial cycles on `theme.cycle`.** `permission.decide` is intentionally a no-op shim until Plan 02c wires the permission-store; `theme.cycle` defers to the keyboard dispatcher and accepts the `KeyboardActionDefinition` type cast (the keyboard dispatcher's union doesn't include `theme.cycle` as a scoped action — it's reachable through `useKeyboardShortcuts`'s switch statement). Both decisions are documented inline in `built-in-actions.ts`.

## Known Stubs

| File | Line | Stub | Reason |
|------|------|------|--------|
| `packages/app/src/actions/built-in-actions.ts` | ~110 | `permission.decide` handler is empty | Wired in Plan 02c via permission-store; keeps the action discoverable for cmdk/voice/parity test without overstepping into Plan 03's ARCH-01 work |
| `packages/app/src/actions/built-in-actions.ts` | ~145 | `theme.cycle` handler delegates to `keyboardActionDispatcher.dispatch` with a cast (`id: "theme.cycle" as never`) | Keyboard dispatcher's `KeyboardActionDefinition` union doesn't include `theme.cycle` — the actual cycle logic lives in `use-keyboard-shortcuts.ts`. Dispatch silently no-ops if no handler matches; Plan 02e's polish sweep will add a proper bridge |

Both stubs are intentional and documented inline. Neither blocks the plan's NAT-01 acceptance criteria — modalities + locales are present, and dispatch is safe (returns false).

## User Setup Required

None — no external service configuration required. All 4 new npm dependencies (`cmdk`, `react-hotkeys-hook`, `burnt`, `sonner`) are pure runtime packages installed via `pnpm --filter @ottie/app add`.

## Next Phase Readiness

**Ready for Plan 02b (Onboarding):** The ActionRegistry + useHaptic foundation is in place; onboarding flows can register `onboarding.*` actions via `defineAction` and use `useHaptic` for celebratory beats.

**Ready for Plan 02c (Chats Tab):** Chat-row context-menu items (`chat.menu.*`) and add-menu items (`chat.add.*`) are already in the `ActionId` union — Plan 02c just needs to call `actionRegistry.register(defineAction(...))` for each and wire the dispatch from the long-press menu / top-right add menu. Swipe haptics use `useHaptic` directly.

**Ready for Plan 02d (Settings IA):** Settings deep-link actions follow the same `defineAction` pattern; cmdk reaches them via the existing palette.

**Ready for Plan 02e (Polish Sweep):** `useHaptic`'s `isLowPowerMode` input is the seam for `expo-battery` integration; replacing inline `Haptics.*` calls with `useHaptic` is mechanical (search for `Haptics.impactAsync\|Haptics.notificationAsync` across the app and route through the hook).

**Phase 2 research-flag (Tauri global-shortcut bridge for `Cmd+Shift+O`):** Still open per STATE.md — `react-hotkeys-hook` here is intra-app only (DOM-scoped). The global-summon shortcut would need a Tauri command-registry bridge if/when adopted.

## Self-Check: PASSED

Files exist:

- FOUND: packages/app/src/actions/registry.ts
- FOUND: packages/app/src/actions/ids.ts
- FOUND: packages/app/src/actions/modalities.ts
- FOUND: packages/app/src/actions/built-in-actions.ts
- FOUND: packages/app/src/actions/registry.test.ts
- FOUND: packages/app/src/actions/registry.parity.test.ts
- FOUND: packages/app/src/hooks/use-haptic.ts
- FOUND: packages/app/src/hooks/use-haptic.test.ts
- FOUND: packages/app/src/components/command-center.web.tsx
- FOUND: packages/app/src/components/command-center.native.tsx
- FOUND: packages/app/src/voice-control/voice-commands.actions.test.ts

Commits exist:

- FOUND: 7b22bc50 (Task 1)
- FOUND: ccf0a9a2 (Task 2)
- FOUND: c28886ef (Task 3)

Verification:

- `npx vitest run src/actions/registry.test.ts src/actions/registry.parity.test.ts src/hooks/use-haptic.test.ts src/voice-control/voice-commands.actions.test.ts --bail=1` — 18/18 PASS
- `npm run typecheck` — PASS (8 packages, all green)
- `npm run lint -- <plan files>` — PASS (0 warnings, 0 errors)
- `npm run format:check:files -- <plan files>` — PASS (all files use the correct format)

---

_Phase: 02-onboarding-navigation-settings-theme-native-feel-polish_
_Completed: 2026-05-01_
