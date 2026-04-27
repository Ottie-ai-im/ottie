import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ArrowUpRight, Terminal, Blocks, Check } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  shouldUseDesktopDaemon,
  getCliInstallStatus,
  installCli,
  getSkillsInstallStatus,
  installSkills,
  type InstallStatus,
} from "@/desktop/daemon/desktop-daemon";

const CLI_DOCS_URL = "https://github.com/Wendell-Guan/ottie/tree/main/packages/cli";
const SKILLS_DOCS_URL = "https://github.com/Wendell-Guan/ottie/tree/main/skills";
const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];

export function IntegrationsSection() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const showSection = shouldUseDesktopDaemon();

  const [cliStatus, setCliStatus] = useState<InstallStatus | null>(null);
  const [skillsStatus, setSkillsStatus] = useState<InstallStatus | null>(null);
  const [isInstallingCli, setIsInstallingCli] = useState(false);
  const [isInstallingSkills, setIsInstallingSkills] = useState(false);

  const loadStatus = useCallback(() => {
    if (!showSection) return;
    void getCliInstallStatus()
      .then(setCliStatus)
      .catch((error) => {
        console.error("[Integrations] Failed to load CLI status", error);
      });
    void getSkillsInstallStatus()
      .then(setSkillsStatus)
      .catch((error) => {
        console.error("[Integrations] Failed to load skills status", error);
      });
  }, [showSection]);

  useFocusEffect(
    useCallback(() => {
      if (!showSection) return undefined;
      loadStatus();
      return undefined;
    }, [loadStatus, showSection]),
  );

  const handleInstallCli = useCallback(() => {
    if (isInstallingCli) return;
    setIsInstallingCli(true);
    void installCli()
      .then(setCliStatus)
      .catch((error) => {
        console.error("[Integrations] Failed to install CLI", error);
      })
      .finally(() => {
        setIsInstallingCli(false);
      });
  }, [isInstallingCli]);

  const handleInstallSkills = useCallback(() => {
    if (isInstallingSkills) return;
    setIsInstallingSkills(true);
    void installSkills()
      .then(setSkillsStatus)
      .catch((error) => {
        console.error("[Integrations] Failed to install skills", error);
      })
      .finally(() => {
        setIsInstallingSkills(false);
      });
  }, [isInstallingSkills]);

  const handleOpenCliDocs = useCallback(() => {
    void openExternalUrl(CLI_DOCS_URL);
  }, []);

  const handleOpenSkillsDocs = useCallback(() => {
    void openExternalUrl(SKILLS_DOCS_URL);
  }, []);

  const arrowIcon = useMemo(
    () => <ArrowUpRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    [theme.iconSize.sm, theme.colors.foregroundMuted],
  );

  const trailing = useMemo(
    () => (
      <View style={styles.headerLinks}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={arrowIcon}
          textStyle={settingsStyles.sectionHeaderLinkText}
          style={settingsStyles.sectionHeaderLink}
          onPress={handleOpenCliDocs}
          accessibilityLabel={t("integrations.openCliDocs")}
        >
          {t("integrations.cliDocs")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={arrowIcon}
          textStyle={settingsStyles.sectionHeaderLinkText}
          style={settingsStyles.sectionHeaderLink}
          onPress={handleOpenSkillsDocs}
          accessibilityLabel={t("integrations.openSkillsDocs")}
        >
          {t("integrations.skillsDocs")}
        </Button>
      </View>
    ),
    [arrowIcon, handleOpenCliDocs, handleOpenSkillsDocs, t],
  );

  if (!showSection) {
    return null;
  }

  return (
    <SettingsSection title={t("integrations.title")} trailing={trailing}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <View style={styles.rowTitleRow}>
              <Terminal size={theme.iconSize.md} color={theme.colors.foreground} />
              <Text style={settingsStyles.rowTitle}>{t("integrations.commandLine")}</Text>
            </View>
            <Text style={settingsStyles.rowHint}>{t("integrations.commandLineHint")}</Text>
          </View>
          {cliStatus?.installed ? (
            <View style={styles.installedLabel}>
              <Check size={14} color={theme.colors.foregroundMuted} />
              <Text style={styles.mutedText}>{t("integrations.installed")}</Text>
            </View>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onPress={handleInstallCli}
              disabled={isInstallingCli}
            >
              {isInstallingCli ? t("integrations.installing") : t("integrations.install")}
            </Button>
          )}
        </View>
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <View style={styles.rowTitleRow}>
              <Blocks size={theme.iconSize.md} color={theme.colors.foreground} />
              <Text style={settingsStyles.rowTitle}>{t("integrations.orchestrationSkills")}</Text>
            </View>
            <Text style={settingsStyles.rowHint}>{t("integrations.orchestrationSkillsHint")}</Text>
          </View>
          {skillsStatus?.installed ? (
            <View style={styles.installedLabel}>
              <Check size={14} color={theme.colors.foregroundMuted} />
              <Text style={styles.mutedText}>{t("integrations.installed")}</Text>
            </View>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onPress={handleInstallSkills}
              disabled={isInstallingSkills}
            >
              {isInstallingSkills ? t("integrations.installing") : t("integrations.install")}
            </Button>
          )}
        </View>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerLinks: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0],
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  installedLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
