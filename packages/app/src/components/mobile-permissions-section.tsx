import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { useMobileNotificationPermissions } from "@/hooks/use-mobile-notification-permissions";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";

/**
 * Phase 4 v3/d — mobile (iOS / Android) analogue of
 * `DesktopPermissionsSection`. Surfaces:
 *
 *   - Current OS notification permission state
 *   - "Request" button (or "Open settings" deep-link if the OS
 *     prompt has already been declined)
 *   - "Send local test" — fires an immediate local notification
 *     bypassing the daemon push pipeline, so the user can confirm
 *     iOS / Android delivery works on the device itself.
 *   - "Send daemon test" — pings the daemon to dispatch a real Expo
 *     push to all registered tokens. Verifies the full
 *     token registered → daemon → Expo → APNS → device pipeline,
 *     which is the path real "task complete" notifications take.
 *
 * Renders nothing on web / desktop. The section only appears on
 * native platforms (the existing DesktopPermissionsSection covers
 * Tauri).
 */
export function MobilePermissionsSection({
  serverId,
}: {
  /** The host whose daemon-test button targets. */
  serverId: string | null;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const client = useHostRuntimeClient(serverId ?? "");
  const {
    isNative,
    state,
    canAskAgain,
    isLoading,
    isRequesting,
    isSendingLocalTest,
    lastError,
    refresh,
    requestPermission,
    sendLocalTest,
    openSystemSettings,
  } = useMobileNotificationPermissions();

  const [isSendingDaemonTest, setIsSendingDaemonTest] = useState(false);
  const [daemonTestError, setDaemonTestError] = useState<string | null>(null);
  const [daemonTestTokens, setDaemonTestTokens] = useState<number | null>(null);

  const handleSendDaemonTest = useCallback(async () => {
    if (!client) {
      setDaemonTestError(
        t("mobilePermissions.daemonOffline", {
          defaultValue: "Daemon is offline; can't dispatch a test push from settings.",
        }),
      );
      return;
    }
    setIsSendingDaemonTest(true);
    setDaemonTestError(null);
    setDaemonTestTokens(null);
    try {
      const response = await client.pushSendTest();
      if (response.error) {
        setDaemonTestError(response.error);
      }
      setDaemonTestTokens(response.tokenCount);
    } catch (err) {
      setDaemonTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSendingDaemonTest(false);
    }
  }, [client, t]);

  const errorTextStyle = useMemo(
    () => [styles.errorText, { color: theme.colors.destructive }],
    [theme.colors.destructive],
  );

  if (!isNative) return null;

  const isGranted = state === "granted";
  const showRequest = state !== "granted" && canAskAgain;
  const showOpenSettings = state === "denied" && !canAskAgain;

  return (
    <SettingsSection title={t("mobilePermissions.title", { defaultValue: "Notifications" })}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("mobilePermissions.notifications", { defaultValue: "Push notifications" })}
            </Text>
            <Text style={styles.subtitle}>
              {state === "granted"
                ? t("mobilePermissions.statusGranted", {
                    defaultValue: "Granted. Tap a test button below to confirm delivery works.",
                  })
                : state === "denied" && !canAskAgain
                  ? t("mobilePermissions.statusDeniedSystem", {
                      defaultValue:
                        "Denied. Tap Open settings to re-enable notifications in the OS.",
                    })
                  : state === "denied"
                    ? t("mobilePermissions.statusDenied", {
                        defaultValue: "Denied. Tap Request to ask again.",
                      })
                    : t("mobilePermissions.statusUndetermined", {
                        defaultValue:
                          "Not yet decided. Tap Request to grant Ottie permission to notify you.",
                      })}
            </Text>
          </View>
          <View style={styles.actions}>
            {isGranted ? (
              <View style={styles.statusPill}>
                <Check size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
                <Text style={styles.statusText}>
                  {t("mobilePermissions.granted", { defaultValue: "Granted" })}
                </Text>
              </View>
            ) : null}
            {showRequest ? (
              <Button
                variant="outline"
                size="sm"
                onPress={() => void requestPermission()}
                disabled={isRequesting || isLoading}
              >
                {isRequesting
                  ? t("mobilePermissions.requesting", { defaultValue: "Requesting…" })
                  : t("mobilePermissions.request", { defaultValue: "Request" })}
              </Button>
            ) : null}
            {showOpenSettings ? (
              <Button variant="outline" size="sm" onPress={() => void openSystemSettings()}>
                {t("mobilePermissions.openSettings", { defaultValue: "Open settings" })}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onPress={() => void refresh()} disabled={isLoading}>
              {t("mobilePermissions.refresh", { defaultValue: "Refresh" })}
            </Button>
          </View>
        </View>

        {isGranted ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("mobilePermissions.localTestTitle", {
                  defaultValue: "Send local test",
                })}
              </Text>
              <Text style={styles.subtitle}>
                {t("mobilePermissions.localTestSubtitle", {
                  defaultValue: "Schedules an immediate notification on this device.",
                })}
              </Text>
            </View>
            <View style={styles.actions}>
              <Button
                variant="outline"
                size="sm"
                onPress={() => void sendLocalTest()}
                disabled={isSendingLocalTest}
              >
                {isSendingLocalTest
                  ? t("mobilePermissions.testSending", { defaultValue: "Sending…" })
                  : t("mobilePermissions.test", { defaultValue: "Test" })}
              </Button>
            </View>
          </View>
        ) : null}

        {isGranted ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("mobilePermissions.daemonTestTitle", {
                  defaultValue: "Send daemon test",
                })}
              </Text>
              <Text style={styles.subtitle}>
                {daemonTestTokens !== null
                  ? t("mobilePermissions.daemonTestResult", {
                      tokens: daemonTestTokens,
                      defaultValue:
                        "Dispatched to {{tokens}} registered token(s). Wait a few seconds for the banner.",
                    })
                  : t("mobilePermissions.daemonTestSubtitle", {
                      defaultValue:
                        "Asks this daemon to push a notification through Expo → APNS to every device that's registered a token.",
                    })}
              </Text>
            </View>
            <View style={styles.actions}>
              <Button
                variant="outline"
                size="sm"
                onPress={handleSendDaemonTest}
                disabled={isSendingDaemonTest || !client}
              >
                {isSendingDaemonTest
                  ? t("mobilePermissions.testSending", { defaultValue: "Sending…" })
                  : t("mobilePermissions.test", { defaultValue: "Test" })}
              </Button>
            </View>
          </View>
        ) : null}

        {lastError ? <Text style={errorTextStyle}>{lastError}</Text> : null}
        {daemonTestError ? <Text style={errorTextStyle}>{daemonTestError}</Text> : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  subtitle: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginTop: 2,
    maxWidth: 320,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    minWidth: 88,
    justifyContent: "center",
  },
  statusText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
}));
