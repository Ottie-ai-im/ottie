import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { QrCode, Link2, ClipboardPaste, ExternalLink, Settings } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HostProfile } from "@/types/host-connection";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { AddHostModal } from "./add-host-modal";
import { PairLinkModal } from "./pair-link-modal";
import { Button } from "@/components/ui/button";
import { resolveAppVersion } from "@/utils/app-version";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { buildHostRootRoute } from "@/utils/host-routes";
import { OttieLogo } from "@/components/icons/ottie-logo";
import { openExternalUrl } from "@/utils/open-external-url";
import { isWeb, isNative } from "@/constants/platform";

interface WelcomeAction {
  key: "scan-qr" | "direct-connection" | "paste-pairing-link";
  label: string;
  testID: string;
  primary: boolean;
  icon: typeof QrCode;
  onPress: () => void;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollView: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: theme.spacing[6],
    paddingBottom: 0,
    alignItems: "center",
  },
  content: {
    width: "100%",
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
    letterSpacing: -0.4,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  copyBlock: {
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[6],
    marginBottom: theme.spacing[12],
  },
  actions: {
    width: "100%",
    maxWidth: 420,
    gap: theme.spacing[3],
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionButtonPrimary: {
    backgroundColor: theme.colors.foreground,
    borderColor: theme.colors.foreground,
  },
  actionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  actionTextPrimary: {
    color: theme.colors.surface0,
  },
  setupLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  setupLinkText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    textDecorationLine: "underline",
  },
  versionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
    marginTop: theme.spacing[6],
  },
  settingsButton: {
    alignSelf: "center",
    marginTop: theme.spacing[6],
  },
}));

function useAnyHostOnline(serverIds: string[]): string | null {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
  );
}

export interface WelcomeScreenProps {
  onHostAdded?: (profile: HostProfile) => void;
}

export function WelcomeScreen({ onHostAdded }: WelcomeScreenProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const [isDirectOpen, setIsDirectOpen] = useState(false);
  const [isPasteLinkOpen, setIsPasteLinkOpen] = useState(false);
  const hosts = useHosts();
  const anyOnlineServerId = useAnyHostOnline(hosts.map((h) => h.serverId));

  useEffect(() => {
    if (!anyOnlineServerId) return;
    router.replace(buildHostRootRoute(anyOnlineServerId));
  }, [anyOnlineServerId, router]);

  const finishOnboarding = useCallback(
    (serverId: string) => {
      router.replace(buildHostRootRoute(serverId));
    },
    [router],
  );

  const handleOpenOttieSite = useCallback(() => {
    void openExternalUrl("https://github.com/Wendell-Guan/ottie");
  }, []);

  const handleOpenSettings = useCallback(() => {
    router.push("/settings");
  }, [router]);

  const handleOpenDirect = useCallback(() => setIsDirectOpen(true), []);
  const handleCloseDirect = useCallback(() => setIsDirectOpen(false), []);
  const handleOpenPasteLink = useCallback(() => setIsPasteLinkOpen(true), []);
  const handleClosePasteLink = useCallback(() => setIsPasteLinkOpen(false), []);
  const handleScanQr = useCallback(() => {
    router.push("/pair-scan?source=onboarding");
  }, [router]);

  const handleHostSaved = useCallback(
    ({ profile, serverId }: { profile: HostProfile; serverId: string }) => {
      onHostAdded?.(profile);
      finishOnboarding(serverId);
    },
    [onHostAdded, finishOnboarding],
  );

  const actions: WelcomeAction[] = isWeb
    ? [
        {
          key: "direct-connection",
          label: t("welcome.openOnDesktop"),
          testID: "welcome-direct-connection",
          primary: true,
          icon: Link2,
          onPress: handleOpenDirect,
        },
        {
          key: "paste-pairing-link",
          label: t("welcome.pasteLink"),
          testID: "welcome-paste-pairing-link",
          primary: false,
          icon: ClipboardPaste,
          onPress: handleOpenPasteLink,
        },
      ]
    : [
        {
          key: "scan-qr",
          label: t("welcome.scanQr"),
          testID: "welcome-scan-qr",
          primary: true,
          icon: QrCode,
          onPress: handleScanQr,
        },
        {
          key: "direct-connection",
          label: t("welcome.openOnDesktop"),
          testID: "welcome-direct-connection",
          primary: false,
          icon: Link2,
          onPress: handleOpenDirect,
        },
        {
          key: "paste-pairing-link",
          label: t("welcome.pasteLink"),
          testID: "welcome-paste-pairing-link",
          primary: false,
          icon: ClipboardPaste,
          onPress: handleOpenPasteLink,
        },
      ];

  const isConnectingToSavedHosts = hosts.length > 0 && !anyOnlineServerId;

  const scrollContentContainerStyle = useMemo(
    () => [styles.container, { paddingBottom: theme.spacing[6] + insets.bottom }],
    [theme.spacing, insets.bottom],
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={scrollContentContainerStyle}
        showsVerticalScrollIndicator={false}
        testID="welcome-screen"
      >
        <View style={styles.content}>
          <OttieLogo size={96} />
          <View style={styles.copyBlock}>
            {isConnectingToSavedHosts ? (
              <Text style={styles.subtitle}>{t("common.loading")}</Text>
            ) : (
              <>
                <Text style={styles.title}>{t("welcome.title")}</Text>
                <Text style={styles.subtitle}>{t("welcome.subtitle")}</Text>
                {isNative ? (
                  <Pressable style={styles.setupLink} onPress={handleOpenOttieSite}>
                    <Text style={styles.setupLinkText}>ottie.app</Text>
                    <ExternalLink size={14} color={theme.colors.foregroundMuted} />
                  </Pressable>
                ) : null}
              </>
            )}
          </View>

          <View style={styles.actions}>
            {actions.map((action) => (
              <WelcomeActionButton key={action.key} action={action} />
            ))}
          </View>

          <Button
            variant="ghost"
            size="sm"
            leftIcon={Settings}
            onPress={handleOpenSettings}
            style={styles.settingsButton}
            testID="welcome-open-settings"
          >
            {t("welcome.settingsButton")}
          </Button>
        </View>
        <Text style={styles.versionLabel}>{appVersionText}</Text>

        <AddHostModal
          visible={isDirectOpen}
          onClose={handleCloseDirect}
          onSaved={handleHostSaved}
        />

        <PairLinkModal
          visible={isPasteLinkOpen}
          onClose={handleClosePasteLink}
          onSaved={handleHostSaved}
        />
      </ScrollView>
    </View>
  );
}

interface WelcomeActionButtonProps {
  action: WelcomeAction;
}

function WelcomeActionButton({ action }: WelcomeActionButtonProps) {
  const { theme } = useUnistyles();
  const Icon = action.icon;
  const buttonStyle = useMemo(
    () => [styles.actionButton, action.primary ? styles.actionButtonPrimary : null],
    [action.primary],
  );
  const textStyle = useMemo(
    () => [styles.actionText, action.primary ? styles.actionTextPrimary : null],
    [action.primary],
  );
  return (
    <Pressable style={buttonStyle} onPress={action.onPress} testID={action.testID}>
      <Icon
        size={18}
        color={action.primary ? theme.colors.accentForeground : theme.colors.foreground}
      />
      <Text style={textStyle}>{action.label}</Text>
    </Pressable>
  );
}
