// Web variant of the chat-row context menu.
// Triggered by `onContextMenu` (right-click) on web; rendered as an absolutely
// positioned <Modal> + <GlassSurface radius="sheet"> stack so the menu floats
// above the current route at the click anchor point.
//
// On native this file is NOT bundled — Metro resolves to
// `chat-row-context-menu.native.tsx`.

import { useCallback, useMemo } from "react";
import { Modal, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { GlassSurface } from "@/components/ui/glass-surface";
import { actionRegistry } from "@/actions/registry";
import type { ActionId } from "@/actions/ids";

export interface ChatRowContextMenuProps {
  serverId: string;
  agentId: string;
  isPinned: boolean;
  isMuted: boolean;
  /** Page-coordinate anchor for the menu. Null hides the menu. */
  anchor: { x: number; y: number } | null;
  open: boolean;
  onClose: () => void;
}

interface MenuItem {
  id: ActionId;
  label: string;
  destructive?: boolean;
}

export function ChatRowContextMenu({
  serverId,
  agentId,
  isPinned,
  isMuted,
  anchor,
  open,
  onClose,
}: ChatRowContextMenuProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  const items = useMemo<MenuItem[]>(
    () => [
      {
        id: isPinned ? "chat.menu.unpin" : "chat.menu.pin",
        label: t(isPinned ? "chat.menu.unpin" : "chat.menu.pin"),
      },
      { id: "chat.menu.markUnread", label: t("chat.menu.markUnread") },
      { id: "chat.menu.markRead", label: t("chat.menu.markRead") },
      {
        id: isMuted ? "chat.menu.unmute" : "chat.menu.mute",
        label: t(isMuted ? "chat.menu.unmute" : "chat.menu.mute"),
      },
      { id: "chat.menu.rename", label: t("chat.menu.rename") },
      { id: "chat.menu.archive", label: t("chat.menu.archive") },
      { id: "chat.menu.delete", label: t("chat.menu.delete"), destructive: true },
    ],
    [isPinned, isMuted, t],
  );

  const handleSelect = useCallback(
    async (id: ActionId) => {
      await actionRegistry.dispatch(id, { serverId, agentId });
      onClose();
    },
    [serverId, agentId, onClose],
  );

  const positionStyle = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      left: anchor?.x ?? 0,
      top: anchor?.y ?? 0,
    }),
    [anchor?.x, anchor?.y],
  );

  if (!open || !anchor) return null;

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="chat-row-context-menu"
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID="chat-row-context-menu-backdrop"
      />
      <View style={positionStyle}>
        <GlassSurface radius="sheet">
          <View style={styles.menu}>
            {items.map((item) => (
              <ChatRowContextMenuItem
                key={item.id}
                item={item}
                theme={theme}
                onSelect={handleSelect}
              />
            ))}
          </View>
        </GlassSurface>
      </View>
    </Modal>
  );
}

function ChatRowContextMenuItem({
  item,
  theme,
  onSelect,
}: {
  item: MenuItem;
  theme: ReturnType<typeof useUnistyles>["theme"];
  onSelect: (id: ActionId) => void;
}) {
  const labelStyle = useMemo<TextStyle[]>(
    () => [
      styles.label,
      {
        color: item.destructive ? theme.colors.destructive : theme.colors.foreground,
      },
    ],
    [item.destructive, theme.colors.destructive, theme.colors.foreground],
  );
  const handlePress = useCallback(() => {
    onSelect(item.id);
  }, [item.id, onSelect]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="menuitem"
      accessibilityLabel={item.label}
      style={styles.item}
    >
      <Text style={labelStyle}>{item.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
  },
  menu: {
    paddingVertical: theme.spacing[2],
    minWidth: 200,
  },
  item: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
}));
