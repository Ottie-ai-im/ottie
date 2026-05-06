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

// Phase 3.a UI — the responder pastes the friend-pair deep-link the
// originator generated and asks their own daemon to redeem it. While
// the request is in flight, the originator's user must tap Approve in
// their settings — so this screen sits in a "submitting" state for as
// long as it takes (up to the 5-minute sender timeout). On success,
// the daemon's `adoptPeerFromApproval` writes the new Peer entry
// into peers.json and the user goes back to /settings/identity.

type Phase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "paired" }
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

function humanizeFriendRedeemError(
  t: (key: string) => string,
  errorCode: string,
  fallback: string,
): string {
  switch (errorCode) {
    case "user_rejected":
      return t("redeemFriend.rejectedByUser");
    case "no_offer":
    case "offer_expired":
      return t("redeemFriend.rejectedNoOffer");
    case "self_pairing":
      return t("redeemFriend.rejectedSelfPairing");
    case "bad_signature":
      return t("redeemFriend.rejectedBadSignature");
    case "timeout":
      return t("redeemFriend.rejectedTimeout");
    case "connection_closed":
    case "socket_error":
      return t("redeemFriend.rejectedConnectionClosed");
    default:
      return fallback;
  }
}

export default function RedeemFriendLinkRoute() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const serverId = resolveServerId(params.serverId);
  const client = useHostRuntimeClient(serverId ?? "");

  const [deepLink, setDeepLink] = useState("");
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
        errorMessage: t("redeemFriend.errorMissingLink"),
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
      const response = await client.friendPairRedeem({ deepLink: trimmedLink });
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
      if (outcome.status === "paired") {
        setPhase({ kind: "paired" });
        setTimeout(() => {
          router.replace("/settings/identity");
        }, 1500);
      } else {
        setPhase({
          kind: "error",
          errorCode: outcome.errorCode,
          errorMessage: humanizeFriendRedeemError(t, outcome.errorCode, outcome.errorMessage),
        });
      }
    } catch (err) {
      setPhase({
        kind: "error",
        errorCode: "exception",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }, [client, deepLink, router, t]);

  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const rootStyle = useMemo(() => [styles.root, { paddingTop: insets.top }], [insets.top]);
  const linkIcon = useMemo(
    () => <LinkIcon size={16} color={theme.colors.palette.white} />,
    [theme.colors.palette.white],
  );

  const submitting = phase.kind === "submitting";
  const paired = phase.kind === "paired";

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
          <Text style={styles.title}>{t("redeemFriend.title")}</Text>
          <Text style={styles.subtitle}>{t("redeemFriend.subtitle")}</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.fieldLabel}>{t("redeemFriend.linkLabel")}</Text>
          <TextInput
            value={deepLink}
            onChangeText={setDeepLink}
            placeholder={t("redeemFriend.linkPlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            editable={!submitting && !paired}
            style={styles.textInput}
            accessibilityLabel={t("redeemFriend.linkLabel")}
          />
          <Button variant="secondary" onPress={handlePastePress} disabled={submitting || paired}>
            {t("redeemFriend.pasteFromClipboard")}
          </Button>

          <Button
            variant="default"
            onPress={handleSubmitPress}
            disabled={submitting || paired}
            leftIcon={linkIcon}
          >
            {submitting ? t("redeemFriend.submitting") : t("redeemFriend.submit")}
          </Button>
        </View>

        {phase.kind === "paired" ? (
          <View style={styles.successCard}>
            <Text style={styles.successText}>{t("redeemFriend.paired")}</Text>
          </View>
        ) : null}

        {phase.kind === "error" ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {t("redeemFriend.errorPrefix")}: {phase.errorMessage}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
