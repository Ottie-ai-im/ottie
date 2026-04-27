import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FolderOpen, FolderPlus, Smartphone } from "lucide-react-native";
import { OttieLogo } from "@/components/icons/ottie-logo";
import { Button } from "@/components/ui/button";
import { MenuHeader } from "@/components/headers/menu-header";
import { NewTaskModal } from "@/components/new-task-modal";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { useAppSettings } from "@/hooks/use-settings";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { useHasWorkspaces } from "@/stores/session-store-hooks";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";

export function OpenProjectScreen({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const openProjectPicker = useOpenProjectPicker(serverId);
  const { settings } = useAppSettings();
  const hasHydrated = useSessionStore((s) => s.sessions[serverId]?.hasHydratedWorkspaces ?? false);
  const hasProjects = useHasWorkspaces(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);

  const defaultWorkspaceRoot = settings.defaultWorkspaceRoot?.trim() ?? "";
  const hasDefaultWorkspaceRoot = defaultWorkspaceRoot.length > 0;

  const isCompactLayout = useIsCompactFormFactor();

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  const handleOpenPicker = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);
  const handleOpenNewTask = useCallback(() => setIsNewTaskOpen(true), []);
  const handleCloseNewTask = useCallback(() => setIsNewTaskOpen(false), []);

  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <View style={styles.content}>
        <TitlebarDragRegion />
        <View style={styles.logo}>
          <OttieLogo size={56} />
        </View>
        <View style={styles.headingGroup}>
          <Text style={styles.heading}>{t("project.emptyHeading")}</Text>
          {hasHydrated && !hasProjects ? (
            <Text style={styles.subtitle}>{t("project.emptySubtitle")}</Text>
          ) : null}
        </View>
        <View style={styles.cta}>
          {hasDefaultWorkspaceRoot ? (
            <Button
              variant="default"
              leftIcon={FolderPlus}
              onPress={handleOpenNewTask}
              testID="open-project-new-task"
            >
              {t("project.newTaskCta")}
            </Button>
          ) : null}
          <Button
            variant={hasDefaultWorkspaceRoot ? "outline" : "default"}
            leftIcon={FolderOpen}
            onPress={handleOpenPicker}
            testID="open-project-submit"
          >
            {t("project.addProjectCta")}
          </Button>
          {isLocalDaemon ? (
            <Button
              variant="outline"
              leftIcon={Smartphone}
              onPress={handleOpenPairDevice}
              testID="open-project-pair-device"
            >
              {t("project.pairDevice")}
            </Button>
          ) : null}
        </View>
      </View>
      <PairDeviceModal
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
      {hasDefaultWorkspaceRoot ? (
        <NewTaskModal
          visible={isNewTaskOpen}
          onClose={handleCloseNewTask}
          serverId={serverId}
          defaultWorkspaceRoot={defaultWorkspaceRoot}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
    padding: theme.spacing[6],
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  logo: {
    marginBottom: theme.spacing[8],
  },
  headingGroup: {
    alignItems: "center",
    gap: theme.spacing[3],
  },
  cta: {
    marginTop: theme.spacing[12],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
