import { useCallback, useMemo } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, CheckCircle2, Download, ExternalLink, Play, Trash2 } from "lucide-react-native";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";
import { useActiveServerId } from "@/hooks/use-active-server-id";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";

interface PluginCompanionAppInfo {
  bundleName?: string;
  state?: "installed" | "manual" | "skipped" | "not_installed";
  path?: string;
  releaseBrowserUrl?: string;
}

interface PluginEntry {
  id: string;
  name?: string;
  description?: string;
  author?: string;
  platforms?: readonly string[];
  status?: "installed" | "not_installed" | "incompatible";
  companionApp?: PluginCompanionAppInfo;
}

const PLUGIN_LIST_QUERY_KEY = ["plugin", "list"] as const;

export function CommunityScreen() {
  const { theme } = useUnistyles();
  const serverId = useActiveServerId();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryClient = useQueryClient();
  const toast = useToast();

  const pluginsQuery = useQuery({
    queryKey: [...PLUGIN_LIST_QUERY_KEY, serverId],
    queryFn: async (): Promise<PluginEntry[]> => {
      if (!client) return [];
      const response = await client.listPlugins();
      return (response.plugins ?? []) as PluginEntry[];
    },
    enabled: Boolean(client) && isConnected,
    staleTime: 30_000,
  });

  const installMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!client) throw new Error("Daemon not connected");
      return client.installPlugin(pluginId);
    },
    onSuccess: (result) => {
      const id = result.pluginId ?? "extension";
      if (!result.success) {
        toast.error(result.error ?? `Install of ${id} failed`);
        return;
      }
      const companion = result.companionApp;
      if (companion?.state === "manual" && companion.releaseBrowserUrl) {
        toast.show(`${id} bridge installed. Finish installing the companion app from GitHub.`);
      } else if (companion?.state === "installed") {
        toast.show(`${id} ready to launch`, { variant: "success" });
      } else {
        toast.show(`${id} installed`, { variant: "success" });
      }
      void queryClient.invalidateQueries({ queryKey: PLUGIN_LIST_QUERY_KEY });
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
      void queryClient.invalidateQueries({ queryKey: PLUGIN_LIST_QUERY_KEY });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const launchMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!client) throw new Error("Daemon not connected");
      return client.launchPlugin(pluginId);
    },
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error ?? "Launch failed");
      }
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const handleOpenReleasePage = useCallback((url?: string) => {
    if (!url) return;
    void Linking.openURL(url);
  }, []);

  const installMutate = installMutation.mutate;
  const uninstallMutate = uninstallMutation.mutate;
  const launchMutate = launchMutation.mutate;
  const handleInstall = useCallback((id: string) => installMutate(id), [installMutate]);
  const handleUninstall = useCallback((id: string) => uninstallMutate(id), [uninstallMutate]);
  const handleLaunch = useCallback((id: string) => launchMutate(id), [launchMutate]);
  const renderPlugin = (plugin: PluginEntry) => (
    <PluginCard
      key={plugin.id}
      plugin={plugin}
      isInstalling={installMutation.isPending && installMutation.variables === plugin.id}
      isUninstalling={uninstallMutation.isPending && uninstallMutation.variables === plugin.id}
      isLaunching={launchMutation.isPending && launchMutation.variables === plugin.id}
      onInstall={handleInstall}
      onUninstall={handleUninstall}
      onLaunch={handleLaunch}
      onOpenReleasePage={handleOpenReleasePage}
    />
  );

  let body: React.ReactNode;
  if (!serverId) {
    body = <PlaceholderText>Connect to a daemon to browse extensions.</PlaceholderText>;
  } else if (pluginsQuery.isLoading) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.foreground} />
      </View>
    );
  } else if (pluginsQuery.isError) {
    body = (
      <PlaceholderText>
        {pluginsQuery.error instanceof Error
          ? pluginsQuery.error.message
          : "Failed to load extensions"}
      </PlaceholderText>
    );
  } else if (!pluginsQuery.data || pluginsQuery.data.length === 0) {
    body = <PlaceholderText>No extensions are available yet.</PlaceholderText>;
  } else {
    body = <View style={styles.list}>{pluginsQuery.data.map(renderPlugin)}</View>;
  }

  return (
    <View style={styles.container}>
      <MobileTabHeader title="Extensions" testID="community-header" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Blocks size={32} color={theme.colors.foreground} />
          <Text style={styles.title}>Extension Store</Text>
          <Text style={styles.body}>
            Discover and install community extensions to power up your daemon.
          </Text>
        </View>
        {body}
      </ScrollView>
    </View>
  );
}

function PlaceholderText({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.center}>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

interface PluginCardProps {
  plugin: PluginEntry;
  isInstalling: boolean;
  isUninstalling: boolean;
  isLaunching: boolean;
  onInstall: (pluginId: string) => void;
  onUninstall: (pluginId: string) => void;
  onLaunch: (pluginId: string) => void;
  onOpenReleasePage: (url?: string) => void;
}

function PluginCard({
  plugin,
  isInstalling,
  isUninstalling,
  isLaunching,
  onInstall,
  onUninstall,
  onLaunch,
  onOpenReleasePage,
}: PluginCardProps) {
  const { theme } = useUnistyles();
  const status = plugin.status ?? "not_installed";
  const isInstalled = status === "installed";
  const isIncompatible = status === "incompatible";
  const companion = plugin.companionApp;
  const companionInstalled = companion?.state === "installed";
  const companionManual = companion?.state === "manual";
  const releaseUrl = companion?.releaseBrowserUrl;
  const platforms = plugin.platforms?.join(", ");
  const handleInstall = useCallback(() => onInstall(plugin.id), [onInstall, plugin.id]);
  const handleUninstall = useCallback(() => onUninstall(plugin.id), [onUninstall, plugin.id]);
  const handleLaunch = useCallback(() => onLaunch(plugin.id), [onLaunch, plugin.id]);
  const handleReleasePagePress = useCallback(
    () => onOpenReleasePage(releaseUrl),
    [onOpenReleasePage, releaseUrl],
  );

  let statusBadge: React.ReactNode = null;
  if (isIncompatible) {
    statusBadge = (
      <View style={[styles.statusPill, styles.statusPillMuted]}>
        <Text style={styles.statusText}>{platforms ? `${platforms} only` : "Unsupported"}</Text>
      </View>
    );
  } else if (isInstalled) {
    statusBadge = (
      <View style={[styles.statusPill, styles.statusPillInstalled]}>
        <CheckCircle2 size={12} color={theme.colors.palette.green[500]} />
        <Text style={[styles.statusText, styles.statusTextInstalled]}>Installed</Text>
      </View>
    );
  }

  return (
    <View style={styles.pluginCard}>
      <View style={styles.pluginHeader}>
        <View style={styles.pluginInfo}>
          <Text style={styles.pluginName}>{plugin.name ?? plugin.id}</Text>
          {plugin.author ? <Text style={styles.pluginAuthor}>by {plugin.author}</Text> : null}
        </View>
        {statusBadge}
      </View>
      {plugin.description ? <Text style={styles.pluginDesc}>{plugin.description}</Text> : null}

      {isInstalled && companionManual && releaseUrl ? (
        <View style={styles.companionRow}>
          <Text style={styles.companionText}>
            Bridge installed. Get {companion.bundleName ?? "the companion app"} from GitHub:
          </Text>
          <Pressable
            style={styles.linkButton}
            onPress={handleReleasePagePress}
            accessibilityRole="link"
          >
            <ExternalLink size={12} color={theme.colors.foreground} />
            <Text style={styles.linkText}>Open release page</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {isIncompatible ? null : isInstalled ? (
          <>
            {companion ? (
              <Pressable
                style={[styles.button, styles.primaryButton]}
                disabled={!companionInstalled || isLaunching}
                onPress={handleLaunch}
                accessibilityRole="button"
              >
                {isLaunching ? (
                  <ActivityIndicator size="small" color={theme.colors.accentForeground} />
                ) : (
                  <>
                    <Play size={14} color={theme.colors.accentForeground} />
                    <Text style={styles.primaryButtonText}>
                      {companionInstalled ? "Open" : "Companion missing"}
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.button, styles.secondaryButton]}
              disabled={isUninstalling}
              onPress={handleUninstall}
              accessibilityRole="button"
            >
              {isUninstalling ? (
                <ActivityIndicator size="small" color={theme.colors.foreground} />
              ) : (
                <>
                  <Trash2 size={14} color={theme.colors.foreground} />
                  <Text style={styles.secondaryButtonText}>Uninstall</Text>
                </>
              )}
            </Pressable>
          </>
        ) : (
          <Pressable
            style={[styles.button, styles.primaryButton]}
            disabled={isInstalling}
            onPress={handleInstall}
            accessibilityRole="button"
          >
            {isInstalling ? (
              <ActivityIndicator size="small" color={theme.colors.accentForeground} />
            ) : (
              <>
                <Download size={14} color={theme.colors.accentForeground} />
                <Text style={styles.primaryButtonText}>Install</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[12],
  },
  header: {
    alignItems: "center",
    marginBottom: theme.spacing[8],
    gap: theme.spacing[3],
  },
  title: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.4,
  },
  body: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
  },
  list: {
    gap: theme.spacing[4],
  },
  center: {
    alignItems: "center",
    paddingVertical: theme.spacing[8],
  },
  pluginCard: {
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous" as const,
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: theme.spacing[3],
  },
  pluginHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  pluginInfo: {
    flex: 1,
    marginRight: theme.spacing[4],
  },
  pluginName: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginBottom: 2,
  },
  pluginAuthor: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  pluginDesc: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 20,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.glassPill,
    backgroundColor: theme.colors.surfaceGlassStrong,
  },
  statusPillInstalled: {
    backgroundColor: "rgba(31, 168, 85, 0.12)",
  },
  statusPillMuted: {
    backgroundColor: theme.colors.surface2,
  },
  statusText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
  },
  statusTextInstalled: {
    color: theme.colors.palette.green[500],
  },
  actionRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous" as const,
    minHeight: 32,
    flex: 1,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
  },
  primaryButtonText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.accentForeground,
  },
  secondaryButton: {
    backgroundColor: theme.colors.surfaceGlassStrong,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  secondaryButtonText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  companionRow: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surfaceGlassStrong,
    borderRadius: theme.borderRadius.lg,
    borderCurve: "continuous" as const,
  },
  companionText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous" as const,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  linkText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));
