import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Copy, RotateCw } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import * as QRCode from "qrcode";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { DeviceLinkOffer } from "@server/server/identity/device-link-types";

// Phase 2.c-ui — "Add device" screen. Asks the daemon to mint a one-time
// device-link offer, renders the deep-link as a QR code + copy-link
// button, and exposes a cancel/regenerate path. The new device's scan
// flow lands in Phase 2.d.

interface OfferData {
  offer: DeviceLinkOffer;
  deepLink: string;
}

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
  scroll: {
    flex: 1,
  },
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
  qrCard: {
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    padding: theme.spacing[6],
    alignItems: "center",
    gap: theme.spacing[3],
  },
  qrImage: {
    width: 280,
    height: 280,
    borderRadius: theme.borderRadius.lg,
  },
  qrPlaceholder: {
    width: 280,
    height: 280,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  expiresLabel: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  linkCard: {
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  linkLabel: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: -0.1,
  },
  linkText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    letterSpacing: -0.1,
  },
  copyRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  flexOne: {
    flex: 1,
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
}));

export default function AddDeviceRoute() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const serverId = resolveServerId(params.serverId);
  const client = useHostRuntimeClient(serverId ?? "");

  const offerQuery = useQuery<OfferData, Error>({
    queryKey: ["device-link-generate", serverId],
    queryFn: async () => {
      if (!client) throw new Error("No daemon connection");
      const response = await client.deviceLinkGenerate();
      if (response.error || !response.offer || !response.deepLink) {
        throw new Error(response.error ?? "Daemon refused to generate offer");
      }
      return { offer: response.offer, deepLink: response.deepLink };
    },
    enabled: !!client,
    staleTime: Infinity,
  });

  const qrQuery = useQuery<string, Error>({
    queryKey: ["device-link-qr", offerQuery.data?.deepLink],
    queryFn: () =>
      QRCode.toDataURL(offerQuery.data!.deepLink, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 560,
      }),
    enabled: !!offerQuery.data?.deepLink,
    staleTime: Infinity,
  });

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!offerQuery.data?.deepLink) return;
    await Clipboard.setStringAsync(offerQuery.data.deepLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [offerQuery.data?.deepLink]);

  const handleCopyPress = useCallback(() => {
    void handleCopy();
  }, [handleCopy]);

  const handleRegenerate = useCallback(() => {
    void offerQuery.refetch();
  }, [offerQuery]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/settings/identity");
    }
  }, [router]);

  // Best-effort cancellation of the pending offer when the user navigates
  // away (router.back / app close). The daemon TTLs offers anyway, but
  // proactively cancelling shrinks the redemption window and frees the
  // concurrent-offer slot.
  useEffect(() => {
    const nonce = offerQuery.data?.offer.nonceB64;
    return () => {
      if (!client || !nonce) return;
      void client.deviceLinkCancel(nonce).catch(() => undefined);
    };
  }, [client, offerQuery.data?.offer.nonceB64]);

  const rootStyle = useMemo(() => [styles.root, { paddingTop: insets.top }], [insets.top]);

  const qrImageSource = useMemo(
    () => (qrQuery.data ? { uri: qrQuery.data } : null),
    [qrQuery.data],
  );

  const copyIcon = useMemo(
    () => <Copy size={16} color={theme.colors.palette.white} />,
    [theme.colors.palette.white],
  );
  const regenerateIcon = useMemo(
    () => <RotateCw size={16} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );

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
          <Text style={styles.title}>{t("addDevice.title")}</Text>
          <Text style={styles.subtitle}>{t("addDevice.subtitle")}</Text>
        </View>

        {offerQuery.isError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {offerQuery.error?.message ?? t("addDevice.genericError")}
            </Text>
            <Button variant="secondary" onPress={handleRegenerate} leftIcon={regenerateIcon}>
              {t("addDevice.regenerate")}
            </Button>
          </View>
        ) : (
          <View style={styles.qrCard}>
            {qrImageSource ? (
              <Image
                source={qrImageSource}
                style={styles.qrImage}
                accessibilityLabel={t("addDevice.qrAccessibility")}
              />
            ) : (
              <View style={styles.qrPlaceholder}>
                <ActivityIndicator color={theme.colors.foregroundMuted} />
              </View>
            )}
            {offerQuery.data ? (
              <Text style={styles.expiresLabel}>
                {t("addDevice.expiresAt", { exp: offerQuery.data.offer.exp })}
              </Text>
            ) : null}
          </View>
        )}

        {offerQuery.data ? (
          <View style={styles.linkCard}>
            <Text style={styles.linkLabel}>{t("addDevice.linkLabel")}</Text>
            <Text style={styles.linkText} numberOfLines={3}>
              {offerQuery.data.deepLink}
            </Text>
            <View style={styles.copyRow}>
              <Button
                style={styles.flexOne}
                variant="default"
                onPress={handleCopyPress}
                leftIcon={copyIcon}
              >
                {copied ? t("addDevice.copied") : t("addDevice.copyLink")}
              </Button>
              <Button
                style={styles.flexOne}
                variant="secondary"
                onPress={handleRegenerate}
                leftIcon={regenerateIcon}
              >
                {t("addDevice.regenerate")}
              </Button>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
