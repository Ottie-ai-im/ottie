import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { ComponentType, ReactNode } from "react";
import { setLanguage, type SupportedLanguage } from "@/i18n";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Buffer } from "buffer";
import {
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  ChevronRight,
  Settings,
  Server,
  Keyboard,
  Stethoscope,
  Info,
  Shield,
  Puzzle,
  Plus,
  Gauge,
  FlaskConical,
  Lock,
} from "lucide-react-native";
import { SidebarSeparator } from "@/components/sidebar/sidebar-separator";
import { ScreenTitle } from "@/components/headers/screen-title";
import { MobileTabHeader } from "@/components/headers/mobile-tab-header";
import { HeaderIconBadge } from "@/components/headers/header-icon-badge";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useAppSettings, type AppSettings, type SendBehavior } from "@/hooks/use-settings";
import { THEME_SWATCHES } from "@/styles/theme";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostRuntimeClient,
  useHosts,
} from "@/runtime/host-runtime";
import type { CheckPathStatus } from "@server/shared/messages";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { confirmDialog } from "@/utils/confirm-dialog";
import { BackHeader } from "@/components/headers/back-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";
import { KeyboardShortcutsSection } from "@/screens/settings/keyboard-shortcuts-section";
import { LabsSection } from "@/screens/settings/labs-section";
import { LocalDaemonPanel } from "@/screens/settings/local-daemon-panel";
import { UsageSection } from "@/screens/settings/usage-section";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DesktopPermissionsSection } from "@/desktop/components/desktop-permissions-section";
import { IntegrationsSection } from "@/desktop/components/integrations-section";
import { isElectronRuntime } from "@/desktop/host";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { settingsStyles } from "@/styles/settings";
import { THINKING_TONE_NATIVE_PCM_BASE64 } from "@/utils/thinking-tone.native-pcm";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { HostPage, HostRenameButton } from "@/screens/settings/host-page";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import {
  buildHostOpenProjectRoute,
  buildHostWorkspaceRoute,
  buildSettingsHostRoute,
  buildSettingsSectionRoute,
  type SettingsSectionSlug,
} from "@/utils/host-routes";
import { getLastNavigationWorkspaceRouteSelection } from "@/stores/navigation-active-workspace-store";

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type SettingsView =
  | { kind: "root" }
  | { kind: "section"; section: SettingsSectionSlug }
  | { kind: "host"; serverId: string };

interface SidebarSectionItem {
  id: SettingsSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
  desktopOnly?: boolean;
}

const SIDEBAR_SECTION_ITEMS: SidebarSectionItem[] = [
  { id: "general", labelKey: "settings.general", icon: Settings },
  { id: "shortcuts", labelKey: "settings.shortcuts", icon: Keyboard, desktopOnly: true },
  { id: "integrations", labelKey: "settings.integrations", icon: Puzzle, desktopOnly: true },
  { id: "permissions", labelKey: "settings.permissions", icon: Shield, desktopOnly: true },
  { id: "usage", labelKey: "settings.usage", icon: Gauge },
  { id: "labs", labelKey: "settings.labs.title", icon: FlaskConical },
  { id: "localDaemon", labelKey: "settings.localDaemon.title", icon: Lock },
  { id: "diagnostics", labelKey: "settings.diagnostics", icon: Stethoscope },
  { id: "about", labelKey: "settings.about", icon: Info },
];

// ---------------------------------------------------------------------------
// Theme helpers (General section)
// ---------------------------------------------------------------------------

function ThemeIcon({
  theme,
  size,
  color,
}: {
  theme: AppSettings["theme"];
  size: number;
  color: string;
}) {
  switch (theme) {
    case "light":
      return <Sun size={size} color={color} />;
    case "dark":
      return <Moon size={size} color={color} />;
    case "auto":
      return <Monitor size={size} color={color} />;
    default:
      return <ThemeSwatch color={THEME_SWATCHES[theme]} size={size} />;
  }
}

function ThemeSwatch({ color, size }: { color: string; size: number }) {
  const swatchStyle = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.15)",
    }),
    [color, size],
  );
  return <View style={swatchStyle} />;
}

function themeTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.themeTrigger, pressed && { opacity: 0.85 }];
}

function sidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [sidebarStyles.item, Boolean(hovered) && sidebarStyles.itemHovered];
}

function selectedSidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    Boolean(hovered) && sidebarStyles.itemHovered,
    sidebarStyles.itemSelected,
  ];
}

function mobileSidebarItemStyle({ pressed }: PressableStateCallbackType) {
  return [sidebarStyles.mobileItem, pressed && sidebarStyles.mobileItemPressed];
}

const THEME_LABEL_KEYS: Record<AppSettings["theme"], string> = {
  light: "settings.themeLight",
  dark: "settings.themeDark",
  zinc: "settings.themeZinc",
  midnight: "settings.themeMidnight",
  claude: "settings.themeClaude",
  ghostty: "settings.themeGhostty",
  auto: "settings.themeAuto",
};

const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

interface GeneralSectionProps {
  settings: AppSettings;
  handleThemeChange: (theme: AppSettings["theme"]) => void;
  handleSendBehaviorChange: (behavior: SendBehavior) => void;
  handleDefaultWorkspaceRootChange: (root: string | null) => void;
  probeServerId: string | null;
}

interface ThemeMenuItemProps {
  themeValue: AppSettings["theme"];
  selected: boolean;
  iconSize: number;
  iconColor: string;
  onChange: (theme: AppSettings["theme"]) => void;
}

function ThemeMenuItem({
  themeValue,
  selected,
  iconSize,
  iconColor,
  onChange,
}: ThemeMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(themeValue);
  }, [onChange, themeValue]);
  const leading = useMemo(
    () => <ThemeIcon theme={themeValue} size={iconSize} color={iconColor} />,
    [themeValue, iconSize, iconColor],
  );
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} leading={leading}>
      {t(THEME_LABEL_KEYS[themeValue])}
    </DropdownMenuItem>
  );
}

function GeneralSection({
  settings,
  handleThemeChange,
  handleSendBehaviorChange,
  handleDefaultWorkspaceRootChange,
  probeServerId,
}: GeneralSectionProps) {
  const { theme } = useUnistyles();
  const { t, i18n } = useTranslation();
  const iconSize = theme.iconSize.md;
  const iconColor = theme.colors.foregroundMuted;

  const currentLanguage: SupportedLanguage = i18n.language === "zh" ? "zh" : "en";
  const languageOptions = useMemo(
    () => [
      { value: "en" as const, label: t("settings.languageEnglish") },
      { value: "zh" as const, label: t("settings.languageChinese") },
    ],
    [t],
  );
  const sendBehaviorOptions = useMemo(
    () => [
      { value: "interrupt" as const, label: t("settings.sendInterrupt") },
      { value: "queue" as const, label: t("settings.sendQueue") },
    ],
    [t],
  );
  const handleLanguageChange = useCallback((value: SupportedLanguage) => {
    void setLanguage(value);
  }, []);

  return (
    <SettingsSection title={t("settings.general")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.language")}</Text>
          </View>
          <SegmentedControl
            size="sm"
            value={currentLanguage}
            onValueChange={handleLanguageChange}
            options={languageOptions}
          />
        </View>
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.theme")}</Text>
          </View>
          <DropdownMenu>
            <DropdownMenuTrigger style={themeTriggerStyle}>
              <ThemeIcon theme={settings.theme} size={iconSize} color={iconColor} />
              <Text style={styles.themeTriggerText}>{t(THEME_LABEL_KEYS[settings.theme])}</Text>
              <ChevronDown size={theme.iconSize.sm} color={iconColor} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" width={200}>
              {(["light", "dark", "auto"] as const).map((themeValue) => (
                <ThemeMenuItem
                  key={themeValue}
                  themeValue={themeValue}
                  selected={settings.theme === themeValue}
                  iconSize={iconSize}
                  iconColor={iconColor}
                  onChange={handleThemeChange}
                />
              ))}
              <DropdownMenuSeparator />
              {(["zinc", "midnight", "claude", "ghostty"] as const).map((themeValue) => (
                <ThemeMenuItem
                  key={themeValue}
                  themeValue={themeValue}
                  selected={settings.theme === themeValue}
                  iconSize={iconSize}
                  iconColor={iconColor}
                  onChange={handleThemeChange}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.defaultSend")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.defaultSendHint")}</Text>
          </View>
          <SegmentedControl
            size="sm"
            value={settings.sendBehavior}
            onValueChange={handleSendBehaviorChange}
            options={sendBehaviorOptions}
          />
        </View>
        <DefaultWorkspaceRootRow
          value={settings.defaultWorkspaceRoot}
          onChange={handleDefaultWorkspaceRootChange}
          probeServerId={probeServerId}
        />
      </View>
    </SettingsSection>
  );
}

interface DefaultWorkspaceRootRowProps {
  value: string | null;
  onChange: (root: string | null) => void;
  probeServerId: string | null;
}

type RootProbe =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "result"; status: CheckPathStatus; error: string | null };

function pickStatusStyle(tone: "ok" | "err" | "info") {
  if (tone === "ok") return styles.defaultWorkspaceStatusOk;
  if (tone === "err") return styles.defaultWorkspaceStatusError;
  return styles.defaultWorkspaceClearText;
}

function DefaultWorkspaceRootRow({ value, onChange, probeServerId }: DefaultWorkspaceRootRowProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [draft, setDraft] = useState(value ?? "");
  const [probe, setProbe] = useState<RootProbe>({ kind: "idle" });
  const client = useHostRuntimeClient(probeServerId ?? "");

  // Debounced probe whenever the typed-in path changes. We probe even before
  // save so the user gets immediate "✓ Folder exists" / "Will be created" /
  // "Not writable" feedback without having to dismiss focus.
  useEffect(() => {
    const trimmed = draft.trim();
    if (!trimmed || !client) {
      setProbe({ kind: "idle" });
      return;
    }
    setProbe({ kind: "checking" });
    const handle = setTimeout(() => {
      void client
        .checkPath(trimmed)
        .then((result) => setProbe({ kind: "result", status: result.status, error: result.error }))
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          setProbe({ kind: "result", status: "error", error: msg });
        });
    }, 600);
    return () => clearTimeout(handle);
  }, [client, draft]);

  const handleBlur = useCallback(() => {
    const trimmed = draft.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if (next !== value) {
      onChange(next);
    }
  }, [draft, onChange, value]);

  const handleClear = useCallback(() => {
    setDraft("");
    setProbe({ kind: "idle" });
    onChange(null);
  }, [onChange]);

  const statusText = useMemo(() => {
    if (probe.kind === "idle") return null;
    if (probe.kind === "checking") {
      return { text: t("settings.defaultWorkspaceRootChecking"), tone: "info" as const };
    }
    switch (probe.status) {
      case "ok":
        return { text: t("settings.defaultWorkspaceRootOk"), tone: "ok" as const };
      case "missing_will_create":
        return {
          text: t("settings.defaultWorkspaceRootWillCreate"),
          tone: "info" as const,
        };
      case "not_directory":
        return { text: t("settings.defaultWorkspaceRootNotDirectory"), tone: "err" as const };
      case "not_writable":
        return { text: t("settings.defaultWorkspaceRootNotWritable"), tone: "err" as const };
      default:
        return {
          text: probe.error ?? t("settings.defaultWorkspaceRootError"),
          tone: "err" as const,
        };
    }
  }, [probe, t]);

  return (
    <View style={ROW_WITH_BORDER_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.defaultWorkspaceRoot")}</Text>
        <Text style={settingsStyles.rowHint}>{t("settings.defaultWorkspaceRootHint")}</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={handleBlur}
          placeholder={t("settings.defaultWorkspaceRootPlaceholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={styles.defaultWorkspaceInput}
          testID="settings-default-workspace-root-input"
        />
        {statusText ? (
          <Text style={pickStatusStyle(statusText.tone)}>{statusText.text}</Text>
        ) : null}
        {value ? (
          <Pressable onPress={handleClear} testID="settings-default-workspace-root-clear">
            <Text style={styles.defaultWorkspaceClearText}>
              {t("settings.defaultWorkspaceRootClear")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

interface DiagnosticsSectionProps {
  voiceAudioEngine: ReturnType<typeof useVoiceAudioEngineOptional>;
  isPlaybackTestRunning: boolean;
  playbackTestResult: string | null;
  handlePlaybackTest: () => Promise<void>;
}

function DiagnosticsSection({
  voiceAudioEngine,
  isPlaybackTestRunning,
  playbackTestResult,
  handlePlaybackTest,
}: DiagnosticsSectionProps) {
  const { t } = useTranslation();
  const handlePlayPress = useCallback(() => {
    void handlePlaybackTest();
  }, [handlePlaybackTest]);
  return (
    <SettingsSection title={t("settings.diagnostics")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.testAudio")}</Text>
            {playbackTestResult ? (
              <Text style={settingsStyles.rowHint}>{playbackTestResult}</Text>
            ) : null}
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={handlePlayPress}
            disabled={!voiceAudioEngine || isPlaybackTestRunning}
          >
            {isPlaybackTestRunning ? t("settings.playing") : t("settings.playTest")}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

interface AboutSectionProps {
  appVersionText: string;
  isDesktopApp: boolean;
}

function AboutSection({ appVersionText, isDesktopApp }: AboutSectionProps) {
  const { t } = useTranslation();
  return (
    <SettingsSection title={t("settings.about")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.version")}</Text>
          </View>
          <Text style={styles.aboutValue}>{appVersionText}</Text>
        </View>
        {isDesktopApp ? <DesktopAppUpdateRow /> : null}
      </View>
    </SettingsSection>
  );
}

function getUpdateButtonLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  isInstalling: boolean,
  latestVersion: string | null | undefined,
): string {
  if (isInstalling) return t("settings.installing");
  if (latestVersion) {
    return t("settings.updateTo", { version: formatVersionWithPrefix(latestVersion) });
  }
  return t("settings.update");
}

function DesktopAppUpdateRow() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const releaseChannelOptions = useMemo(
    () => [
      { value: "stable" as const, label: t("settings.releaseChannelStable") },
      { value: "beta" as const, label: t("settings.releaseChannelBeta") },
    ],
    [t],
  );
  const {
    isDesktopApp,
    statusText,
    availableUpdate,
    errorMessage,
    isChecking,
    isInstalling,
    checkForUpdates,
    installUpdate,
  } = useDesktopAppUpdater();

  useFocusEffect(
    useCallback(() => {
      if (!isDesktopApp) {
        return undefined;
      }
      void checkForUpdates({ silent: true });
      return undefined;
    }, [checkForUpdates, isDesktopApp]),
  );

  const handleCheckForUpdates = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }
    void checkForUpdates();
  }, [checkForUpdates, isDesktopApp]);

  const handleReleaseChannelChange = useCallback(
    (releaseChannel: AppSettings["releaseChannel"]) => {
      void updateSettings({ releaseChannel });
    },
    [updateSettings],
  );

  const handleInstallUpdate = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }

    void confirmDialog({
      title: t("settings.installDesktopUpdate"),
      message: t("settings.installDesktopUpdateMessage"),
      confirmLabel: t("settings.installUpdate"),
      cancelLabel: t("common.cancel"),
    })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        void installUpdate();
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to open app update confirmation", error);
        Alert.alert(t("common.error"), t("settings.updateConfirmFailed"));
      });
  }, [installUpdate, isDesktopApp, t]);

  if (!isDesktopApp) {
    return null;
  }

  return (
    <>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.releaseChannel")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.releaseChannelHint")}</Text>
        </View>
        <SegmentedControl
          size="sm"
          value={settings.releaseChannel}
          onValueChange={handleReleaseChannelChange}
          options={releaseChannelOptions}
        />
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.appUpdates")}</Text>
          <Text style={settingsStyles.rowHint}>{statusText}</Text>
          {availableUpdate?.latestVersion ? (
            <Text style={settingsStyles.rowHint}>
              {t("settings.readyToInstall", {
                version: formatVersionWithPrefix(availableUpdate.latestVersion),
              })}
            </Text>
          ) : null}
          {errorMessage ? <Text style={styles.aboutErrorText}>{errorMessage}</Text> : null}
        </View>
        <View style={styles.aboutUpdateActions}>
          <Button
            variant="outline"
            size="sm"
            onPress={handleCheckForUpdates}
            disabled={isChecking || isInstalling}
          >
            {isChecking ? t("settings.checking") : t("settings.check")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleInstallUpdate}
            disabled={isChecking || isInstalling || !availableUpdate}
          >
            {getUpdateButtonLabel(t, isInstalling, availableUpdate?.latestVersion)}
          </Button>
        </View>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function useAnyOnlineHostServerId(serverIds: string[]): string | null {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
    () => null,
  );
}

interface SidebarSectionButtonProps {
  itemId: SettingsSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string }>;
  isSelected: boolean;
  onSelect: (section: SettingsSectionSlug) => void;
  layout: "desktop" | "mobile";
}

function SidebarSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
  layout,
}: SidebarSectionButtonProps) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () =>
      layout === "mobile"
        ? sidebarStyles.mobileLabel
        : [sidebarStyles.label, isSelected && { color: theme.colors.foreground }],
    [isSelected, layout, theme.colors.foreground],
  );
  if (layout === "mobile") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={handlePress}
        style={mobileSidebarItemStyle}
      >
        <IconComponent size={theme.iconSize.md} color={theme.colors.foreground} />
        <Text style={labelStyle} numberOfLines={1}>
          {label}
        </Text>
        <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <IconComponent
        size={theme.iconSize.md}
        color={isSelected ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SidebarHostItemProps {
  serverId: string;
  label: string;
  isSelected: boolean;
  isLocal: boolean;
  onSelect: (serverId: string) => void;
  layout: "desktop" | "mobile";
}

function SidebarHostItem({
  serverId,
  label,
  isSelected,
  isLocal,
  onSelect,
  layout,
}: SidebarHostItemProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onSelect(serverId);
  }, [onSelect, serverId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () =>
      layout === "mobile"
        ? sidebarStyles.mobileLabel
        : [sidebarStyles.label, isSelected && { color: theme.colors.foreground }],
    [isSelected, layout, theme.colors.foreground],
  );
  if (layout === "mobile") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={handlePress}
        testID={`settings-host-entry-${serverId}`}
        style={mobileSidebarItemStyle}
      >
        <Server size={theme.iconSize.md} color={theme.colors.foreground} />
        <Text style={labelStyle} numberOfLines={1}>
          {label}
        </Text>
        {isLocal ? (
          <Text style={sidebarStyles.localMarker} testID="settings-host-local-marker">
            {t("settings.local")}
          </Text>
        ) : null}
        <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      testID={`settings-host-entry-${serverId}`}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <Server
        size={theme.iconSize.md}
        color={isSelected ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
      {isLocal ? (
        <Text style={sidebarStyles.localMarker} testID="settings-host-local-marker">
          {t("settings.local")}
        </Text>
      ) : null}
    </Pressable>
  );
}

interface SettingsSidebarProps {
  view: SettingsView;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHost: (serverId: string) => void;
  onAddHost: () => void;
  onBackToWorkspace: () => void;
  layout: "desktop" | "mobile";
}

function SettingsSidebar({
  view,
  onSelectSection,
  onSelectHost,
  onAddHost,
  onBackToWorkspace: _onBackToWorkspace,
  layout,
}: SettingsSidebarProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useMemo(() => {
    if (!localServerId) {
      return hosts;
    }
    const localIndex = hosts.findIndex((host) => host.serverId === localServerId);
    if (localIndex <= 0) {
      return hosts;
    }
    const next = hosts.slice();
    const [local] = next.splice(localIndex, 1);
    next.unshift(local);
    return next;
  }, [hosts, localServerId]);
  const isDesktopApp = isElectronRuntime();
  const items = SIDEBAR_SECTION_ITEMS.filter((item) => !item.desktopOnly || isDesktopApp);
  const padding = useWindowControlsPadding("sidebar");
  const isDesktop = layout === "desktop";
  const containerStyle = isDesktop ? sidebarStyles.desktopContainer : sidebarStyles.mobileContainer;
  const groupStyle = isDesktop ? sidebarStyles.list : sidebarStyles.mobileGroup;
  const selectedSectionId = view.kind === "section" ? view.section : null;
  const selectedServerId = view.kind === "host" ? view.serverId : null;
  const paddingTopStyle = useMemo(() => ({ height: padding.top }), [padding.top]);

  return (
    <View style={containerStyle} testID="settings-sidebar">
      {isDesktop ? (
        <>
          <TitlebarDragRegion />
          {padding.top > 0 ? <View style={paddingTopStyle} /> : null}
        </>
      ) : null}
      <View style={groupStyle}>
        {items.map((item, index) => (
          <View key={item.id}>
            {!isDesktop && index > 0 ? <View style={sidebarStyles.mobileItemDivider} /> : null}
            <SidebarSectionButton
              itemId={item.id}
              label={t(item.labelKey)}
              icon={item.icon}
              isSelected={selectedSectionId === item.id}
              onSelect={onSelectSection}
              layout={layout}
            />
          </View>
        ))}
      </View>
      {isDesktop ? <SidebarSeparator /> : null}
      <View style={groupStyle}>
        {sortedHosts.map((host, index) => (
          <View key={host.serverId}>
            {!isDesktop && index > 0 ? <View style={sidebarStyles.mobileItemDivider} /> : null}
            <SidebarHostItem
              serverId={host.serverId}
              label={host.label}
              isSelected={selectedServerId === host.serverId}
              isLocal={localServerId !== null && host.serverId === localServerId}
              onSelect={onSelectHost}
              layout={layout}
            />
          </View>
        ))}
        {!isDesktop && sortedHosts.length > 0 ? (
          <View style={sidebarStyles.mobileItemDivider} />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("settings.addHost")}
          onPress={onAddHost}
          testID="settings-add-host"
          style={isDesktop ? sidebarItemStyle : mobileSidebarItemStyle}
        >
          <Plus
            size={theme.iconSize.md}
            color={isDesktop ? theme.colors.foregroundMuted : theme.colors.accent}
          />
          <Text
            style={isDesktop ? sidebarStyles.label : sidebarStyles.mobileLabelAccent}
            numberOfLines={1}
          >
            {t("settings.addHost")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export interface SettingsScreenProps {
  view: SettingsView;
}

function MobileSettingsRootHeader({ title }: { title: string }) {
  return <MobileTabHeader title={title} testID="settings-header" />;
}

export default function SettingsScreen({ view }: SettingsScreenProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const voiceAudioEngine = useVoiceAudioEngineOptional();
  const { settings, isLoading: settingsLoading, updateSettings } = useAppSettings();
  const [isAddHostMethodVisible, setIsAddHostMethodVisible] = useState(false);
  const [isDirectHostVisible, setIsDirectHostVisible] = useState(false);
  const [isPasteLinkVisible, setIsPasteLinkVisible] = useState(false);
  const [isPlaybackTestRunning, setIsPlaybackTestRunning] = useState(false);
  const [playbackTestResult, setPlaybackTestResult] = useState<string | null>(null);
  const isDesktopApp = isElectronRuntime();
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const isCompactLayout = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const insetBottomStyle = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  const hosts = useHosts();
  const hostServerIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const anyOnlineServerId = useAnyOnlineHostServerId(hostServerIds);

  const handleThemeChange = useCallback(
    (nextTheme: AppSettings["theme"]) => {
      void updateSettings({ theme: nextTheme });
    },
    [updateSettings],
  );

  const handleSendBehaviorChange = useCallback(
    (behavior: SendBehavior) => {
      void updateSettings({ sendBehavior: behavior });
    },
    [updateSettings],
  );

  const handleDefaultWorkspaceRootChange = useCallback(
    (root: string | null) => {
      void updateSettings({ defaultWorkspaceRoot: root });
    },
    [updateSettings],
  );

  const handlePlaybackTest = useCallback(async () => {
    if (!voiceAudioEngine || isPlaybackTestRunning) {
      return;
    }

    setIsPlaybackTestRunning(true);
    setPlaybackTestResult(null);

    try {
      const bytes = Buffer.from(THINKING_TONE_NATIVE_PCM_BASE64, "base64");
      await voiceAudioEngine.initialize();
      voiceAudioEngine.stop();
      await voiceAudioEngine.play({
        type: "audio/pcm;rate=16000;bits=16",
        size: bytes.byteLength,
        async arrayBuffer() {
          return Uint8Array.from(bytes).buffer;
        },
      });
      setPlaybackTestResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Settings] Playback test failed", error);
      setPlaybackTestResult(t("settings.playbackFailed", { message }));
    } finally {
      setIsPlaybackTestRunning(false);
    }
  }, [isPlaybackTestRunning, voiceAudioEngine, t]);

  const closeAddConnectionFlow = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(false);
    setIsPasteLinkVisible(false);
  }, []);

  const goBackToAddConnectionMethods = useCallback(() => {
    setIsDirectHostVisible(false);
    setIsPasteLinkVisible(false);
    setIsAddHostMethodVisible(true);
  }, []);

  const handleAddHost = useCallback(() => {
    setIsAddHostMethodVisible(true);
  }, []);

  const handleSelectDirectConnection = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(true);
  }, []);

  const handleSelectPasteLink = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsPasteLinkVisible(true);
  }, []);

  const handleHostAdded = useCallback(
    ({ serverId }: { serverId: string }) => {
      const target = buildSettingsHostRoute(serverId);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router],
  );

  const handleSelectSection = useCallback(
    (section: SettingsSectionSlug) => {
      const target = buildSettingsSectionRoute(section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router],
  );

  const handleSelectHost = useCallback(
    (serverId: string) => {
      const target = buildSettingsHostRoute(serverId);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router],
  );

  const handleScanQr = useCallback(() => {
    closeAddConnectionFlow();
    router.push({
      pathname: "/pair-scan",
      params: { source: "settings" },
    });
  }, [closeAddConnectionFlow, router]);

  const handleHostRemoved = useCallback(() => {
    const fallback = buildSettingsSectionRoute("general");
    if (isCompactLayout) {
      router.replace("/settings");
    } else {
      router.replace(fallback);
    }
  }, [isCompactLayout, router]);

  const handleBackToRoot = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/settings");
    }
  }, [router]);

  const handleBackToWorkspace = useCallback(() => {
    if (!isCompactLayout) {
      const lastWorkspaceRoute = getLastNavigationWorkspaceRouteSelection();
      if (lastWorkspaceRoute) {
        router.replace(
          buildHostWorkspaceRoute(lastWorkspaceRoute.serverId, lastWorkspaceRoute.workspaceId),
        );
        return;
      }
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (anyOnlineServerId) {
      router.replace(buildHostOpenProjectRoute(anyOnlineServerId));
      return;
    }
    router.replace("/");
  }, [anyOnlineServerId, isCompactLayout, router]);

  const detailHeader = ((): {
    title: string;
    Icon: ComponentType<{ size: number; color: string }>;
    titleAccessory?: ReactNode;
  } | null => {
    if (view.kind === "host") {
      const host = hosts.find((h) => h.serverId === view.serverId);
      if (!host) return null;
      return {
        title: host.label,
        Icon: Server,
        titleAccessory: <HostRenameButton host={host} />,
      };
    }
    if (view.kind === "section") {
      const item = SIDEBAR_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: t(item.labelKey), Icon: item.icon };
    }
    return null;
  })();

  const content = (() => {
    if (view.kind === "host") {
      return <HostPage serverId={view.serverId} onHostRemoved={handleHostRemoved} />;
    }
    if (view.kind === "section") {
      switch (view.section) {
        case "general":
          return (
            <GeneralSection
              settings={settings}
              handleThemeChange={handleThemeChange}
              handleSendBehaviorChange={handleSendBehaviorChange}
              handleDefaultWorkspaceRootChange={handleDefaultWorkspaceRootChange}
              probeServerId={anyOnlineServerId}
            />
          );
        case "shortcuts":
          return isDesktopApp ? <KeyboardShortcutsSection /> : null;
        case "integrations":
          return isDesktopApp ? <IntegrationsSection /> : null;
        case "permissions":
          return isDesktopApp ? <DesktopPermissionsSection /> : null;
        case "usage":
          return <UsageSection />;
        case "labs":
          return <LabsSection />;
        case "localDaemon":
          return <LocalDaemonPanel />;
        case "diagnostics":
          return (
            <DiagnosticsSection
              voiceAudioEngine={voiceAudioEngine}
              isPlaybackTestRunning={isPlaybackTestRunning}
              playbackTestResult={playbackTestResult}
              handlePlaybackTest={handlePlaybackTest}
            />
          );
        case "about":
          return <AboutSection appVersionText={appVersionText} isDesktopApp={isDesktopApp} />;
      }
    }
    return null;
  })();

  if (settingsLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{t("settings.loadingSettings")}</Text>
      </View>
    );
  }

  const addHostModals = (
    <>
      <AddHostMethodModal
        visible={isAddHostMethodVisible}
        onClose={closeAddConnectionFlow}
        onDirectConnection={handleSelectDirectConnection}
        onPasteLink={handleSelectPasteLink}
        onScanQr={handleScanQr}
      />
      <AddHostModal
        visible={isDirectHostVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
      <PairLinkModal
        visible={isPasteLinkVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
    </>
  );

  // Mobile root: full-screen sidebar-as-list. No back button — settings is a
  // bottom-tab destination, not a pushed screen, so there's nowhere to go
  // "back" to. Just render the title in the screen header.
  if (isCompactLayout && view.kind === "root") {
    return (
      <View style={styles.iosGroupedContainer}>
        <MobileSettingsRootHeader title={t("settings.title")} />
        <ScrollView style={styles.scrollView} contentContainerStyle={insetBottomStyle}>
          <SettingsSidebar
            view={view}
            onSelectSection={handleSelectSection}
            onSelectHost={handleSelectHost}
            onAddHost={handleAddHost}
            onBackToWorkspace={handleBackToWorkspace}
            layout="mobile"
          />
        </ScrollView>
        {addHostModals}
      </View>
    );
  }

  // Mobile detail: full-screen content with a back header that returns to the list.
  if (isCompactLayout) {
    return (
      <View style={styles.container}>
        <BackHeader
          title={detailHeader?.title}
          titleAccessory={detailHeader?.titleAccessory}
          onBack={handleBackToRoot}
        />
        <ScrollView style={styles.scrollView} contentContainerStyle={insetBottomStyle}>
          <View style={styles.content}>{content}</View>
        </ScrollView>
        {addHostModals}
      </View>
    );
  }

  // Desktop view — Settings is reached from the DesktopNavRail. The inner
  // section sidebar stays so users can navigate between General / Usage /
  // Labs / Diagnostics / About / hosts. The "Back to workspace" header row
  // is gone (DesktopNavRail provides that affordance instead).
  return (
    <View style={styles.container}>
      <View style={desktopStyles.row}>
        <SettingsSidebar
          view={view}
          onSelectSection={handleSelectSection}
          onSelectHost={handleSelectHost}
          onAddHost={handleAddHost}
          onBackToWorkspace={handleBackToWorkspace}
          layout="desktop"
        />
        <View style={desktopStyles.contentPane}>
          <ScreenHeader
            borderless={!detailHeader}
            windowControlsPaddingRole="detailHeader"
            left={
              detailHeader ? (
                <>
                  <HeaderIconBadge>
                    <detailHeader.Icon
                      size={theme.iconSize.md}
                      color={theme.colors.foregroundMuted}
                    />
                  </HeaderIconBadge>
                  <ScreenTitle testID="settings-detail-header-title">
                    {detailHeader.title}
                  </ScreenTitle>
                  {detailHeader.titleAccessory}
                </>
              ) : null
            }
            leftStyle={desktopStyles.detailLeft}
          />
          <ScrollView style={styles.scrollView} contentContainerStyle={insetBottomStyle}>
            <View style={styles.content}>{content}</View>
          </ScrollView>
        </View>
      </View>
      {addHostModals}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  iosGroupedContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  aboutValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  aboutErrorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
  aboutUpdateActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  themeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  themeTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  defaultWorkspaceInput: {
    marginTop: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.sm,
  },
  defaultWorkspaceClearText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
  defaultWorkspaceStatusOk: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
  defaultWorkspaceStatusError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
}));

const desktopStyles = StyleSheet.create((theme) => ({
  row: {
    flex: 1,
    flexDirection: "row",
  },
  contentPane: {
    flex: 1,
  },
  detailLeft: {
    gap: theme.spacing[2],
  },
}));

const sidebarStyles = StyleSheet.create((theme) => ({
  desktopContainer: {
    width: 320,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  mobileContainer: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[6],
  },
  list: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1],
  },
  mobileGroup: {
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.xl,
    overflow: "hidden",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  itemHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  itemSelected: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  mobileItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 44,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  mobileItemPressed: {
    backgroundColor: theme.colors.surface2,
  },
  mobileItemDivider: {
    height: 1,
    marginLeft: theme.spacing[4] + theme.iconSize.md + theme.spacing[3],
    backgroundColor: theme.colors.border,
  },
  label: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
  },
  mobileLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
  },
  mobileLabelAccent: {
    fontSize: theme.fontSize.base,
    color: theme.colors.accent,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
  },
  localMarker: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
}));
