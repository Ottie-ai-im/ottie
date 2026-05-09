// Top-right "+" menu rendered in the Chats tab header (and now also next
// to the per-section headers introduced by the sidebar three-section
// redesign).
//
// Originally a single global menu with 8 items; the redesign splits those
// items across three section-scoped menus (workspaces / humans / AI Agent)
// while keeping this component as the shared trigger + popover renderer.
// Callers pass an `items` array; the component dispatches via
// `actionRegistry` so cmdk / voice / menu surfaces converge on the same
// handlers.
//
// Cross-platform Modal + GlassSurface stack (mirrors the web variant of the
// chat-row context menu — the native variant of the `+` menu intentionally
// uses Modal too instead of a bottom sheet, because the trigger lives in
// the header at a stable position and a tiny anchored menu reads better
// than a large sliding sheet for a 4-item action list).

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  Text,
  View,
  type TextStyle,
  type View as RNView,
  type ViewStyle,
} from "react-native";
import { Plus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { GlassSurface } from "@/components/ui/glass-surface";
import { actionRegistry } from "@/actions/registry";
import type { ActionId } from "@/actions/ids";

export interface AddMenuItem {
  id: ActionId;
  labelKey: string;
}

export interface TopRightAddMenuProps {
  serverId?: string;
  testID?: string;
  /**
   * Optional override of the action list. Defaults to the legacy 8-item
   * global menu so callers that haven't migrated still work.
   */
  items?: ReadonlyArray<AddMenuItem>;
  /** Optional aria/label override for the trigger. */
  triggerLabelKey?: string;
  /** Visual size of the trigger — "sm" used by per-section headers. */
  size?: "default" | "sm";
}

const DEFAULT_ITEMS: ReadonlyArray<AddMenuItem> = [
  { id: "chat.add.newChat", labelKey: "chat.add.newChat" },
  { id: "chat.add.scanToPair", labelKey: "chat.add.scanToPair" },
  { id: "chat.add.joinHost", labelKey: "chat.add.joinHost" },
  { id: "chat.add.createWorkspace", labelKey: "chat.add.createWorkspace" },
  { id: "chat.add.addDevice", labelKey: "chat.add.addDevice" },
  { id: "chat.add.linkToExisting", labelKey: "chat.add.linkToExisting" },
  { id: "chat.add.addFriend", labelKey: "chat.add.addFriend" },
  { id: "chat.add.redeemFriendLink", labelKey: "chat.add.redeemFriendLink" },
];

const MENU_WIDTH = 220;
const MENU_OFFSET_Y = 6;
// Per-row + container padding. Used to pre-compute menu height so we can
// flip the popover above the trigger when there isn't enough room below.
const MENU_ROW_HEIGHT = 44;
const MENU_VERTICAL_PADDING = 16;
const MENU_VIEWPORT_MARGIN = 8;

interface AnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
}

export function TopRightAddMenu({
  serverId,
  testID,
  items = DEFAULT_ITEMS,
  triggerLabelKey,
  size = "default",
}: TopRightAddMenuProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const triggerRef = useRef<RNView | null>(null);

  // Measure the trigger's screen-space rect on open so the popover can
  // anchor to it. Without this the menu was hard-pinned to the top-right
  // corner of the window — fine for the original single-+ at the sidebar
  // header, surprising when triggered from a section header further down.
  const handleOpen = useCallback(() => {
    const node = triggerRef.current;
    if (!node) {
      setAnchor(null);
      setOpen(true);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setAnchor({
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
        width,
      });
      setOpen(true);
    });
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

  const triggerLabel = t(triggerLabelKey ?? "chat.add.newChat");
  const itemLabelStyle = useMemo<TextStyle[]>(
    () => [styles.itemLabel, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  const triggerStyle = size === "sm" ? styles.triggerSm : styles.trigger;
  const triggerIconSize = size === "sm" ? 16 : 22;

  // Anchor the popover near the trigger. Default placement is below the
  // trigger right-aligned to it; if that overflows the viewport bottom
  // (which happens when the trigger lives in a lower-screen section like
  // the AI Agent header at the bottom of the sidebar) we flip and open
  // above the trigger instead.
  const menuPositionStyle = useMemo<ViewStyle>(() => {
    if (!anchor) {
      return { top: 60, right: theme.spacing[4] };
    }
    const estimatedHeight = items.length * MENU_ROW_HEIGHT + MENU_VERTICAL_PADDING;
    const windowHeight = Dimensions.get("window").height;
    const belowTop = anchor.bottom + MENU_OFFSET_Y;
    const belowFits = belowTop + estimatedHeight <= windowHeight - MENU_VIEWPORT_MARGIN;
    const top = belowFits
      ? belowTop
      : Math.max(MENU_VIEWPORT_MARGIN, anchor.top - estimatedHeight - MENU_OFFSET_Y);
    const minLeft = MENU_VIEWPORT_MARGIN;
    const desiredLeft = Math.max(minLeft, anchor.right - MENU_WIDTH);
    return { top, left: desiredLeft };
  }, [anchor, items.length, theme.spacing]);

  const menuContainerStyle = useMemo(
    () => [styles.menuContainer, menuPositionStyle],
    [menuPositionStyle],
  );

  return (
    <>
      <Pressable
        ref={triggerRef}
        testID={testID ?? "top-right-add-trigger"}
        accessibilityLabel={triggerLabel}
        accessibilityRole="button"
        onPress={handleOpen}
        style={triggerStyle}
      >
        <Plus size={triggerIconSize} color={theme.colors.foreground} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={handleClose}>
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          testID="top-right-add-menu-backdrop"
        />
        <View style={menuContainerStyle}>
          <GlassSurface radius="sheet">
            <View style={styles.menuList}>
              {items.map((item) => (
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
  triggerSm: {
    padding: theme.spacing[1],
    minWidth: 28,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
  },
  backdrop: {
    flex: 1,
  },
  menuContainer: {
    position: "absolute",
    width: MENU_WIDTH,
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
