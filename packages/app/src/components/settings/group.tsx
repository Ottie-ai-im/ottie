import { type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * One of the 5 D-09 buckets rendered as a header + inset card.
 *
 * Header typography matches UI-SPEC line 94 (settings group header):
 *   - `theme.fontSize.sm`
 *   - `theme.fontWeight.semibold`
 *   - `theme.colors.foreground`
 *
 * Children stack inside a single `surface1`-backed card with rounded corners
 * so the row separators belong to the same visual block. Use this primitive
 * (not raw `<View>` + `<Text>`) so all five buckets share the exact same
 * rhythm — Plan 02e's polish pass relies on a consistent group geometry.
 */
export interface SettingsGroupProps {
  title: string;
  children: ReactNode;
  testID?: string;
}

export function SettingsGroup({ title, children, testID }: SettingsGroupProps) {
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.header}>{title}</Text>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginHorizontal: theme.spacing[4],
  },
  header: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  content: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
}));
