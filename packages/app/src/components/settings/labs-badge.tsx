import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

/**
 * Stability label rendered next to a labs experiment row.
 *
 * D-10 / UI-SPEC lines 149-152:
 *   - Experimental — filled `statusWarning` (amber). Highest-friction surface.
 *   - Beta         — outlined `statusWarning`. Stable enough to show off.
 *   - Stable       — filled `statusSuccess` (green). Promoted, opt-out only.
 *
 * Three visual variants are intentionally distinct so users can scan a long
 * Labs list and locate the experimental rows by colour weight alone.
 */
export type LabsStability = "experimental" | "beta" | "stable";

export interface LabsBadgeProps {
  stability: LabsStability;
  testID?: string;
}

// Map stability → container variant + label key in lookup tables so the
// component body stays free of nested ternaries (eslint(no-nested-ternary))
// while still keeping the per-stability visual contract from UI-SPEC.
const CONTAINER_STYLE_BY_STABILITY: Record<LabsStability, "experimental" | "beta" | "stable"> = {
  experimental: "experimental",
  beta: "beta",
  stable: "stable",
};
const LABEL_KEY_BY_STABILITY: Record<LabsStability, string> = {
  experimental: "settings.labs.experimental",
  beta: "settings.labs.beta",
  stable: "settings.labs.stable",
};

export function LabsBadge({ stability, testID }: LabsBadgeProps) {
  const { t } = useTranslation();
  const containerStyle = styles[CONTAINER_STYLE_BY_STABILITY[stability]];
  const labelKey = LABEL_KEY_BY_STABILITY[stability];
  // `beta` keeps a coloured label on a transparent fill; the filled variants
  // use the inverted accent foreground so amber/green chips meet AA contrast.
  const labelStyle = stability === "beta" ? styles.labelOutline : styles.labelFilled;
  return (
    <View
      testID={testID ?? `labs-badge-${stability}`}
      accessibilityRole="text"
      style={containerStyle}
    >
      <Text style={labelStyle}>{t(labelKey)}</Text>
    </View>
  );
}

// Each variant pre-composes the base chip box with its colour treatment so
// `style={...}` passes a stable, single-source style object — keeps the
// `react-perf/jsx-no-new-array-as-prop` rule happy without forcing a memo
// hook for what is otherwise a pure presentational component.
const styles = StyleSheet.create((theme) => {
  const base = {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
  };
  const labelBase = {
    fontSize: 10,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 0.5,
  };
  return {
    // UI-SPEC line 149: Experimental — filled amber. Strong call-out.
    experimental: {
      ...base,
      backgroundColor: theme.colors.statusWarning,
      borderColor: theme.colors.statusWarning,
    },
    // UI-SPEC line 150: Beta — outlined amber. No fill so it reads softer.
    beta: {
      ...base,
      backgroundColor: "transparent",
      borderColor: theme.colors.statusWarning,
    },
    // UI-SPEC line 151: Stable — filled green. Confidence cue.
    stable: {
      ...base,
      backgroundColor: theme.colors.statusSuccess,
      borderColor: theme.colors.statusSuccess,
    },
    // White text on filled chips for AA contrast against amber/green fills.
    labelFilled: {
      ...labelBase,
      color: theme.colors.accentForeground,
    },
    // Coloured text on transparent fill so the outline stays the only chrome.
    labelOutline: {
      ...labelBase,
      color: theme.colors.statusWarning,
    },
  };
});
