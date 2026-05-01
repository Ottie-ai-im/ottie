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
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { isNative } from "@/constants/platform";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { UnreadBadge } from "@/components/unread-badge";
import { ChatRowContextMenu } from "@/components/chat-row-context-menu";
import { ChatRowSwipeActions } from "@/components/chat-row-swipe-actions";
import { useHaptic } from "@/hooks/use-haptic";
import { makeRowKey, useChatRowStateStore } from "@/stores/chat-row-state-store";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { formatTimeAgo } from "@/utils/time";
import { shortenPath } from "@/utils/shorten-path";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

const LONG_PRESS_DELAY_MS = 350; // UI-SPEC line 315

export interface ChatRowProps {
  agent: AggregatedAgent;
}

export function ChatRow({ agent }: ChatRowProps) {
  const { theme } = useUnistyles();
  const haptic = useHaptic({ enabled: true, isLowPowerMode: false });

  const rowKey = useMemo(() => makeRowKey(agent.serverId, agent.id), [agent.serverId, agent.id]);
  const rowState = useChatRowStateStore(
    (s) =>
      s.rows[rowKey] ?? { pinned: false, pinnedAt: null, muted: false, unread: 0, archived: false },
  );

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
      rowState.pinned && {
        backgroundColor: theme.colors.surface1,
        borderLeftColor: theme.colors.accent,
        borderLeftWidth: 2,
      },
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [rowState.pinned, theme.colors.surface1, theme.colors.accent],
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
      <AgentStatusDot
        status={agent.status}
        requiresAttention={agent.requiresAttention}
        attentionReason={agent.attentionReason}
        pendingPermissionCount={agent.pendingPermissionCount}
      />
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
        <Text style={styles.timeAgo}>{formatTimeAgo(agent.lastActivityAt)}</Text>
        <UnreadBadge count={rowState.unread} muted={rowState.muted} />
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
  timeAgo: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
