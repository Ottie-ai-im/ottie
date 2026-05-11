import { router, usePathname, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { MobileTabBar, type MobileTab } from "@/components/mobile-tab-bar";
import { TopRightAddMenu, type AddMenuItem } from "@/components/top-right-add-menu";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { SidebarHumansList, useSidebarHumans } from "@/components/sidebar/sidebar-humans-list";
import {
  SidebarAiAgentsList,
  useSidebarAiAgents,
} from "@/components/sidebar/sidebar-ai-agents-list";
import { SidebarWechatList } from "@/components/sidebar/sidebar-wechat-list";
import { useSidebarWechatSessions } from "@/hooks/use-sidebar-wechat-sessions";
import { useAppSettings } from "@/hooks/use-settings";
import { Bot, Folder, MessageCircle, Users } from "lucide-react-native";
import {
  buildHostAssistantsRoute,
  buildHostCommunityRoute,
  buildHostDevicesRoute,
  buildHostUsageRoute,
} from "@/utils/host-routes";
import { MessagesSquare } from "lucide-react-native";
import {
  type Dispatch,
  memo,
  type ReactElement,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Platform,
  ScrollView,
  StyleSheet as RNStyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { ComboboxItem, type ComboboxOption, SearchInput } from "@/components/ui/combobox";
import { HEADER_TOP_PADDING_MOBILE, useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { BlurView } from "expo-blur";
import {
  AgentListDndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@/components/agent-list-dnd-context";
import { useGlobalDragStore } from "@/stores/global-drag-store";
import { buildHostWorkspaceOpenRoute, buildHostNewWorkspaceRoute } from "@/utils/host-routes";
import { useSidebarAnimation } from "@/contexts/sidebar-animation-context";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { useSidebarShortcutModel } from "@/hooks/use-sidebar-shortcut-model";
import {
  type SidebarProjectEntry,
  useSidebarWorkspacesList,
} from "@/hooks/use-sidebar-workspaces-list";
import { useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  selectIsAgentListOpen,
  usePanelStore,
} from "@/stores/panel-store";
import { resolveActiveHost } from "@/utils/active-host";
import { formatConnectionStatus } from "@/utils/daemons";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import {
  buildHostSessionsRoute,
  buildSettingsRoute,
  mapPathnameToServer,
} from "@/utils/host-routes";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";

const MIN_CHAT_WIDTH = 400;

type SidebarShortcutModel = ReturnType<typeof useSidebarShortcutModel>;
type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface LeftSidebarProps {
  selectedAgentId?: string;
}

// Sidebar three-section redesign: distribute the original single-+-menu's
// 8 actions across the workspace / humans / AI Agent sections. The four
// device/host actions (scanToPair, joinHost, addDevice, linkToExisting)
// stay on the workspace section because they're infrastructure-level
// (basic plumbing) rather than per-content like friends/agents.
const WORKSPACE_ADD_ITEMS: ReadonlyArray<AddMenuItem> = [
  { id: "chat.add.newChat", labelKey: "chat.add.newChat" },
  { id: "chat.add.createWorkspace", labelKey: "chat.add.createWorkspace" },
  { id: "chat.add.scanToPair", labelKey: "chat.add.scanToPair" },
  { id: "chat.add.joinHost", labelKey: "chat.add.joinHost" },
  { id: "chat.add.addDevice", labelKey: "chat.add.addDevice" },
  { id: "chat.add.linkToExisting", labelKey: "chat.add.linkToExisting" },
];
const HUMANS_ADD_ITEMS: ReadonlyArray<AddMenuItem> = [
  { id: "chat.add.addFriend", labelKey: "chat.add.addFriend" },
  { id: "chat.add.redeemFriendLink", labelKey: "chat.add.redeemFriendLink" },
];
const AI_AGENT_ADD_ITEMS: ReadonlyArray<AddMenuItem> = [
  { id: "chat.add.newAiAgent", labelKey: "chat.add.newAiAgent" },
  { id: "chat.add.addLocalService", labelKey: "chat.add.addLocalService" },
];

// WeChat section is read-only — no "+" menu items. The trailing slot on
// the section header is reserved for the gear/cog that opens the WeChat
// settings page (Step 7); until then we leave it blank to avoid a
// dead-end button.
const WECHAT_ADD_ITEMS: ReadonlyArray<AddMenuItem> = [];

interface ProjectsSectionHeaderProps {
  serverId: string | null;
  count: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

// Top section header (项目). Trailing "+" hosts the workspace + device-pair
// add-menu items the original sidebar header carried before the three-
// section redesign. Visually consistent with the humans / AI Agent
// section headers below it.
function ProjectsSectionHeader({
  serverId,
  count,
  collapsed,
  onToggleCollapsed,
}: ProjectsSectionHeaderProps) {
  const { t } = useTranslation();
  const trailing = useMemo(
    () => (
      <TopRightAddMenu
        serverId={serverId ?? undefined}
        testID="sidebar-projects-add"
        items={WORKSPACE_ADD_ITEMS}
        triggerLabelKey="sidebar.projects.addLabel"
        size="sm"
      />
    ),
    [serverId],
  );
  return (
    <SidebarSectionHeader
      icon={Folder}
      label={t("sidebar.projects.title")}
      count={count}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      trailing={trailing}
      testID="sidebar-section-projects"
    />
  );
}

interface HumansSectionHeaderProps {
  serverId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function HumansSectionHeader({ serverId, collapsed, onToggleCollapsed }: HumansSectionHeaderProps) {
  const { t } = useTranslation();
  const summary = useSidebarHumans(serverId);
  const trailing = useMemo(
    () => (
      <TopRightAddMenu
        serverId={serverId ?? undefined}
        testID="sidebar-humans-add"
        items={HUMANS_ADD_ITEMS}
        triggerLabelKey="sidebar.humans.addLabel"
        size="sm"
      />
    ),
    [serverId],
  );
  return (
    <SidebarSectionHeader
      icon={Users}
      label={t("sidebar.humans.title")}
      count={summary.count}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      trailing={trailing}
      testID="sidebar-section-humans"
    />
  );
}

interface AiAgentsSectionHeaderProps {
  serverId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function AiAgentsSectionHeader({
  serverId,
  collapsed,
  onToggleCollapsed,
}: AiAgentsSectionHeaderProps) {
  const { t } = useTranslation();
  const rows = useSidebarAiAgents(serverId);
  const trailing = useMemo(
    () => (
      <TopRightAddMenu
        serverId={serverId ?? undefined}
        testID="sidebar-ai-agents-add"
        items={AI_AGENT_ADD_ITEMS}
        triggerLabelKey="sidebar.aiAgents.addLabel"
        size="sm"
      />
    ),
    [serverId],
  );
  return (
    <SidebarSectionHeader
      icon={Bot}
      label={t("sidebar.aiAgents.title")}
      count={rows.length}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      trailing={trailing}
      testID="sidebar-section-ai-agents"
    />
  );
}

interface WechatSectionHeaderProps {
  serverId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

// 4th sidebar section — WeChat. Read-only data source from wx-cli; the
// trailing slot would normally host a "+" menu but WeChat has no
// add-flow, so we leave WECHAT_ADD_ITEMS empty. Step 7 swaps that for a
// gear linking into Settings → WeChat once the settings panel exists.
interface WechatSectionProps {
  serverId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Wraps the WeChat section header + list in a single render branch
 * gated on the user's `wechatEnabled` setting. Off → the entire
 * section disappears (no header, no list, no daemon polling), so the
 * user can hide WeChat without losing the toggle.
 */
function WechatSection({ serverId, collapsed, onToggleCollapsed }: WechatSectionProps) {
  const { settings } = useAppSettings();
  if (!settings.wechatEnabled) return null;
  return (
    <>
      <WechatSectionHeader
        serverId={serverId}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
      {collapsed ? null : <SidebarWechatList serverId={serverId} />}
    </>
  );
}

function WechatSectionHeader({ serverId, collapsed, onToggleCollapsed }: WechatSectionHeaderProps) {
  const { t } = useTranslation();
  const summary = useSidebarWechatSessions(serverId);
  const trailing = useMemo(
    () =>
      WECHAT_ADD_ITEMS.length > 0 ? (
        <TopRightAddMenu
          serverId={serverId ?? undefined}
          testID="sidebar-wechat-add"
          items={WECHAT_ADD_ITEMS}
          triggerLabelKey="sidebar.wechat.settingsLabel"
          size="sm"
        />
      ) : null,
    [serverId],
  );
  return (
    <SidebarSectionHeader
      icon={MessageCircle}
      label={t("sidebar.wechat.title")}
      count={summary.sessions.length}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      trailing={trailing}
      testID="sidebar-section-wechat"
    />
  );
}

interface SidebarThreeSectionState {
  projectsCollapsed: boolean;
  humansCollapsed: boolean;
  agentsCollapsed: boolean;
  wechatCollapsed: boolean;
  toggleProjects: () => void;
  toggleHumans: () => void;
  toggleAgents: () => void;
  toggleWechat: () => void;
}

// Local state holder — collapsed-by-default is `false` so the user sees
// content on first paint. Persistence (remember collapsed state across
// reloads) is a follow-up if it surfaces in feedback. The interface name
// is "ThreeSection" by history; WeChat is the 4th but renaming churns
// nothing visible to the user.
function useSidebarThreeSectionState(): SidebarThreeSectionState {
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [humansCollapsed, setHumansCollapsed] = useState(false);
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);
  const [wechatCollapsed, setWechatCollapsed] = useState(false);

  const toggleProjects = useCallback(() => setProjectsCollapsed((p) => !p), []);
  const toggleHumans = useCallback(() => setHumansCollapsed((p) => !p), []);
  const toggleAgents = useCallback(() => setAgentsCollapsed((p) => !p), []);
  const toggleWechat = useCallback(() => setWechatCollapsed((p) => !p), []);

  return {
    projectsCollapsed,
    humansCollapsed,
    agentsCollapsed,
    wechatCollapsed,
    toggleProjects,
    toggleHumans,
    toggleAgents,
    toggleWechat,
  };
}

interface SidebarSharedProps {
  theme: SidebarTheme;
  activeServerId: string | null;
  activeHostLabel: string;
  activeHostStatusColor: string;
  hostOptions: ComboboxOption[];
  hostTriggerRef: RefObject<View | null>;
  isHostPickerOpen: boolean;
  setIsHostPickerOpen: Dispatch<SetStateAction<boolean>>;
  projects: SidebarProjectEntry[];
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  collapsedProjectKeys: SidebarShortcutModel["collapsedProjectKeys"];
  shortcutIndexByWorkspaceKey: SidebarShortcutModel["shortcutIndexByWorkspaceKey"];
  toggleProjectCollapsed: SidebarShortcutModel["toggleProjectCollapsed"];
  handleRefresh: () => void;
  handleHostSelect: (nextServerId: string) => void;
  handleOpenProject: () => void;
  handleSettings: () => void;
  renderHostOption: (input: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
}

interface MobileSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  insetsBottom: number;
  isOpen: boolean;
  closeToAgent: () => void;
  handleViewMoreNavigate: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  isOpen: boolean;
  handleViewMore: () => void;
}

export const LeftSidebar = memo(function LeftSidebar({
  selectedAgentId: _selectedAgentId,
}: LeftSidebarProps) {
  void _selectedAgentId;

  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isCompactLayout }),
  );
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const pathname = usePathname();
  const daemons = useHosts();
  const activeDaemon = useMemo(
    () => resolveActiveHost({ hosts: daemons, pathname }),
    [daemons, pathname],
  );
  const activeServerId = activeDaemon?.serverId ?? null;
  const activeHostLabel = useMemo(() => {
    if (!activeDaemon) return "No host";
    const trimmed = activeDaemon.label?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : activeDaemon.serverId;
  }, [activeDaemon]);
  const activeHostSnapshot = useHostRuntimeSnapshot(activeServerId ?? "");
  const activeHostStatus = activeServerId
    ? (activeHostSnapshot?.connectionStatus ?? "connecting")
    : "idle";
  // Inline color computation in a useMemo so the React Compiler captures values
  // (status, theme) directly. Earlier attempts using a `let` rebind, then a
  // module-level helper, both produced "Can't find variable" runtime crashes
  // under the compiler's scope rewrites.
  const activeHostStatusColor = useMemo(() => {
    if (activeHostStatus === "online") return theme.colors.palette.green[400];
    if (activeHostStatus === "connecting") return theme.colors.palette.amber[500];
    return theme.colors.palette.red[500];
  }, [activeHostStatus, theme.colors.palette]);
  const hostOptions = useMemo(
    () =>
      daemons.map((daemon) => ({
        id: daemon.serverId,
        label: daemon.label?.trim() || daemon.serverId,
      })),
    [daemons],
  );
  const renderHostOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <HostSwitchOption
        serverId={option.id}
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
      />
    ),
    [],
  );
  const hostTriggerRef = useRef<View | null>(null);
  const [isHostPickerOpen, setIsHostPickerOpen] = useState(false);

  const { projects, isInitialLoad, isRevalidating, refreshAll } = useSidebarWorkspacesList({
    serverId: activeServerId,
    enabled: isCompactLayout || isOpen,
  });
  const { collapsedProjectKeys, shortcutIndexByWorkspaceKey, toggleProjectCollapsed } =
    useSidebarShortcutModel({ projects, isInitialLoad });

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const openProjectPicker = useOpenProjectPicker(activeServerId);

  const handleOpenProjectMobile = useCallback(() => {
    showMobileAgent();
    void openProjectPicker();
  }, [showMobileAgent, openProjectPicker]);

  const handleOpenProjectDesktop = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleSettingsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsRoute());
  }, [showMobileAgent]);

  const handleSettingsDesktop = useCallback(() => {
    router.push(buildSettingsRoute());
  }, []);

  const handleViewMoreNavigate = useCallback(() => {
    if (!activeServerId) {
      return;
    }
    router.push(buildHostSessionsRoute(activeServerId));
  }, [activeServerId]);

  const handleHostSelect = useCallback(
    (nextServerId: string) => {
      if (!nextServerId) {
        return;
      }
      const nextPath = mapPathnameToServer(pathname, nextServerId);
      setIsHostPickerOpen(false);
      router.push(nextPath);
    },
    [pathname],
  );

  const sharedProps = {
    theme,
    activeServerId,
    activeHostLabel,
    activeHostStatusColor,
    hostOptions,
    hostTriggerRef,
    isHostPickerOpen,
    setIsHostPickerOpen,
    projects,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    handleHostSelect,
    renderHostOption,
  };

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const sensors = useSensors(pointerSensor);
  const setPendingDroppedProvider = useGlobalDragStore((state) => state.setPendingDroppedProvider);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      if (active.data.current?.type === "provider") {
        const providerId = active.id as string;

        if (over.data.current?.type === "project-new-task") {
          setPendingDroppedProvider(providerId);

          const serverId = over.data.current.serverId as string;
          const workspaceId = over.data.current.workspaceId as string | undefined;
          const projectRootPath = over.data.current.projectRootPath as string;
          const projectName = over.data.current.projectName as string;

          if (workspaceId) {
            router.navigate(buildHostWorkspaceOpenRoute(serverId, workspaceId, "draft:new"));
          } else {
            router.navigate(
              buildHostNewWorkspaceRoute(serverId, projectRootPath, {
                displayName: projectName,
              }) as Href,
            );
          }
        } else if (over.data.current?.type === "workspace-change-ai") {
          if (over.data.current.hasRunningScripts) {
            return;
          }
          setPendingDroppedProvider(providerId);

          const serverId = over.data.current.serverId as string;
          const workspaceId = over.data.current.workspaceId as string;

          router.navigate(buildHostWorkspaceOpenRoute(serverId, workspaceId, "draft:new"));
        } else if (over.data.current?.type === "agent-change-provider") {
          const serverId = over.data.current.serverId as string;
          const agentId = over.data.current.agentId as string;

          // Currently, the daemon `updateAgent` API only supports `name` and `labels`.
          // We navigate to the agent and optionally we could drop into an edit mode if supported.
          router.navigate(
            buildHostWorkspaceOpenRoute(
              serverId,
              over.data.current.workspaceId as string,
              `agent:${agentId}`,
            ),
          );
        }
      }
    },
    [setPendingDroppedProvider],
  );

  if (isCompactLayout) {
    return (
      <AgentListDndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <MobileSidebar
          {...sharedProps}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          isOpen={isOpen}
          closeToAgent={showMobileAgent}
          handleOpenProject={handleOpenProjectMobile}
          handleSettings={handleSettingsMobile}
          handleViewMoreNavigate={handleViewMoreNavigate}
        />
      </AgentListDndContext>
    );
  }

  return (
    <AgentListDndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <View style={staticStyles.desktopRow}>
        <DesktopSidebar
          {...sharedProps}
          insetsTop={insets.top}
          isOpen={isOpen}
          handleOpenProject={handleOpenProjectDesktop}
          handleSettings={handleSettingsDesktop}
          handleViewMore={handleViewMoreNavigate}
        />
      </View>
    </AgentListDndContext>
  );
});

function HostSwitchOption({
  serverId,
  label,
  selected,
  active,
  onPress,
}: {
  serverId: string;
  label: string;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const snapshot = useHostRuntimeSnapshot(serverId);
  const connectionStatus = snapshot?.connectionStatus ?? "connecting";

  return (
    <ComboboxItem
      label={label}
      description={formatConnectionStatus(connectionStatus)}
      selected={selected}
      active={active}
      onPress={onPress}
    />
  );
}

function MobileSidebar({
  theme,
  activeServerId,
  activeHostLabel: _activeHostLabel,
  activeHostStatusColor: _activeHostStatusColor,
  hostOptions: _hostOptions,
  hostTriggerRef: _hostTriggerRef,
  isHostPickerOpen: _isHostPickerOpen,
  setIsHostPickerOpen: _setIsHostPickerOpen,
  projects,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleHostSelect: _handleHostSelect,
  renderHostOption: _renderHostOption,
  handleOpenProject,
  handleSettings: _handleSettings,
  insetsTop,
  insetsBottom,
  isOpen,
  closeToAgent,
  handleViewMoreNavigate,
}: MobileSidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const isSessionsActive = pathname.includes("/sessions");
  const [mobileSearchQuery, setMobileSearchQuery] = useState("");
  const {
    translateX,
    backdropOpacity,
    windowWidth,
    animateToOpen,
    animateToClose,
    isGesturing,
    gestureAnimatingRef,
    closeGestureRef,
  } = useSidebarAnimation();
  const closeTouchStartX = useSharedValue(0);
  const closeTouchStartY = useSharedValue(0);

  const handleCloseFromGesture = useCallback(() => {
    gestureAnimatingRef.current = true;
    closeToAgent();
  }, [closeToAgent, gestureAnimatingRef]);

  // Sidebar 3-section redesign: the original single "+" menu's 8 items
  // are now split across project / humans / AI Agent section headers.
  // The 聊天 SidebarHeaderRow becomes a pure tab marker with no trailing.
  const threeSectionState = useSidebarThreeSectionState();

  const handleMobileTabSelect = useCallback(
    (tab: MobileTab) => {
      if (tab === "chats") return;
      // Close the sidebar drawer immediately so the next route renders on a
      // clean canvas without the workspace overlay competing for the screen.
      closeToAgent();
      switch (tab) {
        case "devices":
          if (activeServerId) {
            router.push(buildHostDevicesRoute(activeServerId));
          }
          return;
        case "extensions":
          if (activeServerId) {
            router.push(buildHostCommunityRoute(activeServerId));
          }
          return;
        case "assistants":
          if (activeServerId) {
            router.push(buildHostAssistantsRoute(activeServerId));
          }
          return;
        case "usage":
          if (activeServerId) {
            router.push(buildHostUsageRoute(activeServerId));
          }
          return;
        case "settings":
          router.push("/settings");
          return;
      }
    },
    [activeServerId, closeToAgent],
  );

  const handleViewMore = useCallback(() => {
    if (!activeServerId) {
      return;
    }
    translateX.value = -windowWidth;
    backdropOpacity.value = 0;
    closeToAgent();
    handleViewMoreNavigate();
  }, [
    activeServerId,
    backdropOpacity,
    closeToAgent,
    handleViewMoreNavigate,
    translateX,
    windowWidth,
  ]);

  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .withRef(closeGestureRef)
        .enabled(isOpen)
        .manualActivation(true)
        .onTouchesDown((event) => {
          const touch = event.changedTouches[0];
          if (!touch) {
            return;
          }
          closeTouchStartX.value = touch.absoluteX;
          closeTouchStartY.value = touch.absoluteY;
        })
        .onTouchesMove((event, stateManager) => {
          const touch = event.changedTouches[0];
          if (!touch || event.numberOfTouches !== 1) {
            stateManager.fail();
            return;
          }

          const deltaX = touch.absoluteX - closeTouchStartX.value;
          const deltaY = touch.absoluteY - closeTouchStartY.value;
          const absDeltaX = Math.abs(deltaX);
          const absDeltaY = Math.abs(deltaY);

          if (deltaX >= 10) {
            stateManager.fail();
            return;
          }
          if (absDeltaY > 10 && absDeltaY > absDeltaX) {
            stateManager.fail();
            return;
          }
          if (deltaX <= -15 && absDeltaX > absDeltaY) {
            stateManager.activate();
          }
        })
        .onStart(() => {
          isGesturing.value = true;
        })
        .onUpdate((event) => {
          const newTranslateX = Math.min(0, Math.max(-windowWidth, event.translationX));
          translateX.value = newTranslateX;
          backdropOpacity.value = interpolate(
            newTranslateX,
            [-windowWidth, 0],
            [0, 1],
            Extrapolation.CLAMP,
          );
        })
        .onEnd((event) => {
          isGesturing.value = false;
          const shouldClose = event.translationX < -windowWidth / 3 || event.velocityX < -500;
          if (shouldClose) {
            animateToClose();
            runOnJS(handleCloseFromGesture)();
          } else {
            animateToOpen();
          }
        })
        .onFinalize(() => {
          isGesturing.value = false;
        }),
    [
      isOpen,
      closeGestureRef,
      closeTouchStartX,
      closeTouchStartY,
      isGesturing,
      windowWidth,
      translateX,
      backdropOpacity,
      animateToClose,
      animateToOpen,
      handleCloseFromGesture,
    ],
  );

  // Match the 8px gap that ScreenHeader adds on mobile so the sidebar's
  // "Chats" header lines up vertically with the headers on Devices /
  // Community / Settings tabs.
  const mobileSidebarInsetStyle = useMemo(
    () => ({
      width: windowWidth,
      paddingTop: insetsTop + HEADER_TOP_PADDING_MOBILE,
      paddingBottom: insetsBottom,
    }),
    [windowWidth, insetsTop, insetsBottom],
  );

  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0.01 ? "auto" : "none",
  }));

  let overlayPointerEvents: "auto" | "none" | "box-none";
  if (!isWeb) overlayPointerEvents = "box-none";
  else if (isOpen) overlayPointerEvents = "auto";
  else overlayPointerEvents = "none";

  const backdropStyle = useMemo(
    () => [staticStyles.backdrop, backdropAnimatedStyle],
    [backdropAnimatedStyle],
  );
  const mobileSidebarStyle = useMemo(
    () => [
      staticStyles.mobileSidebar,
      mobileSidebarInsetStyle,
      sidebarAnimatedStyle,
      {
        backgroundColor: isNative ? theme.colors.surfaceGlassStrong : theme.colors.surfaceSidebar,
      },
    ],
    [
      mobileSidebarInsetStyle,
      sidebarAnimatedStyle,
      theme.colors.surfaceGlassStrong,
      theme.colors.surfaceSidebar,
    ],
  );
  const isDarkScheme = theme.colorScheme === "dark";

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents={overlayPointerEvents}>
      <Animated.View style={backdropStyle} />

      <GestureDetector gesture={closeGesture} touchAction="pan-y">
        <Animated.View style={mobileSidebarStyle} pointerEvents="auto">
          {isNative ? (
            <BlurView
              tint={isDarkScheme ? "systemThickMaterialDark" : "systemThickMaterialLight"}
              intensity={70}
              experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
              style={RNStyleSheet.absoluteFill}
              pointerEvents="none"
            />
          ) : null}
          <View style={styles.sidebarContent} pointerEvents="auto">
            <SidebarHeaderRow
              icon={MessagesSquare}
              label={t("sidebar.sessions")}
              onPress={handleViewMore}
              isActive={isSessionsActive}
              testID="sidebar-sessions"
            />

            <ScrollView
              style={styles.mobileSidebarScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.mobileSidebarSearch}>
                <SearchInput
                  placeholder={t("sidebar.searchPlaceholder", { defaultValue: "Search..." })}
                  value={mobileSearchQuery}
                  onChangeText={setMobileSearchQuery}
                />
              </View>

              <ProjectsSectionHeader
                serverId={activeServerId}
                count={projects.length}
                collapsed={threeSectionState.projectsCollapsed}
                onToggleCollapsed={threeSectionState.toggleProjects}
              />
              {(() => {
                if (threeSectionState.projectsCollapsed) return null;
                if (isInitialLoad) return <SidebarAgentListSkeleton />;
                return (
                  <SidebarWorkspaceList
                    serverId={activeServerId}
                    collapsedProjectKeys={collapsedProjectKeys}
                    onToggleProjectCollapsed={toggleProjectCollapsed}
                    shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
                    projects={projects}
                    isRefreshing={isManualRefresh && isRevalidating}
                    onRefresh={handleRefresh}
                    onAddProject={handleOpenProject}
                    hideSearch
                    scrollEnabled={false}
                    externalSearchQuery={mobileSearchQuery}
                    onExternalSearchChange={setMobileSearchQuery}
                  />
                );
              })()}

              <HumansSectionHeader
                serverId={activeServerId}
                collapsed={threeSectionState.humansCollapsed}
                onToggleCollapsed={threeSectionState.toggleHumans}
              />
              {threeSectionState.humansCollapsed ? null : (
                <SidebarHumansList serverId={activeServerId} />
              )}

              <AiAgentsSectionHeader
                serverId={activeServerId}
                collapsed={threeSectionState.agentsCollapsed}
                onToggleCollapsed={threeSectionState.toggleAgents}
              />
              {threeSectionState.agentsCollapsed ? null : (
                <SidebarAiAgentsList serverId={activeServerId} />
              )}

              <WechatSection
                serverId={activeServerId}
                collapsed={threeSectionState.wechatCollapsed}
                onToggleCollapsed={threeSectionState.toggleWechat}
              />
            </ScrollView>

            <MobileTabBar activeTab="chats" onSelect={handleMobileTabSelect} />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function DesktopSidebar({
  theme: _theme,
  activeServerId,
  activeHostLabel: _activeHostLabel,
  activeHostStatusColor: _activeHostStatusColor,
  hostOptions: _hostOptions,
  hostTriggerRef: _hostTriggerRef,
  isHostPickerOpen: _isHostPickerOpen,
  setIsHostPickerOpen: _setIsHostPickerOpen,
  projects,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleHostSelect: _handleHostSelect,
  renderHostOption: _renderHostOption,
  handleOpenProject,
  handleSettings: _handleSettings,
  insetsTop,
  isOpen,
  handleViewMore,
}: DesktopSidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const isSessionsActive = pathname.includes("/sessions");
  // Hide the chat sessions panel on top-level non-chat destinations
  // (extensions / activity / devices / settings) so the page gets full width.
  const isNonChatRoute = /\/(community|devices|usage|settings)(\/|$)/.test(pathname);
  const padding = useWindowControlsPadding("sidebar");
  const threeSectionState = useSidebarThreeSectionState();
  const [desktopSearchQuery, setDesktopSearchQuery] = useState("");
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();

  const startWidthRef = useRef(sidebarWidth);
  const resizeWidth = useSharedValue(sidebarWidth);

  useEffect(() => {
    resizeWidth.value = sidebarWidth;
  }, [sidebarWidth, resizeWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = sidebarWidth;
          resizeWidth.value = sidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          const maxWidth = Math.max(
            MIN_SIDEBAR_WIDTH,
            Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - MIN_CHAT_WIDTH),
          );
          const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, newWidth));
          resizeWidth.value = clampedWidth;
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        }),
    [sidebarWidth, resizeWidth, setSidebarWidth, viewportWidth],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  const paddingTopSpacerStyle = useMemo(() => ({ height: padding.top }), [padding.top]);
  const desktopSidebarStyle = useMemo(
    () => [staticStyles.desktopSidebar, resizeAnimatedStyle, { paddingTop: insetsTop }],
    [resizeAnimatedStyle, insetsTop],
  );
  const desktopSidebarBorderStyle = useMemo(() => [styles.desktopSidebarBorder, { flex: 1 }], []);
  const vibrancyPassThroughProp: Record<string, unknown> = useMemo(
    () => ({ dataSet: { vibrancyPassThrough: "true" } }),
    [],
  );
  const resizeHandleStyle = useMemo(
    () => [styles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)],
    [],
  );

  if (!isOpen || isNonChatRoute) {
    return null;
  }

  return (
    <Animated.View style={desktopSidebarStyle}>
      <View style={desktopSidebarBorderStyle} {...vibrancyPassThroughProp}>
        <View style={styles.sidebarDragArea}>
          <TitlebarDragRegion />
          {padding.top > 0 ? <View style={paddingTopSpacerStyle} /> : null}
          <SidebarHeaderRow
            icon={MessagesSquare}
            label={t("sidebar.sessions")}
            onPress={handleViewMore}
            isActive={isSessionsActive}
            testID="sidebar-sessions"
          />
        </View>

        <View style={styles.mobileSidebarSearch}>
          <SearchInput
            placeholder={t("sidebar.searchPlaceholder", { defaultValue: "Search..." })}
            value={desktopSearchQuery}
            onChangeText={setDesktopSearchQuery}
          />
        </View>

        <ScrollView style={styles.desktopScrollArea} showsVerticalScrollIndicator={false}>
          <ProjectsSectionHeader
            serverId={activeServerId}
            count={projects.length}
            collapsed={threeSectionState.projectsCollapsed}
            onToggleCollapsed={threeSectionState.toggleProjects}
          />
          {!threeSectionState.projectsCollapsed &&
            (isInitialLoad ? (
              <SidebarAgentListSkeleton />
            ) : (
              <SidebarWorkspaceList
                serverId={activeServerId}
                collapsedProjectKeys={collapsedProjectKeys}
                onToggleProjectCollapsed={toggleProjectCollapsed}
                shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
                projects={projects}
                isRefreshing={isManualRefresh && isRevalidating}
                onRefresh={handleRefresh}
                onAddProject={handleOpenProject}
                hideSearch
                externalSearchQuery={desktopSearchQuery}
                onExternalSearchChange={setDesktopSearchQuery}
              />
            ))}

          <HumansSectionHeader
            serverId={activeServerId}
            collapsed={threeSectionState.humansCollapsed}
            onToggleCollapsed={threeSectionState.toggleHumans}
          />
          {threeSectionState.humansCollapsed ? null : (
            <SidebarHumansList serverId={activeServerId} />
          )}

          <AiAgentsSectionHeader
            serverId={activeServerId}
            collapsed={threeSectionState.agentsCollapsed}
            onToggleCollapsed={threeSectionState.toggleAgents}
          />
          {threeSectionState.agentsCollapsed ? null : (
            <SidebarAiAgentsList serverId={activeServerId} />
          )}

          <WechatSection
            serverId={activeServerId}
            collapsed={threeSectionState.wechatCollapsed}
            onToggleCollapsed={threeSectionState.toggleWechat}
          />

          <SidebarCalloutSlot />
        </ScrollView>

        {/* Resize handle - absolutely positioned over right border */}
        <GestureDetector gesture={resizeGesture}>
          <View style={resizeHandleStyle} />
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  backdrop: {
    ...RNStyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  mobileSidebar: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    bottom: 0,
    overflow: "hidden" as const,
  },
  desktopSidebar: {
    position: "relative" as const,
  },
  desktopRow: {
    flexDirection: "row" as const,
    height: "100%",
    zIndex: 10,
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileSidebarScroll: {
    flex: 1,
    minHeight: 0,
  },
  mobileSidebarSearch: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  desktopScrollArea: {
    flex: 1,
    minHeight: 0,
  },
  desktopSidebarBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  resizeHandle: {
    position: "absolute",
    right: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  sidebarDragArea: {
    position: "relative",
  },
  hostTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: theme.spacing[2],
    minWidth: 0,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
  },
  hostTriggerHovered: {
    backgroundColor: theme.colors.surfaceGlass,
  },
  hostStatusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  hostTriggerText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    minWidth: 0,
  },
  sidebarFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footerHostSlot: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    marginRight: theme.spacing[2],
  },
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  hostPickerList: {
    gap: theme.spacing[2],
  },
  hostPickerOption: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  hostPickerOptionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  hostPickerCancel: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  hostPickerCancelText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
