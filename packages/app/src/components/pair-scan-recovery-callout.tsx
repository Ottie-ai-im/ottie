// Inline recovery callout shown beneath the pair-scan surface when a
// pairing attempt fails. Replaces the previous Alert.alert per ONB-03 +
// CONTEXT D-21: failures must surface inline, must offer self-serve
// recovery, must not lose any typed manual-entry input across attempts,
// and the "switch to local daemon" affordance is Tauri-only.
//
// Rendered inside a <GlassSurface radius="card"> per UI-SPEC D-16. The
// shared <CalloutCard variant="error"> primitive owns the title +
// description; the three recovery actions live in a sibling row below the
// card because CalloutCard caps `actions[]` at 2 by design (preserves the
// shared empty/error layout). Putting the buttons in their own row also
// keeps the iOS-friendly tap targets uniform.

import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { CalloutCard } from "@/components/callout-card";
import { GlassSurface } from "@/components/ui/glass-surface";
import { getIsElectron } from "@/constants/platform";

export interface PairScanRecoveryCalloutProps {
  onRegenerate: () => void;
  onManualEntry: () => void;
  onUseLocal: () => void;
  onDismiss?: () => void;
  testID?: string;
}

const styles = StyleSheet.create((theme) => ({
  surface: {
    marginTop: theme.spacing[4],
  },
  actionRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
  actionButton: {
    flex: 1,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous" as const,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonPressed: {
    opacity: 0.8,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    textAlign: "center",
  },
}));

interface RecoveryActionButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

function RecoveryActionButton({ label, onPress, disabled, testID }: RecoveryActionButtonProps) {
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.actionButton,
      pressed ? styles.actionButtonPressed : null,
      disabled ? styles.actionButtonDisabled : null,
    ],
    [disabled],
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={useMemo(() => ({ disabled: Boolean(disabled) }), [disabled])}
      style={pressableStyle}
    >
      <Text style={styles.actionLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export function PairScanRecoveryCallout({
  onRegenerate,
  onManualEntry,
  onUseLocal,
  onDismiss,
  testID,
}: PairScanRecoveryCalloutProps) {
  // Hooks read at top so we can rely on a stable order across renders.
  // useUnistyles is intentionally invoked even when its return is unused —
  // the hook subscribes the component to theme changes so the StyleSheet
  // re-resolves correctly when the user toggles light/dark mode.
  useUnistyles();
  const { t } = useTranslation();
  const canUseLocal = getIsElectron();
  const resolvedTestID = testID ?? "pair-scan-recovery-callout";
  const useLocalLabel = canUseLocal
    ? t("errors.pairScanFailed.useLocal")
    : `${t("errors.pairScanFailed.useLocal")} — ${t("errors.pairScanFailed.useLocalDesktopOnly")}`;
  const handleUseLocal = useCallback(() => {
    if (!canUseLocal) return;
    onUseLocal();
  }, [canUseLocal, onUseLocal]);

  return (
    <GlassSurface radius="card" style={styles.surface}>
      <CalloutCard
        testID={resolvedTestID}
        variant="error"
        title={t("errors.pairScanFailed.heading")}
        description={t("errors.pairScanFailed.body")}
        onDismiss={onDismiss}
      />
      <View style={styles.actionRow} testID={`${resolvedTestID}-actions`}>
        <RecoveryActionButton
          label={t("errors.pairScanFailed.regenerate")}
          onPress={onRegenerate}
          testID="pair-scan-recovery-regenerate"
        />
        <RecoveryActionButton
          label={t("errors.pairScanFailed.manualEntry")}
          onPress={onManualEntry}
          testID="pair-scan-recovery-manual"
        />
        <RecoveryActionButton
          label={useLocalLabel}
          onPress={handleUseLocal}
          disabled={!canUseLocal}
          testID="pair-scan-recovery-use-local"
        />
      </View>
    </GlassSurface>
  );
}
