// Native variant of the chat-row context menu.
// Triggered by long-press (350ms) on iOS / Android; rendered as a
// `<IsolatedBottomSheetModal>` containing a `<BottomSheetScrollView>` with
// the same 8-item menu the web variant exposes.
//
// On web this file is NOT bundled — Metro resolves to
// `chat-row-context-menu.web.tsx`.

import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type TextStyle } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  IsolatedBottomSheetModal,
  useIsolatedBottomSheetVisibility,
} from "@/components/ui/isolated-bottom-sheet-modal";
import { actionRegistry } from "@/actions/registry";
import type { ActionId } from "@/actions/ids";

export interface ChatRowContextMenuProps {
  serverId: string;
  agentId: string;
  isPinned: boolean;
  isMuted: boolean;
  /** Anchor is unused on native — sheet slides up from the bottom. Kept for
   *  prop parity with the web variant so call sites compile cross-platform. */
  anchor: { x: number; y: number } | null;
  open: boolean;
  onClose: () => void;
}

interface MenuItem {
  id: ActionId;
  label: string;
  destructive?: boolean;
}

const SNAP_POINTS: (string | number)[] = ["50%"];

export function ChatRowContextMenu({
  serverId,
  agentId,
  isPinned,
  isMuted,
  open,
  onClose,
}: ChatRowContextMenuProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  const { sheetRef, handleSheetChange } = useIsolatedBottomSheetVisibility({
    visible: open,
    onClose,
  });

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

  return (
    <IsolatedBottomSheetModal
      ref={sheetRef}
      snapPoints={SNAP_POINTS}
      onChange={handleSheetChange}
      enableDynamicSizing={false}
    >
      <BottomSheetScrollView contentContainerStyle={styles.content}>
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
      </BottomSheetScrollView>
    </IsolatedBottomSheetModal>
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
  content: {
    paddingBottom: theme.spacing[8],
  },
  menu: {
    paddingVertical: theme.spacing[2],
  },
  item: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    minHeight: 44,
    justifyContent: "center",
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
}));
