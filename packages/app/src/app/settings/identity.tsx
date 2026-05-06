import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import type {
  IdentityStateOnWire,
  PublicDevice,
} from "@server/server/identity/identity-rpc-schemas";
import type { HostProfile } from "@/types/host-connection";

// Phase 1.f — read-only "My identity & devices" page.
// Phase 2.b adds: device list comes from the new device/list RPC instead of
// being a single hardcoded "this device" row. Phase 2.c+ will add the
// "Add device" affordance and remove-device action.

type FetchState =
  | { phase: "loading" }
  | {
      phase: "loaded";
      state: IdentityStateOnWire;
      serverId: string;
      serverLabel: string;
      devices: PublicDevice[];
    }
  | { phase: "no-host" }
  | { phase: "error"; message: string };

const styles = StyleSheet.create((theme) => {
  const card = {
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  };
  const sectionTitle = {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: -0.1,
    textTransform: "uppercase" as const,
  };
  const helper = {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  };
  return {
    root: {
      flex: 1,
      backgroundColor: theme.colors.surface0,
    },
    scroll: {
      flex: 1,
    },
    container: {
      padding: theme.spacing[6],
      gap: theme.spacing[6],
      maxWidth: 560,
      width: "100%" as const,
      alignSelf: "center" as const,
    },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: theme.spacing[2],
    },
    backButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: theme.spacing[1],
      paddingVertical: theme.spacing[1],
      paddingRight: theme.spacing[3],
    },
    backLabel: {
      fontFamily: theme.fontFamily.system,
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
    title: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize["2xl"],
      fontWeight: theme.fontWeight.semibold,
      letterSpacing: -0.4,
    },
    sectionTitle,
    sectionTitleSpaced: { ...sectionTitle, marginTop: theme.spacing[6] },
    card,
    cardSpaced: { ...card, marginTop: theme.spacing[2] },
    cardCompactSpaced: { ...card, marginTop: theme.spacing[3] },
    row: {
      gap: theme.spacing[1],
    },
    rowLabel: {
      fontFamily: theme.fontFamily.system,
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.xs,
      fontWeight: theme.fontWeight.medium,
      letterSpacing: -0.1,
    },
    rowValue: {
      fontFamily: theme.fontFamily.system,
      color: theme.colors.foreground,
      fontSize: theme.fontSize.base,
    },
    rowValueMono: {
      fontFamily: theme.fontFamily.system,
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
      letterSpacing: -0.1,
    },
    helper,
    helperSpaced: { ...helper, marginTop: theme.spacing[2] },
    warningCard: {
      backgroundColor: theme.colors.surfaceGlass,
      borderRadius: theme.borderRadius.field,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: theme.colors.destructive,
      padding: theme.spacing[4],
      gap: theme.spacing[2],
    },
    warningText: {
      fontFamily: theme.fontFamily.system,
      color: theme.colors.destructive,
      fontSize: theme.fontSize.sm,
      lineHeight: 20,
    },
  };
});

function pickPrimaryHost(hosts: HostProfile[]): { serverId: string; label: string } | null {
  // Phase 1.f: a user only has one daemon today, so "primary" = first registered.
  // Phase 2 will need to broaden this to "currently online primary" with a
  // multi-daemon-per-user policy from §13 Q7 of the design doc.
  const first = hosts[0];
  if (!first) return null;
  return { serverId: first.serverId, label: first.label || first.serverId };
}

export default function IdentitySettingsRoute() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hosts = useHosts();
  const primaryHost = useMemo(() => pickPrimaryHost(hosts), [hosts]);
  const client = useHostRuntimeClient(primaryHost?.serverId ?? "");
  const [fetchState, setFetchState] = useState<FetchState>({ phase: "loading" });

  useEffect(() => {
    if (!primaryHost) {
      setFetchState({ phase: "no-host" });
      return;
    }
    if (!client) {
      setFetchState({ phase: "loading" });
      return;
    }
    let cancelled = false;
    setFetchState({ phase: "loading" });
    void (async () => {
      let next: FetchState;
      try {
        // Fan out identity/get + device/list in parallel — both are tiny,
        // and parallel cuts the visible loading window roughly in half on
        // slow connections (relay latency dominates).
        const [identityResponse, devicesResponse] = await Promise.all([
          client.identityGet(),
          client.devicesList(),
        ]);
        if (identityResponse.error || !identityResponse.state) {
          next = {
            phase: "error",
            message: identityResponse.error ?? t("identity.loadFailed"),
          };
        } else {
          // device/list errors are non-fatal here — we still want to render
          // the identity card. Empty array is the graceful fallback.
          const devices = devicesResponse.devices ?? [];
          next = {
            phase: "loaded",
            state: identityResponse.state,
            serverId: primaryHost.serverId,
            serverLabel: primaryHost.label,
            devices,
          };
        }
      } catch (err) {
        next = { phase: "error", message: err instanceof Error ? err.message : String(err) };
      }
      if (!cancelled) {
        setFetchState(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, primaryHost, t]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [router]);

  const rootStyle = useMemo(() => [styles.root, { paddingTop: insets.top }], [insets.top]);

  const body = renderBody(fetchState, t);

  return (
    <View style={rootStyle}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
          >
            <ChevronLeft size={20} color={theme.colors.foregroundMuted} />
            <Text style={styles.backLabel}>{t("common.back")}</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{t("identitySettings.title")}</Text>
        {body}
      </ScrollView>
    </View>
  );
}

function renderBody(
  fetchState: FetchState,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (fetchState.phase === "loading") {
    return <Text style={styles.helper}>{t("common.loading")}</Text>;
  }
  if (fetchState.phase === "no-host") {
    return <Text style={styles.helper}>{t("identitySettings.noHost")}</Text>;
  }
  if (fetchState.phase === "error") {
    return (
      <View style={styles.warningCard}>
        <Text style={styles.warningText}>{fetchState.message}</Text>
      </View>
    );
  }
  return <LoadedBody fetchState={fetchState} t={t} />;
}

function LoadedBody({
  fetchState,
  t,
}: {
  fetchState: Extract<FetchState, { phase: "loaded" }>;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { state, serverId, serverLabel } = fetchState;

  if (state.kind === "uninitialized") {
    return (
      <View style={styles.card}>
        <Text style={styles.helper}>{t("identitySettings.uninitialized")}</Text>
      </View>
    );
  }

  if (state.kind === "load-failed") {
    return (
      <View style={styles.warningCard}>
        <Text style={styles.warningText}>{t("identity.loadFailed")}</Text>
        <Text style={styles.helper}>{t("identity.loadFailedHelp")}</Text>
        <Text style={styles.helper}>{state.error}</Text>
      </View>
    );
  }

  const { identity } = state;
  const fingerprint = identity.rootSignPublicKeyB64.slice(0, 8);

  return (
    <View>
      <Text style={styles.sectionTitle}>{t("identitySettings.identitySection")}</Text>
      <View style={styles.cardSpaced}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t("identitySettings.displayName")}</Text>
          <Text style={styles.rowValue}>
            {identity.displayName} ({fingerprint})
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t("identitySettings.rootPubkey")}</Text>
          <Text style={styles.rowValueMono}>{identity.rootSignPublicKeyB64}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t("identitySettings.createdAt")}</Text>
          <Text style={styles.rowValue}>{identity.createdAt}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitleSpaced}>{t("identitySettings.devicesSection")}</Text>
      {fetchState.devices.length === 0 ? (
        // Phase 1 daemons that haven't migrated to a Phase 2.a self-device yet
        // (or daemons running an older binary that doesn't expose device/list).
        // Fall back to the "this device" view we used in Phase 1.f.
        <View style={styles.cardSpaced}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t("identitySettings.thisDevice")}</Text>
            <Text style={styles.rowValue}>{serverLabel}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t("identitySettings.serverId")}</Text>
            <Text style={styles.rowValueMono}>{serverId}</Text>
          </View>
        </View>
      ) : (
        fetchState.devices.map((device, index) => (
          <View
            key={device.deviceId}
            style={index === 0 ? styles.cardSpaced : styles.cardCompactSpaced}
          >
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                {device.deviceId === serverId
                  ? t("identitySettings.thisDevice")
                  : t("identitySettings.deviceLabel")}
              </Text>
              <Text style={styles.rowValue}>
                {device.deviceLabel} ({device.signPublicKeyB64.slice(0, 8)})
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t("identitySettings.role")}</Text>
              <Text style={styles.rowValue}>{device.role}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t("identitySettings.deviceId")}</Text>
              <Text style={styles.rowValueMono}>{device.deviceId}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t("identitySettings.authorizedAt")}</Text>
              <Text style={styles.rowValue}>{device.authorizedAt}</Text>
            </View>
          </View>
        ))
      )}
      <Text style={styles.helperSpaced}>{t("identitySettings.devicesComingSoon")}</Text>
    </View>
  );
}
