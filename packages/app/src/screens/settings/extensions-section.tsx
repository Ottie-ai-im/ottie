// Settings → Advanced → Extensions panel.
//
// Mirrors the Extensions tab data but framed as a power-user list: every
// catalog entry that's installed gets a row with "Reinstall" (re-runs the
// install which writes bridge + hot-reloads + verifies companion app)
// and "Show in Finder" actions. Incompatible / not-installed entries are
// hidden — the discovery UI for those is the Extensions tab.

import { useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { CloudDownload, FolderOpen, RefreshCw, Trash2 } from "lucide-react-native";
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
  enabled: boolean;
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
          enabled: p.enabled ?? true,
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

  const setEnabledMutation = useMutation({
    mutationFn: async (input: { pluginId: string; enabled: boolean }) => {
      if (!client) throw new Error("Daemon not connected");
      return client.setPluginEnabled(input.pluginId, input.enabled);
    },
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error ?? "Toggle failed");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: PLUGIN_QUERY_KEY });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const refreshCatalogMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Daemon not connected");
      return client.refreshPluginCatalog();
    },
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error ?? "Catalog refresh failed");
        return;
      }
      if (result.refreshed) {
        toast.show(t("settings.extensions.refreshed", { count: result.count ?? 0 }), {
          variant: "success",
        });
      } else {
        toast.show(t("settings.extensions.refreshNotConfigured"));
      }
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
  const handleSetEnabled = useCallback(
    (pluginId: string, enabled: boolean) => setEnabledMutation.mutate({ pluginId, enabled }),
    [setEnabledMutation],
  );
  const handleRefreshCatalog = useCallback(
    () => refreshCatalogMutation.mutate(),
    [refreshCatalogMutation],
  );

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
            isToggling={
              setEnabledMutation.isPending && setEnabledMutation.variables?.pluginId === row.id
            }
            onReinstall={handleReinstall}
            onUninstall={handleUninstall}
            onRevealInFinder={handleRevealInFinder}
            onSetEnabled={handleSetEnabled}
          />
        ))}
      </View>
    );
  }

  const refreshTrailing = useMemo(
    () => (
      <RefreshCatalogButton
        isPending={refreshCatalogMutation.isPending}
        isConnected={isConnected}
        label={t("settings.extensions.refreshCatalog")}
        onPress={handleRefreshCatalog}
      />
    ),
    [refreshCatalogMutation.isPending, isConnected, t, handleRefreshCatalog],
  );

  return (
    <SettingsSection title={t("settings.extensions.title")} trailing={refreshTrailing}>
      {body}
    </SettingsSection>
  );
}

interface RefreshCatalogButtonProps {
  isPending: boolean;
  isConnected: boolean;
  label: string;
  onPress: () => void;
}

function RefreshCatalogButton({
  isPending,
  isConnected,
  label,
  onPress,
}: RefreshCatalogButtonProps) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      style={styles.refreshButton}
      disabled={isPending || !isConnected}
      onPress={onPress}
      accessibilityRole="button"
    >
      {isPending ? (
        <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
      ) : (
        <CloudDownload size={14} color={theme.colors.foregroundMuted} />
      )}
      <Text style={styles.refreshButtonText}>{label}</Text>
    </Pressable>
  );
}

interface ExtensionRowProps {
  row: InstalledPluginRow;
  isReinstalling: boolean;
  isUninstalling: boolean;
  isToggling: boolean;
  onReinstall: (pluginId: string) => void;
  onUninstall: (pluginId: string) => void;
  onRevealInFinder: (companionPath?: string) => void;
  onSetEnabled: (pluginId: string, enabled: boolean) => void;
}

function ExtensionRow({
  row,
  isReinstalling,
  isUninstalling,
  isToggling,
  onReinstall,
  onUninstall,
  onRevealInFinder,
  onSetEnabled,
}: ExtensionRowProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const handleReinstall = useCallback(() => onReinstall(row.id), [onReinstall, row.id]);
  const handleUninstall = useCallback(() => onUninstall(row.id), [onUninstall, row.id]);
  const handleReveal = useCallback(
    () => onRevealInFinder(row.companionPath),
    [onRevealInFinder, row.companionPath],
  );
  const handleToggle = useCallback(
    (next: boolean) => onSetEnabled(row.id, next),
    [onSetEnabled, row.id],
  );

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleColumn}>
          <Text style={styles.cardTitle}>{row.name}</Text>
          {row.author ? <Text style={styles.cardSubtitle}>by {row.author}</Text> : null}
          {!row.enabled ? (
            <Text style={styles.disabledLabel}>{t("settings.extensions.disabled")}</Text>
          ) : null}
        </View>
        <Switch
          value={row.enabled}
          onValueChange={handleToggle}
          disabled={isToggling}
          accessibilityLabel={t("settings.extensions.enabledToggle")}
        />
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
  disabledLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    marginTop: 2,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous" as const,
    backgroundColor: theme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  refreshButtonText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
  },
}));
