---
phase: 02
phase-slug: onboarding-navigation-settings-theme-native-feel-polish
artifact: patterns
date: 2026-05-01
---

# Phase 02: Onboarding, Navigation, Settings, Theme & Native-Feel Polish — Pattern Map

**Mapped:** 2026-05-01
**Files analyzed (new + modified):** 33
**Analogs found:** 31 / 33 (2 net-new with no exact analog: action registry, burnt toast wrapper)

This map is the planner's lookup: per-file role, data flow, the nearest existing analog already shipped in `packages/app/src/`, and verbatim excerpts (with file path + line numbers) showing imports, structure, exports, state pattern, and platform gating that new files MUST mirror.

> Phase 02 is a **net-new component** + **modified-screen** sweep on top of the seams Phase 1 landed. Almost every new file has a strong existing analog in the same directory — the heavy invention is concentrated in `packages/app/src/actions/registry.ts` (no prior art) and `packages/app/src/utils/delight-toast.ts` (`burnt` wrapper — first use of `burnt` in the repo).

---

## File Classification

### New files

| New file                                                       | Role                                                    | Data flow                                                     | Closest analog                                                                                                                                              | Match quality                   |
| -------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `packages/app/src/actions/registry.ts`                         | module (universal action map)                           | event-driven dispatch                                         | `voice-control/voice-commands.ts` (`VOICE_COMMANDS`) + `keyboard/keyboard-action-dispatcher.ts` (handler registry)                                          | role-match (no exact prior art) |
| `packages/app/src/actions/ids.ts`                              | module (action ID enum)                                 | constants                                                     | `keyboard/actions.ts` `KeyboardActionId` union                                                                                                              | exact                           |
| `packages/app/src/actions/modalities.ts`                       | module (modality registration helpers)                  | constants                                                     | `keyboard/keyboard-action-dispatcher.ts` `registerHandler`                                                                                                  | exact                           |
| `packages/app/src/actions/registry.test.ts`                    | test                                                    | unit                                                          | `voice-control/voice-router.test.ts` / any `*.test.ts` colocated                                                                                            | exact                           |
| `packages/app/src/actions/registry.parity.test.ts`             | test (CI parity gate)                                   | unit                                                          | `voice-control/voice-router.test.ts`                                                                                                                        | role-match                      |
| `packages/app/src/components/chat-row.tsx`                     | component                                               | request-response (renders aggregated agent + dispatches taps) | `components/agent-list.tsx` (FlatList row) + `components/sidebar-workspace-list.tsx` (long-press / right-click row)                                         | exact                           |
| `packages/app/src/components/chat-row-context-menu.web.tsx`    | component (Metro split)                                 | event-driven menu dispatch                                    | `components/ui/dropdown-menu.tsx` + `components/ui/context-menu.tsx`                                                                                        | exact                           |
| `packages/app/src/components/chat-row-context-menu.native.tsx` | component (Metro split)                                 | event-driven menu dispatch                                    | `components/adaptive-modal-sheet.tsx` (BottomSheetModal) + `components/ui/context-menu.tsx` (sheet branch)                                                  | exact                           |
| `packages/app/src/components/chat-row-context-menu.tsx`        | shim (re-exports for TS)                                | —                                                             | `components/draggable-list.tsx` (re-export shim)                                                                                                            | exact                           |
| `packages/app/src/components/chat-row-swipe-actions.tsx`       | component                                               | gesture                                                       | `react-native-gesture-handler` `<Swipeable>` (no existing usage in repo — net-new)                                                                          | role-match (no analog)          |
| `packages/app/src/components/chat-row-hover-actions.web.tsx`   | component (web only)                                    | hover state                                                   | `components/sidebar-callout-slot.web.tsx` (web-only sibling) + Phase-1 chevron `isHovered \|\| isNative \|\| isCompact` pattern in `components/message.tsx` | exact                           |
| `packages/app/src/components/unread-badge.tsx`                 | component                                               | display                                                       | `components/agent-status-dot.tsx` (small token-driven status pill)                                                                                          | exact                           |
| `packages/app/src/components/top-right-add-menu.tsx`           | component                                               | event-driven menu                                             | `components/ui/dropdown-menu.tsx` (web anchored) + `components/adaptive-modal-sheet.tsx` (native sheet)                                                     | exact                           |
| `packages/app/src/components/total-unread-popup.tsx`           | component                                               | display (auto-decay)                                          | `components/splash-overlay.tsx` (timed module-flag overlay)                                                                                                 | exact                           |
| `packages/app/src/components/command-center.web.tsx`           | component (Metro split — REPLACES `command-center.tsx`) | request-response (filtered list)                              | existing `components/command-center.tsx` (lines 1–491) — same shape, swap filter to `cmdk`                                                                  | exact                           |
| `packages/app/src/components/command-center.native.tsx`        | component (Metro split — REPLACES `command-center.tsx`) | request-response                                              | `components/adaptive-modal-sheet.tsx` (BottomSheet host)                                                                                                    | exact                           |
| `packages/app/src/components/command-center.tsx`               | shim (re-exports for TS)                                | —                                                             | `components/draggable-list.tsx` re-export shim                                                                                                              | exact                           |
| `packages/app/src/components/settings/flat-list.tsx`           | component                                               | display                                                       | `screens/settings-screen.tsx` (existing scrolling list shape)                                                                                               | role-match                      |
| `packages/app/src/components/settings/group.tsx`               | component                                               | display                                                       | `screens/settings/settings-section.tsx`                                                                                                                     | exact                           |
| `packages/app/src/components/settings/row.tsx`                 | component                                               | event-driven (Pressable → push sub-page)                      | `screens/settings-screen.tsx` row patterns + `components/ui/dropdown-menu.tsx` `DropdownMenuItem`                                                           | role-match                      |
| `packages/app/src/components/settings/labs-row.tsx`            | component                                               | display + toggle                                              | `screens/settings/labs-section.tsx` (current labs row layout)                                                                                               | exact                           |
| `packages/app/src/components/settings/labs-badge.tsx`          | component                                               | display                                                       | `components/ui/status-badge.tsx` (existing badge primitive)                                                                                                 | exact                           |
| `packages/app/src/utils/delight-toast.ts`                      | utility (singleton helper)                              | event-driven once                                             | `components/toast-host.tsx` (existing toast API) — `burnt` is new dep, no prior art                                                                         | role-match                      |
| `packages/app/src/hooks/use-haptic.ts`                         | hook                                                    | event-driven (debounced)                                      | existing inline `Haptics.*` calls in `components/sidebar-workspace-list.tsx:1053,1076,1089`                                                                 | role-match                      |
| `packages/app/src/stores/onboarding-state-store.ts`            | store (Zustand + AsyncStorage persist)                  | persisted state                                               | `stores/draft-store.ts` (zustand `persist` + AsyncStorage)                                                                                                  | exact                           |
| `packages/app/src/stores/labs-opt-in-store.ts`                 | store (Zustand + AsyncStorage persist)                  | persisted state                                               | `stores/draft-store.ts` (zustand `persist` + AsyncStorage)                                                                                                  | exact                           |
| `packages/app/src/assets/otter/`                               | asset directory                                         | static                                                        | `components/icons/ottie-logo.tsx` (existing brand surface)                                                                                                  | role-match                      |

### Modified files

| Modified file                                            | Role      | Modification                                                                                                 | Closest analog (for new behavior)                                      |
| -------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `packages/app/src/components/welcome-screen.tsx`         | screen    | add Skip + "Don't show again" + AsyncStorage flag                                                            | self (lines 162–323) — extend existing `actions[]`                     |
| `packages/app/src/app/welcome.tsx`                       | route     | branch on `welcomeShown` flag from new store                                                                 | self (lines 1–6)                                                       |
| `packages/app/src/app/pair-scan.tsx`                     | route     | replace `Alert.alert` (line 193) with inline `<CalloutCard variant="error">` + preserved typed input         | `components/callout-card.tsx` (already shipped error variant)          |
| `packages/app/src/components/mobile-tab-bar.tsx`         | component | add long-press handler on active tab → opens command-center sheet; promote active label to `weight.semibold` | self (lines 38–143)                                                    |
| `packages/app/src/components/desktop-nav-rail.tsx`       | component | wire ⌘K to mount `<CommandCenterPalette>` via `react-hotkeys-hook`                                           | self (lines 49–101)                                                    |
| `packages/app/src/screens/sessions-screen.tsx`           | screen    | reshape into Chats tab — `<ChatRow>`, top-right `+`, pull-to-refresh, infinite scroll, total-unread popup    | self (lines 1–121) — replace `<AgentList>` with `<ChatRow>` collection |
| `packages/app/src/components/splash-overlay.tsx`         | component | mount `<TotalUnreadPopup>` after splash dismiss                                                              | self (lines 1–60)                                                      |
| `packages/app/src/screens/settings-screen.tsx`           | screen    | reorganize into 5-bucket flat list using new `<SettingsFlatList>` / `<SettingsGroup>` / `<SettingsRow>`      | self (lines 1–80)                                                      |
| `packages/app/src/utils/host-routes.ts`                  | module    | extend `SETTINGS_SECTION_SLUGS` with redirect entries; add `buildSettingsBucketRoute`                        | self (lines 391–423)                                                   |
| `packages/app/src/components/message.tsx`                | component | confirm `useSmoothedText` is the **single** call site; gate by `isLive` (already does, line 1640)            | self (line 1640)                                                       |
| `packages/app/src/components/sidebar-workspace-list.tsx` | component | replace inline `Haptics.*` (lines 1053/1076/1089) with `useHaptic()`                                         | self + new `use-haptic.ts`                                             |
| `packages/app/src/i18n/locales/en.json`                  | data      | add 30+ new keys from UI-SPEC §Copywriting Contract                                                          | self (lines 1–40)                                                      |
| `packages/app/src/i18n/locales/zh.json`                  | data      | parity with en.json                                                                                          | self                                                                   |
| `packages/app/src/components/command-center.tsx`         | component | DELETE (replaced by Metro split — see new files above)                                                       | —                                                                      |
| `tools/lint/pointer-events-web-only.ts`                  | tool      | promote warn → error for NAT-03 / D-20                                                                       | self (existing lint rule)                                              |

---

## Pattern Assignments

### `packages/app/src/actions/registry.ts` (module, event-driven dispatch)

**Closest analogs:** `packages/app/src/voice-control/voice-commands.ts` (the `VOICE_COMMANDS` registry pattern — 10 commands, Zod schema, `defineCommand` helper), and `packages/app/src/keyboard/keyboard-action-dispatcher.ts` (the priority-sorted handler dispatch loop).

**Imports + module structure** (`voice-control/voice-commands.ts:1-13`):

```typescript
import { z } from "zod";
import { router } from "expo-router";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { getNavigationActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  buildHostAgentDetailRoute,
  buildHostWorkspaceRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import { getVoiceCommandBridge } from "@/voice-control/voice-command-bridge";
```

_Action registry should mirror this: pull stores via getter, never via React hooks; route via `expo-router`; use Zod-validated payloads._

**Definition helper pattern** (`voice-control/voice-commands.ts:46-65`):

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

_Action registry: rename `VoiceCommand` → `Action`, drop `examples`, add `modalities: ReadonlyArray<"voice" | "kbd" | "cmdk" | "menu" | "gesture">`. Keep the `defineAction()` helper to preserve type inference across heterogeneous schemas._

**Dispatch loop / priority sort** (`keyboard/keyboard-action-dispatcher.ts:74-114`):

```typescript
export function createKeyboardActionDispatcher() {
  let nextRegistrationOrder = 1;
  const handlers = new Map<string, KeyboardActionRegistryEntry>();

  return {
    registerHandler(handler: KeyboardActionHandler) {
      handlers.set(handler.handlerId, {
        ...handler,
        registeredAt: nextRegistrationOrder++,
      });
      return () => {
        handlers.delete(handler.handlerId);
      };
    },

    dispatch(action: KeyboardActionDefinition): boolean {
      const candidates = Array.from(handlers.values())
        .filter((handler) => handler.actions.includes(action.id))
        .filter((handler) => handler.enabled)
        .filter((handler) => (handler.isActive ? handler.isActive() : true))
        .sort((left, right) => {
          if (left.priority !== right.priority) return right.priority - left.priority;
          return right.registeredAt - left.registeredAt;
        });

      for (const handler of candidates) {
        if (handler.handle(action)) return true;
      }
      return false;
    },
  };
}

export const keyboardActionDispatcher = createKeyboardActionDispatcher();
```

_Action registry should NOT recreate priority/scope dispatch — keep the registry to a flat `Map<ActionId, Action>`. Dispatch goes through the keyboard dispatcher only when keyboard is the source. Voice / cmdk / menu sources call `actionRegistry.dispatch(id, payload)` directly._

**Public registry shape + cast for uniform iteration** (`voice-control/voice-commands.ts:294-321`):

```typescript
export const VOICE_COMMANDS: VoiceCommand[] = [
  openFileExplorer,
  closeFileExplorer,
  toggleFocusMode,
  findWorkspace,
  switchToWorkspace,
  switchToAgent,
  sendToActiveAgent,
  interruptActiveAgent,
  listAgents,
  openSettings,
] as unknown as VoiceCommand[];

export function getCommandByName(name: string): VoiceCommand | undefined {
  return VOICE_COMMANDS.find((cmd) => cmd.name === name);
}

export function searchCommands(query: string): VoiceCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return VOICE_COMMANDS;
  return VOICE_COMMANDS.filter((cmd) => {
    if (cmd.name.includes(needle)) return true;
    if (cmd.description.toLowerCase().includes(needle)) return true;
    return cmd.examples.some((ex) => ex.toLowerCase().includes(needle));
  });
}
```

_Registry: export `ACTIONS: readonly Action[]`, `getActionById()`, `searchActions()`. Voice commands wrap by calling `actionRegistry.dispatch("agent.create", payload)` from their `handler` rather than each rebuilding the side effect._

---

### `packages/app/src/actions/ids.ts` (module, constants)

**Closest analog:** `packages/app/src/keyboard/actions.ts` (existing `KeyboardActionId` union)

**Pattern to copy** (`keyboard/actions.ts:18-49`):

```typescript
export type KeyboardActionId =
  | "agent.interrupt"
  | "agent.new"
  | "workspace.tab.new"
  | "workspace.tab.close.current"
  | "workspace.tab.navigate.index"
  | "workspace.tab.navigate.relative"
  | "workspace.pane.split.right"
  | "workspace.pane.split.down"
  | "workspace.pane.focus.left"
  | "workspace.pane.focus.right"
  | "sidebar.toggle.left"
  | "sidebar.toggle.right"
  | "settings.toggle"
  | "command-center.toggle"
  | "shortcuts.dialog.toggle"
  | "theme.cycle"
  | ...
```

_New `actions/ids.ts`: define `ActionId` as the union of all phase-2 IDs (NAT-01 minimum 6 + 8 chat-row context-menu items + 4 add-menu items + future). Use `dotted.case`. Pattern is exact — same naming, same dotted hierarchy, same `as const` ergonomics._

---

### `packages/app/src/components/chat-row.tsx` (component, request-response)

**Closest analog:** `packages/app/src/components/agent-list.tsx` (existing FlatList row that renders `AggregatedAgent`).

**Imports** (`components/agent-list.tsx:1-27`):

```typescript
import {
  View,
  Text,
  Pressable,
  Modal,
  RefreshControl,
  FlatList,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { router, type Href } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { formatTimeAgo } from "@/utils/time";
import { shortenPath } from "@/utils/shorten-path";
import { type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { Archive } from "lucide-react-native";
import { getProviderAccent, getProviderIcon } from "@/components/provider-icons";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { resolveWorkspaceIdByExecutionDirectory } from "@/utils/workspace-execution";
import { prepareWorkspaceTab } from "@/utils/workspace-navigation";
import type { Agent } from "@/stores/session-store";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
```

**Long-press / right-click row pattern** (`components/sidebar-workspace-list.tsx:1001-1078` — long-press timer + haptic + anchored menu):

```typescript
const openContextMenuAtStartPoint = useCallback(() => {
  if (!input.menuController || !touchStartRef.current) return;
  const statusBarHeight = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  input.menuController.setAnchorRect({
    x: touchStartRef.current.x,
    y: touchStartRef.current.y + statusBarHeight,
    width: 0, height: 0,
  });
  input.menuController.setOpen(true);
  ...
}, [input.menuController]);

// Long-press timer (450ms) — opens menu + selectionAsync haptic
contextMenuTimerRef.current = setTimeout(() => {
  if (scrollIntentRef.current || didStartDragRef.current || menuOpenedRef.current) return;
  ...
  void Haptics.selectionAsync().catch(() => {});  // ← replace with useHaptic("medium")
  openContextMenuAtStartPoint();
}, CONTEXT_MENU_DELAY_MS);
```

_ChatRow: copy this 450ms-armed-timer pattern verbatim. Replace inline `Haptics.selectionAsync()` with `useHaptic().fire("medium")` per D-18. Anchor rect in screen coordinates so the menu can render via the new `<ChatRowContextMenu>`._

**Hover-fallback pattern (web hover quick-actions on `<ChatRowHoverActions.web.tsx>`)** — Phase 1 chevron pattern, applied at `components/message.tsx`:

```typescript
// Use isHovered || isNative || isCompact — never isHovered alone (Phase 1 lint stays at warn)
const visible = isHovered || isNative || isCompact;
```

_Per UI-SPEC line 270: web hover-quick-actions are visible on `isHovered || isCompact`. On native, swipe-left replaces hover so they should NOT render — that's a `.web.tsx` Metro split, not a runtime branch._

---

### `packages/app/src/components/chat-row-context-menu.{web,native}.tsx` (Metro split)

**Closest analogs:** `components/ui/dropdown-menu.tsx` (web anchored) + `components/ui/context-menu.tsx` (already supports both modes — its `MobileMenuMode = "dropdown" | "sheet"` switch is the exact prior art).

**Metro split shim pattern** (`components/draggable-list.tsx:1-7`):

```typescript
// This file exists for TypeScript resolution.
// The actual implementations are in:
// - draggable-list.native.tsx (iOS/Android)
// - draggable-list.web.tsx (Web)
// Metro's platform-specific extensions will pick the right one at runtime.
export * from "./draggable-list.native";
```

_Create `chat-row-context-menu.tsx` (shim) + `.web.tsx` + `.native.tsx`. Re-export `_ from "./chat-row-context-menu.native"` for the TS resolution. Metro picks the right file at build time.\*

**Native sheet pattern** (`components/ui/context-menu.tsx:32-44` — already pulls from `@gorhom/bottom-sheet`):

```typescript
import { BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  IsolatedBottomSheetModal,
  useIsolatedBottomSheetVisibility,
} from "@/components/ui/isolated-bottom-sheet-modal";
```

_Native context-menu (`.native.tsx`): wrap `<IsolatedBottomSheetModal>` + `<BottomSheetScrollView>` — already isolated from the global portal so the app shell can stay interactive._

**Web anchored menu pattern** (`components/ui/dropdown-menu.tsx:30-46`):

```typescript
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWebScrollbarStyle } from "@/hooks/use-web-scrollbar-style";
import { isNative, isWeb } from "@/constants/platform";
import { BlurView } from "expo-blur";

export type ActionStatus = "idle" | "pending" | "success";
type Placement = "top" | "bottom" | "left" | "right";
type Alignment = "start" | "center" | "end";
```

_Web context-menu (`.web.tsx`): mount as `<Modal transparent>` with anchored panel near cursor (match `components/command-center.tsx:328-393` modal-shell layout). Wrap content in `<GlassSurface radius="sheet">` per D-16._

---

### `packages/app/src/components/unread-badge.tsx` (component, display)

**Closest analog:** `packages/app/src/components/agent-status-dot.tsx` (token-driven small status pill)

**File structure pattern** (small token-driven view component) — typography-bound to UI-SPEC §Typography "Caption" role (`fontSize.xs` + `weight.semibold` + `fontVariant: ["tabular-nums"]`). The `<UnreadBadge>` should render `theme.status.destructive` for unread, `theme.text.muted` for muted (greyed numeric per UI-SPEC). Borrow the `useUnistyles()` + StyleSheet split from `components/agent-status-dot.tsx`.

---

### `packages/app/src/components/total-unread-popup.tsx` (component, auto-decay display)

**Closest analog:** `packages/app/src/components/splash-overlay.tsx` (timed module-flag overlay).

**Module-scoped one-shot flag pattern** (`components/splash-overlay.tsx:14-20, 41-60`):

```typescript
const SPLASH_DURATION_MS = 2200;
const FADE_OUT_MS = 420;
const TOTAL_VISIBLE_MS = SPLASH_DURATION_MS + 200;

/**
 * Module-scoped flag — splash plays once per app launch (not persisted).
 * Refreshing the page or relaunching the desktop shell triggers it again.
 */
let hasShown = false;

export function SplashOverlay() {
  const [visible, setVisible] = useState(!hasShown);
  useEffect(() => {
    if (hasShown) return;
    hasShown = true;
    const timer = setTimeout(() => setVisible(false), TOTAL_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);
  ...
  if (!visible) return null;
```

_TotalUnreadPopup: copy the module-scoped `hasShown` flag pattern. Use 1500ms timer per UI-SPEC line 192 / D-06. Skip render if total = 0. `<GlassSurface radius="pill">` per UI-SPEC line 272._

---

### `packages/app/src/components/command-center.{web,native}.tsx` (Metro split — REPLACES existing `command-center.tsx`)

**Closest analog:** existing `packages/app/src/components/command-center.tsx` (491 lines — full structure to swap onto `cmdk` for web, `<BottomSheet>` for native).

**Existing modal shell** (`components/command-center.tsx:248-345`):

```typescript
export function CommandCenter() {
  const { theme } = useUnistyles();
  const { open, inputRef, query, setQuery, activeIndex, items, handleClose, handleSelectItem } =
    useCommandCenter();
  ...
  if (isNative || !open) return null;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View testID="command-center-panel" style={panelStyle}>
          <View style={headerStyle}>
            <TextInput
              testID="command-center-input"
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Type a command or search agents..."
              style={inputStyle}
              autoCapitalize="none" autoCorrect={false} autoFocus
            />
          </View>
          <ScrollView ref={resultsRef} ...>
            {items.length === 0 ? <Text>No matches</Text> : ...}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
```

_`.web.tsx`: keep the `<Modal>` shell verbatim. Replace the hand-rolled filter/keyboard logic (the `useCommandCenter()` hook continues to feed items) with `<Command>` from `cmdk@1.1.1`. Wrap the panel in `<GlassSurface radius="sheet">` instead of inline `panelStyle`. The `useCommandCenter` hook (`hooks/use-command-center.ts`) stays — it provides items/dispatch._
_`.native.tsx`: replace `<Modal>` with `<IsolatedBottomSheetModal>` from `components/ui/isolated-bottom-sheet-modal.tsx`. Bottom-sheet trigger: long-press on the active mobile-tab-bar tab (per UI-SPEC interaction contract line 311–315)._

---

### `packages/app/src/components/settings/flat-list.tsx` + `group.tsx` + `row.tsx`

**Closest analog:** `packages/app/src/screens/settings/settings-section.tsx` (1–51 lines — exact group-header + content shape)

**Pattern to copy** (`screens/settings/settings-section.tsx:1-51`):

```typescript
import { useMemo, type ReactNode } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";

interface SettingsSectionProps {
  title: string;
  trailing?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

export function SettingsSection({ title, trailing, testID, style, children }: SettingsSectionProps) {
  const sectionStyle = useMemo(() => [settingsStyles.section, style], [style]);
  return (
    <View style={sectionStyle} testID={testID}>
      <View style={styles.header}>
        <Text style={settingsStyles.sectionHeaderTitle}>{title}</Text>
        {trailing}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            gap: theme.spacing[2], marginBottom: theme.spacing[3], marginLeft: theme.spacing[1] },
  content: { gap: theme.spacing[3] },
}));
```

_New `<SettingsGroup>` (Phase 2 D-09 group header): same shape — `title` prop = `t("settings.section.account" | …)`, label rendered at `theme.fontSize.sm` + `weight.semibold` per UI-SPEC §Typography "Settings group header". Reuse `settingsStyles.section` from `@/styles/settings` so visual rhythm matches the existing screens during the migration._

_New `<SettingsRow>`: Pressable that pushes a sub-page via `router.push(buildSettingsBucketRoute(bucket, slug))`. Render label at Body (16/400) + helper text at Label (14/400) per UI-SPEC. Right chevron is decorative — `accessibilityElementsHidden`. `accessibilityRole="button"`, `accessibilityLabel` = the row's own text label (UI-SPEC §Component Inventory line 277)._

---

### `packages/app/src/components/settings/labs-row.tsx` + `labs-badge.tsx`

**Closest analog:** `packages/app/src/screens/settings/labs-section.tsx:118-237` (current Labs surface)

**Existing labs row layout** (`screens/settings/labs-section.tsx:120-160`):

```typescript
<View style={settingsStyles.card}>
  <View style={styles.cardHeader}>
    <View style={styles.cardHeaderIcon}>
      <Mic size={theme.iconSize.md} color={theme.colors.foreground} />
    </View>
    <View style={styles.cardHeaderText}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardTitle}>{t("settings.labsVoice.title", ...)}</Text>
        <View style={styles.betaPill}>
          <Text style={styles.betaPillText}>BETA</Text>
        </View>
      </View>
      <Text style={settingsStyles.rowHint}>{t("settings.labsVoice.description", ...)}</Text>
    </View>
  </View>
  ...
  <SegmentedControl size="sm" value={toToggleValue(voice.enabled)}
    onValueChange={handleEnableChange} options={ON_OFF_OPTIONS} />
```

_New `<LabsRow>`: collapse this hand-rolled row into a registry-driven row. Each entry comes from a `LABS_REGISTRY` constant ({ id, stability: "experimental" | "beta" | "stable", title, description, enabled, set })`. Stability label rendered through new `<LabsBadge>`. Existing `betaPill` style is replaced — UI-SPEC differentiates Experimental (filled amber), Beta (outline amber), Stable (filled accent green) per line 149–153._

_Toggle widget = `components/ui/segmented-control.tsx` (already imported in labs-section). Use `useAppSettings()` from `hooks/use-settings.ts` for the persisted toggle map (extend `BetaFeatureSettings` from `hooks/use-settings.ts:45-47` instead of creating a parallel store)._

---

### `packages/app/src/hooks/use-haptic.ts` (hook, debounced)

**Closest analog:** existing inline `Haptics.*` usage at `components/sidebar-workspace-list.tsx:1053,1076,1089`

**Existing call sites to replace** (`components/sidebar-workspace-list.tsx`):

```typescript
// line 13:
import * as Haptics from "expo-haptics";

// line 1053 — in long-press timer (drag arm)
void Haptics.selectionAsync().catch(() => {});

// line 1076 — in context-menu open timer
void Haptics.selectionAsync().catch(() => {});

// line 1089 — in handleDragIntent
void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
```

_New `use-haptic.ts` interface (per UI-SPEC §Interaction Contract — Haptics):_

```typescript
import * as Haptics from "expo-haptics";
import { isNative } from "@/constants/platform";

interface UseHapticInput {
  enabled: boolean; // from useAppSettings — user toggle
  isLowPowerMode: boolean; // from system — auto-disable
}
type HapticEvent = "light" | "medium" | "heavy";

const DEBOUNCE_MS = 200;

export function useHaptic(input: UseHapticInput): {
  fire(event: HapticEvent): void;
} {
  // 200ms debounce per event-type (Map<HapticEvent, lastFiredAtMs>)
  // No-op on web (isNative gate)
  // No-op when enabled === false || isLowPowerMode === true
  // light  → Haptics.impactAsync(ImpactFeedbackStyle.Light)
  // medium → Haptics.impactAsync(ImpactFeedbackStyle.Medium)
  // heavy  → Haptics.notificationAsync(NotificationFeedbackType.Warning)
}
```

_Settings toggle: extend `useAppSettings()` (hooks/use-settings.ts:84-91) — add `haptics: { enabled: boolean }` under top-level `AppSettings`. Default `true`. AsyncStorage-persisted (existing pattern)._

_Low-power-mode read: native iOS exposes via `expo-battery` (not yet installed) — researcher noted the planner should resolve. Conservative default if unavailable: assume `false` (don't auto-disable)._

---

### `packages/app/src/stores/onboarding-state-store.ts` + `labs-opt-in-store.ts`

**Closest analog:** `packages/app/src/stores/draft-store.ts` (zustand `persist` + AsyncStorage middleware)

**Imports + persist boilerplate** (`stores/draft-store.ts:1-14`):

```typescript
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import { GitHubSearchItemSchema } from "@server/shared/messages";
...

const DRAFT_STORE_VERSION = 4;
```

**Store shape pattern** (existing `mobile-quick-action-store.ts:1-26` — simple zustand without persist):

```typescript
import { create } from "zustand";

export type MobileQuickAction =
  | { kind: "openModelPicker"; serverId: string; agentId: string }
  | ...;

interface MobileQuickActionState {
  pending: MobileQuickAction | null;
  request: (action: MobileQuickAction) => void;
  clear: () => void;
}

export const useMobileQuickActionStore = create<MobileQuickActionState>((set) => ({
  pending: null,
  request: (action) => set({ pending: action }),
  clear: () => set({ pending: null }),
}));
```

_`onboarding-state-store.ts` should follow the **persisted** `draft-store.ts` shape (welcome flag must survive reload). Per RESEARCH.md, **stay on AsyncStorage, do NOT introduce MMKV mid-milestone**. Schema:_

```typescript
interface OnboardingState {
  welcomeShown: boolean; // D-21 — set when "Skip" or "Get started" pressed
  welcomeShownAt: number | null; // ms epoch
  delightFiredFirstAgent: boolean; // D-17 — one-shot
  delightFiredFirstPermission: boolean; // D-17
  delightFiredFirstVoice: boolean; // D-17
  emptyOttiePlayedFirstWorkspace: boolean;
  emptyOttiePlayedFirstChats: boolean;
}
```

_Persistence key: `@ottie:onboarding-state` (matches existing convention `@ottie:app-settings` from `hooks/use-settings.ts:5`)._

---

### `packages/app/src/utils/delight-toast.ts` (utility, event-driven once)

**Closest analog:** `components/toast-host.tsx` (existing in-app inline toast — JS-rendered) + new `burnt` dep (no prior art).

**Existing toast API surface** (`components/toast-host.tsx:36-44`):

```typescript
export interface ToastApi {
  show: (content: ReactNode, options?: ToastShowOptions) => void;
  copied: (label?: string) => void;
  error: (message: string) => void;
}
```

_New `delight-toast.ts`: tiny wrapper that:_

1. _Reads `useOnboardingStateStore.getState().delightFiredX` flag_
2. _Returns immediately if flag = true_
3. _Calls `burnt.alert({ title, preset: "done", duration: 2 })` (or web Sonner equivalent)_
4. _Sets the flag via `useOnboardingStateStore.getState().setDelightFiredX(true)`_

_Don't re-implement the existing `useToastHost` for state-change toasts (D-12) — keep both surfaces separate: `burnt` for native-feel system acks, `toast-host` for in-app inline messaging. Per RESEARCH.md line 39 ("keep `toast-host` for in-app inline toasts; introduce `burnt` for system-level acks")._

---

### `packages/app/src/components/welcome-screen.tsx` (MODIFY)

**Closest analog:** itself (lines 162–323) — extend the existing `actions[]` array.

**Existing actions array structure** (`components/welcome-screen.tsx:210-254`):

```typescript
const actions: WelcomeAction[] = isWeb
  ? [
      { key: "direct-connection", label: t("welcome.openOnDesktop"), testID: "welcome-direct-connection",
        primary: true, icon: Link2, onPress: handleOpenDirect },
      { key: "paste-pairing-link", label: t("welcome.pasteLink"), testID: "welcome-paste-pairing-link",
        primary: false, icon: ClipboardPaste, onPress: handleOpenPasteLink },
    ]
  : [
      { key: "scan-qr", label: t("welcome.scanQr"), ... },
      ...
    ];
```

_Extend the array with a new `"skip"` entry that:_

1. _Calls `useOnboardingStateStore.getState().setWelcomeShown(true)`_
2. _Routes to `buildHostSessionsRoute(activeServerId)` if any host online, else `/`_
3. _Uses copy keys `welcome.skipForPowerUsers` (UI-SPEC line 173) — both en + zh_

_Add inline `<Pressable accessibilityRole="checkbox">` above the action stack for `welcome.dontShowAgain` (UI-SPEC line 174)._

_The cold-open logic in `app/index.tsx` already routes to most-recent workspace if any host online (RESEARCH.md line 47) — wire `app/welcome.tsx` to consume `useOnboardingStateStore` and redirect to `buildHostSessionsRoute()` if `welcomeShown === true`._

---

### `packages/app/src/app/pair-scan.tsx` (MODIFY)

**Closest analog:** itself (line 193 — `Alert.alert("Error", message)`) + `components/callout-card.tsx` for the inline replacement.

**Existing failure path** (`app/pair-scan.tsx:160-198`):

```typescript
const handleScan = useCallback(
  async (result: BarcodeScanningResult) => {
    if (isPairing) return;
    const offerUrl = extractOfferUrlFromScan(result);
    if (!offerUrl) return;
    if (lastScannedRef.current === offerUrl) return;
    lastScannedRef.current = offerUrl;

    try {
      setIsPairing(true);
      ...
      navigateToPairedHost(profile.serverId);
    } catch (error) {
      lastScannedRef.current = null;
      const message = error instanceof Error ? error.message : "Unable to pair host";
      Alert.alert("Error", message);  // ← REPLACE with inline <CalloutCard variant="error">
    } finally {
      setIsPairing(false);
    }
  },
  [isPairing, navigateToPairedHost, upsertDaemonFromOfferUrl],
);
```

**Replacement pattern from `components/callout-card.tsx:32-92`** (existing error variant, already shipped):

```typescript
export function CalloutCard({
  title, description, icon, variant = "default", actions, onDismiss, testID,
}: CalloutCardProps) {
  ...
  return (
    <View style={containerStyle} testID={testID} accessibilityRole="alert">
      <View style={styles.body}>
        ...
        {hasDescription && typeof description === "string" ? (
          <CalloutDescriptionText>{description}</CalloutDescriptionText>
        ) : null}
```

_Phase 2 inline error: `<CalloutCard variant="error" title={t("errors.pairScanFailed.heading")} description={t("errors.pairScanFailed.body")} actions={[regenerate, manualEntry, useLocal]} />` — wrapped in `<GlassSurface radius="card">` per D-16._

_Typed input preservation (D-21): hoist the manual-entry text state above the recovery callout so re-renders don't reset. Use `useState` at the `app/pair-scan.tsx` top level (not inside the `<PairLinkModal>`)._

---

### `packages/app/src/components/mobile-tab-bar.tsx` (MODIFY)

**Closest analog:** itself (lines 38–143).

**Existing tab button structure** (`components/mobile-tab-bar.tsx:70-110`):

```typescript
function TabButton({ tab, active, onSelect }: { tab: TabSpec; active: boolean; onSelect: (tab: MobileTab) => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const label = t(tab.labelKey);
  const handlePress = useCallback(() => onSelect(tab.id), [onSelect, tab.id]);
  ...
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      accessibilityLabel={label}
      testID={`mobile-tab-${tab.id}`}
      style={buttonStyle}
    >
      <Icon size={22} color={iconColor} />
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
}
```

_Add `onLongPress` handler on the **active** tab → opens `<CommandCenterSheet>` (native bottom-sheet variant). Wire via `useKeyboardShortcutsStore.getState().setCommandCenterOpen(true)` so the existing open/close machinery is reused._

_Promote active label weight from `theme.fontWeight.semibold` (already line 141) — confirm typography contract from UI-SPEC: 14/400 inactive → 14/600 active._

---

### `packages/app/src/components/desktop-nav-rail.tsx` (MODIFY)

**Existing structure** (`components/desktop-nav-rail.tsx:67-101`):

```typescript
const handleSelect = useCallback(
  (tab: RailTabId) => {
    if (tab === activeTab) return;
    switch (tab) {
      case "chats":
        if (activeServerId) router.replace(buildHostSessionsRoute(activeServerId));
        return;
      ...
    }
  },
  [activeServerId, activeTab],
);
```

_Add a `useHotkeys("meta+k, ctrl+k", () => setCommandCenterOpen(true))` call (from `react-hotkeys-hook@5.3.0`) — Web/Tauri only; this file is `.tsx` (no `.web.tsx` split needed because `react-hotkeys-hook` no-ops on native bundles, but per RESEARCH.md line 178 it's web-only — gate via `if (isWeb)` short-circuit)._

---

### `packages/app/src/screens/sessions-screen.tsx` (MODIFY — heaviest lift)

**Closest analog:** itself (lines 1–121) + `components/agent-list.tsx` (existing FlatList rendering).

**Current shape** (`screens/sessions-screen.tsx:24-94`):

```typescript
function SessionsScreenContent({ serverId }: { serverId: string }) {
  const { theme } = useUnistyles();
  const { agents, hasMore, isInitialLoad, isLoadingMore, isRevalidating, loadMore, refreshAll } =
    useAgentHistory({ serverId });

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);
  ...
  return (
    <View style={styles.container}>
      <MenuHeader title="Chats" />
      {isInitialLoad ? <LoadingSpinner ... /> : null}
      {!isInitialLoad && sortedAgents.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No chats yet</Text>
          ...
        </View>
      ) : null}
      {!isInitialLoad && sortedAgents.length > 0 ? (
        <AgentList
          agents={sortedAgents}
          isRefreshing={isManualRefresh && isRevalidating}
          onRefresh={handleRefresh}
          listFooterComponent={listFooterComponent}
          ...
        />
      ) : null}
    </View>
  );
}
```

_Phase 2 reshape: replace `<AgentList>` with a new chats-list shape:_

- _Header: `<MenuHeader>` keeps title; add top-right `+` icon → `<TopRightAddMenu>` (D-04 / UI-SPEC line 271)_
- _Initial-load spinner: `<MathCurveLoader>` per D-13 (this is one of the 3 sanctioned top-level loads)_
- _Empty state: branch on `useOnboardingStateStore().emptyOttiePlayedFirstChats` — first-time renders `<OttieLogo>` + heading; subsequent is pure copy_
- _List body: each item = `<ChatRow>`. Pinned rows sort to top. Pull-to-refresh stays. Infinite scroll = `useAgentHistory.loadMore()` on `onEndReached` (already plumbed)_
- _Pre-list mount: `<TotalUnreadPopup>` (D-06 — auto-decay 1.5s)_

---

### `packages/app/src/components/splash-overlay.tsx` (MODIFY)

**Existing module-flag pattern** (lines 14–60 — reproduced above under `total-unread-popup.tsx`).

_Wire after `setVisible(false)` to mount `<TotalUnreadPopup>` if `useSessionStore.getState().totalUnread > 0`. The popup's own module-flag (`hasShown` per launch) prevents re-firing on subsequent route changes._

---

### `packages/app/src/screens/settings-screen.tsx` + `packages/app/src/utils/host-routes.ts` (MODIFY — settings IA reorg)

**Existing route slugs** (`utils/host-routes.ts:391-414`):

```typescript
export const SETTINGS_SECTION_SLUGS = [
  "general",
  "shortcuts",
  "integrations",
  "permissions",
  "usage",
  "labs",
  "localDaemon",
  "diagnostics",
  "about",
] as const;

export type SettingsSectionSlug = (typeof SETTINGS_SECTION_SLUGS)[number];

export function isSettingsSectionSlug(value: string): value is SettingsSectionSlug {
  return (SETTINGS_SECTION_SLUGS as readonly string[]).includes(value);
}

export function buildSettingsRoute() {
  return "/settings" as const;
}
export function buildSettingsSectionRoute(section: SettingsSectionSlug) {
  return `/settings/${section}` as const;
}
```

_Phase 2 (D-09 / D-11 — additive):_

1. _Add bucket constants: `SETTINGS_BUCKETS = ["account", "agents", "voice", "appearance", "advanced"] as const`_
2. _Map each existing slug to a bucket: `SLUG_TO_BUCKET: Record<SettingsSectionSlug, SettingsBucket>` (e.g. `general → appearance`, `localDaemon → advanced`, `labs → advanced`, `shortcuts → advanced`, `integrations → advanced`, etc.)_
3. _Old paths keep working — the existing `/settings/[section].tsx` route resolves slug → bucket via `SLUG_TO_BUCKET` and renders the bucket page. No 404, no redirect needed at the router layer_
4. _New top-level `/settings` renders the new `<SettingsFlatList>` (5 buckets)_

_Existing `screens/settings-screen.tsx` (1–80) is the keystone — reorganize internals without renaming the file. Its `view = { kind: "section", section }` discriminated-union shape continues to drive sub-page rendering._

---

## Shared Patterns

### Platform gating (CLAUDE.md hard rule)

**Source:** `packages/app/src/constants/platform.ts:20-24`
**Apply to:** every new component that touches DOM, native APIs, hover, or layout breakpoints

```typescript
/** Browser or Electron — the JS runtime has access to the DOM. */
export const isWeb = Platform.OS === "web";

/** iOS or Android — the JS runtime is React Native. */
export const isNative = Platform.OS !== "web";
```

And from `constants/layout.ts:40` (`useIsCompactFormFactor()`) for layout decisions. **Never write `Platform.OS === "web"` locally** — Phase 1 lint stays at warn. **Never use `onPointerEnter`/`onPointerLeave` outside `.web.tsx`** — D-20 promotes to error.

### Metro `.web.tsx` / `.native.tsx` split

**Source:** `packages/app/src/components/draggable-list.tsx:1-7` + `packages/app/src/components/math-curve-loader/index.tsx:1-8` + `packages/app/src/stores/timeline-cache-store.ts`
**Apply to:** `chat-row-context-menu.{web,native}.tsx`, `command-center.{web,native}.tsx`, `chat-row-hover-actions.web.tsx`

```typescript
// math-curve-loader/index.tsx — public entry shim
export { MathCurveLoaderRenderer as MathCurveLoader } from "./renderer";
export type { MathCurveLoaderProps, CurveName } from "./types";
```

### Glass surface (D-16 — every modal/sheet/popover/dropdown migration target)

**Source:** `packages/app/src/components/ui/glass-surface.tsx:8-104`
**Apply to:** `command-center.{web,native}.tsx` panel, `chat-row-context-menu.{web,native}.tsx` container, `top-right-add-menu.tsx` container, `total-unread-popup.tsx`, every modal under `packages/app/src/components/` audit list

```typescript
type GlassRadius = "none" | "card" | "sheet" | "pill" | "button";

export function GlassSurface({
  children, intensity = 50, tint, radius = "card", bordered = true, strong = false, style, ...rest
}: GlassSurfaceProps) {
  const { theme } = useUnistyles();
  const isDark = theme.colorScheme === "dark";
  ...
  if (isWeb) {
    return <View {...rest} style={webStyle}>{children}</View>;
  }
  ...
  return (
    <BlurView {...rest} tint={resolvedTint} intensity={intensity}
      experimentalBlurMethod={experimentalBlurMethod} style={nativeStyle}>
      {children}
    </BlurView>
  );
}
```

_All migration targets pick from `radius="card" | "sheet" | "pill" | "button"`. The component already handles the iOS `BlurView` + web `backdrop-filter` + Android `dimezisBlurView` triad — new code does NOT need to gate by platform._

### Unistyles + token consumption

**Source:** `packages/app/src/components/mobile-tab-bar.tsx:112-143`
**Apply to:** every new component

```typescript
const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    paddingTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surfaceGlassStrong,
    borderTopColor: theme.colors.borderGlass,
  },
  label: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
  },
  labelActive: {
    fontWeight: theme.fontWeight.semibold,
  },
}));
```

_Never inline raw pixel values (UI-SPEC §Spacing forbidden patterns). Always source from `theme.spacing` / `theme.colors` / `theme.fontSize` / `theme.fontWeight`. The four phase-2 sizes are `xs | sm | base | xl` (UI-SPEC §Typography). The two phase-2 weights are `normal | semibold` only — `medium` (500) is forbidden._

### Bilingual i18n (CLAUDE.md hard rule)

**Source:** `packages/app/src/i18n/locales/en.json:1-40` + `zh.json` (parity)
**Apply to:** every new user-visible string

```typescript
import { useTranslation } from "react-i18next";

const { t } = useTranslation();
const label = t("welcome.title"); // ← key already exists
const newLabel = t("chat.menu.pin"); // ← NEW key — must add to BOTH en.json and zh.json
```

_Every new key from UI-SPEC §Copywriting Contract MUST land in both `packages/app/src/i18n/locales/en.json` and `zh.json` in lockstep, in the same commit. UI-SPEC lines 168–248 enumerate the keys._

### AsyncStorage persistence (CLAUDE.md + Phase 1 + RESEARCH.md)

**Source:** `packages/app/src/hooks/use-settings.ts:1-7` + `packages/app/src/stores/draft-store.ts:1-14`
**Apply to:** `onboarding-state-store.ts`, `labs-opt-in-store.ts`, any new persistent UI state

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const APP_SETTINGS_KEY = "@ottie:app-settings";
```

_Per RESEARCH.md line 19–20: stay on AsyncStorage, do **not** introduce MMKV mid-milestone. Persistence keys follow `@ottie:<domain>` convention._

### Schema additivity (CLAUDE.md hard rule)

**Apply to:** any new fields on `agent_update` / `workspace_update` / chat-row state if pin/mute/archive lands at daemon level (RESEARCH.md "Open Questions §1")

- New fields: always `.optional()` with sensible default or `.transform()` fallback
- Never change optional → required, never remove a field, never narrow a type
- Frozen-fixture parse tests for v1.8 / v1.9 / v1.10 / v1.11 must stay green

### Lint promotion (D-20 / NAT-03)

**Source:** `tools/lint/pointer-events-web-only.ts` (existing, currently warn-level)
**Apply to:** the lint config / runner that owns severity. Promote to error before this phase ships.
_Other Phase 1 lint rules (schema-evolution, hardcoded-color, isHovered-alone) stay at warn._

---

## No Analog Found

Files where the planner should fall back to RESEARCH.md / UI-SPEC patterns rather than copy from existing code:

| File                                                     | Role                  | Data flow    | Reason                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | --------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/actions/registry.ts`                   | universal action map  | event-driven | No prior universal-dispatch registry exists. Voice has its own (`voice-commands.ts`), keyboard has its own (`keyboard-action-dispatcher.ts`) — phase 2 unifies. The two analogs above provide the **shape** of the registry, but neither IS a unified action registry. RESEARCH.md §Architecture Patterns line 264–303 has the design diagram. |
| `packages/app/src/utils/delight-toast.ts`                | one-shot system toast | event-driven | `burnt@0.13.0` is **first introduction** in the repo — no prior usage. The pattern is: read flag from `useOnboardingStateStore`, fire `burnt.alert()`, set flag. Web fallback: `sonner@2.0.7` (also new).                                                                                                                                      |
| `packages/app/src/components/chat-row-swipe-actions.tsx` | swipe gesture         | gesture      | `react-native-gesture-handler` `<Swipeable>` exists in the package, but **no current file uses it** (RESEARCH.md line 167). Net-new pattern. UI-SPEC §Spacing fixes the threshold (120px commit, 90px haptic warn). The gesture handler API is documented upstream.                                                                            |

---

## Metadata

**Analog search scope:**

- `packages/app/src/components/`
- `packages/app/src/components/ui/`
- `packages/app/src/components/settings/` (new directory)
- `packages/app/src/screens/`
- `packages/app/src/screens/settings/`
- `packages/app/src/hooks/`
- `packages/app/src/stores/`
- `packages/app/src/contexts/`
- `packages/app/src/keyboard/`
- `packages/app/src/voice-control/`
- `packages/app/src/utils/`
- `packages/app/src/styles/tokens/`
- `packages/app/src/i18n/locales/`
- `packages/app/src/app/` (Expo Router)
- `packages/app/src/constants/`

**Files scanned (Read or Grep):** 33 (full Read on 18, targeted Read on 8, Grep-only confirmation on 7)

**Pattern extraction date:** 2026-05-01

**Cross-reference:**

- CONTEXT.md decisions D-01 through D-21 — every file above is traceable to at least one D-NN decision
- UI-SPEC §Component Inventory (lines 264–283) — each new component listed there has a row in the File Classification table above
- RESEARCH.md §Recommended Project Structure (lines 308–337) — the directory layout matches

---

## PATTERN MAPPING COMPLETE
