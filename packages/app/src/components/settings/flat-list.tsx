import { useMemo } from "react";
import { ScrollView, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SettingsGroup } from "@/components/settings/group";
import { SettingsRow } from "@/components/settings/row";

/**
 * D-09 / SET-01 — WeChat-style flat scrolling settings root.
 *
 * Renders the 5 canonical buckets (Account / Agents / Voice / Appearance /
 * Advanced) as `<SettingsGroup>` cards stacked vertically. Each row inside a
 * group navigates to a sub-page via `<SettingsRow>` — typically through the
 * existing `[section].tsx` route convention so legacy slugs (`general`,
 * `shortcuts`, `localDaemon`, etc.) keep working without a router refactor
 * (D-11).
 *
 * The row inventory is intentionally close to the existing settings surface
 * so SET-01 ("nothing removed; reorganized around user intent") holds. New
 * buckets (Account, Voice) get placeholder rows that route through the
 * bucket sub-page until those features land in later phases.
 */
export interface SettingsFlatListProps {
  /**
   * Optional content padding override. Compact mobile layouts pass the safe
   * area inset bottom so the last group isn't clipped behind the home bar.
   */
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SettingsFlatList({ contentContainerStyle, testID }: SettingsFlatListProps) {
  const { t } = useTranslation();
  // Compose the content style once so the prop reference stays stable across
  // re-renders — keeps the `react-perf/jsx-no-new-array-as-prop` rule happy.
  const composedContentStyle = useMemo(
    () => [styles.content, contentContainerStyle],
    [contentContainerStyle],
  );
  return (
    <ScrollView
      testID={testID ?? "settings-flat-list"}
      style={styles.container}
      contentContainerStyle={composedContentStyle}
    >
      <SettingsGroup title={t("settings.section.account")} testID="settings-group-account">
        <SettingsRow
          bucket="account"
          slug="profile"
          label={t("settings.account.profile")}
          testID="settings-row-account-profile"
        />
        <SettingsRow
          bucket="account"
          slug="identity"
          label={t("settings.account.identity")}
          testID="settings-row-account-identity"
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.section.agents")} testID="settings-group-agents">
        <SettingsRow
          bucket="agents"
          slug="integrations"
          label={t("settings.agents.integrations")}
          testID="settings-row-agents-integrations"
        />
        <SettingsRow
          bucket="agents"
          slug="permissions"
          label={t("settings.agents.permissions")}
          testID="settings-row-agents-permissions"
        />
        <SettingsRow
          bucket="advanced"
          slug="extensions"
          label={t("settings.extensions.title")}
          testID="settings-row-agents-extensions"
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.section.voice")} testID="settings-group-voice">
        <SettingsRow
          bucket="voice"
          slug="stt"
          label={t("settings.voice.stt")}
          testID="settings-row-voice-stt"
        />
        <SettingsRow
          bucket="voice"
          slug="tts"
          label={t("settings.voice.tts")}
          testID="settings-row-voice-tts"
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.section.appearance")} testID="settings-group-appearance">
        {/* `general` slug currently houses theme + language + send behavior. */}
        <SettingsRow
          bucket="appearance"
          slug="general"
          label={t("settings.appearance.general")}
          testID="settings-row-appearance-general"
        />
        <SettingsRow
          bucket="appearance"
          slug="shortcuts"
          label={t("settings.appearance.shortcuts")}
          testID="settings-row-appearance-shortcuts"
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.section.advanced")} testID="settings-group-advanced">
        <SettingsRow
          bucket="advanced"
          slug="labs"
          label={t("settings.labs.title")}
          testID="settings-row-advanced-labs"
        />
        <SettingsRow
          bucket="advanced"
          slug="localDaemon"
          label={t("settings.advanced.localDaemon")}
          testID="settings-row-advanced-localDaemon"
        />
        <SettingsRow
          bucket="advanced"
          slug="diagnostics"
          label={t("settings.advanced.diagnostics")}
          testID="settings-row-advanced-diagnostics"
        />
        <SettingsRow
          bucket="advanced"
          slug="usage"
          label={t("settings.advanced.usage")}
          testID="settings-row-advanced-usage"
        />
        <SettingsRow
          bucket="advanced"
          slug="about"
          label={t("settings.advanced.about")}
          testID="settings-row-advanced-about"
        />
      </SettingsGroup>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    paddingVertical: theme.spacing[6],
    gap: theme.spacing[6],
  },
}));
