import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Send } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { StoredFriendChatMessageOnWire } from "@server/server/identity/identity-rpc-schemas";
import type { StoredPeer } from "@server/server/identity/peer-types";

// Phase 3.b/3 (UI v1) — friend chat screen. Standalone surface, NOT
// integrated into the workspace tab system (which is agent-chat
// territory). Polls every 2s for new messages while focused; sends
// via the new chat/p2p/send WS RPC. Read receipts + chats-list
// integration are deferred to a follow-up commit.

const POLL_MS = 2_000;
// Stable reference for the empty-list fallback so memoized props /
// effect deps don't see a fresh array every render.
const EMPTY_MESSAGES: readonly StoredFriendChatMessageOnWire[] = [];

function resolveParam(raw: string | string[] | undefined): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null;
  return null;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderGlass,
    gap: theme.spacing[2],
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingRight: theme.spacing[2],
  },
  backLabel: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  titleColumn: {
    flex: 1,
    marginLeft: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.2,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    letterSpacing: -0.1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[3],
  },
  bubbleRowOut: {
    alignSelf: "flex-end",
    maxWidth: "85%",
  },
  bubbleRowIn: {
    alignSelf: "flex-start",
    maxWidth: "85%",
  },
  bubbleOut: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  bubbleIn: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bubbleTextOut: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.palette.white,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  bubbleTextIn: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  timestamp: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginTop: 2,
    paddingHorizontal: 4,
  },
  emptyHint: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    marginTop: theme.spacing[8],
  },
  loading: {
    marginTop: theme.spacing[8],
    alignSelf: "center",
  },
  errorBanner: {
    backgroundColor: theme.colors.surfaceGlass,
    borderColor: theme.colors.destructive,
    borderWidth: 1,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    marginHorizontal: theme.spacing[4],
    marginTop: theme.spacing[3],
  },
  errorText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surface0,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
}));

export default function FriendChatRoute() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    peerRootPubKey?: string | string[];
  }>();
  const serverId = resolveParam(params.serverId);
  const peerRootPubKey = resolveParam(params.peerRootPubKey);
  const client = useHostRuntimeClient(serverId ?? "");

  // Fetch the peer record so we can show their displayName + pubkey
  // prefix in the header. The friend list is small; one fetch on
  // mount is enough.
  const peerQuery = useQuery<StoredPeer | null, Error>({
    queryKey: ["friend-chat-peer", serverId, peerRootPubKey],
    queryFn: async () => {
      if (!client || !peerRootPubKey) return null;
      const response = await client.friendList();
      if (response.error) throw new Error(response.error);
      return response.peers?.find((p) => p.peerRootSignPublicKeyB64 === peerRootPubKey) ?? null;
    },
    enabled: !!client && !!peerRootPubKey,
    staleTime: 30_000,
  });

  // Poll the message list every POLL_MS so inbound messages show up
  // without a manual refresh. Phase 3.b/3-subscription will swap this
  // for a server-pushed event stream.
  const messagesQuery = useQuery<readonly StoredFriendChatMessageOnWire[], Error>({
    queryKey: ["friend-chat-messages", serverId, peerRootPubKey],
    queryFn: async () => {
      if (!client || !peerRootPubKey) return [];
      const response = await client.chatP2pList(peerRootPubKey);
      if (response.error) throw new Error(response.error);
      return response.messages ?? [];
    },
    enabled: !!client && !!peerRootPubKey,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll to bottom whenever the message list grows.
  const messageCount = messagesQuery.data?.length ?? 0;
  useEffect(() => {
    if (messageCount === 0) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [messageCount]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/settings/identity");
    }
  }, [router]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (body.length === 0) return;
    if (!client || !peerRootPubKey) return;
    setIsSending(true);
    setSendError(null);
    try {
      const response = await client.chatP2pSend({
        peerRootPubKey,
        body,
      });
      if (response.error || !response.stored) {
        setSendError(response.error ?? t("p2pChat.sendFailedGeneric"));
        return;
      }
      setDraft("");
      void messagesQuery.refetch();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  }, [client, draft, messagesQuery, peerRootPubKey, t]);

  const handleSendPress = useCallback(() => {
    void handleSend();
  }, [handleSend]);

  const rootStyle = useMemo(
    () => [styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.bottom, insets.top],
  );
  const sendIcon = useMemo(
    () => <Send size={16} color={theme.colors.palette.white} />,
    [theme.colors.palette.white],
  );

  const peer = peerQuery.data;
  const peerLabel = peer
    ? `${peer.peerDisplayName} (${peer.peerRootSignPublicKeyB64.slice(0, 8)})`
    : t("p2pChat.unknownPeer");
  const peerStatus = peer ? t(`p2pChat.peerStatus.${peer.status}`) : "";
  const messages = useMemo(() => messagesQuery.data ?? EMPTY_MESSAGES, [messagesQuery.data]);
  // "Is mine" derived as `authorRootPubKey !== peer.peerRootPubKey`.
  // The local root pubkey isn't available here without an extra fetch,
  // so we use the peer-side comparison — same answer, one less RPC.

  return (
    <View style={rootStyle}>
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
        <View style={styles.titleColumn}>
          <Text style={styles.title} numberOfLines={1}>
            {peerLabel}
          </Text>
          {peerStatus ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {peerStatus}
            </Text>
          ) : null}
        </View>
      </View>

      {messagesQuery.isError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>
            {messagesQuery.error?.message ?? t("p2pChat.loadFailed")}
          </Text>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <ChatBody
          isLoading={messagesQuery.isLoading}
          messages={messages}
          peerRootPubKey={peerRootPubKey ?? ""}
          loadingColor={theme.colors.foregroundMuted}
          t={t}
        />
      </ScrollView>

      {sendError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{sendError}</Text>
        </View>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t("p2pChat.placeholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          multiline
          editable={!isSending}
          style={styles.composerInput}
          accessibilityLabel={t("p2pChat.placeholder")}
        />
        <Button
          variant="default"
          onPress={handleSendPress}
          disabled={isSending || draft.trim().length === 0}
          leftIcon={sendIcon}
        >
          {isSending ? t("p2pChat.sending") : t("p2pChat.send")}
        </Button>
      </View>
    </View>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function ChatBody({
  isLoading,
  messages,
  peerRootPubKey,
  loadingColor,
  t,
}: {
  isLoading: boolean;
  messages: readonly StoredFriendChatMessageOnWire[];
  peerRootPubKey: string;
  loadingColor: string;
  t: (key: string) => string;
}) {
  if (isLoading) {
    return <ActivityIndicator color={loadingColor} style={styles.loading} />;
  }
  if (messages.length === 0) {
    return <Text style={styles.emptyHint}>{t("p2pChat.empty")}</Text>;
  }
  return (
    <>
      {messages.map((entry) => (
        <ChatBubble key={entry.message.id} entry={entry} peerRootPubKey={peerRootPubKey} />
      ))}
    </>
  );
}

function ChatBubble({
  entry,
  peerRootPubKey,
}: {
  entry: StoredFriendChatMessageOnWire;
  peerRootPubKey: string;
}) {
  const isMine = entry.message.authorRootPubKey !== peerRootPubKey;
  return (
    <View style={isMine ? styles.bubbleRowOut : styles.bubbleRowIn}>
      <View style={isMine ? styles.bubbleOut : styles.bubbleIn}>
        <Text style={isMine ? styles.bubbleTextOut : styles.bubbleTextIn}>
          {entry.message.body}
        </Text>
      </View>
      <Text style={styles.timestamp}>{formatTime(entry.message.createdAt)}</Text>
    </View>
  );
}
