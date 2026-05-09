import { useCallback, useMemo, useState, type ComponentType } from "react";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, usePathname } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useHotkeys } from "react-hotkeys-hook";
import {
  Activity,
  Bell,
  Blocks,
  MessagesSquare,
  Server,
  Settings,
  User,
} from "lucide-react-native";

import { useHosts } from "@/runtime/host-runtime";
import { useNotifications } from "@/hooks/use-notifications";
import { NotificationCenterPanel } from "./notification-center-panel";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import {
  buildHostCommunityRoute,
  buildHostDevicesRoute,
  buildHostSessionsRoute,
  buildHostUsageRoute,
} from "@/utils/host-routes";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { isWeb } from "@/constants/platform";

// Nav rail must be at least as wide as the macOS traffic-light cluster
// (DESKTOP_TRAFFIC_LIGHT_WIDTH = 78) plus a small breathing margin, so the
// rail's right border doesn't slice through the red/yellow/green buttons.
// 88 keeps the 40×40 icon buttons visually centered with comfortable
// horizontal padding.
const RAIL_WIDTH = 88;

// Note: the "assistants" rail tab was removed once the AI Agent surface
// moved into the left sidebar's three-section layout. The /h/{id}/assistants
// route still exists (it's how the sidebar's AI Agent + → "Add local
// service" reaches the OpenClaw / OpenWebUI install flow), it just no
// longer has a top-level rail icon since the entry point is the sidebar.
type RailTabId = "chats" | "devices" | "extensions" | "usage" | "settings";

interface RailTabSpec {
  id: RailTabId;
  labelKey: "tabs.chats" | "tabs.devices" | "tabs.extensions" | "tabs.usage" | "tabs.settings";
  icon: ComponentType<{ size?: number; color?: string }>;
}

const PRIMARY_TABS: readonly RailTabSpec[] = [
  { id: "chats", labelKey: "tabs.chats", icon: MessagesSquare },
  { id: "devices", labelKey: "tabs.devices", icon: Server },
  { id: "extensions", labelKey: "tabs.extensions", icon: Blocks },
  { id: "usage", labelKey: "tabs.usage", icon: Activity },
  { id: "settings", labelKey: "tabs.settings", icon: Settings },
];

function deriveActiveTab(pathname: string): RailTabId {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.includes("/devices")) return "devices";
  if (pathname.includes("/community")) return "extensions";
  if (pathname.includes("/usage")) return "usage";
  return "chats";
}

/**
 * Vertical icon-only nav rail for desktop. Sits at the very left edge of the
 * window (inside the Tauri vibrancy backdrop) and holds:
 *   - Top: 4 primary destinations (chats / devices / community / settings).
 *   - Bottom: notification bell (red dot when there are pending alerts) and a
 *     profile avatar placeholder.
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

  const topPadding = insets.top + windowControlsPadding.top + 16;
  const bottomPadding = Math.max(insets.bottom, 8) + 8;
  const containerStyle = useMemo(
    () => [styles.container, { paddingTop: topPadding, paddingBottom: bottomPadding }],
    [topPadding, bottomPadding],
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
        case "extensions":
          if (activeServerId) {
            router.replace(buildHostCommunityRoute(activeServerId));
          }
          break;
        case "usage":
          if (activeServerId) {
            router.replace(buildHostUsageRoute(activeServerId));
          }
          return;
        case "settings":
          router.replace("/settings");
          return;
      }
    },
    [activeServerId, activeTab],
  );

  // Phase 3.b/3 (notification center): wire the bell to friend-pair
  // candidates from the active host. Future kinds (offline-inbox hints,
  // Phase 4 share invites) fold into `useNotifications` without
  // touching this caller.
  const { count } = useNotifications(activeServerId);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const handleOpenNotifications = useCallback(() => setNotificationsOpen(true), []);
  const handleCloseNotifications = useCallback(() => setNotificationsOpen(false), []);

  return (
    <View style={containerStyle} accessibilityRole="tablist" data-vibrancy-pass-through="true">
      <View style={styles.group}>
        {PRIMARY_TABS.map((tab) => (
          <RailButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeTab}
            onSelect={handleSelect}
          />
        ))}
      </View>
      <View style={styles.spacer} />
      <View style={styles.group}>
        <NotificationButton count={count} onPress={handleOpenNotifications} />
        <ProfileButton />
      </View>
      <NotificationCenterPanel
        visible={notificationsOpen}
        onClose={handleCloseNotifications}
        serverId={activeServerId}
      />
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
      styles.iconButton,
      active ? styles.iconButtonActive : null,
      Boolean(hovered) && !active ? styles.iconButtonHovered : null,
      pressed ? styles.iconButtonPressed : null,
    ],
    [active],
  );
  const iconColor = active ? theme.colors.foreground : theme.colors.foregroundMuted;
  const Icon = tab.icon;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      testID={`desktop-nav-${tab.id}`}
      style={buttonStyle}
    >
      <Icon size={22} color={iconColor} />
    </Pressable>
  );
}

function NotificationButton({ count, onPress }: { count: number; onPress: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      hovered ? styles.iconButtonHovered : null,
      pressed ? styles.iconButtonPressed : null,
    ],
    [],
  );
  const accessibilityLabel =
    count > 0
      ? t("nav.notifications.withCount", {
          count,
          defaultValue: `Notifications, ${count} unread`,
        })
      : t("nav.notifications.empty", { defaultValue: "Notifications" });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID="desktop-nav-notifications"
      style={buttonStyle}
    >
      <Bell size={22} color={theme.colors.foregroundMuted} />
      {count > 0 ? <View style={styles.notificationDot} /> : null}
    </Pressable>
  );
}

function ProfileButton() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.profileButton,
      hovered ? styles.iconButtonHovered : null,
      pressed ? styles.iconButtonPressed : null,
    ],
    [],
  );
  // Phase 1.f wires this to the identity & devices page. A richer account
  // sheet (avatar upload, sign-out, multi-identity) can replace this once
  // those surfaces ship.
  const handlePress = useCallback(() => {
    router.push("/settings/identity");
  }, []);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("nav.profile", { defaultValue: "Profile" })}
      testID="desktop-nav-profile"
      style={buttonStyle}
    >
      <View style={styles.profileAvatar}>
        <User size={18} color={theme.colors.foregroundMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    // Pin the rail to a fixed width. The parent in `_layout.tsx` is a flex
    // row, so omitting `flex: 1` keeps the rail at exactly RAIL_WIDTH
    // (otherwise `flex: 1` makes it grow horizontally and produces a huge
    // empty band between the rail and the next column). The rail will still
    // stretch vertically to fill the row's cross-axis automatically.
    width: RAIL_WIDTH,
    alignSelf: "stretch",
    backgroundColor: "transparent",
    paddingHorizontal: theme.spacing[2],
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderGlass,
  },
  group: {
    width: "100%",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  spacer: {
    flex: 1,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surfaceGlass,
  },
  iconButtonActive: {
    // Light tinted square highlight (matches the design mock — selected nav
    // item gets a soft fill, not a brand-color outline).
    backgroundColor: theme.colors.surface2,
  },
  iconButtonPressed: {
    opacity: 0.85,
  },
  notificationDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.destructive,
    borderWidth: 1.5,
    borderColor: theme.colors.surface0,
  },
  profileButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  profileAvatar: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
}));
