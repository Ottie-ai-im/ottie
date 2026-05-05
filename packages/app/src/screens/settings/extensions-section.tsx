// Settings → Advanced → Extensions panel.
//
// Mirrors the Extensions tab data but framed as a power-user list: every
// catalog entry that's installed gets a row with "Reinstall" (re-runs the
// install which writes bridge + hot-reloads + verifies companion app)
// and "Show in Finder" actions. Incompatible / not-installed entries are
// hidden — the discovery UI for those is the Extensions tab.

import { useCallback } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { FolderOpen, RefreshCw, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useToast } from "@/contexts/toast-context";

interface InstalledPluginRow {
  id: string;
  name: string;
  author?: string;
  status: string;
  companionPath?: string;
}

const PLUGIN_QUERY_KEY = ["settings", "plugin", "list"] as const;

export function ExtensionsSection() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const hosts = useHosts();
  const probeServerId = hosts[0]?.serverId ?? null;
  const client = useHostRuntimeClient(probeServerId ?? "");
  const isConnected = useHostRuntimeIsConnected(probeServerId ?? "");
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: [...PLUGIN_QUERY_KEY, probeServerId],
    queryFn: async (): Promise<InstalledPluginRow[]> => {
      if (!client) return [];
      const response = await client.listPlugins();
      const plugins = response.plugins ?? [];
      return plugins
        .filter((p) => p.status === "installed")
        .map((p) => ({
          id: p.id,
          name: p.name ?? p.id,
          author: p.author,
          status: p.status ?? "installed",
          companionPath: p.companionApp?.path,
        }));
    },
    enabled: Boolean(client) && isConnected,
    staleTime: 30_000,
  });

  const reinstallMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!client) throw new Error("Daemon not connected");
      return client.installPlugin(pluginId);
    },
    onSuccess: (result) => {
      const id = result.pluginId ?? "extension";
      if (!result.success) {
        toast.error(result.error ?? `Reinstall of ${id} failed`);
        return;
      }
      toast.show(`${id} reinstalled`, { variant: "success" });
      void queryClient.invalidateQueries({ queryKey: PLUGIN_QUERY_KEY });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!client) throw new Error("Daemon not connected");
      return client.uninstallPlugin(pluginId);
    },
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error ?? "Uninstall failed");
        return;
      }
      toast.show(`${result.pluginId ?? "extension"} removed`, { variant: "success" });
      void queryClient.invalidateQueries({ queryKey: PLUGIN_QUERY_KEY });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const handleReinstall = useCallback(
    (pluginId: string) => reinstallMutation.mutate(pluginId),
    [reinstallMutation],
  );
  const handleUninstall = useCallback(
    (pluginId: string) => uninstallMutation.mutate(pluginId),
    [uninstallMutation],
  );
  const handleRevealInFinder = useCallback(async (companionPath?: string) => {
    if (!companionPath) return;
    await Linking.openURL(`file://${companionPath}`);
  }, []);

  let body: React.ReactNode;
  if (!isConnected) {
    body = <Text style={settingsStyles.rowHint}>{t("settings.extensions.notConnected")}</Text>;
  } else if (query.isLoading) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.foreground} />
      </View>
    );
  } else if (query.isError) {
    body = (
      <Text style={settingsStyles.rowHint}>
        {query.error instanceof Error ? query.error.message : t("settings.extensions.loadError")}
      </Text>
    );
  } else if (!query.data || query.data.length === 0) {
    body = <Text style={settingsStyles.rowHint}>{t("settings.extensions.empty")}</Text>;
  } else {
    body = (
      <View style={styles.list}>
        {query.data.map((row) => (
          <ExtensionRow
            key={row.id}
            row={row}
            isReinstalling={reinstallMutation.isPending && reinstallMutation.variables === row.id}
            isUninstalling={uninstallMutation.isPending && uninstallMutation.variables === row.id}
            onReinstall={handleReinstall}
            onUninstall={handleUninstall}
            onRevealInFinder={handleRevealInFinder}
          />
        ))}
      </View>
    );
  }

  return <SettingsSection title={t("settings.extensions.title")}>{body}</SettingsSection>;
}

interface ExtensionRowProps {
  row: InstalledPluginRow;
  isReinstalling: boolean;
  isUninstalling: boolean;
  onReinstall: (pluginId: string) => void;
  onUninstall: (pluginId: string) => void;
  onRevealInFinder: (companionPath?: string) => void;
}

function ExtensionRow({
  row,
  isReinstalling,
  isUninstalling,
  onReinstall,
  onUninstall,
  onRevealInFinder,
}: ExtensionRowProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const handleReinstall = useCallback(() => onReinstall(row.id), [onReinstall, row.id]);
  const handleUninstall = useCallback(() => onUninstall(row.id), [onUninstall, row.id]);
  const handleReveal = useCallback(
    () => onRevealInFinder(row.companionPath),
    [onRevealInFinder, row.companionPath],
  );

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleColumn}>
          <Text style={styles.cardTitle}>{row.name}</Text>
          {row.author ? <Text style={styles.cardSubtitle}>by {row.author}</Text> : null}
        </View>
      </View>
      <View style={styles.cardActions}>
        <Pressable
          style={styles.actionButton}
          disabled={isReinstalling}
          onPress={handleReinstall}
          accessibilityRole="button"
        >
          {isReinstalling ? (
            <ActivityIndicator size="small" color={theme.colors.foreground} />
          ) : (
            <RefreshCw size={14} color={theme.colors.foreground} />
          )}
          <Text style={styles.actionLabel}>{t("settings.extensions.reinstall")}</Text>
        </Pressable>
        {row.companionPath ? (
          <Pressable style={styles.actionButton} onPress={handleReveal} accessibilityRole="button">
            <FolderOpen size={14} color={theme.colors.foreground} />
            <Text style={styles.actionLabel}>{t("settings.extensions.revealInFinder")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.actionButton}
          disabled={isUninstalling}
          onPress={handleUninstall}
          accessibilityRole="button"
        >
          {isUninstalling ? (
            <ActivityIndicator size="small" color={theme.colors.destructive} />
          ) : (
            <Trash2 size={14} color={theme.colors.destructive} />
          )}
          <Text style={styles.actionLabelDestructive}>{t("settings.extensions.uninstall")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[3],
  },
  center: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  card: {
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    padding: theme.spacing[3],
    gap: theme.spacing[3],
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  cardTitleColumn: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  cardSubtitle: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous" as const,
    backgroundColor: theme.colors.surfaceGlassStrong,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  actionLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  actionLabelDestructive: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.destructive,
  },
}));
