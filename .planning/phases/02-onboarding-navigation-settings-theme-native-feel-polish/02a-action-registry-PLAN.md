---
phase: 02-onboarding-navigation-settings-theme-native-feel-polish
plan: 02a
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/app/src/actions/registry.ts
  - packages/app/src/actions/ids.ts
  - packages/app/src/actions/modalities.ts
  - packages/app/src/actions/registry.test.ts
  - packages/app/src/actions/registry.parity.test.ts
  - packages/app/src/components/command-center.tsx
  - packages/app/src/components/command-center.web.tsx
  - packages/app/src/components/command-center.native.tsx
  - packages/app/src/hooks/use-haptic.ts
  - packages/app/src/hooks/use-haptic.test.ts
  - packages/app/src/voice-control/voice-commands.ts
  - packages/app/src/keyboard/keyboard-action-dispatcher.ts
  - packages/app/src/components/mobile-tab-bar.tsx
  - packages/app/src/components/desktop-nav-rail.tsx
  - packages/app/src/i18n/locales/en.json
  - packages/app/src/i18n/locales/zh.json
  - packages/app/package.json
autonomous: true
requirements: [NAV-A5, NAT-01, NAT-02]
tags: [phase-02, action-registry, cmdk, keyboard, haptics]
must_haves:
  truths:
    - "Voice intents, keyboard shortcuts, cmdk results, and long-press menu items all dispatch by the same ActionRegistry ID"
    - "CI parity test enforces every named action reachable from >=2 modalities (web/Tauri) or >=1 (native)"
    - "useHaptic() hook is the single source of truth for native haptics; debounce 200ms; respects user toggle + low-power-mode"
    - "Command center is split via Metro: cmdk on web/Tauri, bottom-sheet on native"
    - "react-hotkeys-hook wires Cmd+K to mount the command-center palette on web/Tauri"
  artifacts:
    - path: "packages/app/src/actions/registry.ts"
      provides: "Universal action map + defineAction helper + dispatch entry point"
      exports: ["defineAction", "actionRegistry", "ACTIONS", "getActionById", "searchActions"]
    - path: "packages/app/src/actions/ids.ts"
      provides: "ActionId union type + dotted.case constants"
      contains: "export type ActionId"
    - path: "packages/app/src/actions/modalities.ts"
      provides: "Modality registration helpers"
    - path: "packages/app/src/actions/registry.parity.test.ts"
      provides: "CI parity gate asserting modality coverage"
    - path: "packages/app/src/hooks/use-haptic.ts"
      provides: "Single haptic hook (light/medium/heavy + 200ms debounce)"
      exports: ["useHaptic"]
    - path: "packages/app/src/components/command-center.web.tsx"
      provides: "cmdk palette on web/Tauri wrapped in <GlassSurface radius='sheet'>"
    - path: "packages/app/src/components/command-center.native.tsx"
      provides: "Bottom-sheet command-center via @gorhom/bottom-sheet"
    - path: "packages/app/src/components/command-center.tsx"
      provides: "Metro shim re-export"
  key_links:
    - from: "packages/app/src/voice-control/voice-commands.ts"
      to: "packages/app/src/actions/registry.ts"
      via: "actionRegistry.dispatch(actionId, payload)"
      pattern: "actionRegistry\\.dispatch"
    - from: "packages/app/src/keyboard/keyboard-action-dispatcher.ts"
      to: "packages/app/src/actions/registry.ts"
      via: "actionRegistry.dispatch on keyboard event match"
      pattern: "actionRegistry\\.dispatch"
    - from: "packages/app/src/components/desktop-nav-rail.tsx"
      to: "react-hotkeys-hook"
      via: "useHotkeys('meta+k, ctrl+k', ...)"
      pattern: "useHotkeys\\("
---

<objective>
Land the universal `ActionRegistry` + cmdk web variant + bottom-sheet native variant + react-hotkeys-hook keyboard wiring + the foundational `useHaptic()` hook. This plan is the seam every other Phase 02 plan extends — chat-row long-press menu items (Plan 02c), settings cmd-K deep links (Plan 02d), and haptic invocation across surfaces (Plans 02c / 02e) all dispatch through artifacts created here.

Purpose: Without `ActionRegistry`, the CI parity test (NAT-01 acceptance) has nothing to assert against and every modality drifts independently (PITFALLS #6 — parity rot). Without `useHaptic()`, every consumer reinvents debounce/low-power/setting-toggle logic.

Output: 5 new module files under `packages/app/src/actions/`, 1 new hook + test, command-center Metro split (3 files), 2 modified existing dispatchers (voice + keyboard) re-routed through the registry, 2 modified shells (mobile-tab-bar long-press + desktop-nav-rail Cmd+K), 4 new npm dependencies installed, en+zh locale entries for the 6 reference actions.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-RESEARCH.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-PATTERNS.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md
@CLAUDE.md
@docs/CODING_STANDARDS.md

<interfaces>
<!-- Existing voice-command shape (registry must mirror this contract) -->
<!-- Source: packages/app/src/voice-control/voice-commands.ts:46-65 -->

```typescript
export interface VoiceCommand<TParams = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<TParams>;
  examples: string[];
  handler: (params: TParams) => Promise<CommandResult> | CommandResult;
}

function defineCommand<TSchema extends z.ZodType>(
  name: string,
  config: {
    description: string;
    schema: TSchema;
    examples: string[];
    handler: (params: z.infer<TSchema>) => Promise<CommandResult> | CommandResult;
  },
): VoiceCommand<z.infer<TSchema>> {
  return { name, ...config };
}
```

<!-- Existing keyboard dispatcher (registry should NOT recreate priority/scope dispatch) -->
<!-- Source: packages/app/src/keyboard/keyboard-action-dispatcher.ts:74-114 -->

```typescript
export function createKeyboardActionDispatcher() {
  let nextRegistrationOrder = 1;
  const handlers = new Map<string, KeyboardActionRegistryEntry>();
  return {
    registerHandler(handler: KeyboardActionHandler) {
      /* ... */
    },
    dispatch(action: KeyboardActionDefinition): boolean {
      /* priority sort, return on first true */
    },
  };
}
export const keyboardActionDispatcher = createKeyboardActionDispatcher();
```

<!-- Existing keyboard ActionId pattern to extend -->
<!-- Source: packages/app/src/keyboard/actions.ts:18-49 -->

```typescript
export type KeyboardActionId =
  | "agent.interrupt"
  | "agent.new"
  | "workspace.tab.new"
  | "command-center.toggle"
  | "theme.cycle"
  | ...;
```

<!-- Existing GlassSurface primitive (cmdk panel + bottom-sheet panel both wrap this) -->
<!-- Source: packages/app/src/components/ui/glass-surface.tsx -->

```typescript
type GlassRadius = "none" | "card" | "sheet" | "pill" | "button";
export function GlassSurface({
  children,
  intensity,
  tint,
  radius,
  bordered,
  strong,
  style,
  ...rest
}: GlassSurfaceProps): JSX.Element;
```

<!-- Existing IsolatedBottomSheetModal (native command-center wraps this) -->
<!-- Source: packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx -->

```typescript
export function IsolatedBottomSheetModal(props: { /* ... */ }): JSX.Element;
export function useIsolatedBottomSheetVisibility(): { isVisible: boolean; ... };
```

<!-- Platform gates (CLAUDE.md hard rule — never write Platform.OS === "web" locally) -->
<!-- Source: packages/app/src/constants/platform.ts:20-24 -->

```typescript
export const isWeb: boolean;
export const isNative: boolean;
export function getIsElectron(): boolean;
```

<!-- App settings shape — useHaptic reads enabled toggle + extends BetaFeatureSettings -->
<!-- Source: packages/app/src/hooks/use-settings.ts:1-91 -->

```typescript
export const APP_SETTINGS_KEY = "@ottie:app-settings";
export interface AppSettings {
  /* ... existing fields ... */
  haptics?: { enabled: boolean }; // ← NEW field added by this plan
}
export function useAppSettings(): { settings: AppSettings; setSettings: ... };
```

</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Install Phase 02 npm dependencies + write ActionRegistry contracts (action ids, modality enum, registry shape, useHaptic interface)</name>
  <files>
    packages/app/package.json,
    packages/app/src/actions/ids.ts,
    packages/app/src/actions/modalities.ts,
    packages/app/src/actions/registry.ts,
    packages/app/src/actions/registry.test.ts,
    packages/app/src/hooks/use-haptic.ts,
    packages/app/src/hooks/use-haptic.test.ts
  </files>
  <read_first>
    - packages/app/package.json (current dependency list — confirm pnpm filter works)
    - packages/app/src/voice-control/voice-commands.ts (analog: defineCommand pattern, lines 46-65; VOICE_COMMANDS registry, lines 294-321)
    - packages/app/src/keyboard/keyboard-action-dispatcher.ts (analog: dispatch loop, lines 74-114)
    - packages/app/src/keyboard/actions.ts (analog: KeyboardActionId union, lines 18-49)
    - packages/app/src/hooks/use-settings.ts (analog: AppSettings + APP_SETTINGS_KEY pattern, lines 1-91)
    - packages/app/src/components/sidebar-workspace-list.tsx lines 1050-1095 (existing inline Haptics.* call sites that use-haptic will replace in Plan 02c)
    - packages/app/src/constants/platform.ts (isNative gate)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-PATTERNS.md sections "packages/app/src/actions/registry.ts" + "packages/app/src/hooks/use-haptic.ts"
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Interaction Contract — Haptics (D-18)" lines 327-352
  </read_first>
  <behavior>
    Test 1 (registry.test.ts): defineAction({id:"agent.create", modalities:["voice","kbd","cmdk","menu"], handler:fn}) returns Action with .id === "agent.create"
    Test 2 (registry.test.ts): actionRegistry.register(action) makes getActionById("agent.create") return the action
    Test 3 (registry.test.ts): actionRegistry.dispatch("agent.create", payload) invokes the registered handler exactly once with payload
    Test 4 (registry.test.ts): actionRegistry.dispatch("does.not.exist", {}) returns false (no throw)
    Test 5 (registry.test.ts): searchActions("agent") returns all actions whose id or description matches "agent"
    Test 6 (use-haptic.test.ts): useHaptic({enabled:true,isLowPowerMode:false}).fire("light") calls Haptics.impactAsync(Light) exactly once
    Test 7 (use-haptic.test.ts): two consecutive fire("light") within 200ms call Haptics.impactAsync exactly once (debounce)
    Test 8 (use-haptic.test.ts): useHaptic({enabled:false,...}).fire("light") never calls Haptics.*
    Test 9 (use-haptic.test.ts): useHaptic({enabled:true,isLowPowerMode:true}).fire("medium") never calls Haptics.*
    Test 10 (use-haptic.test.ts): on web (Platform.OS==="web") all fire() calls are no-ops
  </behavior>
  <action>
    Step 1 — Install deps (run from repo root, pnpm filter):

    ```bash
    pnpm --filter @ottie/app add cmdk@1.1.1 react-hotkeys-hook@5.3.0 burnt@0.13.0 sonner@2.0.7
    ```

    Confirm versions land in `packages/app/package.json` `dependencies`. Do NOT install `expo-glass-effect` here — Plan 02e validates and installs conditionally.

    Step 2 — Create `packages/app/src/actions/ids.ts`:

    ```typescript
    /**
     * ActionRegistry IDs — dotted.case hierarchy, mirrors keyboard/actions.ts pattern.
     * The minimum NAT-01 reference set is the 6 actions enforced by registry.parity.test.ts.
     * Per D-08: extend with the 8 chat-row context-menu items + 4 add-menu items in Plans 02c.
     */
    export type ActionId =
      // NAT-01 minimum reference set (6)
      | "agent.create"
      | "workspace.switch"
      | "session.jump.recent"
      | "permission.decide"
      | "settings.open"
      | "theme.cycle"
      // Chat-row context menu (D-04 — 8 items, registered by Plan 02c)
      | "chat.menu.pin"
      | "chat.menu.unpin"
      | "chat.menu.markUnread"
      | "chat.menu.markRead"
      | "chat.menu.mute"
      | "chat.menu.unmute"
      | "chat.menu.delete"
      | "chat.menu.rename"
      | "chat.menu.archive"
      // Top-right + menu (D-04 — 4 items, registered by Plan 02c)
      | "chat.add.newChat"
      | "chat.add.scanToPair"
      | "chat.add.joinHost"
      | "chat.add.createWorkspace";

    export const ALL_ACTION_IDS: readonly ActionId[] = [
      "agent.create", "workspace.switch", "session.jump.recent",
      "permission.decide", "settings.open", "theme.cycle",
      "chat.menu.pin", "chat.menu.unpin", "chat.menu.markUnread",
      "chat.menu.markRead", "chat.menu.mute", "chat.menu.unmute",
      "chat.menu.delete", "chat.menu.rename", "chat.menu.archive",
      "chat.add.newChat", "chat.add.scanToPair",
      "chat.add.joinHost", "chat.add.createWorkspace",
    ] as const;
    ```

    Step 3 — Create `packages/app/src/actions/modalities.ts`:

    ```typescript
    export type Modality = "voice" | "kbd" | "cmdk" | "menu" | "gesture";
    export const ALL_MODALITIES: readonly Modality[] = ["voice", "kbd", "cmdk", "menu", "gesture"] as const;
    ```

    Step 4 — Create `packages/app/src/actions/registry.ts` per PATTERNS analog (mirror voice-commands.ts shape):

    ```typescript
    import { z } from "zod";
    import type { ActionId } from "@/actions/ids";
    import type { Modality } from "@/actions/modalities";

    export interface Action<TParams = unknown> {
      id: ActionId;
      description: string;
      modalities: ReadonlyArray<Modality>;
      schema: z.ZodType<TParams>;
      handler: (params: TParams) => Promise<void> | void;
    }

    export function defineAction<TSchema extends z.ZodType>(
      id: ActionId,
      config: {
        description: string;
        modalities: ReadonlyArray<Modality>;
        schema: TSchema;
        handler: (params: z.infer<TSchema>) => Promise<void> | void;
      },
    ): Action<z.infer<TSchema>> { return { id, ...config }; }

    interface Registry {
      register<T>(action: Action<T>): () => void;
      getActionById(id: ActionId): Action | undefined;
      searchActions(query: string): Action[];
      dispatch<T>(id: ActionId, params: T): Promise<boolean>;
      list(): Action[];
    }

    export function createActionRegistry(): Registry {
      const map = new Map<ActionId, Action>();
      return {
        register(action) {
          map.set(action.id, action as unknown as Action);
          return () => { map.delete(action.id); };
        },
        getActionById(id) { return map.get(id); },
        searchActions(query) {
          const needle = query.trim().toLowerCase();
          if (!needle) return Array.from(map.values());
          return Array.from(map.values()).filter((a) =>
            a.id.toLowerCase().includes(needle) ||
            a.description.toLowerCase().includes(needle));
        },
        async dispatch(id, params) {
          const action = map.get(id);
          if (!action) return false;
          const parsed = action.schema.safeParse(params);
          if (!parsed.success) return false;
          await action.handler(parsed.data);
          return true;
        },
        list() { return Array.from(map.values()); },
      };
    }

    export const actionRegistry = createActionRegistry();
    ```

    Step 5 — Create `packages/app/src/actions/registry.test.ts` covering Tests 1-5 above. Use `vitest` (file already follows colocated `*.test.ts` convention).

    Step 6 — Create `packages/app/src/hooks/use-haptic.ts` per PATTERNS line 538-559 + UI-SPEC haptics table lines 327-352:

    ```typescript
    import { useCallback, useRef } from "react";
    import * as Haptics from "expo-haptics";
    import { isNative } from "@/constants/platform";

    export type HapticEvent = "light" | "medium" | "heavy";
    export interface UseHapticInput { enabled: boolean; isLowPowerMode: boolean }
    const DEBOUNCE_MS = 200;

    export function useHaptic(input: UseHapticInput): { fire(event: HapticEvent): void } {
      const lastFiredRef = useRef<Map<HapticEvent, number>>(new Map());
      const fire = useCallback((event: HapticEvent) => {
        if (!isNative) return;
        if (!input.enabled || input.isLowPowerMode) return;
        const now = Date.now();
        const last = lastFiredRef.current.get(event) ?? 0;
        if (now - last < DEBOUNCE_MS) return;
        lastFiredRef.current.set(event, now);
        if (event === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        else if (event === "medium") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }, [input.enabled, input.isLowPowerMode]);
      return { fire };
    }
    ```

    Step 7 — Create `packages/app/src/hooks/use-haptic.test.ts` covering Tests 6-10. Mock `expo-haptics` per existing vitest setup convention.

    Note: Low-power-mode source is deferred — `isLowPowerMode` is passed in by the consumer (Plan 02e wires the source via `expo-battery` or returns `false` if unavailable per PATTERNS line 564). For this plan, accept the input as-is.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q '"cmdk"' packages/app/package.json && \
      grep -q '"react-hotkeys-hook"' packages/app/package.json && \
      grep -q '"burnt"' packages/app/package.json && \
      grep -q '"sonner"' packages/app/package.json && \
      grep -q "export type ActionId" packages/app/src/actions/ids.ts && \
      grep -q "export function defineAction" packages/app/src/actions/registry.ts && \
      grep -q "export const actionRegistry" packages/app/src/actions/registry.ts && \
      grep -q "export function useHaptic" packages/app/src/hooks/use-haptic.ts && \
      npx vitest run packages/app/src/actions/registry.test.ts --bail=1 && \
      npx vitest run packages/app/src/hooks/use-haptic.test.ts --bail=1 && \
      npm run typecheck
    </automated>
  </verify>
  <acceptance_criteria>
    - File `packages/app/package.json` contains `"cmdk": "1.1.1"`, `"react-hotkeys-hook": "5.3.0"`, `"burnt": "0.13.0"`, `"sonner": "2.0.7"` in `dependencies`
    - `grep -c "export type ActionId" packages/app/src/actions/ids.ts` returns 1
    - `grep -c "export const ALL_ACTION_IDS" packages/app/src/actions/ids.ts` returns 1
    - `grep -c "export const actionRegistry" packages/app/src/actions/registry.ts` returns 1
    - `grep -c "export function defineAction" packages/app/src/actions/registry.ts` returns 1
    - `grep -c "export function useHaptic" packages/app/src/hooks/use-haptic.ts` returns 1
    - `grep -c "DEBOUNCE_MS = 200" packages/app/src/hooks/use-haptic.ts` returns 1
    - `grep -c "if (!isNative) return" packages/app/src/hooks/use-haptic.ts` returns 1
    - `npx vitest run packages/app/src/actions/registry.test.ts --bail=1` exits 0
    - `npx vitest run packages/app/src/hooks/use-haptic.test.ts --bail=1` exits 0
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/actions/registry.ts packages/app/src/actions/ids.ts packages/app/src/actions/modalities.ts packages/app/src/hooks/use-haptic.ts` exits 0
  </acceptance_criteria>
  <done>ActionRegistry + useHaptic foundations exist with passing tests; npm deps installed; typecheck green</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Migrate command-center to Metro split (cmdk web variant + bottom-sheet native variant) and route voice / keyboard dispatchers through ActionRegistry</name>
  <files>
    packages/app/src/components/command-center.tsx,
    packages/app/src/components/command-center.web.tsx,
    packages/app/src/components/command-center.native.tsx,
    packages/app/src/components/desktop-nav-rail.tsx,
    packages/app/src/components/mobile-tab-bar.tsx,
    packages/app/src/voice-control/voice-commands.ts,
    packages/app/src/keyboard/keyboard-action-dispatcher.ts,
    packages/app/src/i18n/locales/en.json,
    packages/app/src/i18n/locales/zh.json
  </files>
  <read_first>
    - packages/app/src/components/command-center.tsx (existing 491-line implementation — extract modal shell + useCommandCenter consumer; PATTERNS lines 393-433)
    - packages/app/src/components/draggable-list.tsx (analog: Metro split shim re-export pattern, lines 1-7)
    - packages/app/src/components/ui/glass-surface.tsx (radius="sheet" target wrapper)
    - packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx (native bottom-sheet host)
    - packages/app/src/components/desktop-nav-rail.tsx lines 49-101 (existing handleSelect — add useHotkeys here)
    - packages/app/src/components/mobile-tab-bar.tsx lines 38-143 (existing TabButton — add onLongPress on active tab)
    - packages/app/src/voice-control/voice-commands.ts lines 1-321 (existing handlers to refactor)
    - packages/app/src/keyboard/keyboard-action-dispatcher.ts (existing dispatch — wrap so registered keyboard handlers can dispatch through actionRegistry)
    - packages/app/src/actions/registry.ts (just-created — defineAction + actionRegistry instance)
    - packages/app/src/i18n/locales/en.json (current shape — add new keys)
    - packages/app/src/i18n/locales/zh.json
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Component Inventory" line 273-274
  </read_first>
  <behavior>
    Test 1 (command-center.web.test.tsx — if vitest+RN testing infra reaches it; otherwise smoke via typecheck): cmdk panel mounts inside <GlassSurface radius="sheet">
    Test 2: voice command "createAgent" calls actionRegistry.dispatch("agent.create", ...) instead of executing inline (regression-style — assert dispatch called)
    Test 3: registry parity smoke: searchActions("settings.open") returns the registered action with modalities including "kbd" and "cmdk"
  </behavior>
  <action>
    Step 1 — Create Metro shim `packages/app/src/components/command-center.tsx` (replace the existing file). Use Write to overwrite the 491-line existing impl with a 7-line shim per PATTERNS lines 309-318:

    ```typescript
    // This file exists for TypeScript resolution.
    // Real implementations:
    // - command-center.web.tsx (Web/Tauri — cmdk palette)
    // - command-center.native.tsx (iOS/Android — bottom sheet)
    // Metro picks the right file per platform.
    export * from "./command-center.web";
    ```

    Step 2 — Create `packages/app/src/components/command-center.web.tsx`. Port the modal shell from the original `command-center.tsx` (lines 248-345) — keep `useCommandCenter()` consumer hook usage as the items source. Replace the hand-rolled filter/keyboard logic with `<Command>` from `cmdk`. Wrap the panel in `<GlassSurface radius="sheet">` instead of inline `panelStyle`. Preserve all `testID` attributes (`command-center-panel`, `command-center-input`).

    Sketch:

    ```tsx
    import { Command } from "cmdk";
    import { Modal, View, Pressable } from "react-native";
    import { GlassSurface } from "@/components/ui/glass-surface";
    import { useCommandCenter } from "@/hooks/use-command-center";
    import { actionRegistry } from "@/actions/registry";
    import { isWeb } from "@/constants/platform";

    export function CommandCenter() {
      if (!isWeb) return null;
      const { open, query, setQuery, items, handleClose, handleSelectItem } = useCommandCenter();
      if (!open) return null;
      return (
        <Modal visible={open} transparent animationType="fade" onRequestClose={handleClose} testID="command-center-panel">
          <View style={{ flex: 1, alignItems: "center", justifyContent: "flex-start", paddingTop: 80 }}>
            <Pressable onPress={handleClose} style={{ position: "absolute", inset: 0 }} />
            <GlassSurface radius="sheet" style={{ width: 560, maxWidth: "100%" }}>
              <Command label="Command Center">
                <Command.Input
                  testID="command-center-input"
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Type a command or search..."
                  autoFocus
                />
                <Command.List>
                  {items.length === 0 ? <Command.Empty>No matches</Command.Empty> :
                    items.map((item) => (
                      <Command.Item key={item.id} value={item.label} onSelect={() => handleSelectItem(item)}>
                        {item.label}
                      </Command.Item>
                    ))}
                </Command.List>
              </Command>
            </GlassSurface>
          </View>
        </Modal>
      );
    }
    ```

    Step 3 — Create `packages/app/src/components/command-center.native.tsx`. Use `<IsolatedBottomSheetModal>` from `@/components/ui/isolated-bottom-sheet-modal` per PATTERNS lines 322-344. Mount the same `useCommandCenter()` items list inside a `<BottomSheetScrollView>`; reuse Glass tokens via the existing modal-content sheet style. Trigger source for native: long-press on active mobile-tab-bar tab (wired in Step 5).

    Step 4 — Wire ⌘K on `packages/app/src/components/desktop-nav-rail.tsx`. Add at the top of the component body (after existing imports — guarded by `isWeb`):

    ```typescript
    import { useHotkeys } from "react-hotkeys-hook";
    import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
    // ...
    useHotkeys("meta+k, ctrl+k", (e) => {
      if (!isWeb) return;
      e.preventDefault();
      useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
    }, { preventDefault: true });
    ```

    Confirm `useKeyboardShortcutsStore` exists; if the open/close machinery uses a different store, follow PATTERNS line 765 and call `useKeyboardShortcutsStore.getState().setCommandCenterOpen(true)`.

    Step 5 — Wire long-press on active tab in `packages/app/src/components/mobile-tab-bar.tsx`. In `TabButton` (existing lines 70-110), add `onLongPress` prop on the `<Pressable>`:

    ```typescript
    onLongPress={() => {
      if (!active) return;
      useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
    }}
    delayLongPress={350}
    ```

    Per UI-SPEC line 313: this is the native command-center trigger.

    Step 6 — Refactor `packages/app/src/voice-control/voice-commands.ts` so each handler delegates to `actionRegistry.dispatch(actionId, payload)` instead of executing the side-effect inline. For the 6 NAT-01 reference actions, register them via `actionRegistry.register(defineAction("agent.create", { description, modalities: ["voice", "kbd", "cmdk", "menu"], schema, handler }))` at module load. Voice command handlers then call `actionRegistry.dispatch("agent.create", parsedParams)`. Keep the `VOICE_COMMANDS` array intact for backward compatibility — voice intent matching still uses the `name` field.

    Step 7 — Wire keyboard dispatcher to actionRegistry. In `packages/app/src/keyboard/keyboard-action-dispatcher.ts`, after the existing dispatch returns, ensure the keyboard's "command-center.toggle", "settings.toggle", "theme.cycle" handlers call `actionRegistry.dispatch(...)` if the action is registered. Do NOT remove the keyboard's priority/scope dispatch loop (per PATTERNS line 158-160 — registry is flat; keyboard handles its own priority).

    Step 8 — Add 6 NAT-01 reference action en+zh strings:

    en.json additions:
    ```json
    "actions.agentCreate": "New chat",
    "actions.workspaceSwitch": "Switch workspace",
    "actions.sessionJumpRecent": "Jump to recent",
    "actions.permissionDecide": "Decide permission",
    "actions.settingsOpen": "Open settings",
    "actions.themeCycle": "Cycle theme"
    ```

    zh.json additions (parity):
    ```json
    "actions.agentCreate": "新建",
    "actions.workspaceSwitch": "切换工作区",
    "actions.sessionJumpRecent": "跳转到最近",
    "actions.permissionDecide": "处理权限",
    "actions.settingsOpen": "打开设置",
    "actions.themeCycle": "切换主题"
    ```

    Step 9 — Run `npm run format -- packages/app/src/components/command-center.web.tsx packages/app/src/components/command-center.native.tsx packages/app/src/components/command-center.tsx packages/app/src/components/desktop-nav-rail.tsx packages/app/src/components/mobile-tab-bar.tsx packages/app/src/voice-control/voice-commands.ts packages/app/src/keyboard/keyboard-action-dispatcher.ts packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "from \"./command-center.web\"" packages/app/src/components/command-center.tsx && \
      grep -q "from \"cmdk\"" packages/app/src/components/command-center.web.tsx && \
      grep -q "GlassSurface" packages/app/src/components/command-center.web.tsx && \
      grep -q "IsolatedBottomSheetModal\\|BottomSheetModal" packages/app/src/components/command-center.native.tsx && \
      grep -q "useHotkeys" packages/app/src/components/desktop-nav-rail.tsx && \
      grep -q "onLongPress" packages/app/src/components/mobile-tab-bar.tsx && \
      grep -q "actionRegistry.dispatch" packages/app/src/voice-control/voice-commands.ts && \
      grep -q "\"actions.agentCreate\":" packages/app/src/i18n/locales/en.json && \
      grep -q "\"actions.agentCreate\":" packages/app/src/i18n/locales/zh.json && \
      grep -q "新建" packages/app/src/i18n/locales/zh.json && \
      npm run typecheck && \
      npm run lint -- packages/app/src/components/command-center.tsx packages/app/src/components/command-center.web.tsx packages/app/src/components/command-center.native.tsx packages/app/src/components/desktop-nav-rail.tsx packages/app/src/components/mobile-tab-bar.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - `wc -l < packages/app/src/components/command-center.tsx` returns ≤10 (shim only — full impl moved to .web/.native)
    - `grep -c "from \"cmdk\"" packages/app/src/components/command-center.web.tsx` returns 1
    - `grep -c "<GlassSurface" packages/app/src/components/command-center.web.tsx` returns ≥1
    - `grep -c "BottomSheet" packages/app/src/components/command-center.native.tsx` returns ≥1
    - `grep -c "useHotkeys" packages/app/src/components/desktop-nav-rail.tsx` returns ≥1
    - `grep -c "meta+k" packages/app/src/components/desktop-nav-rail.tsx` returns 1
    - `grep -c "onLongPress" packages/app/src/components/mobile-tab-bar.tsx` returns ≥1
    - `grep -c "delayLongPress" packages/app/src/components/mobile-tab-bar.tsx` returns ≥1
    - `grep -c "actionRegistry.dispatch" packages/app/src/voice-control/voice-commands.ts` returns ≥1
    - `grep -c "actions.agentCreate" packages/app/src/i18n/locales/en.json` returns 1
    - `grep -c "actions.agentCreate" packages/app/src/i18n/locales/zh.json` returns 1
    - `grep -c "切换工作区" packages/app/src/i18n/locales/zh.json` returns 1 (zh parity verified)
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/components/command-center.tsx packages/app/src/components/command-center.web.tsx packages/app/src/components/command-center.native.tsx packages/app/src/components/desktop-nav-rail.tsx packages/app/src/components/mobile-tab-bar.tsx` exits 0
  </acceptance_criteria>
  <done>Command center is Metro-split; cmdk + react-hotkeys-hook wired on web; bottom-sheet wired on native; voice commands dispatch through actionRegistry; en+zh parity for 6 reference actions</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Build CI parity test asserting modality coverage for the 6 NAT-01 reference actions + en+zh locale presence</name>
  <files>
    packages/app/src/actions/registry.parity.test.ts,
    packages/app/src/actions/registry.ts
  </files>
  <read_first>
    - packages/app/src/actions/registry.ts (registered actions list)
    - packages/app/src/actions/ids.ts (ActionId union — minimum reference set)
    - packages/app/src/voice-control/voice-router.test.ts (analog: vitest unit test colocated, PATTERNS line 32)
    - packages/app/src/i18n/locales/en.json (key presence for action labels)
    - packages/app/src/i18n/locales/zh.json
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md "Open Question Q6" — parity test scope (≥80% coverage AND each action ships in EN+ZH)
  </read_first>
  <behavior>
    Test 1 (parity coverage): For each of the 6 NAT-01 reference action IDs (agent.create, workspace.switch, session.jump.recent, permission.decide, settings.open, theme.cycle), the registered action.modalities array contains ≥2 modalities on web/Tauri OR ≥1 modality on native
    Test 2 (locale parity): For each registered action, both packages/app/src/i18n/locales/en.json AND zh.json contain a non-empty value at key `actions.{idCamelCase}` (e.g. "agent.create" → "actions.agentCreate")
    Test 3 (registration sanity): actionRegistry.list() includes ALL 6 reference IDs after voice-commands.ts is imported (registration-on-load)
    Test 4 (≥80% coverage): of all registered actions, at least 80% have modalities.length >= 2
  </behavior>
  <action>
    Create `packages/app/src/actions/registry.parity.test.ts` covering Tests 1-4 above.

    Sketch:

    ```typescript
    import { describe, it, expect } from "vitest";
    import enLocale from "@/i18n/locales/en.json";
    import zhLocale from "@/i18n/locales/zh.json";
    import { actionRegistry } from "@/actions/registry";
    import "@/voice-control/voice-commands"; // ensures registration

    const NAT_01_REFERENCE_IDS = [
      "agent.create", "workspace.switch", "session.jump.recent",
      "permission.decide", "settings.open", "theme.cycle",
    ] as const;

    function actionIdToLocaleKey(id: string): string {
      // "agent.create" → "actions.agentCreate"
      const parts = id.split(".");
      const camel = parts.map((p, i) =>
        i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)
      ).join("");
      return `actions.${camel}`;
    }

    function pickKey(obj: Record<string, unknown>, dotPath: string): unknown {
      return dotPath.split(".").reduce<unknown>((acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
        obj);
    }

    describe("ActionRegistry parity (NAT-01)", () => {
      it("every NAT-01 reference action is registered", () => {
        const ids = new Set(actionRegistry.list().map((a) => a.id));
        for (const id of NAT_01_REFERENCE_IDS) {
          expect(ids.has(id)).toBe(true);
        }
      });

      it("every NAT-01 reference action covers >= 2 modalities (CONTEXT Q6)", () => {
        for (const id of NAT_01_REFERENCE_IDS) {
          const action = actionRegistry.getActionById(id);
          expect(action).toBeDefined();
          expect(action!.modalities.length).toBeGreaterThanOrEqual(2);
        }
      });

      it("every registered action has en + zh locale entries", () => {
        for (const action of actionRegistry.list()) {
          const localeKey = actionIdToLocaleKey(action.id);
          const en = pickKey(enLocale as Record<string, unknown>, localeKey);
          const zh = pickKey(zhLocale as Record<string, unknown>, localeKey);
          expect(typeof en === "string" && (en as string).length > 0,
            `EN missing for ${action.id} → ${localeKey}`).toBe(true);
          expect(typeof zh === "string" && (zh as string).length > 0,
            `ZH missing for ${action.id} → ${localeKey}`).toBe(true);
        }
      });

      it(">= 80% of registered actions have modalities.length >= 2", () => {
        const actions = actionRegistry.list();
        const multi = actions.filter((a) => a.modalities.length >= 2).length;
        const ratio = multi / actions.length;
        expect(ratio).toBeGreaterThanOrEqual(0.8);
      });
    });
    ```

    Run `npm run format -- packages/app/src/actions/registry.parity.test.ts`.

    The 6 reference actions are minimum coverage. Plans 02c (chat-row + add-menu) and 02d (settings deep-link actions) will register additional IDs; this test continues to pass because they each register with ≥1 modality and the 80% gate is generous.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "NAT_01_REFERENCE_IDS" packages/app/src/actions/registry.parity.test.ts && \
      grep -q "modalities.length" packages/app/src/actions/registry.parity.test.ts && \
      grep -q "en.json" packages/app/src/actions/registry.parity.test.ts && \
      grep -q "zh.json" packages/app/src/actions/registry.parity.test.ts && \
      npx vitest run packages/app/src/actions/registry.parity.test.ts --bail=1 && \
      npm run typecheck && \
      npm run lint -- packages/app/src/actions/registry.parity.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "NAT_01_REFERENCE_IDS" packages/app/src/actions/registry.parity.test.ts` returns ≥1
    - `grep -c "agent.create" packages/app/src/actions/registry.parity.test.ts` returns ≥1
    - `grep -c "workspace.switch" packages/app/src/actions/registry.parity.test.ts` returns ≥1
    - `grep -c "session.jump.recent" packages/app/src/actions/registry.parity.test.ts` returns ≥1
    - `grep -c "permission.decide" packages/app/src/actions/registry.parity.test.ts` returns ≥1
    - `grep -c "settings.open" packages/app/src/actions/registry.parity.test.ts` returns ≥1
    - `grep -c "theme.cycle" packages/app/src/actions/registry.parity.test.ts` returns ≥1
    - `npx vitest run packages/app/src/actions/registry.parity.test.ts --bail=1` exits 0
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/actions/registry.parity.test.ts` exits 0
  </acceptance_criteria>
  <done>Parity test exists and passes; CI will block any future PR that breaks modality coverage or locale parity for the 6 NAT-01 reference actions</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary                             | Description                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| voice/keyboard/cmdk → ActionRegistry | All modality input (voice transcript, key events, palette query) crosses into a single dispatch surface |
| ActionRegistry → handler             | Action handlers may invoke router.replace, store mutations, or daemon WS sends                          |
| URL/deep-link → app routing          | Existing pair-scan & settings deep-link routes carry params (untrusted in remote-relay context)         |

## STRIDE Threat Register

| Threat ID | Category                   | Component                        | Disposition | Mitigation Plan                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | -------------------------- | -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-02a-01  | E (Elevation of Privilege) | actionRegistry.register          | mitigate    | Registration is module-bound only — no public API accepts a handler from URL params, deep links, or untrusted JSON. Validated by code review: only static `defineAction` calls in voice-commands.ts and registry-internal modules. Lint gate: any registration outside `packages/app/src/actions/` or `packages/app/src/voice-control/` requires explicit allowlist (deferred to Plan 02d if needed) |
| T-02a-02  | T (Tampering)              | actionRegistry.dispatch payload  | mitigate    | Every dispatch parses payload through the action's Zod `schema` before invoking the handler (registry.ts:dispatch — `safeParse`, returns false on failure). Handlers never receive untyped payload                                                                                                                                                                                                   |
| T-02a-03  | I (Information disclosure) | useHaptic settings               | accept      | Haptic toggle state is local UI state in AppSettings; not transmitted to daemon. No information leak surface                                                                                                                                                                                                                                                                                         |
| T-02a-04  | S (Spoofing)               | useHotkeys global keybind        | accept      | `react-hotkeys-hook` registers DOM key listeners scoped to the React tree; no privilege escalation path. Same-origin web only (no Tauri global-shortcut bridge per Phase 1 STATE.md research flag — that path is deferred)                                                                                                                                                                           |
| T-02a-05  | D (Denial of Service)      | actionRegistry.dispatch flooding | accept      | Voice/keyboard/cmdk are rate-limited by their own input mechanics (human typing speed, voice latency); no automated dispatch path exists. Deferred to monitoring if observed                                                                                                                                                                                                                         |

No HIGH severity threats. Proceed.
</threat_model>

<verification>
- All 3 task `<verify>` blocks pass
- `npx vitest run packages/app/src/actions/registry.test.ts packages/app/src/actions/registry.parity.test.ts packages/app/src/hooks/use-haptic.test.ts --bail=1` exits 0
- `npm run typecheck` exits 0
- `npm run lint -- packages/app/src/actions/ packages/app/src/hooks/use-haptic.ts packages/app/src/components/command-center.tsx packages/app/src/components/command-center.web.tsx packages/app/src/components/command-center.native.tsx packages/app/src/components/desktop-nav-rail.tsx packages/app/src/components/mobile-tab-bar.tsx packages/app/src/voice-control/voice-commands.ts packages/app/src/keyboard/keyboard-action-dispatcher.ts` exits 0
- `npm run format:check -- packages/app/src/actions/ packages/app/src/hooks/use-haptic.ts packages/app/src/components/command-center.tsx packages/app/src/components/command-center.web.tsx packages/app/src/components/command-center.native.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json` exits 0
</verification>

<success_criteria>

- ActionRegistry exists with `defineAction`, `actionRegistry`, `getActionById`, `searchActions`, `dispatch`
- ActionId union covers the NAT-01 minimum 6 + 8 chat-row context-menu items + 4 add-menu items (registered later by Plan 02c)
- Modality enum (voice / kbd / cmdk / menu / gesture) exists
- Command center is Metro-split: cmdk on web/Tauri, bottom-sheet on native; old single-file impl is reduced to a re-export shim
- react-hotkeys-hook wires Cmd+K to mount the palette via existing `useKeyboardShortcutsStore.setCommandCenterOpen(true)` machinery on desktop-nav-rail
- mobile-tab-bar long-press on active tab opens command-center sheet
- Voice command handlers route through `actionRegistry.dispatch(actionId, payload)`
- Keyboard dispatcher integrates with actionRegistry without losing its own priority/scope dispatch
- `useHaptic({enabled,isLowPowerMode}).fire("light"|"medium"|"heavy")` is the single haptic entry point with 200ms debounce, native-only, settings-respecting
- CI parity test enforces ≥2 modalities for the 6 reference actions, ≥80% coverage overall, and en+zh locale presence
- Locales updated: en.json + zh.json contain `actions.agentCreate`, `actions.workspaceSwitch`, `actions.sessionJumpRecent`, `actions.permissionDecide`, `actions.settingsOpen`, `actions.themeCycle`
- 4 new npm deps installed (cmdk@1.1.1, react-hotkeys-hook@5.3.0, burnt@0.13.0, sonner@2.0.7)
- All acceptance criteria + verification commands pass
  </success_criteria>

<output>
Create `.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02a-action-registry-SUMMARY.md` per the SUMMARY template; include the registered ActionId list (with modalities), the parity test results, and a note that Plans 02c/02d/02e will extend the registry with chat-row, settings-deep-link, and chat-add actions respectively.
</output>
