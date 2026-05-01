import { useCallback, useMemo, type ComponentType } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, usePathname } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useHotkeys } from "react-hotkeys-hook";
import { MessagesSquare, Settings, Server, Users } from "lucide-react-native";

import { useHosts } from "@/runtime/host-runtime";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import {
  buildHostCommunityRoute,
  buildHostDevicesRoute,
  buildHostSessionsRoute,
} from "@/utils/host-routes";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { isWeb } from "@/constants/platform";

const RAIL_WIDTH = 68;

type RailTabId = "chats" | "devices" | "community" | "settings";

interface RailTabSpec {
  id: RailTabId;
  labelKey: "tabs.chats" | "tabs.devices" | "tabs.community" | "tabs.settings";
  icon: ComponentType<{ size?: number; color?: string }>;
}

const TABS: readonly RailTabSpec[] = [
  { id: "chats", labelKey: "tabs.chats", icon: MessagesSquare },
  { id: "devices", labelKey: "tabs.devices", icon: Server },
  { id: "community", labelKey: "tabs.community", icon: Users },
  { id: "settings", labelKey: "tabs.settings", icon: Settings },
];

function deriveActiveTab(pathname: string): RailTabId {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.includes("/devices")) return "devices";
  if (pathname.includes("/community")) return "community";
  return "chats";
}

/**
 * macOS-26-style vertical navigation rail for desktop. Sits at the very left
 * edge of the window (inside the Tauri vibrancy backdrop) and holds the four
 * top-level destinations: chats / devices / community / settings.
 *
 * Mobile uses `MobileTabBar` at the bottom; desktop uses this rail. They
 * share the same target routes so navigation logic stays consistent.
 */
export function DesktopNavRail() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  // Cmd+K (mac) / Ctrl+K (everywhere else) opens the command center palette.
  // Plan 02a NAV-A4 / NAT-01 — universal action surface. Native shells never
  // reach this code (no DOM keyboard event), but `useHotkeys` no-ops cleanly
  // there.
  useHotkeys(
    "meta+k, ctrl+k",
    (event) => {
      if (!isWeb) return;
      event.preventDefault();
      useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
    },
    { preventDefault: true, enableOnFormTags: true },
  );
  // The rail sits at the very left edge of the Tauri window, so it has to
  // dodge the macOS traffic lights. `useWindowControlsPadding("sidebar")`
  // returns the same top offset the existing sidebar uses, keeping the rail's
  // first tab aligned with the workspace list header below.
  const windowControlsPadding = useWindowControlsPadding("sidebar");
  const hosts = useHosts();
  const activeServerId = hosts[0]?.serverId ?? "";
  const activeTab = deriveActiveTab(pathname);

  const topPadding = insets.top + windowControlsPadding.top + 12;
  const containerStyle = useMemo(
    () => [styles.container, { paddingTop: topPadding }],
    [topPadding],
  );

  const handleSelect = useCallback(
    (tab: RailTabId) => {
      if (tab === activeTab) return;
      switch (tab) {
        case "chats":
          if (activeServerId) {
            router.replace(buildHostSessionsRoute(activeServerId));
          }
          return;
        case "devices":
          if (activeServerId) {
            router.replace(buildHostDevicesRoute(activeServerId));
          }
          return;
        case "community":
          if (activeServerId) {
            router.replace(buildHostCommunityRoute(activeServerId));
          }
          return;
        case "settings":
          router.replace("/settings");
          return;
      }
    },
    [activeServerId, activeTab],
  );

  return (
    <View style={containerStyle} accessibilityRole="tablist" data-vibrancy-pass-through="true">
      {TABS.map((tab) => (
        <RailButton key={tab.id} tab={tab} active={tab.id === activeTab} onSelect={handleSelect} />
      ))}
    </View>
  );
}

function RailButton({
  tab,
  active,
  onSelect,
}: {
  tab: RailTabSpec;
  active: boolean;
  onSelect: (tab: RailTabId) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const label = t(tab.labelKey);
  const handlePress = useCallback(() => onSelect(tab.id), [onSelect, tab.id]);
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      active ? styles.buttonActive : null,
      Boolean(hovered) && !active ? styles.buttonHovered : null,
      pressed ? styles.buttonPressed : null,
    ],
    [active],
  );
  const iconColor = active ? theme.colors.accent : theme.colors.foregroundMuted;
  const labelStyle = useMemo(
    () => [styles.label, { color: iconColor }, active ? styles.labelActive : null],
    [iconColor, active],
  );
  const Icon = tab.icon;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      testID={`desktop-nav-${tab.id}`}
      style={buttonStyle}
    >
      <Icon size={20} color={iconColor} />
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: RAIL_WIDTH,
    backgroundColor: "transparent",
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[1],
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderGlass,
  },
  button: {
    width: "100%",
    paddingVertical: theme.spacing[2],
    gap: 4,
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceGlass,
  },
  buttonActive: {
    backgroundColor: theme.colors.surfaceGlassStrong,
    borderColor: theme.colors.borderGlass,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  label: {
    fontFamily: theme.fontFamily.system,
    fontSize: 11,
    letterSpacing: -0.1,
  },
  labelActive: {
    fontWeight: theme.fontWeight.semibold,
  },
}));
