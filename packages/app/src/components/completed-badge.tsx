// CompletedBadge — small blue numeric pill rendered alongside chat rows when
// one or more tasks have finished since the user last opened the chat.
//
// Sibling of `UnreadBadge` (red). The two badges are independent so a chat
// can show both at once: red = unread messages, blue = completed tasks.
// Driven by `chat-row-state-store.completedCount` (bumped in
// session-context on `running → finished` transitions, cleared when the
// agent panel mounts).

import { useMemo } from "react";
import { Text, View, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

export interface CompletedBadgeProps {
  count: number;
  /** When true, the badge fades to a muted neutral color. */
  muted?: boolean;
  testID?: string;
}

export function CompletedBadge({ count, muted, testID }: CompletedBadgeProps) {
  const { theme } = useUnistyles();
  const display = count > 99 ? "99+" : String(count);
  const containerStyle = useMemo<ViewStyle[]>(
    () => [
      styles.container,
      {
        backgroundColor: muted ? theme.colors.surface3 : theme.colors.palette.blue[500],
      },
    ],
    [muted, theme.colors.surface3, theme.colors.palette.blue],
  );
  const textStyle = useMemo<TextStyle[]>(
    () => [
      styles.text,
      {
        color: muted ? theme.colors.foregroundMuted : "#ffffff",
      },
    ],
    [muted, theme.colors.foregroundMuted],
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
