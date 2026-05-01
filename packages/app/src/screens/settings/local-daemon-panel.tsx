// Settings → Advanced → Local daemon panel (D-13).
//
// Surfaces the local-daemon auth token state to the user. Three rows:
//   1. Status — current mode (loopback-trust / token-file / explicit) + presence
//   2. Locate token — guidance string pointing at $OTTIE_HOME/local-token
//      (the value never crosses the WS — T-05-08; users find it on disk)
//   3. Regenerate — confirms with an Alert, then RPCs the daemon
//
// Bilingual strings (CLAUDE.md hard rule): every visible string keyed under
// `settings.localDaemon.*` in en.json + zh.json with parallel structure.
//
// Hidden behind the existing settings IA — surfaced as a new "localDaemon"
// section slug. Phase 4 (SET-01) reorganizes this into the planned
// Account/Agents/Voice/Appearance/Advanced groups.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Lock, RefreshCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";

type LocalTokenMode = "loopback-trust" | "token-file" | "explicit";

interface LocalTokenStatusState {
  mode: LocalTokenMode | null;
  tokenPresent: boolean | null;
  isLoading: boolean;
  error: string | null;
}

const INITIAL_STATUS: LocalTokenStatusState = {
  mode: null,
  tokenPresent: null,
  isLoading: false,
  error: null,
};

export function LocalDaemonPanel() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const hosts = useHosts();
  const probeServerId = hosts[0]?.serverId ?? null;
  const client = useHostRuntimeClient(probeServerId ?? "");
  const isConnected = useHostRuntimeIsConnected(probeServerId ?? "");

  const [status, setStatus] = useState<LocalTokenStatusState>(INITIAL_STATUS);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!client || !isConnected) {
      return;
    }
    setStatus((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await client.getLocalTokenStatus({});
      setStatus({
        mode: (response.mode as LocalTokenMode | undefined) ?? null,
        tokenPresent: response.tokenPresent ?? null,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setStatus({
        mode: null,
        tokenPresent: null,
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [client, isConnected]);

  // Initial fetch when the host becomes available + connected.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleRegenerate = useCallback(() => {
    Alert.alert(
      t("settings.localDaemon.regenerateConfirm.title"),
      t("settings.localDaemon.regenerateConfirm.message"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.localDaemon.regenerate"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (!client) {
                return;
              }
              setIsRegenerating(true);
              try {
                const response = await client.regenerateLocalToken({});
                if (response.success === false) {
                  Alert.alert(t("common.error"), response.error ?? t("errors.somethingWentWrong"));
                  return;
                }
                await refreshStatus();
              } catch (err) {
                Alert.alert(t("common.error"), err instanceof Error ? err.message : String(err));
              } finally {
                setIsRegenerating(false);
              }
            })();
          },
        },
      ],
    );
  }, [client, refreshStatus, t]);

  const handleViewTokenGuidance = useCallback(() => {
    Alert.alert(
      t("settings.localDaemon.viewTokenConfirm.title"),
      t("settings.localDaemon.viewTokenConfirm.message"),
      [
        { text: t("common.ok"), style: "default" },
        {
          text: t("common.copy"),
          onPress: () => {
            void Clipboard.setStringAsync("$OTTIE_HOME/local-token");
          },
        },
      ],
    );
  }, [t]);

  const statusLine = formatStatusLine(t, status);
  // Stable composite style — avoids the eslint-plugin-react-perf
  // jsx-no-new-array-as-prop warning for inline style arrays.
  const errorTextStyle = useMemo(() => [settingsStyles.rowHint, styles.errorText], []);

  return (
    <SettingsSection title={t("settings.localDaemon.title")}>
      <View style={settingsStyles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderIcon}>
            <Lock size={theme.iconSize.md} color={theme.colors.foreground} />
          </View>
          <View style={styles.cardHeaderText}>
            <Text style={styles.cardTitle}>{t("settings.localDaemon.title")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.localDaemon.description")}</Text>
          </View>
        </View>

        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.localDaemon.statusRow.title")}</Text>
            <Text style={settingsStyles.rowHint}>{statusLine}</Text>
            {status.error ? <Text style={errorTextStyle}>{status.error}</Text> : null}
          </View>
        </View>

        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.localDaemon.viewToken")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.localDaemon.viewTokenHint")}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={handleViewTokenGuidance}
            style={pressableStyle}
            disabled={status.tokenPresent !== true}
          >
            <Text style={styles.actionButtonText}>{t("settings.localDaemon.viewToken")}</Text>
          </Pressable>
        </View>

        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.localDaemon.regenerate")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.localDaemon.regenerateHint")}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={handleRegenerate}
            style={pressableStyle}
            disabled={isRegenerating || !client}
          >
            <View style={styles.actionButtonRow}>
              <RefreshCw size={14} color={theme.colors.foreground} />
              <Text style={styles.actionButtonText}>
                {isRegenerating ? t("common.loading") : t("settings.localDaemon.regenerate")}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    </SettingsSection>
  );
}

function formatStatusLine(
  t: ReturnType<typeof useTranslation>["t"],
  status: LocalTokenStatusState,
): string {
  if (status.isLoading) {
    return t("common.loading");
  }
  if (status.mode === null) {
    return t("settings.localDaemon.statusRow.unknown");
  }
  switch (status.mode) {
    case "loopback-trust":
      return t("settings.localDaemon.statusRow.absent");
    case "explicit":
      return t("settings.localDaemon.statusRow.explicit");
    case "token-file":
      return t("settings.localDaemon.statusRow.present");
  }
}

const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];

// Hover/press-state helper. Keeps the visual idiom matching labs-section.tsx
// (lines 105-112) — `(hovered || pressed) && active` style fork.
function pressableStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return [styles.actionButton, (Boolean(hovered) || Boolean(pressed)) && styles.actionButtonActive];
}

const styles = StyleSheet.create((theme) => ({
  cardHeader: {
    flexDirection: "row",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  cardHeaderIcon: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    marginBottom: 2,
  },
  actionButton: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionButtonActive: {
    backgroundColor: theme.colors.surface3,
  },
  actionButtonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  errorText: {
    color: theme.colors.palette.amber[500],
  },
}));
