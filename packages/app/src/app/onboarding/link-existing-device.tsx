import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, LinkIcon } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

// Phase 2.d-ui — the NEW device pastes a deep-link the OLD device
// generated and asks its own daemon to redeem it. While the request is
// in flight, the OLD device's user must tap Approve in their settings —
// so this screen sits in a "submitting" state for as long as it takes
// (up to the 5-minute sender timeout). On success, the daemon's
// adoptIdentityFromLink writes root.json + self-device.json + devices
// .json and the user goes to /settings/identity to see everything.

type Phase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "linked" }
  | { kind: "error"; errorCode: string; errorMessage: string };

function resolveServerId(raw: string | string[] | undefined): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null;
  return null;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: { flex: 1 },
  container: {
    padding: theme.spacing[6],
    gap: theme.spacing[6],
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
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
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  formCard: {
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  fieldLabel: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: -0.1,
  },
  textInput: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    minHeight: 80,
  },
  textInputSingleLine: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  helperText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  errorCard: {
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  errorText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  successCard: {
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  successText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
}));

function humanizeRedeemError(
  t: (key: string) => string,
  errorCode: string,
  fallback: string,
): string {
  switch (errorCode) {
    case "user_rejected":
      return t("linkDevice.rejectedByUser");
    case "no_offer":
    case "offer_expired":
      return t("linkDevice.rejectedNoOffer");
    case "timeout":
      return t("linkDevice.rejectedTimeout");
    case "connection_closed":
    case "socket_error":
      return t("linkDevice.rejectedConnectionClosed");
    default:
      return fallback;
  }
}

export default function LinkExistingDeviceRoute() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const serverId = resolveServerId(params.serverId);
  const client = useHostRuntimeClient(serverId ?? "");

  const [deepLink, setDeepLink] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [router]);

  const handlePasteFromClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text && text.length > 0) setDeepLink(text);
  }, []);

  const handlePastePress = useCallback(() => {
    void handlePasteFromClipboard();
  }, [handlePasteFromClipboard]);

  const handleSubmit = useCallback(async () => {
    const trimmedLink = deepLink.trim();
    if (trimmedLink.length === 0) {
      setPhase({
        kind: "error",
        errorCode: "missing_link",
        errorMessage: t("linkDevice.errorMissingLink"),
      });
      return;
    }
    const trimmedLabel = deviceLabel.trim();
    if (trimmedLabel.length === 0) {
      setPhase({
        kind: "error",
        errorCode: "missing_label",
        errorMessage: t("linkDevice.errorMissingLabel"),
      });
      return;
    }
    if (!client) {
      setPhase({
        kind: "error",
        errorCode: "no_client",
        errorMessage: "No daemon connection",
      });
      return;
    }

    setPhase({ kind: "submitting" });
    try {
      const response = await client.deviceLinkRedeem({
        deepLink: trimmedLink,
        deviceLabel: trimmedLabel,
        role: "daemon",
      });
      if (response.error) {
        setPhase({
          kind: "error",
          errorCode: "rpc_error",
          errorMessage: response.error,
        });
        return;
      }
      const outcome = response.outcome;
      if (!outcome) {
        setPhase({
          kind: "error",
          errorCode: "no_outcome",
          errorMessage: "Daemon returned an empty outcome",
        });
        return;
      }
      if (outcome.status === "accepted") {
        setPhase({ kind: "linked" });
        setTimeout(() => {
          router.replace("/settings/identity");
        }, 1500);
      } else {
        setPhase({
          kind: "error",
          errorCode: outcome.errorCode,
          errorMessage: humanizeRedeemError(t, outcome.errorCode, outcome.errorMessage),
        });
      }
    } catch (err) {
      setPhase({
        kind: "error",
        errorCode: "exception",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }, [client, deepLink, deviceLabel, router, t]);

  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const rootStyle = useMemo(() => [styles.root, { paddingTop: insets.top }], [insets.top]);
  const linkIcon = useMemo(
    () => <LinkIcon size={16} color={theme.colors.palette.white} />,
    [theme.colors.palette.white],
  );

  const submitting = phase.kind === "submitting";
  const linked = phase.kind === "linked";

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

        <View>
          <Text style={styles.title}>{t("linkDevice.title")}</Text>
          <Text style={styles.subtitle}>{t("linkDevice.subtitle")}</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.fieldLabel}>{t("linkDevice.linkLabel")}</Text>
          <TextInput
            value={deepLink}
            onChangeText={setDeepLink}
            placeholder={t("linkDevice.linkPlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            editable={!submitting && !linked}
            style={styles.textInput}
            accessibilityLabel={t("linkDevice.linkLabel")}
          />
          <Button variant="secondary" onPress={handlePastePress} disabled={submitting || linked}>
            {t("linkDevice.linkLabel")}
          </Button>

          <Text style={styles.fieldLabel}>{t("linkDevice.deviceLabelLabel")}</Text>
          <TextInput
            value={deviceLabel}
            onChangeText={setDeviceLabel}
            placeholder={t("linkDevice.deviceLabelPlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="words"
            editable={!submitting && !linked}
            style={styles.textInputSingleLine}
            accessibilityLabel={t("linkDevice.deviceLabelLabel")}
          />

          <Button
            variant="default"
            onPress={handleSubmitPress}
            disabled={submitting || linked}
            leftIcon={linkIcon}
          >
            {submitting ? t("linkDevice.submitting") : t("linkDevice.submit")}
          </Button>
        </View>

        {phase.kind === "linked" ? (
          <View style={styles.successCard}>
            <Text style={styles.successText}>{t("linkDevice.linked")}</Text>
          </View>
        ) : null}

        {phase.kind === "error" ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {t("linkDevice.errorPrefix")}: {phase.errorMessage}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
