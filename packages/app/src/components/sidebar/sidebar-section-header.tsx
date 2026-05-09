import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react-native";

// Sub-section header used by the new sidebar groupings (humans, AI agents,
// and any future addition). Smaller and visually de-emphasised compared to
// the top-of-sidebar `SidebarHeaderRow` (which is the Sessions tab marker)
// — these headers describe a list group inside the chat tab, not a route.
//
// Layout: ▾ icon  title  count    [trailing slot, e.g. "+" button]
//
// The chevron + title + count are one Pressable that toggles `collapsed`.
// The trailing slot is a sibling so it can have its own onPress without
// fighting the collapse gesture.

interface SidebarSectionHeaderProps {
  icon?: LucideIcon;
  label: string;
  count?: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  trailing?: ReactNode;
  testID?: string;
}

export function SidebarSectionHeader({
  icon: Icon,
  label,
  count,
  collapsed,
  onToggleCollapsed,
  trailing,
  testID,
}: SidebarSectionHeaderProps) {
  const { theme } = useUnistyles();

  const buttonStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      hovered ? styles.buttonHovered : null,
    ],
    [],
  );

  const renderChildren = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const isHighlighted = Boolean(state.hovered);
      const accentColor = isHighlighted ? theme.colors.foreground : theme.colors.foregroundMuted;
      const Chevron = collapsed ? ChevronRight : ChevronDown;
      return (
        <>
          <Chevron size={14} color={accentColor} />
          {Icon ? <Icon size={14} color={accentColor} /> : null}
          <Text style={isHighlighted ? styles.labelHighlighted : styles.label}>{label}</Text>
          {typeof count === "number" ? (
            <Text style={isHighlighted ? styles.countHighlighted : styles.count}>{count}</Text>
          ) : null}
        </>
      );
    },
    [Icon, collapsed, count, label, theme.colors.foreground, theme.colors.foregroundMuted],
  );

  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onToggleCollapsed}
        testID={testID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        style={buttonStyle}
      >
        {renderChildren}
      </Pressable>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    gap: theme.spacing[1],
  },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    borderCurve: "continuous",
    minHeight: 28,
    minWidth: 0,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  labelHighlighted: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  count: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
  },
  countHighlighted: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  trailing: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
  },
}));
