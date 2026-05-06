// Top-right "+" menu rendered in the Chats tab header.
//
// 5 items: chat.add.newChat / chat.add.scanToPair / chat.add.joinHost /
// chat.add.createWorkspace / chat.add.addDevice. Each dispatches via
// `actionRegistry` so cmdk / voice / menu surfaces converge on the same
// handlers. addDevice was added in Phase 2.c-ui to surface the Add-device
// QR flow from the primary discovery point (the Chats tab) rather than
// only from settings/identity.
//
// Cross-platform Modal + GlassSurface stack (mirrors the web variant of the
// chat-row context menu — the native variant of the `+` menu intentionally
// uses Modal too instead of a bottom sheet, because the trigger lives in
// the header at a stable position and a tiny anchored menu reads better
// than a large sliding sheet for a 4-item action list).

import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, Text, View, type TextStyle } from "react-native";
import { Plus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { GlassSurface } from "@/components/ui/glass-surface";
import { actionRegistry } from "@/actions/registry";
import type { ActionId } from "@/actions/ids";

export interface TopRightAddMenuProps {
  serverId?: string;
  testID?: string;
}

interface AddMenuItem {
  id: ActionId;
  labelKey: string;
}

const ITEMS: ReadonlyArray<AddMenuItem> = [
  { id: "chat.add.newChat", labelKey: "chat.add.newChat" },
  { id: "chat.add.scanToPair", labelKey: "chat.add.scanToPair" },
  { id: "chat.add.joinHost", labelKey: "chat.add.joinHost" },
  { id: "chat.add.createWorkspace", labelKey: "chat.add.createWorkspace" },
  { id: "chat.add.addDevice", labelKey: "chat.add.addDevice" },
];

export function TopRightAddMenu({ serverId, testID }: TopRightAddMenuProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSelect = useCallback(
    async (id: ActionId) => {
      setOpen(false);
      await actionRegistry.dispatch(id, serverId ? { serverId } : {});
    },
    [serverId],
  );

  const triggerLabel = t("chat.add.newChat");
  const itemLabelStyle = useMemo<TextStyle[]>(
    () => [styles.itemLabel, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );

  return (
    <>
      <Pressable
        testID={testID ?? "top-right-add-trigger"}
        accessibilityLabel={triggerLabel}
        accessibilityRole="button"
        onPress={handleOpen}
        style={styles.trigger}
      >
        <Plus size={22} color={theme.colors.foreground} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={handleClose}>
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          testID="top-right-add-menu-backdrop"
        />
        <View style={styles.menuContainer}>
          <GlassSurface radius="sheet">
            <View style={styles.menuList}>
              {ITEMS.map((item) => (
                <AddMenuItemButton
                  key={item.id}
                  item={item}
                  labelStyle={itemLabelStyle}
                  label={t(item.labelKey)}
                  onSelect={handleSelect}
                />
              ))}
            </View>
          </GlassSurface>
        </View>
      </Modal>
    </>
  );
}

function AddMenuItemButton({
  item,
  label,
  labelStyle,
  onSelect,
}: {
  item: AddMenuItem;
  label: string;
  labelStyle: TextStyle[];
  onSelect: (id: ActionId) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(item.id);
  }, [item.id, onSelect]);
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      onPress={handlePress}
      style={styles.item}
    >
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[2],
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    flex: 1,
  },
  menuContainer: {
    position: "absolute",
    top: 60,
    right: theme.spacing[4],
  },
  menuList: {
    paddingVertical: theme.spacing[2],
    minWidth: 200,
  },
  item: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  itemLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
}));
