import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { LucideIcon } from "lucide-react-native";
import { HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE } from "@/constants/layout";

interface SidebarHeaderRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  testID?: string;
  nativeID?: string;
  accessibilityLabel?: string;
  /**
   * Optional accessory rendered at the right edge of the row, outside the
   * pressable trigger so it can have its own onPress (e.g. an "add" button).
   */
  trailing?: ReactNode;
}

/**
 * Top-of-sidebar header row: a sidebar-height pressable with an icon + label
 * and a full-width border separator beneath. Used as the first element of a
 * sidebar (workspace "Sessions", settings "Back to workspace"). Owns its own
 * separator line so both sidebars converge on the same edge and padding.
 */
export function SidebarHeaderRow({
  icon: Icon,
  label,
  onPress,
  isActive = false,
  testID,
  nativeID,
  accessibilityLabel,
  trailing,
}: SidebarHeaderRowProps) {
  const { theme } = useUnistyles();

  const buttonStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (Boolean(hovered) || isActive) && styles.buttonHovered,
    ],
    [isActive],
  );

  const renderChildren = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const isHighlighted = Boolean(state.hovered) || isActive;
      const iconColor = isHighlighted ? theme.colors.foreground : theme.colors.foregroundMuted;
      return (
        <>
          <Icon size={theme.iconSize.md} color={iconColor} />
          <SidebarHeaderRowLabel label={label} isHighlighted={isHighlighted} />
        </>
      );
    },
    [
      Icon,
      isActive,
      label,
      theme.colors.foreground,
      theme.colors.foregroundMuted,
      theme.iconSize.md,
    ],
  );

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onPress}
        testID={testID}
        nativeID={nativeID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        style={buttonStyle}
      >
        {renderChildren}
      </Pressable>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

function SidebarHeaderRowLabel({
  label,
  isHighlighted,
}: {
  label: string;
  isHighlighted: boolean;
}) {
  const labelStyle = useMemo(
    () => [styles.label, isHighlighted && styles.labelHighlighted],
    [isHighlighted],
  );
  return <Text style={labelStyle}>{label}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderGlass,
    userSelect: "none",
    gap: theme.spacing[2],
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    flexShrink: 1,
    minWidth: 0,
  },
  trailing: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  labelHighlighted: {
    color: theme.colors.foreground,
  },
}));
