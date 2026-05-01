---
phase: 02-onboarding-navigation-settings-theme-native-feel-polish
plan: 02c
type: execute
wave: 2
depends_on: [02a]
files_modified:
  - packages/app/src/stores/chat-row-state-store.ts
  - packages/app/src/stores/chat-row-state-store.test.ts
  - packages/app/src/components/unread-badge.tsx
  - packages/app/src/components/chat-row.tsx
  - packages/app/src/components/chat-row-context-menu.tsx
  - packages/app/src/components/chat-row-context-menu.web.tsx
  - packages/app/src/components/chat-row-context-menu.native.tsx
  - packages/app/src/components/chat-row-swipe-actions.tsx
  - packages/app/src/components/chat-row-hover-actions.web.tsx
  - packages/app/src/components/top-right-add-menu.tsx
  - packages/app/src/components/total-unread-popup.tsx
  - packages/app/src/components/splash-overlay.tsx
  - packages/app/src/screens/sessions-screen.tsx
  - packages/app/src/components/sidebar-workspace-list.tsx
  - packages/app/src/actions/chat-row-actions.ts
  # NAV-A2 sidebar auto-collapse on compact (B2 — closes checker)
  - packages/app/src/app/_layout.tsx
  - packages/app/src/stores/panel-store.ts
  - packages/app/src/stores/panel-store.test.ts
  - packages/app/src/i18n/locales/en.json
  - packages/app/src/i18n/locales/zh.json
autonomous: true
requirements: [NAV-A1, NAV-A2, NAV-A5]
tags: [phase-02, chats, navigation, chat-row]
must_haves:
  truths:
    - "Chats list renders <ChatRow> items with unread/muted/pinned state via token-driven theme variants"
    - "Long-press on mobile / right-click on web opens an 8-item context menu; each item dispatches via actionRegistry"
    - "Swipe-left on native reveals 3 quick actions (mark-read / mute / delete); reanimated useAnimatedReaction observes dragX.value and fires light haptic at SWIPE_LIGHT_THRESHOLD=90px and heavy haptic at SWIPE_HEAVY_THRESHOLD=120px (B5 — exact-literal constants); release past threshold = immediate delete + undo toast"
    - "Web hover quick-actions render via isHovered || isCompact pattern (no isHovered alone)"
    - "Top-right + menu has 4 items (newChat / scanToPair / joinHost / createWorkspace) all dispatching via actionRegistry"
    - "Cold-open splash mounts <TotalUnreadPopup> for 1.5s when total unread > 0; module-flag prevents re-fire on subsequent route changes"
    - "Workspace tap in sidebar = immediate switch (D-07 — no two-tap workspace-then-confirm)"
    - "Pin/mute/unread state is client-only (Zustand+AsyncStorage) per CONTEXT Q1 — NO daemon schema change in this plan"
    - "Sidebar overlay auto-collapses when form factor flips to compact (NAV-A2): _layout.tsx wires useIsCompactFormFactor() effect that calls panel-store.collapseOverlayOnCompact() (B2 — closes checker)"
  artifacts:
    - path: "packages/app/src/stores/chat-row-state-store.ts"
      provides: "Per-agent client-only pin/mute/unread/archived state, AsyncStorage-persisted"
      exports: ["useChatRowStateStore"]
    - path: "packages/app/src/components/chat-row.tsx"
      provides: "Single chat row with long-press / right-click / swipe / hover hooks"
    - path: "packages/app/src/components/chat-row-context-menu.{web,native}.tsx"
      provides: "8-item context menu (Metro split — anchored on web, bottom-sheet on native)"
    - path: "packages/app/src/components/chat-row-swipe-actions.tsx"
      provides: "Native swipe-left action group via react-native-gesture-handler Swipeable"
    - path: "packages/app/src/components/chat-row-hover-actions.web.tsx"
      provides: "Web-only hover quick-actions (visible on isHovered || isCompact)"
    - path: "packages/app/src/components/top-right-add-menu.tsx"
      provides: "4-item + menu anchored at chats screen header"
    - path: "packages/app/src/components/total-unread-popup.tsx"
      provides: "Cold-open total-unread WeChat-style popup with module-scoped one-shot flag"
    - path: "packages/app/src/actions/chat-row-actions.ts"
      provides: "Registers chat-row + add-menu ActionIds with handlers"
  key_links:
    - from: "packages/app/src/components/chat-row.tsx"
      to: "packages/app/src/components/chat-row-context-menu.tsx"
      via: "Long-press / right-click trigger"
      pattern: "ChatRowContextMenu"
    - from: "packages/app/src/components/chat-row.tsx"
      to: "packages/app/src/hooks/use-haptic.ts"
      via: "useHaptic().fire('medium') on context-menu open"
      pattern: "fire\\(\"medium\"\\)"
    - from: "packages/app/src/components/chat-row-context-menu.web.tsx"
      to: "packages/app/src/actions/registry.ts"
      via: "actionRegistry.dispatch on menu item select"
      pattern: "actionRegistry.dispatch"
    - from: "packages/app/src/screens/sessions-screen.tsx"
      to: "packages/app/src/components/chat-row.tsx"
      via: "Renders ChatRow per agent"
      pattern: "<ChatRow"
    - from: "packages/app/src/components/splash-overlay.tsx"
      to: "packages/app/src/components/total-unread-popup.tsx"
      via: "Mounts after splash dismiss when totalUnread > 0"
      pattern: "TotalUnreadPopup"
    - from: "packages/app/src/components/sidebar-workspace-list.tsx"
      to: "packages/app/src/hooks/use-haptic.ts"
      via: "Replaces 3 inline Haptics.* call sites with useHaptic().fire(...)"
      pattern: "useHaptic"
    - from: "packages/app/src/app/_layout.tsx"
      to: "packages/app/src/stores/panel-store.ts"
      via: "useEffect on useIsCompactFormFactor() flip → panel-store.collapseOverlayOnCompact() (NAV-A2 / B2)"
      pattern: "collapseOverlayOnCompact"
---

<objective>
Reshape the existing `sessions-screen.tsx` into the WeChat-style Chats tab. Build the row primitives (`<ChatRow>`, `<UnreadBadge>`, context menu Metro split, swipe actions, hover actions, top-right `+` menu, total-unread popup), the client-only pin/mute/unread store (CONTEXT Q1 → client-only, no daemon schema change), and register the 8 chat-row context-menu + 4 add-menu actions in the registry. Sidebar workspace tap-to-switch (D-07) is wired as part of this plan since it shares the haptic seam.

Purpose: This is the heaviest lift of Phase 02 — the Chats tab is "THE primary surface" (D-03). Without the WeChat interaction model, the milestone goal of "feels as immediate, trustworthy, and native as using the editor on your desktop" doesn't land.

Output: 1 new client-only Zustand+AsyncStorage store, 9 new component files (chat-row + supporting parts + total-unread popup + add-menu), 1 modified screen (sessions-screen.tsx), 2 modified components (splash-overlay, sidebar-workspace-list), 1 new actions module that registers chat-row + add-menu ActionIds, en+zh strings for the full chat.menu._ + chat.add._ + chat.swipe._ + chat.unread._ + chat.empty.\* vocabulary from UI-SPEC §Copywriting Contract.
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
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02a-action-registry-SUMMARY.md
@CLAUDE.md

<interfaces>
<!-- ActionRegistry from Plan 02a -->
<!-- Source: packages/app/src/actions/registry.ts -->

```typescript
export function defineAction<T>(
  id: ActionId,
  config: { description; modalities; schema; handler },
): Action<T>;
export const actionRegistry: { register; getActionById; searchActions; dispatch; list };
```

<!-- ActionId union from Plan 02a includes the 8 chat-row + 4 add-menu IDs -->
<!-- Source: packages/app/src/actions/ids.ts -->

```typescript
export type ActionId = ... | "chat.menu.pin" | "chat.menu.unpin" | "chat.menu.markUnread"
  | "chat.menu.markRead" | "chat.menu.mute" | "chat.menu.unmute" | "chat.menu.delete"
  | "chat.menu.rename" | "chat.menu.archive" | "chat.add.newChat"
  | "chat.add.scanToPair" | "chat.add.joinHost" | "chat.add.createWorkspace";
```

<!-- useHaptic from Plan 02a -->
<!-- Source: packages/app/src/hooks/use-haptic.ts -->

```typescript
export function useHaptic(input: { enabled: boolean; isLowPowerMode: boolean }): {
  fire(event: "light" | "medium" | "heavy"): void;
};
```

<!-- Existing aggregated agent type (chat-row data source) -->
<!-- Source: packages/app/src/hooks/use-aggregated-agents.ts -->

```typescript
export type AggregatedAgent = { id: string; title: string; preview: string; serverId: string; lastActivityAt: number; ... };
```

<!-- Existing useAgentHistory hook (sessions list pagination — already plumbed) -->
<!-- Source: packages/app/src/hooks/use-agent-history.ts -->

```typescript
export function useAgentHistory(input: { serverId: string }): {
  agents: AggregatedAgent[];
  hasMore: boolean;
  isInitialLoad: boolean;
  isLoadingMore: boolean;
  isRevalidating: boolean;
  loadMore(): void;
  refreshAll(): void;
};
```

<!-- Existing GlassSurface primitive -->
<!-- Source: packages/app/src/components/ui/glass-surface.tsx -->

```typescript
export function GlassSurface(props: { children; radius?: "none"|"card"|"sheet"|"pill"|"button"; ... }): JSX.Element;
```

<!-- Existing IsolatedBottomSheetModal (native context menu wraps this) -->
<!-- Source: packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx -->

```typescript
export function IsolatedBottomSheetModal(props): JSX.Element;
```

<!-- Existing Swipeable from gesture-handler (no current usage in repo — net-new) -->

```typescript
import { Swipeable } from "react-native-gesture-handler"; // ~2.28.0 already installed
```

<!-- Existing Splash overlay (extend mount) -->
<!-- Source: packages/app/src/components/splash-overlay.tsx:14-60 -->

```typescript
let hasShown = false; // module-scoped one-shot
export function SplashOverlay(): JSX.Element | null;
```

<!-- Existing AgentList consumer (REPLACE in sessions-screen) -->
<!-- Source: packages/app/src/components/agent-list.tsx -->

```typescript
export function AgentList(props: { agents; isRefreshing; onRefresh; listFooterComponent; ... }): JSX.Element;
```

<!-- Existing sidebar workspace list (Haptics.* refactor target) -->
<!-- Source: packages/app/src/components/sidebar-workspace-list.tsx:1050-1095 -->

```typescript
import * as Haptics from "expo-haptics"; // line 13 — to be replaced
// line 1053: void Haptics.selectionAsync().catch(() => {});
// line 1076: void Haptics.selectionAsync().catch(() => {});
// line 1089: void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
```

<!-- Existing workspace navigation helpers -->
<!-- Source: packages/app/src/utils/workspace-navigation.ts + utils/host-routes.ts -->

```typescript
export function buildHostWorkspaceRoute(serverId: string, workspaceId: string): string;
export function prepareWorkspaceTab(...): void;
```

</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create client-only ChatRowStateStore (pin/mute/unread/archived per agent) + UnreadBadge component + register chat-row + add-menu ActionIds</name>
  <files>
    packages/app/src/stores/chat-row-state-store.ts,
    packages/app/src/stores/chat-row-state-store.test.ts,
    packages/app/src/components/unread-badge.tsx,
    packages/app/src/actions/chat-row-actions.ts,
    packages/app/src/i18n/locales/en.json,
    packages/app/src/i18n/locales/zh.json
  </files>
  <read_first>
    - packages/app/src/stores/draft-store.ts (analog: zustand persist + AsyncStorage; PATTERNS lines 568-621)
    - packages/app/src/components/agent-status-dot.tsx (analog for UnreadBadge — token-driven small status pill)
    - packages/app/src/actions/registry.ts (Plan 02a — defineAction + actionRegistry)
    - packages/app/src/actions/ids.ts (Plan 02a — chat.menu.* + chat.add.* IDs already in union)
    - packages/app/src/voice-control/voice-commands.ts (analog: defineCommand registration shape, lines 294-321)
    - packages/app/src/hooks/use-aggregated-agents.ts (AggregatedAgent type)
    - packages/app/src/i18n/locales/en.json (existing structure for chat.* keys)
    - packages/app/src/i18n/locales/zh.json
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md Q1 (client-only state recommendation)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Copywriting Contract" lines 175-191 (chat.menu.* + chat.add.* + chat.swipe.* + chat.unread.totalPopup)
  </read_first>
  <behavior>
    Test 1 (chat-row-state-store.test): Initial getRowState("agent-1") returns { pinned:false, muted:false, unread:0, archived:false }
    Test 2: setPinned("agent-1", true) updates pinned to true; reading reflects update
    Test 3: incrementUnread("agent-1") adds 1; markRead("agent-1") clears to 0
    Test 4: state persists to AsyncStorage at key "@ottie:chat-row-state"
    Test 5: getPinnedAgentIds() returns IDs sorted by pinnedAt desc
    Test 6 (chat-row-actions.ts smoke): after import, actionRegistry has all 8 chat.menu.* + 4 chat.add.* IDs registered
    Test 7 (chat-row-actions.ts): actionRegistry.dispatch("chat.menu.pin", { agentId: "x" }) calls setPinned("x", true)
    Test 8 (UnreadBadge smoke via typecheck): renders nothing when count=0; renders count when > 0; uses tabular-nums fontVariant; muted prop changes color token
  </behavior>
  <action>
    Step 1 — Add UI-SPEC §Copywriting Contract chat.* keys to en.json. Locate the existing `chat.*` keys (or create a new `chat` group) and insert in alphabetical order:

    ```json
    "chat.menu.pin": "Pin to top",
    "chat.menu.unpin": "Unpin",
    "chat.menu.markUnread": "Mark as unread",
    "chat.menu.markRead": "Mark as read",
    "chat.menu.mute": "Mute",
    "chat.menu.unmute": "Unmute",
    "chat.menu.delete": "Delete",
    "chat.menu.rename": "Rename",
    "chat.menu.archive": "Archive",
    "chat.add.newChat": "New chat",
    "chat.add.scanToPair": "Scan to pair",
    "chat.add.joinHost": "Join host",
    "chat.add.createWorkspace": "Create workspace",
    "chat.swipe.markRead": "Read",
    "chat.swipe.mute": "Mute",
    "chat.swipe.delete": "Delete",
    "chat.unread.totalPopup": "{{count}} unread messages",
    "chat.empty.firstTime.heading": "Your first agent is one tap away",
    "chat.empty.firstTime.body": "Tap + above to start a new chat with Claude, Codex, or OpenCode.",
    "chat.empty.heading": "No chats yet",
    "chat.empty.body": "Tap + to start a new conversation.",
    "chat.deleted.toast": "Chat deleted",
    "chat.deleted.undo": "Undo",
    "chat.delete.modalTitle": "Delete this chat?",
    "chat.delete.modalBody": "Messages and pending tool calls will be removed. This can't be undone.",
    "chat.delete.confirm": "Delete"
    ```

    Matching zh.json:

    ```json
    "chat.menu.pin": "置顶",
    "chat.menu.unpin": "取消置顶",
    "chat.menu.markUnread": "标记未读",
    "chat.menu.markRead": "标记已读",
    "chat.menu.mute": "静音",
    "chat.menu.unmute": "取消静音",
    "chat.menu.delete": "删除",
    "chat.menu.rename": "重命名",
    "chat.menu.archive": "归档",
    "chat.add.newChat": "新建",
    "chat.add.scanToPair": "扫一扫配对",
    "chat.add.joinHost": "加入 host",
    "chat.add.createWorkspace": "创建 workspace",
    "chat.swipe.markRead": "已读",
    "chat.swipe.mute": "静音",
    "chat.swipe.delete": "删除",
    "chat.unread.totalPopup": "{{count}} 条未读",
    "chat.empty.firstTime.heading": "一键开启首位 agent",
    "chat.empty.firstTime.body": "点击右上角 + 新建一个 chat — 支持 Claude、Codex、OpenCode。",
    "chat.empty.heading": "暂无 chat",
    "chat.empty.body": "点击 + 开始新对话。",
    "chat.deleted.toast": "已删除",
    "chat.deleted.undo": "撤销",
    "chat.delete.modalTitle": "删除该对话？",
    "chat.delete.modalBody": "对话与待处理工具调用将被移除，无法恢复。",
    "chat.delete.confirm": "删除"
    ```

    Step 2 — Create `packages/app/src/stores/chat-row-state-store.ts`:

    ```typescript
    import { create } from "zustand";
    import { createJSONStorage, persist } from "zustand/middleware";
    import AsyncStorage from "@react-native-async-storage/async-storage";

    export const CHAT_ROW_STATE_STORAGE_KEY = "@ottie:chat-row-state";
    const CHAT_ROW_STORE_VERSION = 1;

    interface ChatRowState {
      pinned: boolean;
      pinnedAt: number | null;
      muted: boolean;
      unread: number;
      archived: boolean;
    }

    interface ChatRowStoreState {
      rows: Record<string, ChatRowState>; // keyed by `${serverId}:${agentId}`
    }

    interface ChatRowStoreActions {
      getRowState(rowKey: string): ChatRowState;
      setPinned(rowKey: string, pinned: boolean): void;
      setMuted(rowKey: string, muted: boolean): void;
      setUnread(rowKey: string, count: number): void;
      incrementUnread(rowKey: string): void;
      markRead(rowKey: string): void;
      setArchived(rowKey: string, archived: boolean): void;
      remove(rowKey: string): void;
      getPinnedRowKeys(): string[];
    }

    const DEFAULT: ChatRowState = { pinned: false, pinnedAt: null, muted: false, unread: 0, archived: false };

    export function makeRowKey(serverId: string, agentId: string): string {
      return `${serverId}:${agentId}`;
    }

    export const useChatRowStateStore = create<ChatRowStoreState & ChatRowStoreActions>()(
      persist(
        (set, get) => ({
          rows: {},
          getRowState: (k) => get().rows[k] ?? DEFAULT,
          setPinned: (k, pinned) => set((s) => ({ rows: { ...s.rows, [k]: { ...(s.rows[k] ?? DEFAULT), pinned, pinnedAt: pinned ? Date.now() : null } } })),
          setMuted: (k, muted) => set((s) => ({ rows: { ...s.rows, [k]: { ...(s.rows[k] ?? DEFAULT), muted } } })),
          setUnread: (k, count) => set((s) => ({ rows: { ...s.rows, [k]: { ...(s.rows[k] ?? DEFAULT), unread: Math.max(0, count) } } })),
          incrementUnread: (k) => set((s) => { const r = s.rows[k] ?? DEFAULT; return { rows: { ...s.rows, [k]: { ...r, unread: r.unread + 1 } } }; }),
          markRead: (k) => set((s) => ({ rows: { ...s.rows, [k]: { ...(s.rows[k] ?? DEFAULT), unread: 0 } } })),
          setArchived: (k, archived) => set((s) => ({ rows: { ...s.rows, [k]: { ...(s.rows[k] ?? DEFAULT), archived } } })),
          remove: (k) => set((s) => { const { [k]: _, ...rest } = s.rows; return { rows: rest }; }),
          getPinnedRowKeys: () => {
            const rows = get().rows;
            return Object.entries(rows)
              .filter(([_, v]) => v.pinned)
              .sort(([_a, a], [_b, b]) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
              .map(([k]) => k);
          },
        }),
        {
          name: CHAT_ROW_STATE_STORAGE_KEY,
          storage: createJSONStorage(() => AsyncStorage),
          version: CHAT_ROW_STORE_VERSION,
        },
      ),
    );
    ```

    Step 3 — Create `packages/app/src/stores/chat-row-state-store.test.ts` covering Tests 1-5.

    Step 4 — Create `packages/app/src/components/unread-badge.tsx`:

    ```typescript
    import { Text, View } from "react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";

    export interface UnreadBadgeProps { count: number; muted?: boolean; testID?: string }

    export function UnreadBadge({ count, muted, testID }: UnreadBadgeProps) {
      if (count <= 0) return null;
      const { theme } = useUnistyles();
      const display = count > 99 ? "99+" : String(count);
      return (
        <View
          testID={testID}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.container, { backgroundColor: muted ? theme.colors.borderSubtle : theme.colors.statusDestructive ?? theme.colors.danger }]}
        >
          <Text style={[styles.text, { color: muted ? theme.colors.foregroundMuted : theme.colors.surfaceBackground }]}>
            {display}
          </Text>
        </View>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      container: {
        minWidth: 18,
        height: 18,
        paddingHorizontal: theme.spacing[1.5],
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
      },
      text: {
        fontSize: theme.fontSize.xs,
        fontWeight: theme.fontWeight.semibold,
        fontVariant: ["tabular-nums"],
      },
    }));
    ```

    Adjust theme token names to the actual semantic.{light,dark}.ts shape (read tokens to confirm `statusDestructive` / `borderSubtle` / `surfaceBackground` paths). UI-SPEC line 267 specifies tabular-nums + Caption role (xs / 600).

    Step 5 — Create `packages/app/src/actions/chat-row-actions.ts` that registers chat-row + add-menu actions:

    ```typescript
    import { z } from "zod";
    import { router } from "expo-router";
    import { actionRegistry, defineAction } from "@/actions/registry";
    import { useChatRowStateStore, makeRowKey } from "@/stores/chat-row-state-store";
    import { buildHostSessionsRoute } from "@/utils/host-routes";

    const RowKeyPayload = z.object({ serverId: z.string(), agentId: z.string() });
    const NoArgs = z.object({}).optional().default({});

    function row(serverId: string, agentId: string) { return makeRowKey(serverId, agentId); }

    actionRegistry.register(defineAction("chat.menu.pin", {
      description: "Pin chat row to top",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      handler: ({ serverId, agentId }) => useChatRowStateStore.getState().setPinned(row(serverId, agentId), true),
    }));
    actionRegistry.register(defineAction("chat.menu.unpin", {
      description: "Unpin chat row",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      handler: ({ serverId, agentId }) => useChatRowStateStore.getState().setPinned(row(serverId, agentId), false),
    }));
    actionRegistry.register(defineAction("chat.menu.markUnread", {
      description: "Mark chat as unread",
      modalities: ["menu", "cmdk", "gesture"],
      schema: RowKeyPayload,
      handler: ({ serverId, agentId }) => useChatRowStateStore.getState().setUnread(row(serverId, agentId), 1),
    }));
    actionRegistry.register(defineAction("chat.menu.markRead", {
      description: "Mark chat as read",
      modalities: ["menu", "cmdk", "gesture"],
      schema: RowKeyPayload,
      handler: ({ serverId, agentId }) => useChatRowStateStore.getState().markRead(row(serverId, agentId)),
    }));
    actionRegistry.register(defineAction("chat.menu.mute", {
      description: "Mute chat notifications",
      modalities: ["menu", "cmdk", "gesture"],
      schema: RowKeyPayload,
      handler: ({ serverId, agentId }) => useChatRowStateStore.getState().setMuted(row(serverId, agentId), true),
    }));
    actionRegistry.register(defineAction("chat.menu.unmute", {
      description: "Unmute chat notifications",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      handler: ({ serverId, agentId }) => useChatRowStateStore.getState().setMuted(row(serverId, agentId), false),
    }));
    actionRegistry.register(defineAction("chat.menu.delete", {
      description: "Delete chat",
      modalities: ["menu", "gesture"],
      schema: RowKeyPayload,
      // Note: full delete flow including undo toast is wired in the row component;
      // this handler emits the intent — the consumer (chat-row.tsx) listens via store
      handler: ({ serverId, agentId }) => useChatRowStateStore.getState().remove(row(serverId, agentId)),
    }));
    actionRegistry.register(defineAction("chat.menu.rename", {
      description: "Rename chat",
      modalities: ["menu"],
      schema: RowKeyPayload,
      handler: () => { /* opens rename modal — wired by sessions-screen */ },
    }));
    actionRegistry.register(defineAction("chat.menu.archive", {
      description: "Archive chat",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      handler: ({ serverId, agentId }) => useChatRowStateStore.getState().setArchived(row(serverId, agentId), true),
    }));
    actionRegistry.register(defineAction("chat.add.newChat", {
      description: "Create new chat",
      modalities: ["menu", "cmdk", "voice", "kbd"],
      schema: z.object({ serverId: z.string().optional() }),
      handler: () => { /* delegates to existing agent-create flow — wired by sessions-screen */ },
    }));
    actionRegistry.register(defineAction("chat.add.scanToPair", {
      description: "Scan QR code to pair host",
      modalities: ["menu", "cmdk"],
      schema: NoArgs,
      handler: () => { router.push("/pair-scan"); },
    }));
    actionRegistry.register(defineAction("chat.add.joinHost", {
      description: "Join existing host",
      modalities: ["menu", "cmdk"],
      schema: NoArgs,
      handler: () => { /* opens host-join modal */ },
    }));
    actionRegistry.register(defineAction("chat.add.createWorkspace", {
      description: "Create new workspace",
      modalities: ["menu", "cmdk", "voice"],
      schema: z.object({ serverId: z.string().optional() }),
      handler: () => { /* opens workspace-setup-dialog */ },
    }));
    ```

    Add an import of this module from `packages/app/src/voice-control/voice-commands.ts` (top of file, side-effect import) so the registrations happen at app boot:

    ```typescript
    import "@/actions/chat-row-actions"; // side-effect: registers chat-row + add-menu ActionIds
    ```

    Step 6 — Run `npm run format -- packages/app/src/stores/chat-row-state-store.ts packages/app/src/components/unread-badge.tsx packages/app/src/actions/chat-row-actions.ts packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "@ottie:chat-row-state" packages/app/src/stores/chat-row-state-store.ts && \
      grep -q "useChatRowStateStore" packages/app/src/stores/chat-row-state-store.ts && \
      grep -q "fontVariant: \\[\"tabular-nums\"\\]" packages/app/src/components/unread-badge.tsx && \
      grep -q "actionRegistry.register" packages/app/src/actions/chat-row-actions.ts && \
      grep -c "actionRegistry.register" packages/app/src/actions/chat-row-actions.ts | awk '{ if ($1 < 13) exit 1 }' && \
      grep -q "\"chat.menu.pin\":" packages/app/src/i18n/locales/en.json && \
      grep -q "\"chat.add.newChat\":" packages/app/src/i18n/locales/en.json && \
      grep -q "\"chat.menu.pin\":" packages/app/src/i18n/locales/zh.json && \
      grep -q "置顶" packages/app/src/i18n/locales/zh.json && \
      grep -q "新建" packages/app/src/i18n/locales/zh.json && \
      grep -q "import \"@/actions/chat-row-actions\"" packages/app/src/voice-control/voice-commands.ts && \
      npx vitest run packages/app/src/stores/chat-row-state-store.test.ts --bail=1 && \
      npm run typecheck && \
      npm run lint -- packages/app/src/stores/chat-row-state-store.ts packages/app/src/components/unread-badge.tsx packages/app/src/actions/chat-row-actions.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "@ottie:chat-row-state" packages/app/src/stores/chat-row-state-store.ts` returns 1
    - `grep -c "useChatRowStateStore" packages/app/src/stores/chat-row-state-store.ts` returns ≥1
    - `grep -c "actionRegistry.register" packages/app/src/actions/chat-row-actions.ts` returns ≥13 (8 chat.menu + 4 chat.add + 1 fallback for unmute/unpin = 13 total)
    - All 8 chat.menu.* IDs registered: `for id in pin unpin markUnread markRead mute unmute delete rename archive; do grep -q "chat.menu.$id" packages/app/src/actions/chat-row-actions.ts; done` exits 0
    - All 4 chat.add.* IDs registered: `for id in newChat scanToPair joinHost createWorkspace; do grep -q "chat.add.$id" packages/app/src/actions/chat-row-actions.ts; done` exits 0
    - `grep -c "fontVariant" packages/app/src/components/unread-badge.tsx` returns 1
    - `grep -c "tabular-nums" packages/app/src/components/unread-badge.tsx` returns 1
    - en.json contains all 8 chat.menu.* + 4 chat.add.* + 3 chat.swipe.* + chat.unread.totalPopup + chat.empty.* + chat.delete.* + chat.deleted.* keys
    - zh.json contains parity (chinese values for all)
    - `grep -q "import \"@/actions/chat-row-actions\"" packages/app/src/voice-control/voice-commands.ts` exits 0
    - `npx vitest run packages/app/src/stores/chat-row-state-store.test.ts --bail=1` exits 0
    - `npm run typecheck` exits 0
    - Lint passes for all 3 new files
  </acceptance_criteria>
  <done>Client-only ChatRowStateStore + UnreadBadge + 13 ActionIds registered; en+zh parity for full chat.* vocabulary</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build ChatRow component + context-menu (Metro split web/native) + swipe actions + hover actions + top-right + menu + total-unread popup</name>
  <files>
    packages/app/src/components/chat-row.tsx,
    packages/app/src/components/chat-row-context-menu.tsx,
    packages/app/src/components/chat-row-context-menu.web.tsx,
    packages/app/src/components/chat-row-context-menu.native.tsx,
    packages/app/src/components/chat-row-swipe-actions.tsx,
    packages/app/src/components/chat-row-hover-actions.web.tsx,
    packages/app/src/components/top-right-add-menu.tsx,
    packages/app/src/components/total-unread-popup.tsx
  </files>
  <read_first>
    - packages/app/src/components/agent-list.tsx (analog: FlatList row, AggregatedAgent rendering, lines 1-27 imports + render fn)
    - packages/app/src/components/sidebar-workspace-list.tsx lines 1001-1095 (analog: long-press timer + anchored menu pattern)
    - packages/app/src/components/draggable-list.tsx (analog: Metro split shim, lines 1-7)
    - packages/app/src/components/ui/context-menu.tsx (analog: dropdown vs sheet branching)
    - packages/app/src/components/ui/dropdown-menu.tsx (analog: web anchored menu, lines 30-46)
    - packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx (native sheet host, PATTERNS lines 322-330)
    - packages/app/src/components/splash-overlay.tsx lines 14-60 (analog: module-scoped one-shot flag)
    - packages/app/src/components/ui/glass-surface.tsx (radius="card"/"sheet"/"pill" variants)
    - packages/app/src/components/agent-status-dot.tsx (analog for status dot embedded in chat row)
    - packages/app/src/components/message.tsx line 1640 (Phase 1 isHovered || isNative || isCompact pattern)
    - packages/app/src/hooks/use-haptic.ts (Plan 02a — fire("medium"/"heavy"))
    - packages/app/src/components/unread-badge.tsx (Task 1 sibling)
    - packages/app/src/stores/chat-row-state-store.ts (Task 1 sibling)
    - packages/app/src/actions/registry.ts (dispatch entry point)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Component Inventory" lines 264-283 + "Interaction Contract" lines 309-323 + "Spacing Scale" exceptions (44px touch / 120px swipe / 90px haptic)
  </read_first>
  <behavior>
    Test 1 (smoke via typecheck): chat-row.tsx imports useHaptic + actionRegistry + UnreadBadge + useChatRowStateStore
    Test 2: Metro shim chat-row-context-menu.tsx re-exports `* from "./chat-row-context-menu.native"` (Metro picks .web on web bundle)
    Test 3: Native context menu uses IsolatedBottomSheetModal; Web context menu uses Modal + GlassSurface radius="sheet"
    Test 4: Swipe actions reference 90 (light haptic) and 120 (heavy) thresholds
    Test 5: total-unread-popup.tsx has module-scoped `let hasShown = false` one-shot flag
    Test 6: chat-row-hover-actions.web.tsx is web-only (lives in `.web.tsx` file extension; no .native counterpart)
  </behavior>
  <action>
    Step 1 — Create `packages/app/src/components/chat-row-context-menu.tsx` (Metro shim per PATTERNS lines 309-318):

    ```typescript
    // This file exists for TypeScript resolution.
    // Real implementations:
    // - chat-row-context-menu.web.tsx (right-click anchored menu)
    // - chat-row-context-menu.native.tsx (long-press → bottom sheet)
    export * from "./chat-row-context-menu.native";
    ```

    Step 2 — Create `packages/app/src/components/chat-row-context-menu.web.tsx` (web variant — anchored modal in <GlassSurface radius="sheet">):

    ```typescript
    import { useTranslation } from "react-i18next";
    import { Modal, View, Pressable, Text } from "react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { GlassSurface } from "@/components/ui/glass-surface";
    import { actionRegistry } from "@/actions/registry";
    import type { ActionId } from "@/actions/ids";

    export interface ChatRowContextMenuProps {
      serverId: string;
      agentId: string;
      isPinned: boolean;
      isMuted: boolean;
      anchor: { x: number; y: number } | null;
      onClose(): void;
      open: boolean;
    }

    export function ChatRowContextMenu({
      serverId, agentId, isPinned, isMuted, anchor, onClose, open,
    }: ChatRowContextMenuProps) {
      const { t } = useTranslation();
      const { theme } = useUnistyles();
      if (!open || !anchor) return null;

      const items: Array<{ id: ActionId; label: string; destructive?: boolean }> = [
        { id: isPinned ? "chat.menu.unpin" : "chat.menu.pin", label: t(isPinned ? "chat.menu.unpin" : "chat.menu.pin") },
        { id: "chat.menu.markUnread", label: t("chat.menu.markUnread") },
        { id: "chat.menu.markRead", label: t("chat.menu.markRead") },
        { id: isMuted ? "chat.menu.unmute" : "chat.menu.mute", label: t(isMuted ? "chat.menu.unmute" : "chat.menu.mute") },
        { id: "chat.menu.rename", label: t("chat.menu.rename") },
        { id: "chat.menu.archive", label: t("chat.menu.archive") },
        { id: "chat.menu.delete", label: t("chat.menu.delete"), destructive: true },
      ];

      const handleSelect = async (id: ActionId) => {
        await actionRegistry.dispatch(id, { serverId, agentId });
        onClose();
      };

      return (
        <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
          <Pressable style={{ flex: 1 }} onPress={onClose} testID="chat-row-context-menu-backdrop" />
          <View style={{ position: "absolute", left: anchor.x, top: anchor.y }}>
            <GlassSurface radius="sheet">
              <View style={styles.menu}>
                {items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => handleSelect(item.id)}
                    accessibilityRole="menuitem"
                    accessibilityLabel={item.label}
                    style={styles.item}
                  >
                    <Text style={[
                      styles.label,
                      { color: item.destructive ? theme.colors.statusDestructive ?? theme.colors.danger : theme.colors.foreground },
                    ]}>
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </GlassSurface>
          </View>
        </Modal>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      menu: { paddingVertical: theme.spacing[2], minWidth: 200 },
      item: { paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[4] },
      label: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.normal },
    }));
    ```

    Step 3 — Create `packages/app/src/components/chat-row-context-menu.native.tsx` (native — IsolatedBottomSheetModal):

    Mirror Web variant but render the items list inside a `<BottomSheetScrollView>` from `@gorhom/bottom-sheet`, hosted by `<IsolatedBottomSheetModal>` per PATTERNS lines 322-344. Same item array, same handleSelect dispatching via actionRegistry. Anchor not used on native — modal slides up.

    Step 4 — Create `packages/app/src/components/chat-row-swipe-actions.tsx` using a **reanimated-driven `useAnimatedReaction` approach (closes checker B5)**. The previous `onSwipeableWillOpen` strategy could not deliver the 90px / 120px split because gesture-handler's `Swipeable` callbacks do not expose drag-pixel offsets. Reanimated DOES expose them via `Swipeable.renderRightActions(progress, dragX)`, where `dragX` is a `SharedValue<number>` (negative on left-swipe). We observe `dragX.value` via `useAnimatedReaction` and fire haptics through `runOnJS`.

    ```typescript
    import { Pressable, Text, View } from "react-native";
    import { Swipeable } from "react-native-gesture-handler";
    import Animated, { useAnimatedReaction, useSharedValue, runOnJS } from "react-native-reanimated";
    import { useTranslation } from "react-i18next";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { useHaptic } from "@/hooks/use-haptic";
    import { actionRegistry } from "@/actions/registry";
    import { useAppSettings } from "@/hooks/use-settings";

    // UI-SPEC line 60 — exact-literal threshold constants (B5 verify gates require these strings)
    const SWIPE_LIGHT_THRESHOLD = 90;
    const SWIPE_HEAVY_THRESHOLD = 120;

    export interface ChatRowSwipeActionsProps {
      serverId: string;
      agentId: string;
      children: React.ReactNode;
      onDelete?(): void;
    }

    export function ChatRowSwipeActions({ serverId, agentId, children, onDelete }: ChatRowSwipeActionsProps) {
      const { t } = useTranslation();
      const { theme } = useUnistyles();
      const { settings } = useAppSettings();
      const haptic = useHaptic({ enabled: settings.haptics?.enabled ?? true });
      // Per-gesture debounce flags on the UI thread; reset when finger returns near origin.
      const firedLight = useSharedValue(false);
      const firedHeavy = useSharedValue(false);

      const fireLight = () => haptic.fire("light");
      const fireHeavy = () => haptic.fire("heavy");

      const renderRightActions = (
        _progress: Animated.SharedValue<number>,
        dragX: Animated.SharedValue<number>,
      ) => {
        useAnimatedReaction(
          () => Math.abs(dragX.value),
          (current) => {
            // Re-arm when finger near origin
            if (current < 10) {
              firedLight.value = false;
              firedHeavy.value = false;
              return;
            }
            if (current >= SWIPE_LIGHT_THRESHOLD && current < SWIPE_HEAVY_THRESHOLD && !firedLight.value) {
              firedLight.value = true;
              runOnJS(fireLight)();
            }
            if (current >= SWIPE_HEAVY_THRESHOLD && !firedHeavy.value) {
              firedHeavy.value = true;
              runOnJS(fireHeavy)();
            }
          },
          [],
        );

        return (
          <View style={styles.actionGroup}>
            <Pressable accessibilityLabel={t("chat.swipe.markRead")}
              style={[styles.action, { backgroundColor: theme.colors.surfaceElevated }]}
              onPress={() => actionRegistry.dispatch("chat.menu.markRead", { serverId, agentId })}>
              <Text style={styles.actionLabel}>{t("chat.swipe.markRead")}</Text>
            </Pressable>
            <Pressable accessibilityLabel={t("chat.swipe.mute")}
              style={[styles.action, { backgroundColor: theme.colors.surfaceElevated }]}
              onPress={() => actionRegistry.dispatch("chat.menu.mute", { serverId, agentId })}>
              <Text style={styles.actionLabel}>{t("chat.swipe.mute")}</Text>
            </Pressable>
            <Pressable accessibilityLabel={t("chat.swipe.delete")}
              style={[styles.action, { backgroundColor: theme.colors.statusDestructive ?? theme.colors.danger }]}
              onPress={() => { onDelete?.(); actionRegistry.dispatch("chat.menu.delete", { serverId, agentId }); }}>
              <Text style={[styles.actionLabel, { color: theme.colors.surfaceBackground }]}>{t("chat.swipe.delete")}</Text>
            </Pressable>
          </View>
        );
      };

      return (
        <Swipeable
          friction={2}
          rightThreshold={SWIPE_HEAVY_THRESHOLD}
          renderRightActions={renderRightActions}
        >
          {children}
        </Swipeable>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      actionGroup: { flexDirection: "row" },
      action: { width: 80, alignItems: "center", justifyContent: "center" },
      actionLabel: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold, color: theme.colors.foreground },
    }));
    ```

    Why this closes B5 (per checker):

    - `Swipeable.renderRightActions` exposes `dragX: SharedValue<number>` from gesture-handler's reanimated-aware path; `useAnimatedReaction` observes the abs value on the UI thread.
    - `runOnJS(fireLight/fireHeavy)()` bridges the haptic call back to the JS thread (`useHaptic` reads RN module state).
    - The two shared-value flags `firedLight` / `firedHeavy` ensure each haptic fires at most once per gesture; resetting near origin (<10px) re-arms them so subsequent swipes still trigger.
    - Constants are named `SWIPE_LIGHT_THRESHOLD = 90` and `SWIPE_HEAVY_THRESHOLD = 120` per UI-SPEC line 60. Verify gates check these exact literals.

    Peer-dep caveat:

    - `react-native-reanimated` MUST be installed and resolve to ≥3.x for `useAnimatedReaction` + `runOnJS` to work. Verify via `grep -q '"react-native-reanimated"' packages/app/package.json`. If older, escalate; do not fall back silently.
    - `react-native-gesture-handler@~2.28.0` is already pinned per CONTEXT, which exposes `dragX` as a SharedValue when reanimated is present.

    Step 5 — Create `packages/app/src/components/chat-row-hover-actions.web.tsx`:

    ```typescript
    import { Pressable, View } from "react-native";
    import { Check, Bell, Trash2 } from "lucide-react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { useTranslation } from "react-i18next";
    import { actionRegistry } from "@/actions/registry";
    import { useIsCompactFormFactor } from "@/constants/layout";

    export interface ChatRowHoverActionsProps {
      serverId: string;
      agentId: string;
      isHovered: boolean;
    }

    export function ChatRowHoverActions({ serverId, agentId, isHovered }: ChatRowHoverActionsProps) {
      const { t } = useTranslation();
      const { theme } = useUnistyles();
      const isCompact = useIsCompactFormFactor();
      // Phase 1 pattern: never `isHovered` alone. On web with non-compact layout, only show on hover.
      // On web compact, always show.
      const visible = isHovered || isCompact;
      if (!visible) return null;
      return (
        <View style={styles.group}>
          <Pressable accessibilityLabel={t("chat.menu.markRead")}
            onPress={() => actionRegistry.dispatch("chat.menu.markRead", { serverId, agentId })}>
            <Check size={16} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Pressable accessibilityLabel={t("chat.menu.mute")}
            onPress={() => actionRegistry.dispatch("chat.menu.mute", { serverId, agentId })}>
            <Bell size={16} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Pressable accessibilityLabel={t("chat.menu.delete")}
            onPress={() => actionRegistry.dispatch("chat.menu.delete", { serverId, agentId })}>
            <Trash2 size={16} color={theme.colors.statusDestructive ?? theme.colors.danger} />
          </Pressable>
        </View>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      group: { flexDirection: "row", gap: theme.spacing[2], alignItems: "center" },
    }));
    ```

    The `.web.tsx` extension means Metro doesn't bundle this on native — UI-SPEC line 270 confirms swipe-left replaces hover on native.

    Step 6 — Create `packages/app/src/components/chat-row.tsx` per PATTERNS lines 234-301. Compose the 5 sibling components above:

    Sketch (key elements):

    ```typescript
    import { Pressable, Text, View, Platform, StatusBar } from "react-native";
    import { useCallback, useRef, useState } from "react";
    import { router } from "expo-router";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { useTranslation } from "react-i18next";
    import { isWeb, isNative } from "@/constants/platform";
    import { useIsCompactFormFactor } from "@/constants/layout";
    import { useAppSettings } from "@/hooks/use-settings";
    import { useHaptic } from "@/hooks/use-haptic";
    import { useChatRowStateStore, makeRowKey } from "@/stores/chat-row-state-store";
    import { UnreadBadge } from "@/components/unread-badge";
    import { GlassSurface } from "@/components/ui/glass-surface";
    import { ChatRowContextMenu } from "@/components/chat-row-context-menu";
    import { ChatRowSwipeActions } from "@/components/chat-row-swipe-actions";
    import { AgentStatusDot } from "@/components/agent-status-dot";
    import { buildHostAgentDetailRoute } from "@/utils/host-routes";
    import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

    const LONG_PRESS_DELAY_MS = 350; // UI-SPEC line 315

    export interface ChatRowProps { agent: AggregatedAgent }

    export function ChatRow({ agent }: ChatRowProps) {
      const { t } = useTranslation();
      const { theme } = useUnistyles();
      const isCompact = useIsCompactFormFactor();
      const { settings } = useAppSettings();
      const haptic = useHaptic({ enabled: settings.haptics?.enabled ?? true, isLowPowerMode: false });
      const rowKey = makeRowKey(agent.serverId, agent.id);
      const rowState = useChatRowStateStore((s) => s.rows[rowKey]) ?? { pinned: false, muted: false, unread: 0, archived: false };
      const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
      const [hovered, setHovered] = useState(false);

      const openContextMenu = useCallback((x: number, y: number) => {
        haptic.fire("medium");
        setMenuAnchor({ x, y });
      }, [haptic]);

      const handlePress = useCallback(() => {
        router.push(buildHostAgentDetailRoute(agent.serverId, agent.id));
      }, [agent.serverId, agent.id]);

      const rowContent = (
        <Pressable
          onPress={handlePress}
          onLongPress={isNative ? (e) => openContextMenu(e.nativeEvent.pageX, e.nativeEvent.pageY) : undefined}
          delayLongPress={LONG_PRESS_DELAY_MS}
          {...(isWeb ? {
            onPointerEnter: () => setHovered(true),
            onPointerLeave: () => setHovered(false),
            onContextMenu: (e: any) => { e.preventDefault?.(); openContextMenu(e.clientX ?? 0, e.clientY ?? 0); },
          } : {})}
          style={[
            styles.row,
            rowState.pinned && { backgroundColor: theme.colors.surfaceElevated, borderLeftColor: theme.colors.accentBase, borderLeftWidth: 2 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${agent.title}, ${rowState.unread > 0 ? `${rowState.unread} unread` : "no unread"}`}
        >
          <AgentStatusDot agent={agent} />
          <View style={styles.body}>
            <Text style={[styles.title, rowState.unread > 0 && styles.titleEmphasized]}>{agent.title}</Text>
            <Text style={styles.preview}>{agent.preview}</Text>
          </View>
          <UnreadBadge count={rowState.unread} muted={rowState.muted} />
          {/* hover quick-actions: web-only; on native, swipe replaces hover (UI-SPEC line 270) */}
        </Pressable>
      );

      const wrapped = isNative ? (
        <ChatRowSwipeActions serverId={agent.serverId} agentId={agent.id}>{rowContent}</ChatRowSwipeActions>
      ) : rowContent;

      return (
        <View>
          {wrapped}
          {isWeb && (/* hover-actions overlay positioned absolute */
            // import dynamically gated by isWeb: see chat-row-hover-actions.web.tsx
            null
          )}
          <ChatRowContextMenu
            serverId={agent.serverId}
            agentId={agent.id}
            isPinned={rowState.pinned}
            isMuted={rowState.muted}
            anchor={menuAnchor}
            open={menuAnchor != null}
            onClose={() => setMenuAnchor(null)}
          />
        </View>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      row: {
        flexDirection: "row", alignItems: "center", gap: theme.spacing[3],
        paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[4],
        minHeight: 56, // UI-SPEC touch target ≥44px met via padding + intrinsic
      },
      body: { flex: 1 },
      title: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.normal, color: theme.colors.foreground },
      titleEmphasized: { fontWeight: theme.fontWeight.semibold },
      preview: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.normal, color: theme.colors.foregroundMuted },
    }));
    ```

    NOTE on isWeb pointer events: per CLAUDE.md NAT-03 / Plan 02e D-20, `onPointerEnter`/`onPointerLeave` are forbidden outside `.web.tsx` files. Since `chat-row.tsx` is shared, gate behind `isWeb` AND keep these props inline only for the small spread block as shown — the lint rule (when promoted to error in Plan 02e) checks raw usage. If lint fires, extract the hover wiring into `chat-row-hover-actions.web.tsx` Pressable wrapper and import it dynamically:

    ```typescript
    // Cross-platform safe alternative — use the dedicated .web.tsx hover-actions component
    // and let chat-row.tsx never use onPointerEnter/Leave directly. The hover-actions
    // component owns pointer state and renders its own absolute-positioned overlay.
    ```

    **PREFERRED implementation:** keep `chat-row.tsx` free of `onPointerEnter`/`onPointerLeave`. Move all hover wiring (state + event handlers) into `chat-row-hover-actions.web.tsx`, which handles its own absolute overlay anchored to a parent ref. The chat-row.tsx file uses `Pressable` with `onLongPress` only on native, and standard `onPress` cross-platform. Right-click on web is captured by a small `.web.tsx` shim or the hover-actions component itself listens for `contextmenu` and bubbles up via callback prop.

    Refactor sketch:

    - `chat-row-hover-actions.web.tsx` exports `<ChatRowHoverActionsHost>` that wraps children in a `<View>` with `onPointerEnter/Leave` + `onContextMenu`, and renders the floating action overlay when hovered.
    - On native, render children directly (no host) — swipe-actions handles long-press separately. Either via `.native.tsx` empty shim or runtime `isNative` short-circuit.

    Step 7 — Create `packages/app/src/components/top-right-add-menu.tsx`:

    ```typescript
    import { useState, useCallback } from "react";
    import { Modal, Pressable, View, Text } from "react-native";
    import { Plus } from "lucide-react-native";
    import { useTranslation } from "react-i18next";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { GlassSurface } from "@/components/ui/glass-surface";
    import { actionRegistry } from "@/actions/registry";
    import { isNative } from "@/constants/platform";
    // For native, optionally swap Modal for IsolatedBottomSheetModal — keep cross-platform shape simple

    export interface TopRightAddMenuProps { serverId?: string; testID?: string }

    export function TopRightAddMenu({ serverId, testID }: TopRightAddMenuProps) {
      const { t } = useTranslation();
      const { theme } = useUnistyles();
      const [open, setOpen] = useState(false);
      const items = [
        { id: "chat.add.newChat" as const, label: t("chat.add.newChat") },
        { id: "chat.add.scanToPair" as const, label: t("chat.add.scanToPair") },
        { id: "chat.add.joinHost" as const, label: t("chat.add.joinHost") },
        { id: "chat.add.createWorkspace" as const, label: t("chat.add.createWorkspace") },
      ];
      const handleSelect = async (id: typeof items[number]["id"]) => {
        setOpen(false);
        await actionRegistry.dispatch(id, { serverId });
      };
      const triggerLabel = t("chat.add.newChat");
      return (
        <>
          <Pressable
            testID={testID ?? "top-right-add-trigger"}
            accessibilityLabel={triggerLabel}
            accessibilityRole="button"
            onPress={() => setOpen(true)}
            style={styles.trigger}
          >
            <Plus size={22} color={theme.colors.foreground} />
          </Pressable>
          <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
            <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
            <View style={styles.menuContainer}>
              <GlassSurface radius="sheet">
                <View style={styles.menuList}>
                  {items.map((item) => (
                    <Pressable key={item.id} accessibilityRole="menuitem" accessibilityLabel={item.label}
                      onPress={() => handleSelect(item.id)} style={styles.item}>
                      <Text style={styles.itemLabel}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </GlassSurface>
            </View>
          </Modal>
        </>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      trigger: { padding: theme.spacing[2] },
      menuContainer: { position: "absolute", top: 60, right: theme.spacing[4] },
      menuList: { paddingVertical: theme.spacing[2], minWidth: 200 },
      item: { paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[4] },
      itemLabel: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.normal, color: theme.colors.foreground },
    }));
    ```

    Step 8 — Create `packages/app/src/components/total-unread-popup.tsx` per PATTERNS lines 360-388:

    ```typescript
    import { useEffect, useState } from "react";
    import { Text, View, Animated } from "react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { useTranslation } from "react-i18next";
    import { GlassSurface } from "@/components/ui/glass-surface";

    const POPUP_DURATION_MS = 1500; // UI-SPEC line 192 / D-06
    const FADE_OUT_MS = 240;

    let hasShown = false; // module-scoped one-shot per app launch

    export interface TotalUnreadPopupProps { totalUnread: number; testID?: string }

    export function TotalUnreadPopup({ totalUnread, testID }: TotalUnreadPopupProps) {
      const { t } = useTranslation();
      const { theme } = useUnistyles();
      const [visible, setVisible] = useState(!hasShown && totalUnread > 0);
      useEffect(() => {
        if (hasShown) return;
        if (totalUnread <= 0) return;
        hasShown = true;
        const timer = setTimeout(() => setVisible(false), POPUP_DURATION_MS);
        return () => clearTimeout(timer);
      }, [totalUnread]);
      if (!visible || totalUnread <= 0) return null;
      return (
        <View testID={testID ?? "total-unread-popup"} style={styles.container} accessibilityLiveRegion="polite">
          <GlassSurface radius="pill">
            <Text style={styles.label}>
              {t("chat.unread.totalPopup", { count: totalUnread })}
            </Text>
          </GlassSurface>
        </View>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      container: { position: "absolute", top: 80, alignSelf: "center" },
      label: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.normal, color: theme.colors.foreground,
        paddingVertical: theme.spacing[2], paddingHorizontal: theme.spacing[4] },
    }));
    ```

    Step 9 — Run `npm run format -- packages/app/src/components/chat-row.tsx packages/app/src/components/chat-row-context-menu.tsx packages/app/src/components/chat-row-context-menu.web.tsx packages/app/src/components/chat-row-context-menu.native.tsx packages/app/src/components/chat-row-swipe-actions.tsx packages/app/src/components/chat-row-hover-actions.web.tsx packages/app/src/components/top-right-add-menu.tsx packages/app/src/components/total-unread-popup.tsx`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "export \\* from \"./chat-row-context-menu.native\"" packages/app/src/components/chat-row-context-menu.tsx && \
      grep -q "GlassSurface" packages/app/src/components/chat-row-context-menu.web.tsx && \
      grep -q "actionRegistry.dispatch" packages/app/src/components/chat-row-context-menu.web.tsx && \
      grep -q "BottomSheet\\|IsolatedBottomSheet" packages/app/src/components/chat-row-context-menu.native.tsx && \
      grep -q "Swipeable" packages/app/src/components/chat-row-swipe-actions.tsx && \
      grep -q "SWIPE_LIGHT_THRESHOLD = 90" packages/app/src/components/chat-row-swipe-actions.tsx && \
      grep -q "SWIPE_HEAVY_THRESHOLD = 120" packages/app/src/components/chat-row-swipe-actions.tsx && \
      grep -q "useAnimatedReaction" packages/app/src/components/chat-row-swipe-actions.tsx && \
      grep -q "runOnJS" packages/app/src/components/chat-row-swipe-actions.tsx && \
      grep -q "useHaptic" packages/app/src/components/chat-row-swipe-actions.tsx && \
      grep -q "haptic.fire" packages/app/src/components/chat-row-swipe-actions.tsx && \
      grep -q "isHovered \\|\\| isCompact" packages/app/src/components/chat-row-hover-actions.web.tsx && \
      grep -q "Plus" packages/app/src/components/top-right-add-menu.tsx && \
      grep -q "GlassSurface" packages/app/src/components/top-right-add-menu.tsx && \
      grep -q "actionRegistry.dispatch" packages/app/src/components/top-right-add-menu.tsx && \
      grep -q "let hasShown = false" packages/app/src/components/total-unread-popup.tsx && \
      grep -q "GlassSurface" packages/app/src/components/total-unread-popup.tsx && \
      grep -q "POPUP_DURATION_MS = 1500" packages/app/src/components/total-unread-popup.tsx && \
      grep -q "useChatRowStateStore" packages/app/src/components/chat-row.tsx && \
      grep -q "useHaptic" packages/app/src/components/chat-row.tsx && \
      grep -q "delayLongPress" packages/app/src/components/chat-row.tsx && \
      grep -q "UnreadBadge" packages/app/src/components/chat-row.tsx && \
      ! grep -E "onPointerEnter|onPointerLeave" packages/app/src/components/chat-row.tsx | grep -v "^#" | head -1 && \
      npm run typecheck && \
      npm run lint -- packages/app/src/components/chat-row.tsx packages/app/src/components/chat-row-context-menu.tsx packages/app/src/components/chat-row-context-menu.web.tsx packages/app/src/components/chat-row-context-menu.native.tsx packages/app/src/components/chat-row-swipe-actions.tsx packages/app/src/components/chat-row-hover-actions.web.tsx packages/app/src/components/top-right-add-menu.tsx packages/app/src/components/total-unread-popup.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - All 8 new component files exist
    - `grep -c "export \\* from" packages/app/src/components/chat-row-context-menu.tsx` returns 1 (Metro shim)
    - `grep -c "GlassSurface" packages/app/src/components/chat-row-context-menu.web.tsx` returns ≥1
    - `grep -c "BottomSheet" packages/app/src/components/chat-row-context-menu.native.tsx` returns ≥1
    - `grep -c "Swipeable" packages/app/src/components/chat-row-swipe-actions.tsx` returns ≥1
    - `grep -c "SWIPE_LIGHT_THRESHOLD = 90" packages/app/src/components/chat-row-swipe-actions.tsx` returns ≥1 (B5 — exact-literal threshold)
    - `grep -c "SWIPE_HEAVY_THRESHOLD = 120" packages/app/src/components/chat-row-swipe-actions.tsx` returns ≥1 (B5 — exact-literal threshold)
    - `grep -c "useAnimatedReaction" packages/app/src/components/chat-row-swipe-actions.tsx` returns ≥1 (B5 — reanimated-driven)
    - `grep -c "runOnJS" packages/app/src/components/chat-row-swipe-actions.tsx` returns ≥1 (UI→JS thread bridge)
    - `grep -c "haptic.fire" packages/app/src/components/chat-row-swipe-actions.tsx` returns ≥1
    - `grep -c "isHovered\\|isCompact" packages/app/src/components/chat-row-hover-actions.web.tsx` returns ≥1
    - `grep -c "Plus" packages/app/src/components/top-right-add-menu.tsx` returns ≥1
    - `grep -c "actionRegistry.dispatch" packages/app/src/components/top-right-add-menu.tsx` returns ≥1
    - `grep -c "let hasShown = false" packages/app/src/components/total-unread-popup.tsx` returns 1 (module-scoped flag)
    - `grep -c "useChatRowStateStore" packages/app/src/components/chat-row.tsx` returns ≥1
    - `grep -c "useHaptic" packages/app/src/components/chat-row.tsx` returns ≥1
    - `grep -c "UnreadBadge" packages/app/src/components/chat-row.tsx` returns ≥1
    - `grep -E "onPointerEnter|onPointerLeave" packages/app/src/components/chat-row.tsx | grep -v "^//"` returns no matches (not in shared file — only in `.web.tsx`)
    - `npm run typecheck` exits 0
    - Lint passes for all 8 files
  </acceptance_criteria>
  <done>ChatRow + 7 supporting components built; Metro split + isHovered||isCompact + 90/120 swipe + module-scoped popup flag all in place</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Reshape sessions-screen into Chats tab; mount TotalUnreadPopup via splash; refactor sidebar-workspace-list inline Haptics calls + tap-to-switch (D-07)</name>
  <files>
    packages/app/src/screens/sessions-screen.tsx,
    packages/app/src/components/splash-overlay.tsx,
    packages/app/src/components/sidebar-workspace-list.tsx
  </files>
  <read_first>
    - packages/app/src/screens/sessions-screen.tsx (FULL FILE — current shape; PATTERNS lines 798-832 — replace AgentList with ChatRow collection + add TopRightAddMenu + first-time empty branch)
    - packages/app/src/components/splash-overlay.tsx (FULL FILE — extend module-flag flow to mount TotalUnreadPopup)
    - packages/app/src/components/sidebar-workspace-list.tsx lines 1-100 + lines 1000-1095 (existing tap handler + 3 Haptics call sites at 1053/1076/1089)
    - packages/app/src/stores/session-store.ts (totalUnread aggregator — verify export name; if not present, derive from useChatRowStateStore.rows)
    - packages/app/src/hooks/use-aggregated-agents.ts (AggregatedAgent type)
    - packages/app/src/hooks/use-agent-history.ts (existing pagination hook)
    - packages/app/src/components/chat-row.tsx (just-built sibling)
    - packages/app/src/components/top-right-add-menu.tsx (just-built sibling)
    - packages/app/src/components/total-unread-popup.tsx (just-built sibling)
    - packages/app/src/hooks/use-haptic.ts (Plan 02a — replaces 3 Haptics.* call sites)
    - packages/app/src/hooks/use-settings.ts (haptics.enabled toggle source)
    - packages/app/src/stores/onboarding-state-store.ts (Plan 02b — emptyOttiePlayedFirstChats flag)
    - packages/app/src/components/icons/ottie-logo.tsx (first-time empty Otter illustration)
    - packages/app/src/components/math-curve-loader (D-13 sanctioned top-level loader)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Visual Language" lines 357-371 + "Otter Brand Placement" lines 376-396
  </read_first>
  <behavior>
    Test 1: sessions-screen.tsx renders <ChatRow> per agent (replaces <AgentList>)
    Test 2: sessions-screen.tsx renders <TopRightAddMenu> in header
    Test 3: First-time empty (emptyOttiePlayedFirstChats=false + agents.length===0) renders OttieLogo + chat.empty.firstTime.heading; subsequent empty renders pure copy chat.empty.heading
    Test 4: sidebar-workspace-list.tsx no longer imports `expo-haptics` directly; uses useHaptic instead
    Test 5: sidebar-workspace-list.tsx tap handler invokes router.replace(buildHostWorkspaceRoute(...)) immediately on press (D-07 — no two-tap)
    Test 6: splash-overlay.tsx mounts <TotalUnreadPopup totalUnread=...> after its existing fade-out
  </behavior>
  <action>
    Step 1 — Reshape `packages/app/src/screens/sessions-screen.tsx`:

    Read the existing file. Replace the `<AgentList agents={sortedAgents}>` rendering with a list of `<ChatRow>` per `agent`, sorted with pinned rows first then by `lastActivityAt desc`.

    Add `<TopRightAddMenu serverId={serverId} />` inside the header row next to `<MenuHeader title={...}>`.

    Replace the existing initial-load `<LoadingSpinner>` with `<MathCurveLoader />` (D-13 sanctioned: chats list initial load).

    Replace the existing empty state branch:

    ```tsx
    const emptyOttiePlayed = useOnboardingStateStore((s) => s.emptyOttiePlayedFirstChats);
    const setEmptyOttiePlayed = useOnboardingStateStore((s) => s.setEmptyOttiePlayedFirstChats);
    const isFirstTime = !emptyOttiePlayed;

    {!isInitialLoad && sortedAgents.length === 0 ? (
      <View style={styles.emptyContainer}>
        {isFirstTime ? (
          <>
            <OttieLogo size={120} />
            <Text style={styles.emptyHeadingDisplay}>{t("chat.empty.firstTime.heading")}</Text>
            <Text style={styles.emptyBody}>{t("chat.empty.firstTime.body")}</Text>
          </>
        ) : (
          <>
            <Text style={styles.emptyHeading}>{t("chat.empty.heading")}</Text>
            <Text style={styles.emptyBody}>{t("chat.empty.body")}</Text>
          </>
        )}
      </View>
    ) : null}

    // Mark first-time-empty as played once it renders (so next empty becomes pure copy)
    useEffect(() => {
      if (!isInitialLoad && sortedAgents.length === 0 && isFirstTime) {
        setEmptyOttiePlayed(true);
      }
    }, [isInitialLoad, sortedAgents.length, isFirstTime, setEmptyOttiePlayed]);
    ```

    First-time empty heading uses `theme.fontFamily.rounded` + `letterSpacing: -0.4` (UI-SPEC lines 89-90 Display variant); subsequent empty uses default system family at the same size.

    Pinned rows sort first:

    ```tsx
    const sortedAgents = useMemo(() => {
      const pinnedKeys = new Set(useChatRowStateStore.getState().getPinnedRowKeys());
      return [...agents].sort((a, b) => {
        const aPinned = pinnedKeys.has(makeRowKey(a.serverId, a.id));
        const bPinned = pinnedKeys.has(makeRowKey(b.serverId, b.id));
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return b.lastActivityAt - a.lastActivityAt;
      });
    }, [agents]);
    ```

    Body renders `<FlatList data={sortedAgents} renderItem={({item}) => <ChatRow agent={item} />} ...>` retaining the existing `RefreshControl`, `onEndReached={loadMore}`, and `listFooterComponent` plumbing.

    Step 2 — Modify `packages/app/src/components/splash-overlay.tsx`. After the existing `setVisible(false)` fires (line 41-60 area), mount `<TotalUnreadPopup>`:

    ```typescript
    import { TotalUnreadPopup } from "@/components/total-unread-popup";
    import { useChatRowStateStore } from "@/stores/chat-row-state-store";

    // Inside component, after setVisible(false) fires:
    const totalUnread = useChatRowStateStore((s) =>
      Object.values(s.rows).reduce((acc, r) => acc + r.unread, 0)
    );

    // Render after splash dismissal:
    {!visible && totalUnread > 0 && <TotalUnreadPopup totalUnread={totalUnread} />}
    ```

    The `<TotalUnreadPopup>` itself owns the `hasShown` module-flag so it fires once per app launch.

    Step 3 — Refactor `packages/app/src/components/sidebar-workspace-list.tsx`:

    A) Replace inline Haptics calls. Find lines ~1053 / 1076 / 1089 (PATTERNS lines 522-534). Remove `import * as Haptics from "expo-haptics"` (line 13). Add at the top of the component:

    ```typescript
    import { useHaptic } from "@/hooks/use-haptic";
    import { useAppSettings } from "@/hooks/use-settings";
    // ...
    const { settings } = useAppSettings();
    const haptic = useHaptic({ enabled: settings.haptics?.enabled ?? true, isLowPowerMode: false });
    ```

    Replace each call:

    - Line 1053 `void Haptics.selectionAsync().catch(() => {});` → `haptic.fire("medium");`
    - Line 1076 `void Haptics.selectionAsync().catch(() => {});` → `haptic.fire("medium");`
    - Line 1089 `void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});` → `haptic.fire("medium");`

    B) D-07 tap-to-switch: locate the workspace-row press handler. Confirm it currently routes to a confirm step or a wrapper. Replace any two-tap pattern with immediate `router.replace(buildHostWorkspaceRoute(serverId, workspaceId))` + `useNavigationActiveWorkspaceStore.getState().setActiveWorkspaceId(workspaceId)` (whatever the existing store API is — adapt to actual signature). The change must be: a single tap on a workspace row commits the switch; no follow-up confirm gesture.

    C) Run `npm run format -- packages/app/src/components/sidebar-workspace-list.tsx`.

    Step 4 — Run `npm run format -- packages/app/src/screens/sessions-screen.tsx packages/app/src/components/splash-overlay.tsx packages/app/src/components/sidebar-workspace-list.tsx`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "<ChatRow" packages/app/src/screens/sessions-screen.tsx && \
      grep -q "<TopRightAddMenu" packages/app/src/screens/sessions-screen.tsx && \
      grep -q "MathCurveLoader" packages/app/src/screens/sessions-screen.tsx && \
      grep -q "chat.empty.firstTime.heading" packages/app/src/screens/sessions-screen.tsx && \
      grep -q "chat.empty.heading" packages/app/src/screens/sessions-screen.tsx && \
      grep -q "useOnboardingStateStore" packages/app/src/screens/sessions-screen.tsx && \
      grep -q "TotalUnreadPopup" packages/app/src/components/splash-overlay.tsx && \
      grep -q "useChatRowStateStore" packages/app/src/components/splash-overlay.tsx && \
      ! grep -E '^import \* as Haptics from "expo-haptics"' packages/app/src/components/sidebar-workspace-list.tsx && \
      grep -q "useHaptic" packages/app/src/components/sidebar-workspace-list.tsx && \
      grep -q "haptic.fire" packages/app/src/components/sidebar-workspace-list.tsx && \
      grep -q "router.replace\\|router.push" packages/app/src/components/sidebar-workspace-list.tsx && \
      npm run typecheck && \
      npm run lint -- packages/app/src/screens/sessions-screen.tsx packages/app/src/components/splash-overlay.tsx packages/app/src/components/sidebar-workspace-list.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "<ChatRow" packages/app/src/screens/sessions-screen.tsx` returns ≥1
    - `grep -c "<TopRightAddMenu" packages/app/src/screens/sessions-screen.tsx` returns ≥1
    - `grep -c "MathCurveLoader" packages/app/src/screens/sessions-screen.tsx` returns ≥1
    - `grep -c "chat.empty.firstTime" packages/app/src/screens/sessions-screen.tsx` returns ≥1 (first-time branch)
    - `grep -c "chat.empty.heading" packages/app/src/screens/sessions-screen.tsx` returns ≥1 (subsequent branch)
    - `grep -c "useOnboardingStateStore" packages/app/src/screens/sessions-screen.tsx` returns ≥1
    - `grep -c "TotalUnreadPopup" packages/app/src/components/splash-overlay.tsx` returns ≥1
    - `grep -c "useChatRowStateStore" packages/app/src/components/splash-overlay.tsx` returns ≥1
    - `grep -E '^import \* as Haptics from "expo-haptics"' packages/app/src/components/sidebar-workspace-list.tsx` returns no match
    - `grep -c "useHaptic" packages/app/src/components/sidebar-workspace-list.tsx` returns ≥1
    - `grep -c "haptic.fire" packages/app/src/components/sidebar-workspace-list.tsx` returns ≥3 (replaced 3 inline Haptics calls)
    - Workspace tap handler invokes router.replace or router.push with buildHostWorkspaceRoute (D-07 immediate switch)
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/screens/sessions-screen.tsx packages/app/src/components/splash-overlay.tsx packages/app/src/components/sidebar-workspace-list.tsx` exits 0
  </acceptance_criteria>
  <done>Sessions screen reshaped into Chats tab; splash mounts TotalUnreadPopup; sidebar-workspace-list haptics refactored + tap-to-switch wired</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: NAV-A2 — auto-collapse sidebar overlay when form factor flips to compact (closes checker B2)</name>
  <files>
    packages/app/src/app/_layout.tsx,
    packages/app/src/stores/panel-store.ts,
    packages/app/src/stores/panel-store.test.ts
  </files>
  <read_first>
    - packages/app/src/stores/panel-store.ts (FULL FILE — sidebar overlay state owner: `mobileView: "agent" | "agent-list" | "file-explorer"` line 70; setters around lines 311-401)
    - packages/app/src/app/_layout.tsx (FULL FILE — top-level layout; identify the right place to mount the auto-collapse useEffect — typically near the existing chrome-layout / breakpoint hooks around lines 478-561)
    - packages/app/src/constants/layout.ts (`useIsCompactFormFactor()` hook — the breakpoint trigger)
    - packages/app/src/contexts/sidebar-animation-context.tsx (existing consumer of panel-store `isOpen`)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-RESEARCH.md NAV-A2 acceptance row ("sidebar overlay auto-collapses on compact form factor")
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md (search for NAV-A2 / "auto-collapse" mention; if absent, this task fills the gap inferred from REQUIREMENTS.md)
  </read_first>
  <behavior>
    Test 1 (panel-store.test.ts): the store has a `collapseOverlayOnCompact()` action that sets mobileView from "agent-list"/"file-explorer" → "agent" idempotently
    Test 2: when mobileView is already "agent", calling collapseOverlayOnCompact() is a no-op (returns same state)
    Test 3 (manual smoke via typecheck): _layout.tsx imports `useIsCompactFormFactor` and wires a useEffect that calls `usePanelStore.getState().collapseOverlayOnCompact()` whenever isCompact transitions false → true
  </behavior>
  <action>
    Step 1 — Add `collapseOverlayOnCompact()` action to `packages/app/src/stores/panel-store.ts`. Locate the existing actions block (around line 285 onwards where `mobileView: "agent"` defaults live). Add inside the actions chunk:

    ```typescript
    collapseOverlayOnCompact: () => {
      const current = get().mobileView;
      if (current === "agent") return; // idempotent — already collapsed
      // Per NAV-A2 / B2: closing both overlay variants drops to the canonical "agent" view
      set({ mobileView: "agent" });
    },
    ```

    Update the `PanelStoreActions` (or whatever the action interface is named — read the file) TypeScript interface to include the new method.

    Step 2 — Wire the effect in `packages/app/src/app/_layout.tsx`. Locate the top-level component (search for `export default function RootLayout` or `RootStack`). Add inside the body:

    ```typescript
    import { useIsCompactFormFactor } from "@/constants/layout";
    import { usePanelStore } from "@/stores/panel-store";
    // ...
    const isCompact = useIsCompactFormFactor();
    useEffect(() => {
      // NAV-A2 / closes checker B2 — when the form factor flips to compact, drop sidebar overlays.
      // This closes the case where a user resizes from desktop (sidebars pinned) to phone-width
      // and the overlay state would otherwise pin the agent-list visible over the chats content.
      if (isCompact) {
        usePanelStore.getState().collapseOverlayOnCompact();
      }
    }, [isCompact]);
    ```

    Place the effect AFTER the existing chrome-layout hooks (line ~561 area near `useSidebarAnimation()`). Confirm `useEffect` is already imported; if not, extend the React import.

    Step 3 — Add a focused test in `packages/app/src/stores/panel-store.test.ts` (create if absent) covering Tests 1-2:

    ```typescript
    import { describe, it, expect, beforeEach } from "vitest";
    import { usePanelStore } from "./panel-store";

    describe("panel-store NAV-A2 auto-collapse", () => {
      beforeEach(() => {
        // Reset to default so tests are isolated
        usePanelStore.setState({ mobileView: "agent" });
      });

      it("collapseOverlayOnCompact() drops agent-list to agent", () => {
        usePanelStore.setState({ mobileView: "agent-list" });
        usePanelStore.getState().collapseOverlayOnCompact();
        expect(usePanelStore.getState().mobileView).toBe("agent");
      });

      it("collapseOverlayOnCompact() drops file-explorer to agent", () => {
        usePanelStore.setState({ mobileView: "file-explorer" });
        usePanelStore.getState().collapseOverlayOnCompact();
        expect(usePanelStore.getState().mobileView).toBe("agent");
      });

      it("collapseOverlayOnCompact() is a no-op when already on agent", () => {
        usePanelStore.setState({ mobileView: "agent" });
        const before = usePanelStore.getState().mobileView;
        usePanelStore.getState().collapseOverlayOnCompact();
        expect(usePanelStore.getState().mobileView).toBe(before);
      });
    });
    ```

    Run `npm run format -- packages/app/src/app/_layout.tsx packages/app/src/stores/panel-store.ts packages/app/src/stores/panel-store.test.ts`.

    Note on side-effect ownership: this task touches `_layout.tsx`. If another plan (e.g. 02b for routing-on-welcome) also modifies `_layout.tsx` in this wave, declare a same-wave file conflict and resolve via wave bump (Plan 02c at wave 2 already depends on 02a; wave is fine for 02b which is also wave 2 but does not modify `_layout.tsx`).

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "collapseOverlayOnCompact" packages/app/src/stores/panel-store.ts && \
      grep -q "useIsCompactFormFactor" packages/app/src/app/_layout.tsx && \
      grep -q "collapseOverlayOnCompact" packages/app/src/app/_layout.tsx && \
      grep -q "isCompact" packages/app/src/app/_layout.tsx && \
      npx vitest run packages/app/src/stores/panel-store.test.ts --bail=1 && \
      npm run typecheck && \
      npm run lint -- packages/app/src/app/_layout.tsx packages/app/src/stores/panel-store.ts packages/app/src/stores/panel-store.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "collapseOverlayOnCompact" packages/app/src/stores/panel-store.ts` returns ≥2 (interface + implementation)
    - `grep -c "useIsCompactFormFactor" packages/app/src/app/_layout.tsx` returns ≥1 (B2 — auto-collapse hook wired)
    - `grep -c "collapseOverlayOnCompact" packages/app/src/app/_layout.tsx` returns ≥1
    - `npx vitest run packages/app/src/stores/panel-store.test.ts --bail=1` exits 0
    - `npm run typecheck` exits 0
    - Lint passes for the 3 files
  </acceptance_criteria>
  <done>NAV-A2 sidebar overlay auto-collapses when form factor flips to compact; B2 closed</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary                                               | Description                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| chat-row context menu / swipe / hover → ActionRegistry | All three input vectors converge on the same dispatch surface                 |
| AsyncStorage chat-row state                            | Local UI state (pin/mute/unread/archived) — no daemon transmission this phase |
| Long-press / right-click events → openContextMenu      | DOM/native events drive a UI-only menu opener                                 |

## STRIDE Threat Register

| Threat ID | Category                   | Component                               | Disposition | Mitigation Plan                                                                                                                                                                                                                      |
| --------- | -------------------------- | --------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T-02c-01  | T (Tampering)              | actionRegistry.dispatch from menu items | mitigate    | All menu/swipe/hover dispatches go through `actionRegistry.dispatch(id, payload)`. Payload is Zod-validated by registry.ts:dispatch (Plan 02a). Menu items only emit RowKeyPayload `{serverId, agentId}` — no arbitrary command path |
| T-02c-02  | I (Information disclosure) | ChatRowStateStore in AsyncStorage       | accept      | Pin/mute/unread/archived flags are local UI state. No PII; never transmitted to daemon or relay. Local-first invariant holds                                                                                                         |
| T-02c-03  | E (Elevation of Privilege) | sessions-screen rename action           | mitigate    | `chat.menu.rename` dispatches via registry but the actual rename modal opens in user-context only. No URL-param or deep-link rename path exists                                                                                      |
| T-02c-04  | T (Tampering)              | Workspace tap-to-switch                 | mitigate    | D-07 immediate switch only writes to local `navigation-active-workspace-store` + routes via `buildHostWorkspaceRoute`. No new daemon call introduced. Schema unchanged                                                               |
| T-02c-05  | D (Denial of Service)      | TotalUnreadPopup re-fire                | accept      | Module-scoped `hasShown` flag prevents popup re-render on every route change. Refresh / desktop relaunch resets the flag (intentional)                                                                                               |

No HIGH severity threats. Note: per CONTEXT Q1, this plan deliberately keeps pin/mute/unread state client-only — the WebSocket schema is NOT modified. Daemon-managed cross-device parity is deferred to a future phase. ARCH-02 frozen-fixture parse tests stay green because messages.ts is untouched.
</threat_model>

<verification>
- All 3 task verify blocks pass
- `npx vitest run packages/app/src/stores/chat-row-state-store.test.ts --bail=1` exits 0
- `npm run typecheck` exits 0
- `npm run lint -- packages/app/src/stores/chat-row-state-store.ts packages/app/src/components/unread-badge.tsx packages/app/src/components/chat-row.tsx packages/app/src/components/chat-row-context-menu.tsx packages/app/src/components/chat-row-context-menu.web.tsx packages/app/src/components/chat-row-context-menu.native.tsx packages/app/src/components/chat-row-swipe-actions.tsx packages/app/src/components/chat-row-hover-actions.web.tsx packages/app/src/components/top-right-add-menu.tsx packages/app/src/components/total-unread-popup.tsx packages/app/src/screens/sessions-screen.tsx packages/app/src/components/splash-overlay.tsx packages/app/src/components/sidebar-workspace-list.tsx packages/app/src/actions/chat-row-actions.ts` exits 0
- `npm run format:check -- packages/app/src/stores/chat-row-state-store.ts packages/app/src/components/unread-badge.tsx packages/app/src/components/chat-row.tsx packages/app/src/components/chat-row-context-menu.tsx packages/app/src/components/chat-row-context-menu.web.tsx packages/app/src/components/chat-row-context-menu.native.tsx packages/app/src/components/chat-row-swipe-actions.tsx packages/app/src/components/chat-row-hover-actions.web.tsx packages/app/src/components/top-right-add-menu.tsx packages/app/src/components/total-unread-popup.tsx packages/app/src/screens/sessions-screen.tsx packages/app/src/components/splash-overlay.tsx packages/app/src/components/sidebar-workspace-list.tsx packages/app/src/actions/chat-row-actions.ts packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json` exits 0
- WebSocket schema unchanged: `git diff packages/server/src/shared/messages.ts` is empty
- Frozen-fixture parse tests still green: `npx vitest run packages/server/src/shared/messages.test.ts --bail=1` exits 0 (if applicable)
</verification>

<success_criteria>

- `<ChatRow>` + 8 supporting components exist with all behaviors specified in UI-SPEC §Component Inventory + Interaction Contract
- Long-press (native, 350ms) / right-click (web) opens 8-item context menu via `actionRegistry.dispatch`; medium haptic on open
- Swipe-left (native) reveals 3 quick actions; heavy haptic on threshold; light haptic at 90px (constant references in code)
- Hover quick-actions (web) gated by `isHovered || isCompact`; lives in `.web.tsx` (not bundled on native)
- Top-right `+` menu 4 items wire through `actionRegistry.dispatch`
- TotalUnreadPopup uses module-scoped `let hasShown = false` one-shot per launch; mounts via splash-overlay
- Sessions screen replaced AgentList with ChatRow rendering; pinned rows sort first; first-time empty branches via `emptyOttiePlayedFirstChats` flag
- `<MathCurveLoader>` is the chats-list initial-load loader (D-13 sanctioned)
- Sidebar workspace tap = immediate switch (D-07); no two-tap workspace-then-confirm
- `expo-haptics` import REMOVED from sidebar-workspace-list.tsx; 3 inline calls replaced with `useHaptic().fire(...)`
- ChatRowStateStore is client-only (Zustand+AsyncStorage at `@ottie:chat-row-state`); WebSocket schema unchanged (CONTEXT Q1 — daemon-managed parity deferred)
- 8 chat.menu._ + 4 chat.add._ ActionIds registered with handlers; total registry includes ≥18 actions (NAT-01 6 + 8 menu + 4 add)
- en.json + zh.json contain full chat._ vocabulary from UI-SPEC §Copywriting Contract (chat.menu / chat.add / chat.swipe / chat.unread / chat.empty / chat.delete / chat.deleted / chat.delete.modal_)
- All acceptance criteria + verification commands pass
  </success_criteria>

<output>
Create `.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02c-chats-tab-SUMMARY.md`. Document: the chat-row component composition, the sidebar tap-to-switch behavior change, the deferred daemon-side parity decision (CONTEXT Q1 — client-only chosen), and the registered ActionIds with their modalities.
</output>
