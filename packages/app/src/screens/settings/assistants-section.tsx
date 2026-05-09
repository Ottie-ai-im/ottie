import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { RotateCw, Sparkles } from "lucide-react-native";

import { settingsStyles } from "@/styles/settings";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useLocalServices } from "@/hooks/use-local-services";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { SettingsSection } from "@/screens/settings/settings-section";
import { buildHostAssistantsRoute } from "@/utils/host-routes";

interface AssistantSpec {
  id: "open-webui" | "openclaw" | "hermes";
  label: string;
  description: string;
}

const SPECS: AssistantSpec[] = [
  {
    id: "open-webui",
    label: "Open WebUI",
    description: "Multi-agent chat hub. Connects OpenClaw, Hermes, MCP, OpenAI-compatible models.",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    description: "Personal AI assistant. Local Gateway dashboard.",
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    description: "Self-improving AI agent with persistent memory.",
  },
];

function AssistantRow({
  spec,
  running,
  url,
  isFirst,
  onPress,
}: {
  spec: AssistantSpec;
  running: boolean;
  url: string | null | undefined;
  isFirst: boolean;
  onPress: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const rowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && settingsStyles.rowBorder],
    [isFirst],
  );
  return (
    <Pressable
      style={rowStyle}
      onPress={onPress}
      accessibilityRole="button"
      testID={`settings-assistant-row-${spec.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <View style={styles.titleRow}>
          <Sparkles size={theme.iconSize.sm} color={theme.colors.foreground} />
          <Text style={settingsStyles.rowTitle}>{spec.label}</Text>
        </View>
        <Text style={settingsStyles.rowHint}>{spec.description}</Text>
        {running && url ? <Text style={styles.urlText}>{url}</Text> : null}
      </View>
      <StatusBadge
        label={
          running
            ? t("assistants.settingsSection.installed")
            : t("assistants.settingsSection.notInstalled")
        }
        variant={running ? "success" : "muted"}
      />
    </Pressable>
  );
}

export interface AssistantsSectionProps {
  serverId: string;
}

export function AssistantsSection({ serverId }: AssistantsSectionProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { services, isLoading, isFetching, refetch } = useLocalServices(
    serverId.length > 0 ? serverId : null,
  );
  const hasServer = serverId.length > 0;

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleRowPress = useCallback(() => {
    if (!serverId) return;
    router.push(buildHostAssistantsRoute(serverId));
  }, [serverId]);

  const refreshAction = useMemo(
    () =>
      hasServer && isConnected ? (
        <Pressable
          onPress={handleRefresh}
          disabled={isFetching}
          hitSlop={8}
          style={settingsStyles.sectionHeaderLink}
          accessibilityRole="button"
          accessibilityLabel={t("assistants.settingsSection.refresh")}
        >
          {isFetching ? (
            <LoadingSpinner size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          ) : (
            <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          )}
        </Pressable>
      ) : undefined,
    [
      hasServer,
      isConnected,
      handleRefresh,
      isFetching,
      theme.iconSize.sm,
      theme.colors.foregroundMuted,
      t,
    ],
  );

  return (
    <SettingsSection
      title={t("assistants.settingsSection.title")}
      trailing={refreshAction}
      testID="host-page-assistants-card"
      style={styles.sectionSpacing}
    >
      {!hasServer || !isConnected ? (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("assistants.settingsSection.notConnected")}</Text>
        </View>
      ) : null}
      {hasServer && isConnected && isLoading ? (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("assistants.settingsSection.loading")}</Text>
        </View>
      ) : null}
      {hasServer && isConnected && !isLoading ? (
        <View style={settingsStyles.card}>
          {SPECS.map((spec, index) => {
            const status = services.find((s) => s.id === spec.id);
            const running = Boolean(status?.running);
            return (
              <AssistantRow
                key={spec.id}
                spec={spec}
                running={running}
                url={status?.url}
                isFirst={index === 0}
                onPress={handleRowPress}
              />
            );
          })}
        </View>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionSpacing: {
    marginBottom: theme.spacing[4],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  urlText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginTop: theme.spacing[1],
  },
}));

const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
