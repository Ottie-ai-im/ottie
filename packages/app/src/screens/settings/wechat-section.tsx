import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { SettingsSection } from "@/screens/settings/settings-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAppSettings } from "@/hooks/use-settings";

type ToggleValue = "off" | "on";

const ON_OFF_OPTIONS: { value: ToggleValue; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

/**
 * Settings → WeChat panel. Two controls only:
 *
 *   1. Show/hide the sidebar section. Off makes ottie behave as if
 *      WeChat integration didn't exist — the section disappears, no
 *      polling, no wx subprocess spawning.
 *   2. Reset privacy notice. Re-arms the modal that gates LLM calls so
 *      the user can re-confirm or revoke without digging into
 *      AsyncStorage.
 *
 * Model selection lives in the AI Agent settings panel; we surface a
 * one-line hint pointing at it rather than duplicating the picker
 * here — there's no dedicated WeChat model in the MVP, just whatever
 * the user picked for Hermes.
 */
export function WechatSettingsSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();

  const handleToggleEnabled = useCallback(
    (next: ToggleValue) => {
      void updateSettings({ wechatEnabled: next === "on" });
    },
    [updateSettings],
  );

  const handleResetPrivacy = useCallback(() => {
    void updateSettings({ wechatPrivacyAgreed: false });
  }, [updateSettings]);

  return (
    <SettingsSection title={t("wechat.settings.title")} testID="settings-wechat">
      <Text style={styles.description}>{t("wechat.settings.description")}</Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t("wechat.settings.enabled")}</Text>
        <SegmentedControl
          value={settings.wechatEnabled ? "on" : "off"}
          onValueChange={handleToggleEnabled}
          options={ON_OFF_OPTIONS}
          size="sm"
        />
      </View>

      <Text style={styles.hint}>{t("wechat.settings.modelHint")}</Text>

      {settings.wechatPrivacyAgreed ? (
        <Pressable
          onPress={handleResetPrivacy}
          accessibilityRole="button"
          style={styles.resetButton}
        >
          <Text style={styles.resetLabel}>{t("wechat.settings.privacyResetLabel")}</Text>
          <Text style={styles.resetHint}>{t("wechat.settings.privacyResetHint")}</Text>
        </Pressable>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  description: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
    marginBottom: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowLabel: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  resetButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: 2,
  },
  resetLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  resetHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
