// ChatRow — the WeChat-style row primitive that renders one agent in the
// chats list.
//
// Responsibilities:
//   - Tap → push to the agent detail route
//   - Long-press (native, 350ms) / right-click (web) → open the 7-item
//     context menu with a medium haptic
//   - Hover quick-actions (web) → 3 icons that dispatch via actionRegistry,
//     visible when `isHovered || isCompact` (Phase 1 NAT-A3 pattern)
//   - Swipe-left (native) → 3 actions (Read / Mute / Delete) via
//     `<ChatRowSwipeActions>` (90px light haptic, 120px heavy haptic — see
//     chat-row-swipe-actions.tsx for the exact-literal constants)
//   - Pin / mute / unread state from `useChatRowStateStore` (client-only;
//     CONTEXT Q1 — daemon schema unchanged in Plan 02c)
//
// Keep this file FREE of `onPointerEnter`/`onPointerLeave` — the hover
// wiring lives in `chat-row-hover-actions.web.tsx` (web-only file extension)
// and is opted into here via a small overlay positioned by absolute
// coordinates. See PATTERNS lines 234-301 for the composition recipe.

import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { router } from "expo-router";
import { Folder } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { isNative } from "@/constants/platform";
import { UnreadBadge } from "@/components/unread-badge";
import { CompletedBadge } from "@/components/completed-badge";
import { ChatRowContextMenu } from "@/components/chat-row-context-menu";
import { ChatRowSwipeActions } from "@/components/chat-row-swipe-actions";
import { useHaptic } from "@/hooks/use-haptic";
import { makeRowKey, useChatRowStateStore } from "@/stores/chat-row-state-store";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { formatTimeAgo } from "@/utils/time";
import { shortenPath } from "@/utils/shorten-path";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

const LONG_PRESS_DELAY_MS = 350; // UI-SPEC line 315

// Selection palette — matches the reference mock (light blue tint + blue bar).
// Defined here as literals because the semantic theme has no blue-selection token.
const SELECTED_BG = "rgba(59, 130, 246, 0.10)";
const SELECTED_BAR = "#3b82f6";

// Stable default for rows that haven't been touched yet. Hoisted out of the
// selector so the reference is identical across renders — otherwise
// useSyncExternalStore sees a new object every time and infinite-loops.
const DEFAULT_ROW_STATE = {
  pinned: false,
  pinnedAt: null,
  muted: false,
  unread: 0,
  completedCount: 0,
  archived: false,
} as const;

export interface ChatRowProps {
  agent: AggregatedAgent;
  selected?: boolean;
}

export function ChatRow({ agent, selected = false }: ChatRowProps) {
  const { theme } = useUnistyles();
  const haptic = useHaptic({ enabled: true, isLowPowerMode: false });

  const rowKey = useMemo(() => makeRowKey(agent.serverId, agent.id), [agent.serverId, agent.id]);
  const rowState = useChatRowStateStore((s) => s.rows[rowKey] ?? DEFAULT_ROW_STATE);

  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);

  const openContextMenu = useCallback(
    (x: number, y: number) => {
      haptic.fire("medium");
      setMenuAnchor({ x, y });
    },
    [haptic],
  );

  const handlePress = useCallback(() => {
    router.navigate(buildHostAgentDetailRoute(agent.serverId, agent.id));
  }, [agent.serverId, agent.id]);

  const handleLongPress = useCallback(
    (event: { nativeEvent: { pageX: number; pageY: number } }) => {
      if (!isNative) return;
      openContextMenu(event.nativeEvent.pageX, event.nativeEvent.pageY);
    },
    [openContextMenu],
  );

  const handleCloseMenu = useCallback(() => {
    setMenuAnchor(null);
  }, []);

  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      selected && {
        backgroundColor: SELECTED_BG,
        borderLeftColor: SELECTED_BAR,
        borderLeftWidth: 3,
        paddingLeft: theme.spacing[4] - 3,
      },
      !selected && Boolean(hovered) && styles.rowHovered,
      !selected && pressed && styles.rowPressed,
    ],
    [selected, theme.spacing],
  );

  const titleStyle = useMemo(
    () => [styles.title, rowState.unread > 0 && styles.titleEmphasized],
    [rowState.unread],
  );

  const previewLine = useMemo(() => {
    const parts: string[] = [];
    if (agent.cwd) parts.push(shortenPath(agent.cwd));
    if (agent.serverLabel) parts.push(agent.serverLabel);
    return parts.join(" · ");
  }, [agent.cwd, agent.serverLabel]);

  const accessibilityLabel = useMemo(() => {
    const title = agent.title ?? "New session";
    const unreadBit = rowState.unread > 0 ? `, ${rowState.unread} unread` : ", no unread";
    const muted = rowState.muted ? ", muted" : "";
    return `${title}${unreadBit}${muted}`;
  }, [agent.title, rowState.unread, rowState.muted]);

  const rowContent = (
    <Pressable
      onPress={handlePress}
      onLongPress={isNative ? handleLongPress : undefined}
      delayLongPress={LONG_PRESS_DELAY_MS}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={`chat-row-${agent.serverId}-${agent.id}`}
    >
      <ChatRowAvatar status={agent.status} />
      <View style={styles.body}>
        <Text style={titleStyle} numberOfLines={1}>
          {agent.title ?? "New session"}
        </Text>
        {previewLine ? (
          <Text style={styles.preview} numberOfLines={1}>
            {previewLine}
          </Text>
        ) : null}
      </View>
      <View style={styles.trailing}>
        {rowState.unread > 0 || rowState.completedCount > 0 ? (
          <View style={styles.badgeStack}>
            {rowState.unread > 0 ? (
              <UnreadBadge count={rowState.unread} muted={rowState.muted} />
            ) : null}
            {rowState.completedCount > 0 ? (
              <CompletedBadge count={rowState.completedCount} muted={rowState.muted} />
            ) : null}
          </View>
        ) : (
          <Text style={styles.timeAgo}>{formatTimeAgo(agent.lastActivityAt)}</Text>
        )}
      </View>
    </Pressable>
  );

  // Native: wrap in swipe-actions. Web: render directly (hover-actions are
  // overlaid by the consumer via the `.web.tsx` component).
  const wrapped = isNative ? (
    <ChatRowSwipeActions serverId={agent.serverId} agentId={agent.id}>
      {rowContent}
    </ChatRowSwipeActions>
  ) : (
    rowContent
  );

  return (
    <View>
      {wrapped}
      <ChatRowContextMenu
        serverId={agent.serverId}
        agentId={agent.id}
        isPinned={rowState.pinned}
        isMuted={rowState.muted}
        isArchived={agent.archivedAt !== null || rowState.archived}
        anchor={menuAnchor}
        open={menuAnchor != null}
        onClose={handleCloseMenu}
      />
      {/* hover-actions overlay (web): owned by chat-row-hover-actions.web.tsx.
          Kept out of this shared file so it never imports onPointerEnter /
          onPointerLeave (NAT-03 hard rule). Consumers wrap chat-row in their
          own overlay when they want hover quick-actions. */}
    </View>
  );
}

function ChatRowAvatar({ status }: { status: AggregatedAgent["status"] }) {
  const { theme } = useUnistyles();
  const isWorking = status === "running" || status === "initializing";

  const spinnerStyle = useMemo(() => [styles.indicator, styles.indicatorSpinner], []);
  const idleStyle = useMemo(
    () => [styles.indicator, { backgroundColor: theme.colors.accent }],
    [theme.colors.accent],
  );
  const errorStyle = useMemo(
    () => [styles.indicator, { backgroundColor: theme.colors.destructive }],
    [theme.colors.destructive],
  );

  let indicator: React.ReactNode = null;
  if (isWorking) {
    indicator = (
      <View style={spinnerStyle}>
        <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
      </View>
    );
  } else if (status === "idle") {
    indicator = <View style={idleStyle} />;
  } else if (status === "error") {
    indicator = <View style={errorStyle} />;
  }

  return (
    <View style={styles.avatar}>
      <Folder size={20} color={theme.colors.foregroundMuted} strokeWidth={1.75} />
      {indicator}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    minHeight: 56,
    backgroundColor: theme.colors.surface0,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  indicator: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: theme.borderRadius.full,
    borderWidth: 2,
    borderColor: theme.colors.surface0,
  },
  indicatorSpinner: {
    width: 14,
    height: 14,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  titleEmphasized: {
    fontWeight: theme.fontWeight.semibold,
  },
  preview: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  trailing: {
    alignItems: "flex-end",
    gap: theme.spacing[1],
  },
  badgeStack: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  timeAgo: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
