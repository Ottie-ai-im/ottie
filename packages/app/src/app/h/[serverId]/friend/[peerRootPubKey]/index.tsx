import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Send, Sparkles, X } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useActiveAiShares } from "@/hooks/use-active-ai-shares";
import { useShareableAgents } from "@/hooks/use-shareable-agents";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ShareableAgentOnWire,
  StoredFriendChatMessageOnWire,
} from "@server/server/identity/identity-rpc-schemas";
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
  shareAiButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  shareAiButtonHovered: {
    backgroundColor: theme.colors.surfaceGlassHover,
  },
  shareAiButtonText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  shareModalBody: {
    gap: theme.spacing[3],
  },
  shareModalIntro: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  shareModalDisclaimer: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  shareModalActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    justifyContent: "flex-end",
    marginTop: theme.spacing[2],
  },
  shareModalError: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  sharePickerList: {
    gap: theme.spacing[1],
  },
  sharePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surface1,
  },
  sharePickerRowHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
  },
  sharePickerRowPressed: {
    opacity: 0.7,
  },
  sharePickerRowDisabled: {
    opacity: 0.5,
  },
  sharePickerRowText: {
    flex: 1,
    gap: 2,
  },
  sharePickerLabel: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  sharePickerMeta: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  sharePickerStatus: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  activeShareBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderGlass,
  },
  activeShareIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  activeShareText: {
    flex: 1,
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  activeShareEndButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  activeShareEndButtonHovered: {
    backgroundColor: theme.colors.surfaceGlassHover,
  },
  activeShareEndText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
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
  /**
   * Phase 3.b/2e: row containing the timestamp + delivery-status badge,
   * shown under outgoing bubbles only. Inbound (peer-authored) messages
   * never carry a deliveryStatus the local UI should care about — the
   * remote daemon's status applies to its own send, not the recipient's
   * read.
   */
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
    paddingHorizontal: 4,
    gap: theme.spacing[2],
  },
  statusQueued: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontStyle: "italic",
  },
  statusDelivered: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
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
        {peerRootPubKey ? (
          <ShareAiButton serverId={serverId} peerRootPubKey={peerRootPubKey} />
        ) : null}
      </View>

      {peerRootPubKey ? (
        <ActiveShareBanners serverId={serverId} peerRootPubKey={peerRootPubKey} />
      ) : null}

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
  const { t } = useTranslation();
  const isMine = entry.message.authorRootPubKey !== peerRootPubKey;
  // Phase 3.b/2e: only render a status badge for our own outgoing
  // messages. The "queued" string is intentionally informational —
  // recipients see the message regardless of how it was delivered, but
  // the sender wants to know "did the live session take it, or did it
  // get parked at the relay for later". Inbound messages never have a
  // meaningful deliveryStatus from this device's perspective.
  const showStatus = isMine && entry.deliveryStatus !== undefined;
  const statusLabel = entry.deliveryStatus === "queued" ? t("p2pChat.statusQueued") : null;
  return (
    <View style={isMine ? styles.bubbleRowOut : styles.bubbleRowIn}>
      <View style={isMine ? styles.bubbleOut : styles.bubbleIn}>
        <Text style={isMine ? styles.bubbleTextOut : styles.bubbleTextIn}>
          {entry.message.body}
        </Text>
      </View>
      {showStatus && statusLabel ? (
        <View style={styles.metaRow}>
          <Text style={styles.timestamp}>{formatTime(entry.message.createdAt)}</Text>
          <Text style={styles.statusQueued}>· {statusLabel}</Text>
        </View>
      ) : (
        <Text style={styles.timestamp}>{formatTime(entry.message.createdAt)}</Text>
      )}
    </View>
  );
}

/**
 * Phase 4 v2/b — "Share AI" button in the friend chat header. Opens a
 * picker modal sourced from `chatP2pAiShareListShareableAgents`
 * (replaces v1's hardcoded placeholder). The user taps an agent row
 * to fire `chatP2pAiShareInvite` with that agent's real id / label /
 * provider. v3 swaps in §7.5's two-step picker for the multi-daemon
 * case.
 */
function ShareAiButton({
  serverId,
  peerRootPubKey,
}: {
  serverId: string | null;
  peerRootPubKey: string;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const client = useHostRuntimeClient(serverId ?? "");
  const [open, setOpen] = useState(false);
  const [submittingAgentId, setSubmittingAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentLabel, setSentLabel] = useState<string | null>(null);
  const { agents, isLoading, hasError, refetch } = useShareableAgents(serverId);

  const handleOpen = useCallback(() => {
    setError(null);
    setSentLabel(null);
    setSubmittingAgentId(null);
    setOpen(true);
    // Refetch on open so the picker reflects any agents created since
    // the modal was last dismissed.
    refetch();
  }, [refetch]);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handlePickAgent = useCallback(
    async (agent: ShareableAgentOnWire) => {
      if (!client) {
        setError("Not connected to daemon");
        return;
      }
      setSubmittingAgentId(agent.agentId);
      setError(null);
      try {
        const response = await client.chatP2pAiShareInvite({
          peerRootPubKey,
          agentId: agent.agentId,
          agentLabel: agent.agentLabel,
          agentProvider: agent.agentProvider,
        });
        if (response.error) {
          setError(response.error);
        } else if (response.invite) {
          setSentLabel(agent.agentLabel);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmittingAgentId(null);
      }
    },
    [client, peerRootPubKey],
  );

  const buttonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.shareAiButton,
      hovered ? styles.shareAiButtonHovered : null,
    ],
    [],
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("p2pChat.shareAi.button", { defaultValue: "Share AI" })}
        onPress={handleOpen}
        style={buttonStyle}
        testID="friend-chat-share-ai-button"
      >
        <Sparkles size={16} color={theme.colors.foreground} />
        <Text style={styles.shareAiButtonText}>
          {t("p2pChat.shareAi.button", { defaultValue: "Share AI" })}
        </Text>
      </Pressable>
      <AdaptiveModalSheet
        title={t("p2pChat.shareAi.modalTitle", { defaultValue: "Share an AI agent" })}
        visible={open}
        onClose={handleClose}
        testID="ai-share-modal"
        desktopMaxWidth={460}
      >
        <View style={styles.shareModalBody}>
          {sentLabel ? (
            <Text style={styles.shareModalIntro}>
              {t("p2pChat.shareAi.sent", {
                label: sentLabel,
                defaultValue: "Invite for {{label}} sent. Friend will see it in their bell.",
              })}
            </Text>
          ) : (
            <>
              <Text style={styles.shareModalIntro}>
                {t("p2pChat.shareAi.pickIntro", {
                  defaultValue:
                    "Pick a local agent to share. Your friend will get a notification and can accept or decline.",
                })}
              </Text>
              {isLoading ? (
                <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
              ) : hasError ? (
                <Text style={styles.shareModalError}>
                  {t("p2pChat.shareAi.loadError", {
                    defaultValue: "Could not load agent list. Try reopening this modal.",
                  })}
                </Text>
              ) : agents.length === 0 ? (
                <Text style={styles.shareModalDisclaimer}>
                  {t("p2pChat.shareAi.empty", {
                    defaultValue:
                      "No agents yet on this daemon. Create one from the workspace screen first.",
                  })}
                </Text>
              ) : (
                <View style={styles.sharePickerList}>
                  {agents.map((agent) => (
                    <ShareablePickerRow
                      key={agent.agentId}
                      agent={agent}
                      submitting={submittingAgentId === agent.agentId}
                      anySubmitting={submittingAgentId !== null}
                      onPick={handlePickAgent}
                    />
                  ))}
                </View>
              )}
            </>
          )}
          {error ? <Text style={styles.shareModalError}>{error}</Text> : null}
          <View style={styles.shareModalActions}>
            <Button variant="secondary" onPress={handleClose}>
              {sentLabel
                ? t("common.close", { defaultValue: "Close" })
                : t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
          </View>
        </View>
      </AdaptiveModalSheet>
    </>
  );
}

function ShareablePickerRow({
  agent,
  submitting,
  anySubmitting,
  onPick,
}: {
  agent: ShareableAgentOnWire;
  submitting: boolean;
  anySubmitting: boolean;
  onPick: (agent: ShareableAgentOnWire) => Promise<void>;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    void onPick(agent);
  }, [agent, onPick]);
  const rowStyle = useCallback(
    ({ pressed, hovered }: { pressed?: boolean; hovered?: boolean }) => [
      styles.sharePickerRow,
      hovered && !anySubmitting ? styles.sharePickerRowHovered : null,
      pressed ? styles.sharePickerRowPressed : null,
      anySubmitting && !submitting ? styles.sharePickerRowDisabled : null,
    ],
    [anySubmitting, submitting],
  );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      disabled={anySubmitting}
      style={rowStyle}
      testID={`ai-share-pick-${agent.agentId}`}
    >
      <View style={styles.sharePickerRowText}>
        <Text style={styles.sharePickerLabel} numberOfLines={1}>
          {agent.agentLabel}
        </Text>
        <Text style={styles.sharePickerMeta} numberOfLines={1}>
          {agent.lifecycle} · {agent.cwd}
        </Text>
      </View>
      {submitting ? (
        <Text style={styles.sharePickerStatus}>
          {t("p2pChat.shareAi.sending", { defaultValue: "Sending…" })}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Phase 4 v2/a — render an active-share banner per running session
 * with this peer. Either side (owner OR friend) sees the banner; the
 * "End session" button calls `chatP2pAiShareEnd` and invalidates the
 * active-list query so the banner disappears as soon as the daemon
 * confirms.
 */
function ActiveShareBanners({
  serverId,
  peerRootPubKey,
}: {
  serverId: string | null;
  peerRootPubKey: string;
}) {
  const { sessions } = useActiveAiShares(serverId, peerRootPubKey);
  if (sessions.length === 0) return null;
  return (
    <>
      {sessions.map((session) => (
        <ActiveShareBanner
          key={session.inviteId}
          serverId={serverId}
          peerRootPubKey={peerRootPubKey}
          session={session}
        />
      ))}
    </>
  );
}

function ActiveShareBanner({
  serverId,
  peerRootPubKey,
  session,
}: {
  serverId: string | null;
  peerRootPubKey: string;
  session: import("@server/server/identity/identity-rpc-schemas").AiShareActiveOnWire;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  const client = useHostRuntimeClient(serverId ?? "");
  const queryClient = useQueryClient();
  const [ending, setEnding] = useState(false);
  const handleEnd = useCallback(async () => {
    if (!client) return;
    setEnding(true);
    try {
      await client.chatP2pAiShareEnd({ inviteId: session.inviteId });
      await queryClient.invalidateQueries({ queryKey: ["ai-share-active", serverId] });
    } finally {
      setEnding(false);
    }
  }, [client, queryClient, serverId, session.inviteId]);

  const handleOpen = useCallback(() => {
    if (!serverId) return;
    router.push({
      pathname: "/h/[serverId]/friend/[peerRootPubKey]/share/[inviteId]",
      params: { serverId, peerRootPubKey, inviteId: session.inviteId },
    });
  }, [peerRootPubKey, router, serverId, session.inviteId]);

  const endButtonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.activeShareEndButton,
      hovered ? styles.activeShareEndButtonHovered : null,
    ],
    [],
  );
  const openButtonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.activeShareEndButton,
      hovered ? styles.activeShareEndButtonHovered : null,
    ],
    [],
  );

  // Phase 4 v2/c — only the friend side (inbound) gets the "Open"
  // affordance, since the shared-agent compose surface is one-way:
  // friend types prompts, owner's agent runs them. The owner's banner
  // still has End so they can revoke the share at any time.
  const showOpenButton = session.side === "inbound";

  return (
    <View
      style={styles.activeShareBanner}
      testID={`active-share-banner-${session.inviteId.slice(0, 8)}`}
    >
      <View style={styles.activeShareIcon}>
        <Sparkles size={16} color={theme.colors.palette.white} />
      </View>
      <Text style={styles.activeShareText} numberOfLines={1}>
        {session.peerOnline === false
          ? t("p2pChat.activeShareBannerOffline", {
              label: session.agentLabel,
              defaultValue: "AI share — {{label}} (peer offline)",
            })
          : t("p2pChat.activeShareBanner", {
              label: session.agentLabel,
              defaultValue: "AI share active — {{label}}",
            })}
      </Text>
      {showOpenButton ? (
        <Pressable
          accessibilityRole="button"
          onPress={handleOpen}
          style={openButtonStyle}
          testID={`active-share-open-${session.inviteId.slice(0, 8)}`}
        >
          <Text style={styles.activeShareEndText}>
            {t("p2pChat.activeShareOpen", { defaultValue: "Open" })}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => void handleEnd()}
        style={endButtonStyle}
        disabled={ending}
        testID={`active-share-end-${session.inviteId.slice(0, 8)}`}
      >
        <X size={14} color={theme.colors.foreground} />
        <Text style={styles.activeShareEndText}>
          {ending
            ? t("p2pChat.activeShareEnding", { defaultValue: "Ending…" })
            : t("p2pChat.activeShareEnd", { defaultValue: "End session" })}
        </Text>
      </Pressable>
    </View>
  );
}
