import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ExternalLink, Settings as SettingsIcon, Sparkles } from "lucide-react-native";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";
import { isWeb } from "@/constants/platform";
import { openExternalUrl } from "@/utils/open-external-url";
import { useHosts } from "@/runtime/host-runtime";
import { useInstallLocalService, useLocalServices } from "@/hooks/use-local-services";
import { OpenclawChatPanel } from "@/components/openclaw-chat-panel";
import { HermesChatPanel } from "@/components/hermes-chat-panel";

function renderActiveService(
  service: { id: string; url: string | null },
  serverId: string | null,
  fallbackUrl: string,
) {
  if (service.id === "openclaw") return <OpenclawChatPanel serverId={serverId} />;
  if (service.id === "hermes") return <HermesChatPanel serverId={serverId} />;
  return <EmbeddedWebUi url={service.url ?? fallbackUrl} />;
}
import { DEFAULT_OPEN_WEBUI_URL, useAssistantsConfigStore } from "@/stores/assistants-config-store";

interface KnownDashboard {
  id: string;
  labelKey: string;
  descriptionKey: string;
  defaultUrl: string;
  installHintKey: string;
  installCommand: string;
}

const IFRAME_STYLE = { width: "100%", height: "100%", border: "none" };

const KNOWN_DASHBOARDS: KnownDashboard[] = [
  {
    id: "openclaw",
    labelKey: "assistants.openclaw.label",
    descriptionKey: "assistants.openclaw.description",
    defaultUrl: "http://localhost:18789",
    installHintKey: "assistants.openclaw.installHint",
    installCommand: "npm install -g openclaw && openclaw onboard --install-daemon",
  },
  {
    id: "open-webui",
    labelKey: "assistants.openWebUi.label",
    descriptionKey: "assistants.openWebUi.description",
    defaultUrl: "http://localhost:3000",
    installHintKey: "assistants.openWebUi.installHint",
    installCommand: "pip install open-webui && open-webui serve",
  },
  {
    id: "hermes",
    labelKey: "assistants.hermes.label",
    descriptionKey: "assistants.hermes.description",
    defaultUrl: "http://localhost:8642",
    installHintKey: "assistants.hermes.installHint",
    installCommand: "See https://hermes-agent.org for install instructions",
  },
];

export function AssistantsScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const openWebUiUrl = useAssistantsConfigStore((s) => s.openWebUiUrl);
  const setOpenWebUiUrl = useAssistantsConfigStore((s) => s.setOpenWebUiUrl);
  const resetOpenWebUiUrl = useAssistantsConfigStore((s) => s.resetOpenWebUiUrl);
  const hosts = useHosts();
  const serverId = hosts[0]?.serverId ?? null;
  const { services, installers } = useLocalServices(serverId);
  const { install, isInstalling, lastResult } = useInstallLocalService(serverId);
  const runningServices = useMemo(() => services.filter((s) => s.running && s.url), [services]);
  const anyRunning = runningServices.length > 0;

  // Default selection: prefer OpenClaw, fall back to first running service.
  // If user manually picks something else via the chip selector we honor that
  // choice for the lifetime of this mount.
  const defaultSelection =
    runningServices.find((s) => s.id === "openclaw")?.id ?? runningServices[0]?.id ?? null;
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const activeServiceId = selectedServiceId ?? defaultSelection;
  const activeService = runningServices.find((s) => s.id === activeServiceId);

  const handleInstallDocker = useCallback(() => {
    void install({ serviceId: "open-webui", method: "docker" });
  }, [install]);

  const [showSettings, setShowSettings] = useState(false);
  const [draftUrl, setDraftUrl] = useState(openWebUiUrl);

  const handleSave = useCallback(() => {
    setOpenWebUiUrl(draftUrl);
    setShowSettings(false);
  }, [draftUrl, setOpenWebUiUrl]);

  const handleReset = useCallback(() => {
    resetOpenWebUiUrl();
    setDraftUrl(DEFAULT_OPEN_WEBUI_URL);
  }, [resetOpenWebUiUrl]);

  const handleOpenInBrowser = useCallback((url: string) => {
    void openExternalUrl(url);
  }, []);

  const handleToggleSettings = useCallback(() => {
    setShowSettings((v) => !v);
  }, []);

  const settingsButton = useMemo(
    () => (
      <Pressable
        onPress={handleToggleSettings}
        accessibilityRole="button"
        accessibilityLabel={t("assistants.configure")}
        testID="assistants-settings"
        style={styles.headerButton}
      >
        <SettingsIcon size={18} color={theme.colors.foreground} />
      </Pressable>
    ),
    [handleToggleSettings, t, theme.colors.foreground],
  );

  return (
    <View style={styles.container}>
      <MobileTabHeader
        title={t("assistants.title")}
        testID="assistants-header"
        trailing={settingsButton}
      />

      {showSettings ? (
        <View style={styles.configCard}>
          <Text style={styles.configLabel}>{t("assistants.openWebUiUrl")}</Text>
          <TextInput
            style={styles.input}
            value={draftUrl}
            onChangeText={setDraftUrl}
            placeholder={DEFAULT_OPEN_WEBUI_URL}
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            testID="assistants-url-input"
          />
          <View style={styles.configActions}>
            <Pressable style={styles.secondaryButton} onPress={handleReset}>
              <Text style={styles.secondaryButtonText}>{t("assistants.resetDefault")}</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={handleSave}>
              <Text style={styles.primaryButtonText}>{t("common.save")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {isWeb ? (
        (() => {
          if (anyRunning && activeService) {
            return (
              <>
                {runningServices.length > 1 ? (
                  <ServiceSwitcher
                    services={runningServices}
                    activeId={activeService.id}
                    onSelect={setSelectedServiceId}
                  />
                ) : null}
                {renderActiveService(activeService, serverId, openWebUiUrl)}
              </>
            );
          }
          return (
            <NotRunningCard
              configuredUrl={openWebUiUrl}
              onOpen={handleOpenInBrowser}
              dockerAvailable={installers?.docker ?? false}
              pipxAvailable={installers?.pipx ?? false}
              onInstallDocker={handleInstallDocker}
              isInstalling={isInstalling}
              lastInstallResult={lastResult}
            />
          );
        })()
      ) : (
        <NativeFallback url={openWebUiUrl} onOpen={handleOpenInBrowser} services={services} />
      )}
    </View>
  );
}

const SERVICE_LABELS: Record<string, string> = {
  "open-webui": "Open WebUI",
  openclaw: "OpenClaw",
  hermes: "Hermes Agent",
};

function ServiceChip({
  service,
  active,
  onSelect,
}: {
  service: { id: string; label: string; url: string | null };
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const chipStyle = useMemo(() => [styles.chip, active ? styles.chipActive : null], [active]);
  const dotStyle = useMemo(
    () => [styles.chipDot, active ? styles.chipDotActive : styles.chipDotInactive],
    [active],
  );
  const textStyle = useMemo(
    () => [styles.chipText, active ? styles.chipTextActive : null],
    [active],
  );
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const handlePress = useCallback(() => onSelect(service.id), [onSelect, service.id]);

  return (
    <Pressable
      onPress={handlePress}
      style={chipStyle}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      testID={`assistants-switch-${service.id}`}
    >
      <View style={dotStyle} />
      <Text style={textStyle}>{SERVICE_LABELS[service.id] ?? service.label}</Text>
    </Pressable>
  );
}

function ServiceSwitcher({
  services,
  activeId,
  onSelect,
}: {
  services: Array<{ id: string; label: string; url: string | null }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.switcher}>
      {services.map((s) => (
        <ServiceChip key={s.id} service={s} active={s.id === activeId} onSelect={onSelect} />
      ))}
    </View>
  );
}

function NotRunningCard({
  configuredUrl,
  onOpen,
  dockerAvailable,
  pipxAvailable,
  onInstallDocker,
  isInstalling,
  lastInstallResult,
}: {
  configuredUrl: string;
  onOpen: (url: string) => void;
  dockerAvailable: boolean;
  pipxAvailable: boolean;
  onInstallDocker: () => void;
  isInstalling: boolean;
  lastInstallResult: {
    success: boolean;
    message: string;
    output: string;
    port: number | null;
  } | null;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  const statusDotStyle = useMemo(
    () => [styles.statusDot, { backgroundColor: theme.colors.destructive }],
    [theme.colors.destructive],
  );
  const installButtonStyle = useMemo(
    () => [styles.primaryButton, isInstalling ? styles.primaryButtonDisabled : null],
    [isInstalling],
  );
  const installResultStyle = useMemo(
    () => [
      styles.installResultText,
      {
        color: lastInstallResult?.success
          ? theme.colors.palette.green[400]
          : theme.colors.destructive,
      },
    ],
    [lastInstallResult?.success, theme.colors.palette.green, theme.colors.destructive],
  );
  const handleOpenDocs = useCallback(() => {
    onOpen("https://docs.openwebui.com/getting-started/");
  }, [onOpen]);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.notRunningCard}>
        <View style={styles.statusRow}>
          <View style={statusDotStyle} />
          <Text style={styles.statusText}>
            {t("assistants.notRunning", { url: configuredUrl })}
          </Text>
        </View>
        <Text style={styles.notRunningTitle}>{t("assistants.installPrompt")}</Text>
        <Text style={styles.notRunningHint}>{t("assistants.installPromptHint")}</Text>

        {dockerAvailable ? (
          <View style={styles.installOption}>
            <Text style={styles.installOptionLabel}>
              {t("assistants.install.docker")} {t("assistants.install.detected")}
            </Text>
            <Pressable
              style={installButtonStyle}
              onPress={onInstallDocker}
              disabled={isInstalling}
              testID="assistants-install-docker"
            >
              <Text style={styles.primaryButtonText}>
                {isInstalling
                  ? t("assistants.install.installing")
                  : t("assistants.install.oneClick")}
              </Text>
            </Pressable>
            {lastInstallResult ? (
              <Text style={installResultStyle}>{lastInstallResult.message}</Text>
            ) : null}
            {lastInstallResult && !lastInstallResult.success && lastInstallResult.output ? (
              <Text style={styles.installCommand} selectable>
                {lastInstallResult.output}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.installOption}>
            <Text style={styles.installOptionLabel}>
              {t("assistants.install.docker")} {t("assistants.install.notDetected")}
            </Text>
            <Text style={styles.installCommand} selectable>
              docker run -d --name ottie-open-webui --restart unless-stopped -p 3000:8080 -v
              ottie-open-webui-data:/app/backend/data ghcr.io/open-webui/open-webui:main
            </Text>
          </View>
        )}

        <View style={styles.installOption}>
          <Text style={styles.installOptionLabel}>
            {t("assistants.install.pipx")}{" "}
            {pipxAvailable ? t("assistants.install.detected") : t("assistants.install.notDetected")}
          </Text>
          <Text style={styles.installCommand} selectable>
            pipx install open-webui && open-webui serve
          </Text>
        </View>
        <Pressable style={styles.secondaryButton} onPress={handleOpenDocs}>
          <ExternalLink size={14} color={theme.colors.foreground} />
          <Text style={styles.secondaryButtonText}>{t("assistants.openDocs")}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function EmbeddedWebUi({ url }: { url: string }) {
  const { t } = useTranslation();
  const trustedUrl = useMemo(() => normalizeUrl(url), [url]);
  if (!trustedUrl) {
    return (
      <View style={styles.emptyCard}>
        <Sparkles size={28} />
        <Text style={styles.emptyTitle}>{t("assistants.invalidUrl")}</Text>
      </View>
    );
  }
  // Web target: render an iframe pointing at the user's local Open WebUI.
  // We rely on the runtime treating `<iframe>` as a host element (RN-Web
  // passes through unknown DOM tags via createElement).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Iframe = "iframe" as unknown as React.ComponentType<any>;
  return (
    <View style={styles.iframeContainer}>
      <Iframe
        src={trustedUrl}
        title="Open WebUI"
        style={IFRAME_STYLE}
        allow="clipboard-read; clipboard-write; microphone; camera"
      />
    </View>
  );
}

function DashboardCard({
  dashboard,
  liveStatus,
  fallbackUrl,
  onOpen,
}: {
  dashboard: KnownDashboard;
  liveStatus: { running: boolean; url: string | null } | undefined;
  fallbackUrl: string;
  onOpen: (url: string) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isRunning = liveStatus?.running ?? false;
  const dashboardUrl =
    liveStatus?.url ?? (dashboard.id === "open-webui" ? fallbackUrl : dashboard.defaultUrl);
  const statusColor = isRunning ? theme.colors.palette.green[400] : theme.colors.foregroundMuted;
  const statusDotStyle = useMemo(
    () => [styles.statusDot, { backgroundColor: statusColor }],
    [statusColor],
  );
  const handleOpen = useCallback(() => onOpen(dashboardUrl), [onOpen, dashboardUrl]);

  return (
    <View style={styles.dashboardCard}>
      <View style={styles.dashboardHeader}>
        <View style={statusDotStyle} />
        <Sparkles size={20} color={theme.colors.foreground} />
        <Text style={styles.dashboardName}>{t(dashboard.labelKey)}</Text>
        <Text style={styles.dashboardStatus}>
          {isRunning ? t("assistants.running") : t("assistants.stopped")}
        </Text>
      </View>
      <Text style={styles.dashboardDescription}>{t(dashboard.descriptionKey)}</Text>
      <Text style={styles.dashboardUrl}>{dashboardUrl}</Text>
      <View style={styles.dashboardActions}>
        <Pressable
          style={styles.primaryButton}
          onPress={handleOpen}
          testID={`assistants-open-${dashboard.id}`}
        >
          <ExternalLink size={14} color={theme.colors.accentForeground} />
          <Text style={styles.primaryButtonText}>{t("assistants.openInBrowser")}</Text>
        </Pressable>
      </View>
      {!isRunning ? (
        <>
          <Text style={styles.dashboardHint}>{t(dashboard.installHintKey)}</Text>
          <Text style={styles.dashboardCommand} selectable>
            {dashboard.installCommand}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function NativeFallback({
  url,
  onOpen,
  services,
}: {
  url: string;
  onOpen: (url: string) => void;
  services: Array<{ id: string; running: boolean; url: string | null }>;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.heading}>
        <Text style={styles.subtitle}>{t("assistants.subtitle")}</Text>
      </View>
      {KNOWN_DASHBOARDS.map((dashboard) => {
        const liveStatus = services.find((s) => s.id === dashboard.id);
        return (
          <DashboardCard
            key={dashboard.id}
            dashboard={dashboard}
            liveStatus={liveStatus}
            fallbackUrl={url}
            onOpen={onOpen}
          />
        );
      })}
      <View style={styles.attribution}>
        <Text style={styles.attributionText}>{t("assistants.poweredBy")}</Text>
      </View>
    </ScrollView>
  );
}

function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  headerButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
  },
  iframeContainer: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  scrollContent: {
    paddingBottom: theme.spacing[16],
  },
  heading: {
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[1],
  },
  subtitle: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  configCard: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: theme.spacing[2],
  },
  configLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  input: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  configActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    justifyContent: "flex-end",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    alignSelf: "flex-start",
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  installResultText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
  switcher: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderGlass,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderCurve: "continuous",
    backgroundColor: theme.colors.surface2,
  },
  chipActive: {
    backgroundColor: theme.colors.accent,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  chipDotActive: {
    backgroundColor: theme.colors.accentForeground,
  },
  chipDotInactive: {
    backgroundColor: theme.colors.palette.green[400],
  },
  chipText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  chipTextActive: {
    color: theme.colors.accentForeground,
    fontWeight: theme.fontWeight.medium,
  },
  primaryButtonText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accentForeground,
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    backgroundColor: theme.colors.surface2,
    alignSelf: "flex-start",
  },
  secondaryButtonText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  emptyCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[8],
    gap: theme.spacing[2],
  },
  emptyTitle: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  dashboardCard: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: theme.spacing[2],
  },
  dashboardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  dashboardName: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
  },
  dashboardDescription: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 20,
  },
  dashboardUrl: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  dashboardActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  dashboardHint: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginTop: theme.spacing[2],
  },
  dashboardCommand: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  attribution: {
    paddingVertical: theme.spacing[4],
    alignItems: "center",
  },
  attributionText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  notRunningCard: {
    marginHorizontal: theme.spacing[4],
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: theme.spacing[3],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  statusText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  notRunningTitle: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  notRunningHint: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 20,
  },
  installOption: {
    gap: theme.spacing[1],
  },
  installOptionLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
  },
  installCommand: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  dashboardStatus: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginLeft: "auto",
  },
}));
