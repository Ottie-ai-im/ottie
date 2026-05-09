import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { User } from "lucide-react-native";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { StoredPeer } from "@server/server/identity/peer-types";

interface SidebarHumansListProps {
  serverId: string | null;
}

interface SidebarHumansSummary {
  count: number;
  peers: readonly StoredPeer[];
}

const EMPTY_SUMMARY: SidebarHumansSummary = { count: 0, peers: [] };

// Polls `friendList()` every 30s — same cadence as `useLocalServices`.
// Filters out blocked/removed peers (UI surfaces only `active`).
export function useSidebarHumans(serverId: string | null): SidebarHumansSummary {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const query = useQuery({
    queryKey: ["sidebar-humans", serverId],
    enabled: Boolean(serverId && client && isConnected),
    refetchInterval: 30_000,
    staleTime: 10_000,
    queryFn: async () => {
      if (!client) return EMPTY_SUMMARY;
      const response = await client.friendList();
      const peers = (response.peers ?? []).filter((peer) => peer.status === "active");
      return { count: peers.length, peers };
    },
  });
  return query.data ?? EMPTY_SUMMARY;
}

export function SidebarHumansList({ serverId }: SidebarHumansListProps) {
  const { t } = useTranslation();
  const { peers } = useSidebarHumans(serverId);

  if (!serverId) {
    return null;
  }

  if (peers.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.emptyText}>{t("sidebar.humans.empty")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {peers.map((peer) => (
        <SidebarHumanItem key={peer.peerRootSignPublicKeyB64} peer={peer} serverId={serverId} />
      ))}
    </View>
  );
}

interface SidebarHumanItemProps {
  peer: StoredPeer;
  serverId: string;
}

function SidebarHumanItem({ peer, serverId }: SidebarHumanItemProps) {
  const { theme } = useUnistyles();
  const router = useRouter();

  const handlePress = useCallback(() => {
    router.push(
      `/h/${encodeURIComponent(serverId)}/friend/${encodeURIComponent(
        peer.peerRootSignPublicKeyB64,
      )}` as Href,
    );
  }, [peer.peerRootSignPublicKeyB64, router, serverId]);

  const buttonStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.item,
      hovered ? styles.itemHovered : null,
    ],
    [],
  );

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={peer.peerDisplayName}
      style={buttonStyle}
    >
      <User size={14} color={theme.colors.foregroundMuted} />
      <Text style={styles.itemLabel} numberOfLines={1}>
        {peer.peerDisplayName}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    gap: 2,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.sm,
    borderCurve: "continuous",
    minHeight: 28,
  },
  itemHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  itemLabel: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  emptyBlock: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  emptyText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
