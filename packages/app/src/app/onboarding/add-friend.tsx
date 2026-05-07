import { useCallback, useMemo, useState } from "react";
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
import type { FriendPairOffer } from "@server/server/identity/friend-pair-types";

// Phase 3.a UI — "Add friend" screen. Cross-identity analog of
// `add-device.tsx`. Asks the daemon to mint a one-time friend-pair
// offer, renders the deep-link as a QR code + copy-link button.
// The friend's scan flow lands them on `redeem-friend-link.tsx`.

interface OfferData {
  offer: FriendPairOffer;
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
  linkPressable: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  linkPressableHovered: {
    backgroundColor: theme.colors.surfaceGlassHover,
  },
  linkPressableCopied: {
    borderColor: theme.colors.accent,
  },
  copyHint: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    marginTop: theme.spacing[1],
  },
  copyHintActive: {
    color: theme.colors.accent,
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

export default function AddFriendRoute() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const serverId = resolveServerId(params.serverId);
  const client = useHostRuntimeClient(serverId ?? "");

  const offerQuery = useQuery<OfferData, Error>({
    queryKey: ["friend-pair-generate", serverId],
    queryFn: async () => {
      if (!client) throw new Error("No daemon connection");
      const response = await client.friendPairGenerate();
      if (response.error || !response.offer || !response.deepLink) {
        throw new Error(response.error ?? "Daemon refused to generate offer");
      }
      return { offer: response.offer, deepLink: response.deepLink };
    },
    enabled: !!client,
    staleTime: Infinity,
  });

  const qrQuery = useQuery<string, Error>({
    queryKey: ["friend-pair-qr", offerQuery.data?.deepLink],
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

  const linkPressableStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.linkPressable,
      hovered ? styles.linkPressableHovered : null,
      copied ? styles.linkPressableCopied : null,
    ],
    [copied],
  );
  const copyHintStyle = useMemo(
    () => [styles.copyHint, copied ? styles.copyHintActive : null],
    [copied],
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
          <Text style={styles.title}>{t("addFriend.title")}</Text>
          <Text style={styles.subtitle}>{t("addFriend.subtitle")}</Text>
        </View>

        {offerQuery.isError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {offerQuery.error?.message ?? t("addFriend.genericError")}
            </Text>
            <Button variant="secondary" onPress={handleRegenerate} leftIcon={regenerateIcon}>
              {t("addFriend.regenerate")}
            </Button>
          </View>
        ) : (
          <View style={styles.qrCard}>
            {qrImageSource ? (
              <Image
                source={qrImageSource}
                style={styles.qrImage}
                accessibilityLabel={t("addFriend.qrAccessibility")}
              />
            ) : (
              <View style={styles.qrPlaceholder}>
                <ActivityIndicator color={theme.colors.foregroundMuted} />
              </View>
            )}
            {offerQuery.data ? (
              <Text style={styles.expiresLabel}>
                {t("addFriend.expiresAt", { exp: offerQuery.data.offer.exp })}
              </Text>
            ) : null}
          </View>
        )}

        {offerQuery.data ? (
          <View style={styles.linkCard}>
            <Text style={styles.linkLabel}>{t("addFriend.linkLabel")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("addFriend.copyLink")}
              onPress={handleCopyPress}
              style={linkPressableStyle}
            >
              <Text style={styles.linkText} numberOfLines={3} selectable>
                {offerQuery.data.deepLink}
              </Text>
              <Text style={copyHintStyle}>
                {copied ? t("addFriend.copied") : t("addFriend.copyLink")}
              </Text>
            </Pressable>
            <View style={styles.copyRow}>
              <Button
                style={styles.flexOne}
                variant="default"
                onPress={handleCopyPress}
                leftIcon={copyIcon}
              >
                {copied ? t("addFriend.copied") : t("addFriend.copyLink")}
              </Button>
              <Button
                style={styles.flexOne}
                variant="secondary"
                onPress={handleRegenerate}
                leftIcon={regenerateIcon}
              >
                {t("addFriend.regenerate")}
              </Button>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
