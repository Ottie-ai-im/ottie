import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Bot, Server } from "lucide-react-native";
import { useLocalServices } from "@/hooks/use-local-services";
import { useAiAgentsStore } from "@/stores/ai-agents-store";

interface SidebarAiAgentsListProps {
  serverId: string | null;
}

export interface SidebarAiAgentRow {
  kind: "user-agent" | "local-service";
  id: string;
  label: string;
  href: string;
  running?: boolean;
}

// Combines:
//   - user-created conversation agents (from `useAiAgentsStore`)
//   - auto-detected running local services (from `useLocalServices`)
// Local services that are detected but NOT running are intentionally not
// shown — the user can still install/start them from the AssistantsScreen
// reachable via the "+" menu's "Add local service" item. Listing dormant
// services in the sidebar would clutter it for users who don't use them.
export function useSidebarAiAgents(serverId: string | null): readonly SidebarAiAgentRow[] {
  const userAgents = useAiAgentsStore((state) => state.agents);
  const { services } = useLocalServices(serverId);

  return useMemo(() => {
    const rows: SidebarAiAgentRow[] = [];
    if (serverId) {
      for (const service of services) {
        if (!service.running) continue;
        rows.push({
          kind: "local-service",
          id: service.id,
          label: service.label || service.id,
          href: `/h/${encodeURIComponent(serverId)}/assistants?service=${encodeURIComponent(
            service.id,
          )}`,
          running: true,
        });
      }
    }
    for (const agent of userAgents) {
      rows.push({
        kind: "user-agent",
        id: agent.id,
        label: agent.name,
        href: `/h/${encodeURIComponent(serverId ?? "_local")}/ai-agent/${encodeURIComponent(
          agent.id,
        )}`,
      });
    }
    return rows;
  }, [serverId, services, userAgents]);
}

export function SidebarAiAgentsList({ serverId }: SidebarAiAgentsListProps) {
  const { t } = useTranslation();
  const rows = useSidebarAiAgents(serverId);

  if (rows.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.emptyText}>{t("sidebar.aiAgents.empty")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {rows.map((row) => (
        <SidebarAiAgentItem key={`${row.kind}:${row.id}`} row={row} />
      ))}
    </View>
  );
}

interface SidebarAiAgentItemProps {
  row: SidebarAiAgentRow;
}

function SidebarAiAgentItem({ row }: SidebarAiAgentItemProps) {
  const { theme } = useUnistyles();
  const router = useRouter();

  const handlePress = useCallback(() => {
    router.push(row.href as Href);
  }, [router, row.href]);

  const buttonStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.item,
      hovered ? styles.itemHovered : null,
    ],
    [],
  );

  const Icon = row.kind === "local-service" ? Server : Bot;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={row.label}
      style={buttonStyle}
    >
      <Icon size={14} color={theme.colors.foregroundMuted} />
      <Text style={styles.itemLabel} numberOfLines={1}>
        {row.label}
      </Text>
      {row.running ? <View style={styles.runningDot} /> : null}
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
  runningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
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
