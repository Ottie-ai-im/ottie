import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { UserPlus } from "lucide-react-native";

import { AdaptiveModalSheet } from "./adaptive-modal-sheet";
import { useNotifications, type NotificationItem } from "@/hooks/use-notifications";

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
            <NotificationRow key={item.id} item={item} onActioned={onClose} />
          ))}
        </View>
      )}
    </AdaptiveModalSheet>
  );
}

function NotificationRow({ item, onActioned }: { item: NotificationItem; onActioned: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    if (item.kind === "friend-pair-candidate") {
      // Deep-link to the Identity page where the existing
      // `PendingFriendRequestsSection` renders the Approve / Reject
      // buttons against the same candidate. The user lands directly
      // on the section that takes action.
      router.push("/settings/identity");
    }
    onActioned();
  }, [item, onActioned]);

  if (item.kind === "friend-pair-candidate") {
    const candidate = item.payload.candidate;
    const pubKeyShort = candidate.peerRootSignPublicKeyB64.slice(0, 8);
    return (
      <Pressable
        accessibilityRole="button"
        onPress={handlePress}
        style={({ hovered }) => [styles.row, hovered ? styles.rowHovered : null]}
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
  // Future kinds land here — exhaustiveness check via never:
  const _exhaustive: never = item.kind;
  return _exhaustive;
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
}));
