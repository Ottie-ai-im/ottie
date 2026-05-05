import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ExternalLink, Settings as SettingsIcon, Sparkles } from "lucide-react-native";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";
import { isWeb } from "@/constants/platform";
import { openExternalUrl } from "@/utils/open-external-url";
import { useHosts } from "@/runtime/host-runtime";
import { useLocalServices } from "@/hooks/use-local-services";
import { DEFAULT_OPEN_WEBUI_URL, useAssistantsConfigStore } from "@/stores/assistants-config-store";

interface KnownDashboard {
  id: string;
  labelKey: string;
  descriptionKey: string;
  defaultUrl: string;
  installHintKey: string;
  installCommand: string;
}

const KNOWN_DASHBOARDS: KnownDashboard[] = [
  {
    id: "open-webui",
    labelKey: "assistants.openWebUi.label",
    descriptionKey: "assistants.openWebUi.description",
    defaultUrl: "http://localhost:3000",
    installHintKey: "assistants.openWebUi.installHint",
    installCommand: "pip install open-webui && open-webui serve",
  },
  {
    id: "openclaw",
    labelKey: "assistants.openclaw.label",
    descriptionKey: "assistants.openclaw.description",
    defaultUrl: "http://localhost:18789",
    installHintKey: "assistants.openclaw.installHint",
    installCommand: "npm install -g openclaw && openclaw onboard --install-daemon",
  },
  {
    id: "hermes",
    labelKey: "assistants.hermes.label",
    descriptionKey: "assistants.hermes.description",
    defaultUrl: "http://localhost:8080",
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
  const { services } = useLocalServices(serverId);
  const openWebUiStatus = services.find((s) => s.id === "open-webui");
  const openWebUiRunning = Boolean(openWebUiStatus?.running);
  const detectedOpenWebUiUrl = openWebUiStatus?.url ?? null;

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

  return (
    <View style={styles.container}>
      <MobileTabHeader
        title={t("assistants.title")}
        testID="assistants-header"
        trailing={
          <Pressable
            onPress={() => setShowSettings((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={t("assistants.configure")}
            testID="assistants-settings"
            style={styles.headerButton}
          >
            <SettingsIcon size={18} color={theme.colors.foreground} />
          </Pressable>
        }
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
        openWebUiRunning ? (
          <EmbeddedWebUi url={detectedOpenWebUiUrl ?? openWebUiUrl} />
        ) : (
          <NotRunningCard configuredUrl={openWebUiUrl} onOpen={handleOpenInBrowser} />
        )
      ) : (
        <NativeFallback url={openWebUiUrl} onOpen={handleOpenInBrowser} services={services} />
      )}
    </View>
  );
}

function NotRunningCard({
  configuredUrl,
  onOpen,
}: {
  configuredUrl: string;
  onOpen: (url: string) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.notRunningCard}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: theme.colors.destructive }]} />
          <Text style={styles.statusText}>
            {t("assistants.notRunning", { url: configuredUrl })}
          </Text>
        </View>
        <Text style={styles.notRunningTitle}>{t("assistants.installPrompt")}</Text>
        <Text style={styles.notRunningHint}>{t("assistants.installPromptHint")}</Text>
        <View style={styles.installOption}>
          <Text style={styles.installOptionLabel}>{t("assistants.install.docker")}</Text>
          <Text style={styles.installCommand} selectable>
            docker run -d --name open-webui -p 3000:8080 ghcr.io/open-webui/open-webui:main
          </Text>
        </View>
        <View style={styles.installOption}>
          <Text style={styles.installOptionLabel}>{t("assistants.install.pipx")}</Text>
          <Text style={styles.installCommand} selectable>
            pipx install open-webui && open-webui serve
          </Text>
        </View>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => onOpen("https://docs.openwebui.com/getting-started/")}
        >
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
        style={{
          width: "100%",
          height: "100%",
          border: "none",
        }}
        allow="clipboard-read; clipboard-write; microphone; camera"
      />
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
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.heading}>
        <Text style={styles.subtitle}>{t("assistants.subtitle")}</Text>
      </View>
      {KNOWN_DASHBOARDS.map((dashboard) => {
        const liveStatus = services.find((s) => s.id === dashboard.id);
        const isRunning = liveStatus?.running ?? false;
        const dashboardUrl =
          liveStatus?.url ?? (dashboard.id === "open-webui" ? url : dashboard.defaultUrl);
        const statusColor = isRunning
          ? theme.colors.palette.green[400]
          : theme.colors.foregroundMuted;
        return (
          <View key={dashboard.id} style={styles.dashboardCard}>
            <View style={styles.dashboardHeader}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
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
                onPress={() => onOpen(dashboardUrl)}
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
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
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
