import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { router, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Sparkles, UserPlus } from "lucide-react-native";

import { AdaptiveModalSheet } from "./adaptive-modal-sheet";
import { useNotifications, type NotificationItem } from "@/hooks/use-notifications";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Phase 3.b/3 — notification center panel. Surfaces the things that
 * deserve user attention but don't block whatever the user is doing
 * right now. Today: pending friend-pair candidates. Future (designed
 * to slot in without rewriting): inbox-arrival hints, Phase 4 AI-share
 * invitations.
 *
 * Each row is tap-to-handle: the panel doesn't render an "Approve"
 * button inline; it deep-links into the full surface (Settings →
 * Identity for friend requests; Phase 4 modal for share invites). This
 * keeps the panel small and avoids duplicating the action UI that
 * already lives in those pages.
 */

export interface NotificationCenterPanelProps {
  visible: boolean;
  onClose: () => void;
  /** Active host context — drives which daemon's notifications we show. */
  serverId: string | null;
}

export function NotificationCenterPanel({
  visible,
  onClose,
  serverId,
}: NotificationCenterPanelProps) {
  const { t } = useTranslation();
  const { items } = useNotifications(serverId);

  return (
    <AdaptiveModalSheet
      title={t("notifications.title")}
      visible={visible}
      onClose={onClose}
      testID="notification-center-panel"
      desktopMaxWidth={420}
    >
      {items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t("notifications.empty")}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} onActioned={onClose} serverId={serverId} />
          ))}
        </View>
      )}
    </AdaptiveModalSheet>
  );
}

function NotificationRow({
  item,
  onActioned,
  serverId,
}: {
  item: NotificationItem;
  onActioned: () => void;
  serverId: string | null;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId ?? "");
  const queryClient = useQueryClient();

  const handleFriendPairPress = useCallback(() => {
    router.push("/settings/identity");
    onActioned();
  }, [onActioned]);

  const handleAiShareAccept = useCallback(
    async (inviteId: string) => {
      if (!client) return;
      try {
        await client.chatP2pAiShareAccept({ inviteId });
        await queryClient.invalidateQueries({
          queryKey: ["notifications-ai-share-invites-inbound", serverId],
        });
      } finally {
        onActioned();
      }
    },
    [client, onActioned, queryClient, serverId],
  );

  const handleAiShareDecline = useCallback(
    async (inviteId: string) => {
      if (!client) return;
      try {
        await client.chatP2pAiShareDecline({ inviteId });
        await queryClient.invalidateQueries({
          queryKey: ["notifications-ai-share-invites-inbound", serverId],
        });
      } finally {
        onActioned();
      }
    },
    [client, onActioned, queryClient, serverId],
  );

  const friendPairRowStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [styles.row, hovered ? styles.rowHovered : null],
    [],
  );

  const handleAiShareAcceptPress = useCallback(() => {
    if (item.kind !== "ai-share-invite") return;
    void handleAiShareAccept(item.payload.invite.inviteId);
  }, [handleAiShareAccept, item]);

  const handleAiShareDeclinePress = useCallback(() => {
    if (item.kind !== "ai-share-invite") return;
    void handleAiShareDecline(item.payload.invite.inviteId);
  }, [handleAiShareDecline, item]);

  const aiShareAcceptButtonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.actionButton,
      styles.actionButtonAccept,
      hovered ? styles.actionButtonHovered : null,
    ],
    [],
  );

  const aiShareDeclineButtonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.actionButton,
      hovered ? styles.actionButtonHovered : null,
    ],
    [],
  );

  if (item.kind === "friend-pair-candidate") {
    const candidate = item.payload.candidate;
    const pubKeyShort = candidate.peerRootSignPublicKeyB64.slice(0, 8);
    return (
      <Pressable
        accessibilityRole="button"
        onPress={handleFriendPairPress}
        style={friendPairRowStyle}
        testID={`notification-row-friend-pair-${candidate.nonceB64.slice(0, 8)}`}
      >
        <View style={styles.iconCircle}>
          <UserPlus size={18} color={theme.colors.foregroundMuted} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {t("notifications.friendPairTitle", {
              name: candidate.peerDisplayName,
              defaultValue: "Friend request from {{name}}",
            })}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {t("notifications.friendPairSubtitle", {
              pubkey: pubKeyShort,
              defaultValue: "{{pubkey}}… · tap to approve",
            })}
          </Text>
        </View>
      </Pressable>
    );
  }

  if (item.kind === "ai-share-invite") {
    const invite = item.payload.invite;
    return (
      <View style={styles.row} testID={`notification-row-ai-share-${invite.inviteId.slice(0, 8)}`}>
        <View style={styles.iconCircle}>
          <Sparkles size={18} color={theme.colors.foregroundMuted} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {t("notifications.aiShareTitle", {
              label: invite.agentLabel,
              defaultValue: "Wants to share {{label}}",
            })}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {t("notifications.aiShareSubtitle", {
              provider: invite.agentProvider,
              defaultValue: "{{provider}} · accept or decline below",
            })}
          </Text>
          {invite.limits ? (
            <Text style={styles.rowLimits} numberOfLines={1}>
              {t("notifications.aiShareLimits", {
                maxPrompts: invite.limits.maxPrompts,
                maxTokens: Math.round(invite.limits.maxTokens / 1000),
                timeoutMin: Math.round(invite.limits.sessionTimeoutMs / 60000),
                defaultValue:
                  "max {{maxPrompts}} prompts · {{maxTokens}}k tokens · {{timeoutMin}} min",
              })}
            </Text>
          ) : null}
          <View style={styles.aiShareActions}>
            <Pressable
              accessibilityRole="button"
              onPress={handleAiShareAcceptPress}
              style={aiShareAcceptButtonStyle}
              testID={`notification-ai-share-accept-${invite.inviteId.slice(0, 8)}`}
            >
              <Text style={styles.actionButtonAcceptText}>
                {t("notifications.aiShareAccept", { defaultValue: "Accept" })}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleAiShareDeclinePress}
              style={aiShareDeclineButtonStyle}
              testID={`notification-ai-share-decline-${invite.inviteId.slice(0, 8)}`}
            >
              <Text style={styles.actionButtonText}>
                {t("notifications.aiShareDecline", { defaultValue: "Decline" })}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (item.kind === "ai-share-pending-intent") {
    return (
      <PendingShareIntentRow
        intent={item.payload.intent}
        client={client}
        serverId={serverId}
        queryClient={queryClient}
        onActioned={onActioned}
      />
    );
  }

  // Future kinds land here — exhaustiveness check via never:
  const _exhaustive: never = item;
  return _exhaustive;
}

/**
 * Phase 4 v3/c §7.5.1 — pending intent row. Tapping "Use this device"
 * claims the intent on this daemon and routes the user into the
 * ShareAi flow with the picker prefilled to the friend the intent
 * targets.
 */
function PendingShareIntentRow({
  intent,
  client,
  serverId,
  queryClient,
  onActioned,
}: {
  intent: import("@server/server/identity/identity-rpc-schemas").AiShareIntentOnWire;
  client: ReturnType<typeof useHostRuntimeClient>;
  serverId: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
  onActioned: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const navRouter = useRouter();
  const [isClaiming, setIsClaiming] = useState(false);

  const handleClaim = useCallback(async () => {
    if (!client || isClaiming) return;
    setIsClaiming(true);
    try {
      const response = await client.chatP2pAiShareClaimIntent({ intentId: intent.intentId });
      if (response.error || !response.peerRootPubKeyB64) {
        return;
      }
      // Navigate to the friend chat where the v2/b ShareAi modal is
      // surfaced. The user picks the agent there.
      if (serverId) {
        navRouter.push({
          pathname: "/h/[serverId]/friend/[peerRootPubKey]",
          params: { serverId, peerRootPubKey: response.peerRootPubKeyB64 },
        });
      }
    } finally {
      setIsClaiming(false);
      await queryClient.invalidateQueries({
        queryKey: ["ai-share-pending-intents", serverId],
      });
      onActioned();
    }
  }, [client, intent.intentId, isClaiming, navRouter, onActioned, queryClient, serverId]);

  const claimButtonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.actionButton,
      styles.actionButtonAccept,
      hovered ? styles.actionButtonHovered : null,
    ],
    [],
  );

  const peerPrefix = intent.peerRootPubKeyB64.slice(0, 8);
  const sourcePrefix = intent.sourceDeviceId.slice(0, 8);
  return (
    <View style={styles.row} testID={`notification-row-ai-share-intent-${peerPrefix}`}>
      <View style={styles.iconCircle}>
        <Sparkles size={18} color={theme.colors.foregroundMuted} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {t("notifications.aiShareIntentTitle", {
            peer: peerPrefix,
            defaultValue: "Pending share with {{peer}}…",
          })}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {t("notifications.aiShareIntentSubtitle", {
            source: sourcePrefix,
            defaultValue: "Started on {{source}}… — claim to share from this device",
          })}
        </Text>
        <View style={styles.aiShareActions}>
          <Pressable
            accessibilityRole="button"
            onPress={handleClaim}
            disabled={isClaiming || !client}
            style={claimButtonStyle}
            testID={`notification-ai-share-claim-${peerPrefix}`}
          >
            <Text style={styles.actionButtonAcceptText}>
              {isClaiming
                ? t("notifications.aiShareClaiming", { defaultValue: "Claiming…" })
                : t("notifications.aiShareClaim", { defaultValue: "Use this device" })}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyContainer: {
    paddingVertical: theme.spacing[8],
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  list: {
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderCurve: "continuous",
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceGlassHover,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: -0.1,
  },
  rowSubtitle: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
  rowLimits: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginTop: 2,
  },
  aiShareActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actionButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  actionButtonAccept: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  actionButtonHovered: {
    backgroundColor: theme.colors.surfaceGlassHover,
  },
  actionButtonText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  actionButtonAcceptText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.palette.white,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
