import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Blocks, CheckCircle2, Download, ExternalLink, Play, Trash2 } from "lucide-react-native";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";
import { useActiveServerId } from "@/hooks/use-active-server-id";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";

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

type InstallPhase =
  | "writing_bridge"
  | "fetching_release"
  | "downloading"
  | "extracting"
  | "installing_app"
  | "done";

interface InstallProgressState {
  phase: InstallPhase;
  bytesLoaded?: number;
  bytesTotal?: number;
  note?: string;
}

const PHASE_KEY: Record<InstallPhase, string> = {
  writing_bridge: "extensions.phase.writingBridge",
  fetching_release: "extensions.phase.fetchingRelease",
  downloading: "extensions.phase.downloading",
  extracting: "extensions.phase.extracting",
  installing_app: "extensions.phase.installingApp",
  done: "extensions.phase.done",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeProgress(
  progress: InstallProgressState,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const label = t(PHASE_KEY[progress.phase]);
  if (progress.phase === "downloading" && progress.bytesLoaded != null) {
    if (progress.bytesTotal && progress.bytesTotal > 0) {
      const pct = Math.min(100, Math.round((progress.bytesLoaded / progress.bytesTotal) * 100));
      return `${pct}% · ${formatBytes(progress.bytesLoaded)} / ${formatBytes(progress.bytesTotal)}`;
    }
    return t("extensions.phase.bytesDownloaded", { size: formatBytes(progress.bytesLoaded) });
  }
  return label;
}

const PLUGIN_LIST_QUERY_KEY = ["plugin", "list"] as const;

export function CommunityScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const serverId = useActiveServerId();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryClient = useQueryClient();
  const toast = useToast();
  const [progressByPlugin, setProgressByPlugin] = useState<Record<string, InstallProgressState>>(
    {},
  );

  useEffect(() => {
    if (!client) return;
    const unsubscribe = client.on("plugin_install_progress", (msg) => {
      const { pluginId, phase, bytesLoaded, bytesTotal, note } = msg.payload;
      setProgressByPlugin((prev) => ({
        ...prev,
        [pluginId]: { phase, bytesLoaded, bytesTotal, note },
      }));
    });
    return unsubscribe;
  }, [client]);

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

  const clearProgress = useCallback((pluginId: string) => {
    setProgressByPlugin((prev) => {
      if (!(pluginId in prev)) return prev;
      const next = { ...prev };
      delete next[pluginId];
      return next;
    });
  }, []);

  const installMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!client) throw new Error("Daemon not connected");
      return client.installPlugin(pluginId);
    },
    onSuccess: (result) => {
      const id = result.pluginId ?? "extension";
      clearProgress(id);
      if (!result.success) {
        toast.error(result.error ?? t("extensions.toast.installFailed", { id }));
        return;
      }
      const companion = result.companionApp;
      if (companion?.state === "manual" && companion.releaseBrowserUrl) {
        toast.show(t("extensions.toast.bridgeInstalled", { id }));
      } else if (companion?.state === "installed") {
        toast.show(t("extensions.toast.readyToLaunch", { id }), { variant: "success" });
      } else {
        toast.show(t("extensions.toast.installed", { id }), { variant: "success" });
      }
      void queryClient.invalidateQueries({ queryKey: PLUGIN_LIST_QUERY_KEY });
    },
    onError: (err: unknown, pluginId) => {
      clearProgress(pluginId);
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (vars: { pluginId: string; removeCompanion: boolean }) => {
      if (!client) throw new Error("Daemon not connected");
      return client.uninstallPlugin(vars.pluginId, { removeCompanion: vars.removeCompanion });
    },
    onSuccess: (result, vars) => {
      if (!result.success) {
        toast.error(result.error ?? t("extensions.toast.uninstallFailed"));
        return;
      }
      const id = result.pluginId ?? vars.pluginId;
      toast.show(
        vars.removeCompanion
          ? t("extensions.toast.removedFull", { id })
          : t("extensions.toast.removed", { id }),
        { variant: "success" },
      );
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
        toast.error(result.error ?? t("extensions.toast.launchFailed"));
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
  const handleLaunch = useCallback((id: string) => launchMutate(id), [launchMutate]);

  // Two-step uninstall flow:
  //   1. Always ask before doing anything destructive.
  //   2. If a companion macOS app is installed, follow up with a SEPARATE
  //      destructive prompt asking whether to also move that .app to Trash.
  // Splitting it into two prompts (instead of a 3-button dialog) lets us
  // reuse the existing boolean confirmDialog helper across web/desktop/native
  // and makes accidental "full uninstall" mis-clicks harder.
  const handleUninstall = useCallback(
    async (plugin: PluginEntry) => {
      const companion = plugin.companionApp;
      const companionInstalled = companion?.state === "installed";
      const bundleName = companion?.bundleName ?? "";
      const appPath = companion?.path ?? "";
      const displayName = plugin.name ?? plugin.id;

      const firstConfirm = await confirmDialog({
        title: t("extensions.uninstall.confirmTitle", { name: displayName }),
        message:
          companionInstalled && bundleName
            ? t("extensions.uninstall.confirmBodyWithCompanion", { app: bundleName })
            : t("extensions.uninstall.confirmBody"),
        confirmLabel: t("extensions.action.uninstall"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!firstConfirm) return;

      let removeCompanion = false;
      if (companionInstalled && bundleName) {
        removeCompanion = await confirmDialog({
          title: t("extensions.uninstall.fullTitle", { app: bundleName }),
          message: t("extensions.uninstall.fullBody", {
            app: bundleName,
            path: appPath,
          }),
          confirmLabel: t("extensions.uninstall.moveToTrash"),
          cancelLabel: t("extensions.uninstall.keepApp"),
          destructive: true,
        });
      }

      uninstallMutate({ pluginId: plugin.id, removeCompanion });
    },
    [uninstallMutate, t],
  );
  const renderPlugin = (plugin: PluginEntry) => (
    <PluginCard
      key={plugin.id}
      plugin={plugin}
      isInstalling={installMutation.isPending && installMutation.variables === plugin.id}
      isUninstalling={
        uninstallMutation.isPending && uninstallMutation.variables?.pluginId === plugin.id
      }
      isLaunching={launchMutation.isPending && launchMutation.variables === plugin.id}
      progress={progressByPlugin[plugin.id]}
      onInstall={handleInstall}
      onUninstall={handleUninstall}
      onLaunch={handleLaunch}
      onOpenReleasePage={handleOpenReleasePage}
    />
  );

  let body: React.ReactNode;
  if (!serverId) {
    body = <PlaceholderText>{t("extensions.empty.notConnected")}</PlaceholderText>;
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
          : t("extensions.empty.loadFailed")}
      </PlaceholderText>
    );
  } else if (!pluginsQuery.data || pluginsQuery.data.length === 0) {
    body = <PlaceholderText>{t("extensions.empty.none")}</PlaceholderText>;
  } else {
    body = <View style={styles.list}>{pluginsQuery.data.map(renderPlugin)}</View>;
  }

  return (
    <View style={styles.container}>
      <MobileTabHeader title={t("extensions.title")} testID="community-header" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Blocks size={32} color={theme.colors.foreground} />
          <Text style={styles.title}>{t("extensions.market")}</Text>
          <Text style={styles.body}>{t("extensions.description")}</Text>
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
  progress: InstallProgressState | undefined;
  onInstall: (pluginId: string) => void;
  // Receives the whole plugin so the parent can branch the confirm dialog on
  // companion-app state without each card re-deriving it.
  onUninstall: (plugin: PluginEntry) => void;
  onLaunch: (pluginId: string) => void;
  onOpenReleasePage: (url?: string) => void;
}

function PluginCard({
  plugin,
  isInstalling,
  isUninstalling,
  isLaunching,
  progress,
  onInstall,
  onUninstall,
  onLaunch,
  onOpenReleasePage,
}: PluginCardProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const status = plugin.status ?? "not_installed";
  const isInstalled = status === "installed";
  const isIncompatible = status === "incompatible";
  const companion = plugin.companionApp;
  const companionInstalled = companion?.state === "installed";
  const companionManual = companion?.state === "manual";
  const releaseUrl = companion?.releaseBrowserUrl;
  const platforms = plugin.platforms?.join(", ");
  const handleInstall = useCallback(() => onInstall(plugin.id), [onInstall, plugin.id]);
  const handleUninstall = useCallback(() => onUninstall(plugin), [onUninstall, plugin]);
  const handleLaunch = useCallback(() => onLaunch(plugin.id), [onLaunch, plugin.id]);
  const handleReleasePagePress = useCallback(
    () => onOpenReleasePage(releaseUrl),
    [onOpenReleasePage, releaseUrl],
  );

  const statusPillIncompatibleStyle = useMemo(
    () => [styles.statusPill, styles.statusPillMuted],
    [],
  );
  const statusPillInstalledStyle = useMemo(
    () => [styles.statusPill, styles.statusPillInstalled],
    [],
  );
  const statusTextInstalledStyle = useMemo(
    () => [styles.statusText, styles.statusTextInstalled],
    [],
  );
  const primaryButtonStyle = useMemo(() => [styles.button, styles.primaryButton], []);
  const secondaryButtonStyle = useMemo(() => [styles.button, styles.secondaryButton], []);

  let statusBadge: React.ReactNode = null;
  if (isIncompatible) {
    statusBadge = (
      <View style={statusPillIncompatibleStyle}>
        <Text style={styles.statusText}>
          {platforms
            ? t("extensions.badge.platformsOnly", { platforms })
            : t("extensions.badge.unsupported")}
        </Text>
      </View>
    );
  } else if (isInstalled) {
    statusBadge = (
      <View style={statusPillInstalledStyle}>
        <CheckCircle2 size={12} color={theme.colors.palette.green[500]} />
        <Text style={statusTextInstalledStyle}>{t("extensions.installed")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.pluginCard}>
      <View style={styles.pluginHeader}>
        <View style={styles.pluginInfo}>
          <Text style={styles.pluginName}>{plugin.name ?? plugin.id}</Text>
          {plugin.author ? (
            <Text style={styles.pluginAuthor}>{t("extensions.by", { author: plugin.author })}</Text>
          ) : null}
        </View>
        {statusBadge}
      </View>
      {plugin.description ? <Text style={styles.pluginDesc}>{plugin.description}</Text> : null}

      {isInstalled && companionManual && releaseUrl ? (
        <View style={styles.companionRow}>
          <Text style={styles.companionText}>
            {t("extensions.bridgeInstalledHint", {
              app: companion.bundleName ?? t("extensions.companionAppFallback"),
            })}
          </Text>
          <Pressable
            style={styles.linkButton}
            onPress={handleReleasePagePress}
            accessibilityRole="link"
          >
            <ExternalLink size={12} color={theme.colors.foreground} />
            <Text style={styles.linkText}>{t("extensions.openReleasePage")}</Text>
          </Pressable>
        </View>
      ) : null}

      {isInstalling && progress ? <InstallProgressRow progress={progress} /> : null}
      <PluginActionRow
        isInstalled={isInstalled}
        isIncompatible={isIncompatible}
        isInstalling={isInstalling}
        isUninstalling={isUninstalling}
        isLaunching={isLaunching}
        companion={companion}
        companionInstalled={companionInstalled}
        primaryButtonStyle={primaryButtonStyle}
        secondaryButtonStyle={secondaryButtonStyle}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        onLaunch={handleLaunch}
      />
    </View>
  );
}

interface InstallProgressRowProps {
  progress: InstallProgressState;
}

function InstallProgressRow({ progress }: InstallProgressRowProps) {
  const { t } = useTranslation();
  const ratio =
    progress.phase === "downloading" && progress.bytesTotal && progress.bytesTotal > 0
      ? Math.min(1, (progress.bytesLoaded ?? 0) / progress.bytesTotal)
      : null;
  const percentLabel = ratio !== null ? `${Math.round(ratio * 100)}%` : null;
  const fillStyle = useMemo(
    () => [styles.progressFill, ratio !== null ? { width: `${ratio * 100}%` as const } : null],
    [ratio],
  );
  const indeterminateStyle = useMemo(
    () => [styles.progressFill, styles.progressFillIndeterminate],
    [],
  );
  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressTextRow}>
        <Text style={styles.progressLabel}>{describeProgress(progress, t)}</Text>
        {percentLabel ? <Text style={styles.progressPercent}>{percentLabel}</Text> : null}
      </View>
      <View style={styles.progressTrack}>
        {ratio !== null ? <View style={fillStyle} /> : <View style={indeterminateStyle} />}
      </View>
    </View>
  );
}

interface PluginActionRowProps {
  isInstalled: boolean;
  isIncompatible: boolean;
  isInstalling: boolean;
  isUninstalling: boolean;
  isLaunching: boolean;
  companion: PluginCompanionAppInfo | undefined;
  companionInstalled: boolean;
  primaryButtonStyle: React.ComponentProps<typeof Pressable>["style"];
  secondaryButtonStyle: React.ComponentProps<typeof Pressable>["style"];
  onInstall: () => void;
  onUninstall: () => void;
  onLaunch: () => void;
}

function PluginActionRow({
  isInstalled,
  isIncompatible,
  isInstalling,
  isUninstalling,
  isLaunching,
  companion,
  companionInstalled,
  primaryButtonStyle,
  secondaryButtonStyle,
  onInstall,
  onUninstall,
  onLaunch,
}: PluginActionRowProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  if (isIncompatible) return null;

  if (isInstalled) {
    return (
      <View style={styles.actionRow}>
        {companion ? (
          <Pressable
            style={primaryButtonStyle}
            disabled={!companionInstalled || isLaunching}
            onPress={onLaunch}
            accessibilityRole="button"
          >
            {isLaunching ? (
              <ActivityIndicator size="small" color={theme.colors.accentForeground} />
            ) : (
              <>
                <Play size={14} color={theme.colors.accentForeground} />
                <Text style={styles.primaryButtonText}>
                  {companionInstalled
                    ? t("extensions.action.open")
                    : t("extensions.action.companionMissing")}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}
        <Pressable
          style={secondaryButtonStyle}
          disabled={isUninstalling}
          onPress={onUninstall}
          accessibilityRole="button"
        >
          {isUninstalling ? (
            <ActivityIndicator size="small" color={theme.colors.foreground} />
          ) : (
            <>
              <Trash2 size={14} color={theme.colors.foreground} />
              <Text style={styles.secondaryButtonText}>{t("extensions.action.uninstall")}</Text>
            </>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.actionRow}>
      <Pressable
        style={primaryButtonStyle}
        disabled={isInstalling}
        onPress={onInstall}
        accessibilityRole="button"
      >
        {isInstalling ? (
          <ActivityIndicator size="small" color={theme.colors.accentForeground} />
        ) : (
          <>
            <Download size={14} color={theme.colors.accentForeground} />
            <Text style={styles.primaryButtonText}>{t("extensions.install")}</Text>
          </>
        )}
      </Pressable>
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
  progressContainer: {
    gap: 6,
    paddingVertical: theme.spacing[1],
  },
  progressTextRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  progressPercent: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginLeft: theme.spacing[2],
  },
  progressTrack: {
    height: 4,
    borderRadius: theme.borderRadius.glassPill,
    backgroundColor: theme.colors.surfaceGlassStrong,
    overflow: "hidden" as const,
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.glassPill,
  },
  progressFillIndeterminate: {
    width: "30%",
    opacity: 0.6,
  },
}));
