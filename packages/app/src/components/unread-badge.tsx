// UnreadBadge — small numeric pill rendered alongside chat rows + tab icons.
// Token-driven (theme.colors.destructive for unread, theme.colors.foregroundMuted
// for muted) per UI-SPEC §Component Inventory line 267 (Caption role + tabular
// nums). Renders nothing when count <= 0 so callers don't need their own guard.

import { useMemo } from "react";
import { Text, View, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

export interface UnreadBadgeProps {
  count: number;
  /** When true, the badge fades to a muted neutral color so the chat row still
   *  reads as a "do not disturb" surface. */
  muted?: boolean;
  testID?: string;
}

export function UnreadBadge({ count, muted, testID }: UnreadBadgeProps) {
  const { theme } = useUnistyles();
  const display = count > 99 ? "99+" : String(count);
  const containerStyle = useMemo<ViewStyle[]>(
    () => [
      styles.container,
      {
        backgroundColor: muted ? theme.colors.surface3 : theme.colors.destructive,
      },
    ],
    [muted, theme.colors.surface3, theme.colors.destructive],
  );
  const textStyle = useMemo<TextStyle[]>(
    () => [
      styles.text,
      {
        color: muted ? theme.colors.foregroundMuted : theme.colors.destructiveForeground,
      },
    ],
    [muted, theme.colors.foregroundMuted, theme.colors.destructiveForeground],
  );

  if (count <= 0) {
    return null;
  }

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={containerStyle}
    >
      <Text style={textStyle}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    fontVariant: ["tabular-nums"],
  },
}));
