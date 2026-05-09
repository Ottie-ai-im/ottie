import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { otterAssets } from "@/assets/otter";
import { PairLinkModal } from "@/components/pair-link-modal";
import { getIsElectronRuntime } from "@/constants/layout";
import { resolveAppVersion } from "@/utils/app-version";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { buildHostRootRoute } from "@/utils/host-routes";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { WelcomeCta } from "./states/welcome-cta";
import { NameInput } from "./states/name-input";
import { ComingSoon } from "./states/coming-soon";

// Empty-home is the unified replacement for the old WelcomeScreen. It is a
// state machine that morphs in place rather than navigating between routes,
// so the user feels like they are already inside the app.
//
// MVP states:
//   welcome      — three CTAs + advanced link
//   name-input   — inline nickname form (calls identityInitialize)
//   advanced     — placeholder for "我用过 Ottie" (folder picker, desktop-only)
//                  and device-link, both surface a "coming soon in desktop"
//                  panel for the MVP
//
// Pair flow (the "配对手机/远程" CTA) is delegated to the existing
// AddHostModal / PairLinkModal so we do not regress that path.

type EmptyHomeState =
  | { kind: "welcome" }
  | { kind: "name-input" }
  | { kind: "advanced"; reason: "old-user" | "device-link" };

interface EmptyHomeCardProps {
  onHostAdded?: (profile: HostProfile) => void;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[8],
    paddingBottom: theme.spacing[6],
    alignItems: "center",
  },
  heroBlock: {
    alignItems: "center",
    gap: theme.spacing[3],
    marginBottom: theme.spacing[8],
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
    maxWidth: 360,
    lineHeight: 20,
  },
  stage: {
    width: "100%",
    maxWidth: 480,
  },
  versionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
    marginTop: theme.spacing[8],
  },
}));

function useFirstOnlineServerId(serverIds: string[]): string | null {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) continue;
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
    () => null,
  );
}

export function EmptyHomeCard({ onHostAdded }: EmptyHomeCardProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const appVersionText = formatVersionWithPrefix(resolveAppVersion());

  const [state, setState] = useState<EmptyHomeState>({ kind: "welcome" });
  const [isPairLinkOpen, setIsPairLinkOpen] = useState(false);

  const hosts = useHosts();
  const onlineServerId = useFirstOnlineServerId(hosts.map((h) => h.serverId));

  const goWelcome = useCallback(() => setState({ kind: "welcome" }), []);
  const goNameInput = useCallback(() => setState({ kind: "name-input" }), []);
  const goAdvancedDeviceLink = useCallback(
    () => setState({ kind: "advanced", reason: "device-link" }),
    [],
  );

  const handleOpenPairLink = useCallback(() => setIsPairLinkOpen(true), []);
  const handleClosePairLink = useCallback(() => setIsPairLinkOpen(false), []);

  // "登录" (old user) means different things per platform:
  //   - desktop (Tauri): pick an existing OTTIE_HOME folder. Folder picker
  //     UI lives in Phase 1/2; for now we surface a coming-soon panel.
  //   - web/mobile: there's no folder concept — "logging in" is pairing
  //     to an already-initialized daemon. Open the pair modal directly.
  const handlePickOldUser = useCallback(() => {
    if (getIsElectronRuntime()) {
      setState({ kind: "advanced", reason: "old-user" });
      return;
    }
    setIsPairLinkOpen(true);
  }, []);

  const handleHostSaved = useCallback(
    ({ profile, serverId }: { profile: HostProfile; serverId: string }) => {
      onHostAdded?.(profile);
      router.replace(buildHostRootRoute(serverId));
    },
    [onHostAdded, router],
  );

  const handleNameSubmitted = useCallback(
    (serverId: string) => {
      router.replace(buildHostRootRoute(serverId));
    },
    [router],
  );

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        paddingTop: theme.spacing[8] + insets.top,
        paddingBottom: theme.spacing[6] + insets.bottom,
      },
    ],
    [insets.bottom, insets.top, theme.spacing],
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={containerStyle}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="empty-home-card"
      >
        <View style={styles.heroBlock}>
          <otterAssets.welcome size={88} />
          <Text style={styles.title}>{t("emptyHome.title")}</Text>
          <Text style={styles.subtitle}>{t("emptyHome.subtitle")}</Text>
        </View>

        <View style={styles.stage}>
          {state.kind === "welcome" ? (
            <WelcomeCta
              onPickNewUser={goNameInput}
              onPickOldUser={handlePickOldUser}
              onPickPair={handleOpenPairLink}
              onPickAdvancedLink={goAdvancedDeviceLink}
            />
          ) : null}

          {state.kind === "name-input" ? (
            <NameInput
              onlineServerId={onlineServerId}
              onPair={handleOpenPairLink}
              onBack={goWelcome}
              onCompleted={handleNameSubmitted}
            />
          ) : null}

          {state.kind === "advanced" ? (
            <ComingSoon reason={state.reason} onBack={goWelcome} />
          ) : null}
        </View>

        <Text style={styles.versionLabel}>{appVersionText}</Text>
      </ScrollView>

      <PairLinkModal
        visible={isPairLinkOpen}
        onClose={handleClosePairLink}
        onSaved={handleHostSaved}
      />
    </View>
  );
}
