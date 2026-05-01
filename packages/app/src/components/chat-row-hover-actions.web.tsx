// Web-only hover quick-actions strip for chat rows.
//
// `.web.tsx` extension so Metro doesn't bundle this on native (UI-SPEC line 270
// — swipe-left replaces hover on native; this overlay is purely a desktop /
// browser affordance).
//
// Visibility rule (per Phase 1 NAT-A3): never `isHovered` alone. Show when
// `isHovered || isCompact` so compact-but-web layouts (think browser-tab on a
// phone) get the controls always visible too.

import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import { Bell, Check, Trash2 } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { actionRegistry } from "@/actions/registry";
import { useIsCompactFormFactor } from "@/constants/layout";

export interface ChatRowHoverActionsProps {
  serverId: string;
  agentId: string;
  isHovered: boolean;
}

export function ChatRowHoverActions({ serverId, agentId, isHovered }: ChatRowHoverActionsProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const isCompact = useIsCompactFormFactor();

  // Phase 1 pattern: never `isHovered` alone — pair with `isCompact` so
  // compact viewports get the controls always-visible.
  const visible = isHovered || isCompact;

  const iconColor = useMemo(() => theme.colors.foregroundMuted, [theme.colors.foregroundMuted]);
  const destructiveColor = useMemo(() => theme.colors.destructive, [theme.colors.destructive]);

  const handleMarkRead = useCallback(() => {
    void actionRegistry.dispatch("chat.menu.markRead", { serverId, agentId });
  }, [serverId, agentId]);

  const handleMute = useCallback(() => {
    void actionRegistry.dispatch("chat.menu.mute", { serverId, agentId });
  }, [serverId, agentId]);

  const handleDelete = useCallback(() => {
    void actionRegistry.dispatch("chat.menu.delete", { serverId, agentId });
  }, [serverId, agentId]);

  if (!visible) return null;

  return (
    <View style={styles.group}>
      <Pressable
        accessibilityLabel={t("chat.menu.markRead")}
        accessibilityRole="button"
        onPress={handleMarkRead}
        style={styles.iconButton}
      >
        <Check size={16} color={iconColor} />
      </Pressable>
      <Pressable
        accessibilityLabel={t("chat.menu.mute")}
        accessibilityRole="button"
        onPress={handleMute}
        style={styles.iconButton}
      >
        <Bell size={16} color={iconColor} />
      </Pressable>
      <Pressable
        accessibilityLabel={t("chat.menu.delete")}
        accessibilityRole="button"
        onPress={handleDelete}
        style={styles.iconButton}
      >
        <Trash2 size={16} color={destructiveColor} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  group: {
    flexDirection: "row",
    gap: theme.spacing[2],
    alignItems: "center",
  },
  iconButton: {
    padding: theme.spacing[1],
  },
}));
