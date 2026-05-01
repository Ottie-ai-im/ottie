import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useCallback } from "react";
import { ChevronRight } from "lucide-react-native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  buildSettingsBucketRoute,
  buildSettingsSectionRoute,
  isSettingsSectionSlug,
  type SettingsBucket,
  type SettingsSectionSlug,
} from "@/utils/host-routes";

/**
 * Settings row primitive — a single navigable entry inside a `<SettingsGroup>`.
 *
 * Tapping a row pushes onto the `/settings/...` route stack. By default the
 * `slug` resolves through the existing `[section].tsx` route convention so
 * legacy paths keep working (D-11). Callers can override navigation with
 * `onPressOverride` for buckets / rows that target a different sub-page.
 *
 * The chevron is decorative — it uses the `accessibilityElementsHidden` /
 * `importantForAccessibility="no"` pair so screen readers don't announce
 * "right arrow image" alongside the row label.
 */
export interface SettingsRowProps {
  bucket: SettingsBucket;
  /**
   * Either a known `SettingsSectionSlug` (resolves to `/settings/{slug}`) or
   * an arbitrary string. Unknown slugs route to the bucket sub-page so new
   * row labels work without a separate route entry.
   */
  slug: string;
  label: string;
  hint?: string;
  testID?: string;
  /**
   * Replace the default router.push behaviour. Useful for rows that open a
   * modal / picker rather than a new screen.
   */
  onPressOverride?(): void;
}

function rowPressableStyle({ pressed }: PressableStateCallbackType) {
  return [styles.row, pressed && styles.rowPressed];
}

export function SettingsRow({
  bucket,
  slug,
  label,
  hint,
  testID,
  onPressOverride,
}: SettingsRowProps) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(() => {
    if (onPressOverride) {
      onPressOverride();
      return;
    }
    if (isSettingsSectionSlug(slug)) {
      router.push(buildSettingsSectionRoute(slug as SettingsSectionSlug));
      return;
    }
    // Unknown slug — fall back to the bucket landing page so the press is
    // never a dead end.
    router.push(buildSettingsBucketRoute(bucket));
  }, [bucket, slug, onPressOverride]);

  return (
    <Pressable
      testID={testID ?? `settings-row-${slug}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={handlePress}
      style={rowPressableStyle}
    >
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        {hint != null ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <ChevronRight
        size={theme.iconSize.sm}
        color={theme.colors.foregroundMuted}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    minHeight: 48,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  body: {
    flex: 1,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    marginTop: theme.spacing[1],
  },
}));
