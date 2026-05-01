import { Text, View } from "react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { LabsBadge, type LabsStability } from "@/components/settings/labs-badge";
import { SegmentedControl } from "@/components/ui/segmented-control";

/**
 * Registry-driven Labs entry row (D-10).
 *
 * Used by the Labs sub-page after Plan 02d's refactor: each row is a single
 * `<LabsRow>` rendered from a `LABS_REGISTRY` array, replacing the prior
 * hand-rolled per-experiment cards. Stability badge sits next to the title;
 * the on/off SegmentedControl drives the bound `betaFeatures` flag.
 *
 * Optional `description` and `children` slots stay so an experiment with
 * extra controls (hotkey picker, intent provider) can render them inline
 * under the master toggle without breaking the row's layout — the registry
 * still owns the title/stability/master-enabled decision.
 */
export interface LabsRowProps {
  title: string;
  description: string;
  stability: LabsStability;
  enabled: boolean;
  onToggle(value: boolean): void;
  /**
   * Optional slot for nested experiment controls — only relevant when the
   * experiment exposes more than the master toggle (e.g. push-to-talk
   * hotkey for voice control). Plain rows omit this.
   */
  children?: React.ReactNode;
  testID?: string;
}

type ToggleValue = "on" | "off";

export function LabsRow({
  title,
  description,
  stability,
  enabled,
  onToggle,
  children,
  testID,
}: LabsRowProps) {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      { value: "on" as const, label: t("common.on", { defaultValue: "On" }) },
      { value: "off" as const, label: t("common.off", { defaultValue: "Off" }) },
    ],
    [t],
  );
  const handleChange = useCallback(
    (value: ToggleValue) => {
      onToggle(value === "on");
    },
    [onToggle],
  );

  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.header}>
        <View style={styles.titleColumn}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            <LabsBadge stability={stability} />
          </View>
          <Text style={styles.description}>{description}</Text>
        </View>
        <SegmentedControl
          size="sm"
          value={enabled ? "on" : "off"}
          onValueChange={handleChange}
          options={options}
        />
      </View>
      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  titleColumn: {
    flex: 1,
    gap: theme.spacing[1],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  description: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  body: {
    gap: theme.spacing[2],
  },
}));
