import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { otterAssets } from "@/assets/otter";
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
        <View style={styles.centerStack}>
          <View style={styles.logo}>
            <otterAssets.emptyState size={56} />
          </View>
          {hasHydrated && !hasProjects ? (
            <View style={styles.headingGroup}>
              <Text style={styles.subtitle}>{t("project.emptySubtitle")}</Text>
            </View>
          ) : null}
          <View style={styles.cta}>
            <Button
              variant="default"
              onPress={hasDefaultWorkspaceRoot ? handleOpenNewTask : handleOpenPicker}
              testID={hasDefaultWorkspaceRoot ? "open-project-new-task" : "open-project-submit"}
            >
              {hasDefaultWorkspaceRoot ? t("project.newTaskCta") : t("project.addProjectCta")}
            </Button>
            <View style={styles.secondaryLinks}>
              {hasDefaultWorkspaceRoot ? (
                <Pressable onPress={handleOpenPicker} testID="open-project-submit">
                  <Text style={styles.linkText}>{t("project.addProjectCta")}</Text>
                </Pressable>
              ) : null}
              {isLocalDaemon ? (
                <Pressable onPress={handleOpenPairDevice} testID="open-project-pair-device">
                  <Text style={styles.linkText}>{t("project.pairDevice")}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
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
    padding: theme.spacing[6],
    // Pull the inner stack up by the header allowance so it lands at the
    // *visual* center of the pane (the header eats vertical space at the
    // top, so a plain center looks low).
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  centerStack: {
    width: "100%",
    maxWidth: 520,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    marginBottom: theme.spacing[8],
  },
  headingGroup: {
    alignItems: "center",
    gap: theme.spacing[3],
  },
  cta: {
    marginTop: theme.spacing[6],
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
  },
  secondaryLinks: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    columnGap: theme.spacing[4],
    rowGap: theme.spacing[2],
  },
  linkText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    letterSpacing: -0.1,
  },
  subtitle: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    letterSpacing: -0.1,
    textAlign: "center",
  },
}));
