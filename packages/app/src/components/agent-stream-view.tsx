import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeInUp, FadeOut, useReducedMotion } from "react-native-reanimated";
import { Check, ChevronDown, X, Clock, Trash2 } from "lucide-react-native";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { usePanelStore } from "@/stores/panel-store";
import {
  AssistantMessage,
  SpeakMessage,
  UserMessage,
  ActivityLog,
  ToolCall,
  TodoListCard,
  CompactionMarker,
  TurnCopyButton,
  MessageOuterSpacingProvider,
  type InlinePathTarget,
} from "./message";
import { PlanCard } from "./plan-card";
import { MathCurveLoader } from "@/components/math-curve-loader";
import type { StreamItem } from "@/types/stream";
import type { PendingPermission } from "@/types/shared";
import type {
  AgentPermissionAction,
  AgentPermissionResponse,
} from "@server/server/agent/agent-sdk-types";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useSessionStore } from "@/stores/session-store";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import type { DaemonClient } from "@server/client/daemon-client";
import { ToolCallDetailsContent } from "./tool-call-details";
import { QuestionFormCard } from "./question-form-card";
import { ToolCallSheetProvider } from "./tool-call-sheet";
import {
  buildAgentStreamRenderModel,
  collectAssistantTurnContentForStreamRenderStrategy,
  getStreamNeighborItem,
  resolveStreamRenderStrategy,
  type AgentStreamRenderModel,
  type StreamSegmentRenderers,
  type StreamViewportHandle,
} from "./agent-stream-render-strategy";
import {
  type BottomAnchorLocalRequest,
  type BottomAnchorRouteRequest,
} from "./use-bottom-anchor-controller";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { normalizeInlinePathTarget } from "@/utils/inline-path";
import { resolveWorkspaceIdByExecutionDirectory } from "@/utils/workspace-execution";
import { prepareWorkspaceTab } from "@/utils/workspace-navigation";
import { useStableEvent } from "@/hooks/use-stable-event";
import { isWeb } from "@/constants/platform";
import { formatTimeMarker } from "@/utils/time";

// IM-style time divider: insert a centered timestamp label whenever two
// consecutive items are separated by at least this much wall-clock time.
// Calibrated to match iMessage / WhatsApp / Telegram defaults.
const TIME_MARKER_GAP_MS = 5 * 60 * 1000;

// Only attach time markers to "spoken" turns. Background events (tool_call,
// thought, activity_log, compaction, todo_list) ride between turns and
// shouldn't carry their own date headers — the next real message will.
const TIME_MARKER_ATTACHABLE_KINDS: ReadonlySet<StreamItem["kind"]> = new Set([
  "user_message",
  "assistant_message",
]);

function getStreamItemTimestampMs(item: StreamItem | null | undefined): number | null {
  if (!item) return null;
  const ts = (item as { timestamp?: Date }).timestamp;
  if (!ts) return null;
  const ms = ts.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function shouldShowTimeMarkerAbove(params: {
  current: StreamItem;
  above: StreamItem | null | undefined;
}): boolean {
  if (!TIME_MARKER_ATTACHABLE_KINDS.has(params.current.kind)) {
    return false;
  }
  const currentMs = getStreamItemTimestampMs(params.current);
  if (currentMs === null) return false;
  // First "spoken" turn in the rendered stream — surface its timestamp so
  // users always see when the conversation started.
  if (!params.above) return true;
  const aboveMs = getStreamItemTimestampMs(params.above);
  if (aboveMs === null) return false;
  return currentMs - aboveMs >= TIME_MARKER_GAP_MS;
}

const isUserMessageItem = (item?: StreamItem) => item?.kind === "user_message";
const isToolSequenceItem = (item?: StreamItem) =>
  item?.kind === "tool_call" || item?.kind === "thought" || item?.kind === "todo_list";

const isSameAssistantBlockGroup = (params: {
  item: StreamItem | null | undefined;
  other: StreamItem | null | undefined;
}) =>
  params.item?.kind === "assistant_message" &&
  params.other?.kind === "assistant_message" &&
  params.item.blockGroupId !== undefined &&
  params.item.blockGroupId === params.other.blockGroupId;

const getAssistantBlockSpacing = (params: {
  item: StreamItem;
  aboveItem: StreamItem | null | undefined;
  belowItem: StreamItem | null | undefined;
}): "default" | "compactTop" | "compactBottom" | "compactBoth" => {
  if (params.item.kind !== "assistant_message") {
    return "default";
  }
  const compactTop = isSameAssistantBlockGroup({
    item: params.item,
    other: params.aboveItem,
  });
  const compactBottom = isSameAssistantBlockGroup({
    item: params.item,
    other: params.belowItem,
  });
  if (compactTop && compactBottom) {
    return "compactBoth";
  }
  if (compactTop) {
    return "compactTop";
  }
  if (compactBottom) {
    return "compactBottom";
  }
  return "default";
};
export interface AgentStreamViewHandle {
  scrollToBottom(reason?: BottomAnchorLocalRequest["reason"]): void;
  prepareForViewportChange(): void;
}

export interface AgentStreamViewProps {
  agentId: string;
  serverId?: string;
  agent: AgentScreenAgent;
  streamItems: StreamItem[];
  pendingPermissions: Map<string, PendingPermission>;
  routeBottomAnchorRequest?: BottomAnchorRouteRequest | null;
  isAuthoritativeHistoryReady?: boolean;
  onOpenWorkspaceFile?: (input: { filePath: string }) => void;
}

const AgentStreamViewComponent = forwardRef<AgentStreamViewHandle, AgentStreamViewProps>(
  function AgentStreamView(
    {
      agentId,
      serverId,
      agent,
      streamItems,
      pendingPermissions,
      routeBottomAnchorRequest = null,
      isAuthoritativeHistoryReady = true,
      onOpenWorkspaceFile,
    },
    ref,
  ) {
    const viewportRef = useRef<StreamViewportHandle | null>(null);
    const { theme } = useUnistyles();
    const router = useRouter();
    const isMobile = useIsCompactFormFactor();
    const streamRenderStrategy = useMemo(
      () =>
        resolveStreamRenderStrategy({
          platform: Platform.OS,
          isMobileBreakpoint: isMobile,
        }),
      [isMobile],
    );
    const [isNearBottom, setIsNearBottom] = useState(true);
    const [expandedInlineToolCallIds, setExpandedInlineToolCallIds] = useState<Set<string>>(
      new Set(),
    );
    const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
    const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);

    // Get serverId (fallback to agent's serverId if not provided)
    const resolvedServerId = serverId ?? agent.serverId ?? "";

    const client = useSessionStore((state) => state.sessions[resolvedServerId]?.client ?? null);
    const streamHead = useSessionStore((state) =>
      state.sessions[resolvedServerId]?.agentStreamHead?.get(agentId),
    );

    const workspaceRoot = agent.cwd?.trim() || "";
    const workspaceId = resolveWorkspaceIdByExecutionDirectory({
      workspaces: useSessionStore.getState().sessions[resolvedServerId]?.workspaces?.values(),
      workspaceDirectory: workspaceRoot,
    });
    const { requestDirectoryListing } = useFileExplorerActions({
      serverId: resolvedServerId,
      workspaceId: workspaceId ?? undefined,
      workspaceRoot,
    });
    const openWorkspaceFile = useStableEvent(function openWorkspaceFile(input: {
      filePath: string;
    }) {
      onOpenWorkspaceFile?.(input);
    });
    // Keep entry/exit animations off on Android due to RN dispatchDraw crashes
    // tracked in react-native-reanimated#8422.
    const shouldDisableEntryExitAnimations = Platform.OS === "android";
    const scrollIndicatorFadeIn = shouldDisableEntryExitAnimations
      ? undefined
      : FadeIn.duration(200);
    const scrollIndicatorFadeOut = shouldDisableEntryExitAnimations
      ? undefined
      : FadeOut.duration(200);

    useEffect(() => {
      setIsNearBottom(true);
      setExpandedInlineToolCallIds(new Set());
    }, [agentId]);

    const handleInlinePathPress = useCallback(
      (target: InlinePathTarget) => {
        if (!target.path) {
          return;
        }

        const normalized = normalizeInlinePathTarget(target.path, agent.cwd);
        if (!normalized) {
          return;
        }

        if (normalized.file) {
          if (onOpenWorkspaceFile) {
            openWorkspaceFile({ filePath: normalized.file });
            return;
          }

          if (workspaceId) {
            const route = prepareWorkspaceTab({
              serverId: resolvedServerId,
              workspaceId,
              target: { kind: "file", path: normalized.file },
            });
            router.navigate(route);
          }
          return;
        }

        void requestDirectoryListing(normalized.directory, {
          recordHistory: false,
          setCurrentPath: false,
        });

        const checkout = {
          serverId: resolvedServerId,
          cwd: agent.cwd,
          isGit: agent.projectPlacement?.checkout?.isGit ?? true,
        };
        setExplorerTabForCheckout({ ...checkout, tab: "files" });
        openFileExplorerForCheckout({
          isCompact: isMobile,
          checkout,
        });
      },
      [
        agent.cwd,
        agent.projectPlacement?.checkout?.isGit,
        isMobile,
        openFileExplorerForCheckout,
        onOpenWorkspaceFile,
        requestDirectoryListing,
        resolvedServerId,
        router,
        setExplorerTabForCheckout,
        openWorkspaceFile,
        workspaceId,
      ],
    );

    const baseRenderModel = useMemo(() => {
      return buildAgentStreamRenderModel({
        tail: streamItems,
        head: streamHead ?? [],
        platform: isWeb ? "web" : "native",
        isMobileBreakpoint: isMobile,
      });
    }, [isMobile, streamHead, streamItems]);
    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom(reason = "jump-to-bottom") {
          viewportRef.current?.scrollToBottom(reason);
        },
        prepareForViewportChange() {
          viewportRef.current?.prepareForViewportChange();
        },
      }),
      [],
    );

    const scrollToBottom = useCallback(() => {
      viewportRef.current?.scrollToBottom("jump-to-bottom");
    }, []);

    const tightGap = theme.spacing[1]; // 4px
    const assistantBlockGap = theme.spacing[3]; // 12px
    const looseGap = theme.spacing[4]; // 16px

    const getGapBetween = useCallback(
      (item: StreamItem | null, belowItem: StreamItem | null) => {
        if (!item || !belowItem) {
          return 0;
        }

        if (isUserMessageItem(item) && isUserMessageItem(belowItem)) {
          return tightGap;
        }
        if (isToolSequenceItem(item) && isToolSequenceItem(belowItem)) {
          return 0;
        }
        if (item.kind === "user_message" && isToolSequenceItem(belowItem)) {
          return looseGap;
        }
        if (item.kind === "assistant_message" && isToolSequenceItem(belowItem)) {
          return tightGap;
        }
        if (isToolSequenceItem(item) && belowItem.kind === "assistant_message") {
          return looseGap;
        }
        if (isSameAssistantBlockGroup({ item, other: belowItem })) {
          return assistantBlockGap;
        }
        return looseGap;
      },
      [assistantBlockGap, looseGap, tightGap],
    );

    const setInlineDetailsExpanded = useCallback(
      (itemId: string, expanded: boolean) => {
        if (!streamRenderStrategy.shouldDisableParentScrollOnInlineDetailsExpansion()) {
          return;
        }
        setExpandedInlineToolCallIds((previous) => {
          const next = new Set(previous);
          if (expanded) {
            next.add(itemId);
          } else {
            next.delete(itemId);
          }
          return next;
        });
      },
      [streamRenderStrategy],
    );

    const renderUserMessageItem = useCallback(
      (
        item: Extract<StreamItem, { kind: "user_message" }>,
        index: number,
        items: StreamItem[],
        seamAboveItem: StreamItem | null,
      ) => {
        const aboveItem =
          getStreamNeighborItem({
            strategy: streamRenderStrategy,
            items,
            index,
            relation: "above",
          }) ??
          seamAboveItem ??
          undefined;
        const belowItem = getStreamNeighborItem({
          strategy: streamRenderStrategy,
          items,
          index,
          relation: "below",
        });
        const isFirstInGroup = aboveItem?.kind !== "user_message";
        const isLastInGroup = belowItem?.kind !== "user_message";
        return (
          <UserMessage
            message={item.text}
            images={item.images}
            timestamp={item.timestamp.getTime()}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            deliveryState={item.deliveryState}
          />
        );
      },
      [streamRenderStrategy],
    );

    const renderAssistantMessageItem = useCallback(
      (
        item: Extract<StreamItem, { kind: "assistant_message" }>,
        index: number,
        items: StreamItem[],
        seamAboveItem: StreamItem | null,
        isLive = false,
      ) => {
        const aboveItem =
          getStreamNeighborItem({
            strategy: streamRenderStrategy,
            items,
            index,
            relation: "above",
          }) ??
          seamAboveItem ??
          undefined;
        const belowItem = getStreamNeighborItem({
          strategy: streamRenderStrategy,
          items,
          index,
          relation: "below",
        });
        const spacing = getAssistantBlockSpacing({
          item,
          aboveItem,
          belowItem,
        });
        return (
          <AssistantMessage
            message={item.text}
            timestamp={item.timestamp.getTime()}
            onInlinePathPress={handleInlinePathPress}
            workspaceRoot={workspaceRoot}
            serverId={serverId}
            client={client}
            spacing={spacing}
            isLive={isLive}
          />
        );
      },
      [handleInlinePathPress, streamRenderStrategy, workspaceRoot, serverId, client],
    );

    const renderThoughtItem = useCallback(
      (item: Extract<StreamItem, { kind: "thought" }>, index: number, items: StreamItem[]) => {
        const nextItem = getStreamNeighborItem({
          strategy: streamRenderStrategy,
          items,
          index,
          relation: "below",
        });
        const isLastInSequence = nextItem?.kind !== "tool_call" && nextItem?.kind !== "thought";
        return (
          <ToolCallSlot
            itemId={item.id}
            onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
            toolName="thinking"
            args={item.text}
            status={item.status === "ready" ? "completed" : "executing"}
            isLastInSequence={isLastInSequence}
          />
        );
      },
      [streamRenderStrategy, setInlineDetailsExpanded],
    );

    const renderToolCallItem = useCallback(
      (item: Extract<StreamItem, { kind: "tool_call" }>, index: number, items: StreamItem[]) => {
        const { payload } = item;
        const nextItem = getStreamNeighborItem({
          strategy: streamRenderStrategy,
          items,
          index,
          relation: "below",
        });
        const isLastInSequence = nextItem?.kind !== "tool_call" && nextItem?.kind !== "thought";

        if (payload.source === "agent") {
          const data = payload.data;

          if (
            data.name === "speak" &&
            data.detail.type === "unknown" &&
            typeof data.detail.input === "string" &&
            data.detail.input.trim()
          ) {
            return (
              <SpeakMessage message={data.detail.input} timestamp={item.timestamp.getTime()} />
            );
          }

          return (
            <ToolCallSlot
              itemId={item.id}
              onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
              toolName={data.name}
              error={data.error}
              status={data.status}
              detail={data.detail}
              cwd={agent.cwd}
              metadata={data.metadata}
              isLastInSequence={isLastInSequence}
            />
          );
        }

        const data = payload.data;
        return (
          <ToolCallSlot
            itemId={item.id}
            onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
            toolName={data.toolName}
            args={data.arguments}
            result={data.result}
            status={data.status}
            isLastInSequence={isLastInSequence}
          />
        );
      },
      [agent.cwd, streamRenderStrategy, setInlineDetailsExpanded],
    );

    const renderStreamItemContent = useCallback(
      (
        item: StreamItem,
        index: number,
        items: StreamItem[],
        seamAboveItem: StreamItem | null = null,
        isLive = false,
      ) => {
        switch (item.kind) {
          case "user_message":
            return renderUserMessageItem(item, index, items, seamAboveItem);

          case "assistant_message":
            return renderAssistantMessageItem(item, index, items, seamAboveItem, isLive);

          case "thought":
            return renderThoughtItem(item, index, items);

          case "tool_call":
            return renderToolCallItem(item, index, items);

          case "activity_log":
            return (
              <ActivityLog
                type={item.activityType}
                message={item.message}
                timestamp={item.timestamp.getTime()}
                metadata={item.metadata}
              />
            );

          case "todo_list":
            return <TodoListCard items={item.items} />;

          case "compaction":
            return <CompactionMarker status={item.status} preTokens={item.preTokens} />;

          default:
            return null;
        }
      },
      [renderUserMessageItem, renderAssistantMessageItem, renderThoughtItem, renderToolCallItem],
    );

    const renderStreamItem = useCallback(
      (
        item: StreamItem,
        index: number,
        items: StreamItem[],
        seamAboveItem: StreamItem | null = null,
        animateEntrance = false,
      ) => {
        const content = renderStreamItemContent(item, index, items, seamAboveItem, animateEntrance);
        if (!content) {
          return null;
        }

        const aboveItem =
          getStreamNeighborItem({
            strategy: streamRenderStrategy,
            items,
            index,
            relation: "above",
          }) ??
          seamAboveItem ??
          null;
        const nextItem = getStreamNeighborItem({
          strategy: streamRenderStrategy,
          items,
          index,
          relation: "below",
        });
        const gapBelow = getGapBetween(item, nextItem ?? null);
        const isEndOfAssistantTurn =
          item.kind === "assistant_message" &&
          (nextItem?.kind === "user_message" ||
            (nextItem === undefined && agent.status !== "running"));

        const showTimeMarker = shouldShowTimeMarkerAbove({ current: item, above: aboveItem });
        const timeMarkerLabel = showTimeMarker
          ? formatTimeMarker((item as { timestamp: Date }).timestamp)
          : null;

        return (
          <StreamItemWrapper gapBelow={gapBelow} animateEntrance={animateEntrance}>
            {timeMarkerLabel !== null ? <TimeMarker label={timeMarkerLabel} /> : null}
            {content}
            {isEndOfAssistantTurn ? (
              <TurnCopyButtonSlot
                strategy={streamRenderStrategy}
                items={items}
                startIndex={index}
              />
            ) : null}
          </StreamItemWrapper>
        );
      },
      [getGapBetween, renderStreamItemContent, agent.status, streamRenderStrategy],
    );

    const pendingPermissionItems = useMemo(
      () => Array.from(pendingPermissions.values()).filter((perm) => perm.agentId === agentId),
      [pendingPermissions, agentId],
    );

    const showWorkingIndicator = agent.status === "running";
    const pendingPermissionsNode = useMemo(
      () =>
        pendingPermissionItems.length > 0 ? (
          <View style={stylesheet.permissionsContainer}>
            {pendingPermissionItems.map((permission) => (
              <PermissionRequestCard key={permission.key} permission={permission} client={client} />
            ))}
          </View>
        ) : null,
      [client, pendingPermissionItems],
    );
    const workingIndicatorNode = useMemo(
      () =>
        showWorkingIndicator ? (
          <View style={stylesheet.bottomBarWrapper}>
            <WorkingIndicator />
          </View>
        ) : null,
      [showWorkingIndicator],
    );
    const scheduledMessagesNode = useMemo(() => {
      const schedules = agent.pendingSchedules;
      if (!schedules || schedules.length === 0) return null;

      return (
        <View style={stylesheet.scheduledContainer}>
          {schedules.map((s: { id: string; prompt: string; runAt: string }) => (
            <ScheduledMessageItem key={s.id} schedule={s} client={client} />
          ))}
        </View>
      );
    }, [agent.pendingSchedules, client]);

    const renderModel = useMemo<AgentStreamRenderModel>(() => {
      return {
        ...baseRenderModel,
        boundary: {
          ...baseRenderModel.boundary,
          historyToHeadGap: getGapBetween(
            baseRenderModel.history.at(-1) ?? null,
            baseRenderModel.segments.liveHead[0] ?? null,
          ),
        },
        auxiliary: {
          pendingPermissions: pendingPermissionsNode,
          workingIndicator: workingIndicatorNode,
          scheduledMessages: scheduledMessagesNode,
        },
      };
    }, [
      baseRenderModel,
      getGapBetween,
      pendingPermissionsNode,
      workingIndicatorNode,
      scheduledMessagesNode,
    ]);

    const emptyStateStyle = useMemo(() => [stylesheet.emptyState, stylesheet.contentWrapper], []);
    const listEmptyComponent = useMemo(() => {
      if (
        renderModel.boundary.hasVirtualizedHistory ||
        renderModel.boundary.hasMountedHistory ||
        renderModel.boundary.hasLiveHead ||
        renderModel.auxiliary.pendingPermissions ||
        renderModel.auxiliary.workingIndicator ||
        renderModel.auxiliary.scheduledMessages
      ) {
        return null;
      }

      return (
        <View style={emptyStateStyle}>
          <Text style={stylesheet.emptyStateText}>Start chatting with this agent...</Text>
        </View>
      );
    }, [renderModel, emptyStateStyle]);

    const historyItems = renderModel.history;
    const _liveHeadItems = renderModel.segments.liveHead;
    const { boundary, auxiliary } = renderModel;
    const lastHistoryItem = historyItems.at(-1) ?? null;

    const historyIndexById = useMemo(() => {
      const indexById = new Map<string, number>();
      historyItems.forEach((item, index) => {
        indexById.set(item.id, index);
      });
      return indexById;
    }, [historyItems]);

    const renderHistoryRow = useCallback(
      (item: StreamItem) => {
        const historyIndex = historyIndexById.get(item.id);
        if (historyIndex === undefined) {
          return null;
        }
        return renderStreamItem(item, historyIndex, historyItems);
      },
      [historyIndexById, historyItems, renderStreamItem],
    );

    const renderHistoryVirtualizedRow = useCallback<
      StreamSegmentRenderers["renderHistoryVirtualizedRow"]
    >((item) => renderHistoryRow(item), [renderHistoryRow]);
    const renderHistoryMountedRow = useCallback<StreamSegmentRenderers["renderHistoryMountedRow"]>(
      (item) => renderHistoryRow(item),
      [renderHistoryRow],
    );
    const renderLiveHeadRow = useCallback<StreamSegmentRenderers["renderLiveHeadRow"]>(
      (item, index, items) =>
        renderStreamItem(item, index, items, index === 0 ? lastHistoryItem : null, true),
      [lastHistoryItem, renderStreamItem],
    );
    const liveAuxiliaryHeaderStyle = useMemo(() => {
      let headerPadding: { paddingBottom: number } | { paddingTop: number } | null;
      if (!boundary.hasLiveHead) headerPadding = null;
      else if (streamRenderStrategy.getFlatListInverted())
        headerPadding = { paddingBottom: looseGap };
      else headerPadding = { paddingTop: looseGap };
      return [stylesheet.listHeaderContent, headerPadding];
    }, [boundary.hasLiveHead, streamRenderStrategy, looseGap]);
    const renderLiveAuxiliary = useCallback<StreamSegmentRenderers["renderLiveAuxiliary"]>(() => {
      if (
        !auxiliary.pendingPermissions &&
        !auxiliary.workingIndicator &&
        !auxiliary.scheduledMessages
      ) {
        return null;
      }
      return (
        <View style={stylesheet.contentWrapper}>
          <View style={liveAuxiliaryHeaderStyle}>
            {auxiliary.pendingPermissions}
            {auxiliary.scheduledMessages}
            {auxiliary.workingIndicator}
          </View>
        </View>
      );
    }, [
      auxiliary.pendingPermissions,
      auxiliary.workingIndicator,
      auxiliary.scheduledMessages,
      liveAuxiliaryHeaderStyle,
    ]);

    const renderers = useMemo<StreamSegmentRenderers>(
      () => ({
        renderHistoryVirtualizedRow,
        renderHistoryMountedRow,
        renderLiveHeadRow,
        renderLiveAuxiliary,
      }),
      [
        renderHistoryVirtualizedRow,
        renderHistoryMountedRow,
        renderLiveHeadRow,
        renderLiveAuxiliary,
      ],
    );

    const streamScrollEnabled =
      !streamRenderStrategy.shouldDisableParentScrollOnInlineDetailsExpansion() ||
      expandedInlineToolCallIds.size === 0;

    return (
      <ToolCallSheetProvider>
        <View style={stylesheet.container}>
          <MessageOuterSpacingProvider disableOuterSpacing>
            {streamRenderStrategy.render({
              agentId,
              segments: renderModel.segments,
              boundary,
              renderers,
              listEmptyComponent,
              viewportRef,
              routeBottomAnchorRequest,
              isAuthoritativeHistoryReady,
              onNearBottomChange: setIsNearBottom,
              scrollEnabled: streamScrollEnabled,
              listStyle: stylesheet.list,
              baseListContentContainerStyle: stylesheet.listContentContainer,
              forwardListContentContainerStyle: stylesheet.forwardListContentContainer,
            })}
          </MessageOuterSpacingProvider>
          {!isNearBottom && (
            <Animated.View
              style={stylesheet.scrollToBottomContainer}
              entering={scrollIndicatorFadeIn}
              exiting={scrollIndicatorFadeOut}
            >
              <View style={stylesheet.scrollToBottomInner}>
                <Pressable
                  style={stylesheet.scrollToBottomButton}
                  onPress={scrollToBottom}
                  accessibilityRole="button"
                  accessibilityLabel="Scroll to bottom"
                  testID="scroll-to-bottom-button"
                >
                  <ChevronDown size={24} color={stylesheet.scrollToBottomIcon.color} />
                </Pressable>
              </View>
            </Animated.View>
          )}
        </View>
      </ToolCallSheetProvider>
    );
  },
);

export const AgentStreamView = memo(AgentStreamViewComponent);
AgentStreamView.displayName = "AgentStreamView";

interface TimeMarkerProps {
  label: string;
}

const TimeMarker = memo(function TimeMarker({ label }: TimeMarkerProps) {
  return (
    <View style={stylesheet.timeMarkerRow}>
      <Text style={stylesheet.timeMarkerText}>{label}</Text>
    </View>
  );
});

// Sits inside the chat stream while the agent is mid-turn but hasn't emitted
// any timeline items yet — i.e. between user "send" and the first thought /
// assistant chunk arriving. Used to be three pulsing dots; now renders the
// Lissajous Drift parametric curve so the placeholder bubble has the same
// visual language as the rest of the loading indicators in the app
// (composer button spinner, ThinkingIconSlot inside thought badges).
function WorkingIndicator() {
  const { theme } = useUnistyles();
  return (
    <View style={stylesheet.workingIndicatorBubble}>
      <MathCurveLoader
        brandContext="thinking"
        curve="lissajous-drift"
        size={26}
        color={theme.colors.foregroundMuted}
      />
    </View>
  );
}

// Permission Request Card Component
type TurnContentStrategy = Parameters<
  typeof collectAssistantTurnContentForStreamRenderStrategy
>[0]["strategy"];

interface TurnCopyButtonSlotProps {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  startIndex: number;
}

function TurnCopyButtonSlot({ strategy, items, startIndex }: TurnCopyButtonSlotProps) {
  const getContent = useCallback(
    () =>
      collectAssistantTurnContentForStreamRenderStrategy({
        strategy,
        items,
        startIndex,
      }),
    [strategy, items, startIndex],
  );
  return <TurnCopyButton getContent={getContent} />;
}

interface ToolCallSlotProps extends Omit<
  ComponentProps<typeof ToolCall>,
  "onInlineDetailsExpandedChange"
> {
  itemId: string;
  onInlineDetailsExpandedChangeByItemId: (itemId: string, expanded: boolean) => void;
}

function ToolCallSlot({
  itemId,
  onInlineDetailsExpandedChangeByItemId,
  ...rest
}: ToolCallSlotProps) {
  const handleExpandedChange = useCallback(
    (expanded: boolean) => onInlineDetailsExpandedChangeByItemId(itemId, expanded),
    [onInlineDetailsExpandedChangeByItemId, itemId],
  );
  return <ToolCall {...rest} onInlineDetailsExpandedChange={handleExpandedChange} />;
}

interface PermissionActionButtonProps {
  action: AgentPermissionAction;
  isRespondingAction: boolean;
  isResponding: boolean;
  textColor: string;
  iconColor: string;
  isDanger: boolean;
  Icon: typeof Check;
  testID: string;
  theme: ReturnType<typeof useUnistyles>["theme"];
  onPress: (action: AgentPermissionAction) => void;
}

function ScheduledMessageItem({
  schedule,
  client,
}: {
  schedule: { id: string; prompt: string; runAt: string };
  client: DaemonClient | null;
}) {
  const { theme } = useUnistyles();
  const { t, i18n } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCancel = useCallback(async () => {
    if (!client || isDeleting) return;
    setIsDeleting(true);
    try {
      await client.deleteSchedule(schedule.id);
    } catch {
      // Toast error if needed, but the next snapshot should clear it if successful
    } finally {
      setIsDeleting(false);
    }
  }, [client, schedule.id, isDeleting]);

  const isZh = i18n.language.startsWith("zh");
  const timeLabel = format(new Date(schedule.runAt), isZh ? "M月d日 HH:mm" : "MMM d, HH:mm");

  const cancelButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      stylesheet.scheduledItemCancel,
      hovered && { backgroundColor: theme.colors.surface2 },
      pressed && { opacity: 0.7 },
    ],
    [theme.colors.surface2],
  );

  return (
    <Animated.View
      entering={FadeInUp.duration(200)}
      exiting={FadeOut.duration(200)}
      style={stylesheet.scheduledItem}
    >
      <View style={stylesheet.scheduledItemHeader}>
        <View style={stylesheet.scheduledItemTimeTag}>
          <Clock size={12} color={theme.colors.foreground} />
          <Text style={stylesheet.scheduledItemTimeText}>
            {t("composer.scheduledFor", { defaultValue: "Scheduled for", time: timeLabel })}{" "}
            {timeLabel}
          </Text>
        </View>
        <Pressable onPress={handleCancel} disabled={isDeleting} style={cancelButtonStyle}>
          {isDeleting ? (
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <Trash2 size={14} color={theme.colors.foregroundMuted} />
          )}
        </Pressable>
      </View>
      <Text style={stylesheet.scheduledItemText}>{schedule.prompt}</Text>
    </Animated.View>
  );
}

function PermissionActionButton({
  action,
  isRespondingAction,
  isResponding,
  textColor,
  iconColor,
  isDanger,
  Icon,
  testID,
  theme,
  onPress,
}: PermissionActionButtonProps) {
  const handlePress = useCallback(() => onPress(action), [onPress, action]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      permissionStyles.optionButton,
      {
        backgroundColor: hovered ? theme.colors.surface2 : theme.colors.surface1,
        borderColor: isDanger ? theme.colors.borderAccent : theme.colors.borderAccent,
      },
      pressed ? permissionStyles.optionButtonPressed : null,
    ],
    [theme.colors.surface2, theme.colors.surface1, theme.colors.borderAccent, isDanger],
  );
  const optionTextStyle = useMemo(
    () => [permissionStyles.optionText, { color: textColor }],
    [textColor],
  );
  return (
    <Pressable testID={testID} style={pressableStyle} onPress={handlePress} disabled={isResponding}>
      {isRespondingAction ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <View style={permissionStyles.optionContent}>
          <Icon size={14} color={iconColor} />
          <Text style={optionTextStyle}>{action.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function PermissionRequestCard({
  permission,
  client,
}: {
  permission: PendingPermission;
  client: DaemonClient | null;
}) {
  const { theme } = useUnistyles();
  const isMobile = useIsCompactFormFactor();

  const { request } = permission;
  const isPlanRequest = request.kind === "plan";
  const title = isPlanRequest ? "Plan" : (request.title ?? request.name ?? "Permission Required");
  const description = request.description ?? "";
  const resolvedToolCallDetail = useMemo(
    () =>
      request.detail ?? {
        type: "unknown" as const,
        input: request.input ?? null,
        output: null,
      },
    [request.detail, request.input],
  );
  const resolvedActions = useMemo((): AgentPermissionAction[] => {
    if (request.kind === "question") {
      return [];
    }
    if (Array.isArray(request.actions) && request.actions.length > 0) {
      return request.actions;
    }
    return [
      {
        id: "reject",
        label: "Deny",
        behavior: "deny",
        variant: "danger",
        intent: "dismiss",
      },
      {
        id: "accept",
        label: isPlanRequest ? "Implement" : "Accept",
        behavior: "allow",
        variant: "primary",
      },
    ];
  }, [isPlanRequest, request]);

  const planMarkdown = useMemo(() => {
    if (!request) {
      return undefined;
    }
    const planFromMetadata =
      typeof request.metadata?.planText === "string" ? request.metadata.planText : undefined;
    if (planFromMetadata) {
      return planFromMetadata;
    }
    const candidate = request.input?.["plan"];
    if (typeof candidate === "string") {
      return candidate;
    }
    return undefined;
  }, [request]);

  const permissionMutation = useMutation({
    mutationFn: async (input: {
      agentId: string;
      requestId: string;
      response: AgentPermissionResponse;
    }) => {
      if (!client) {
        throw new Error("Daemon client unavailable");
      }
      return client.respondToPermissionAndWait(
        input.agentId,
        input.requestId,
        input.response,
        15000,
      );
    },
  });
  const {
    reset: resetPermissionMutation,
    mutateAsync: respondToPermission,
    isPending: isResponding,
  } = permissionMutation;

  const [respondingActionId, setRespondingActionId] = useState<string | null>(null);

  useEffect(() => {
    resetPermissionMutation();
    setRespondingActionId(null);
  }, [permission.request.id, resetPermissionMutation]);
  const handleResponse = useCallback(
    (response: AgentPermissionResponse) => {
      respondToPermission({
        agentId: permission.agentId,
        requestId: permission.request.id,
        response,
      }).catch((error) => {
        console.error("[PermissionRequestCard] Failed to respond to permission:", error);
      });
    },
    [permission.agentId, permission.request.id, respondToPermission],
  );
  const handleActionPress = useCallback(
    (action: AgentPermissionAction) => {
      setRespondingActionId(action.id);
      if (action.behavior === "allow") {
        handleResponse({
          behavior: "allow",
          selectedActionId: action.id,
        });
        return;
      }
      handleResponse({
        behavior: "deny",
        selectedActionId: action.id,
        message: "Denied by user",
      });
    },
    [handleResponse],
  );

  const questionTextStyle = useMemo(
    () => [permissionStyles.question, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const optionsContainerStyle = useMemo(
    () => [
      permissionStyles.optionsContainer,
      !isMobile && permissionStyles.optionsContainerDesktop,
    ],
    [isMobile],
  );
  const cardContainerStyle = useMemo(
    () => [
      permissionStyles.container,
      {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
      },
    ],
    [theme.colors.surface1, theme.colors.border],
  );
  const cardTitleStyle = useMemo(
    () => [permissionStyles.title, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  const cardDescriptionStyle = useMemo(
    () => [permissionStyles.description, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );

  if (request.kind === "question") {
    return (
      <QuestionFormCard
        permission={permission}
        onRespond={handleResponse}
        isResponding={isResponding}
      />
    );
  }

  const footer = (
    <>
      <Text testID="permission-request-question" style={questionTextStyle}>
        How would you like to proceed?
      </Text>

      <View style={optionsContainerStyle}>
        {resolvedActions.map((action) => {
          const isDanger = action.variant === "danger" || action.behavior === "deny";
          const isPrimary = action.variant === "primary";
          const isRespondingAction = respondingActionId === action.id;
          const textColor = isPrimary ? theme.colors.foreground : theme.colors.foregroundMuted;
          const iconColor = textColor;
          const Icon = action.behavior === "allow" ? Check : X;
          let testID: string;
          if (action.behavior === "deny") testID = "permission-request-deny";
          else if (action.id === "accept" || action.id === "implement")
            testID = "permission-request-accept";
          else testID = `permission-request-action-${action.id}`;

          return (
            <PermissionActionButton
              key={action.id}
              action={action}
              isRespondingAction={isRespondingAction}
              isResponding={isResponding}
              textColor={textColor}
              iconColor={iconColor}
              isDanger={isDanger}
              Icon={Icon}
              testID={testID}
              theme={theme}
              onPress={handleActionPress}
            />
          );
        })}
      </View>
    </>
  );

  if (isPlanRequest && planMarkdown) {
    return (
      <PlanCard
        title={title}
        description={description}
        text={planMarkdown}
        footer={footer}
        disableOuterSpacing
      />
    );
  }

  return (
    <View style={cardContainerStyle}>
      <Text style={cardTitleStyle}>{title}</Text>

      {description ? <Text style={cardDescriptionStyle}>{description}</Text> : null}

      {planMarkdown ? (
        <PlanCard title="Proposed plan" text={planMarkdown} disableOuterSpacing />
      ) : null}

      {!isPlanRequest ? (
        <ToolCallDetailsContent detail={resolvedToolCallDetail} maxHeight={200} />
      ) : null}

      {footer}
    </View>
  );
}

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surfaceChat,
  },
  contentWrapper: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  listContentContainer: {
    paddingVertical: 0,
    flexGrow: 1,
    paddingHorizontal: {
      xs: theme.spacing[2],
      md: theme.spacing[4],
    },
  },
  forwardListContentContainer: {
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  list: {
    flex: 1,
  },
  streamItemWrapper: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  timeMarkerRow: {
    alignSelf: "center",
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  timeMarkerText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.bubbleMeta,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.2,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[12],
  },
  permissionsContainer: {
    gap: theme.spacing[2],
  },
  scheduledContainer: {
    gap: theme.spacing[2],
  },
  scheduledItem: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    opacity: 0.8,
  },
  scheduledItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  scheduledItemTimeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
  },
  scheduledItemTimeText: {
    fontSize: 11,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  scheduledItemCancel: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  scheduledItemText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  listHeaderContent: {
    gap: theme.spacing[3],
  },
  bottomBarWrapper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    marginTop: theme.spacing[4],
    paddingLeft: 3,
    paddingRight: 3,
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[2],
  },
  workingIndicatorBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.pill,
    backgroundColor: theme.colors.bubbleOther,
    borderWidth: 0,
    alignSelf: "flex-start",
  },
  syncingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[2],
  },
  syncingIndicatorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  invertedWrapper: {
    transform: [{ scaleY: -1 }],
    width: "100%",
  },
  emptyStateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  scrollToBottomContainer: {
    position: "absolute",
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: "center",
    pointerEvents: "box-none",
  },
  scrollToBottomInner: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    alignItems: "center",
  },
  scrollToBottomButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.sm,
  },
  scrollToBottomIcon: {
    color: theme.colors.foreground,
  },
}));

const permissionStyles = StyleSheet.create((theme) => ({
  container: {
    marginVertical: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.card,
    borderWidth: 1,
    gap: theme.spacing[2],
  },
  title: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  description: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
  },
  question: {
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  optionsContainer: {
    gap: theme.spacing[2],
  },
  optionsContainerDesktop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    width: "100%",
  },
  optionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    borderWidth: theme.borderWidth[1],
  },
  optionButtonPressed: {
    opacity: 0.9,
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  optionText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));

interface StreamItemWrapperProps {
  gapBelow: number;
  /**
   * When true, the wrapper plays a soft fade-up entrance on mount. Used for
   * live-head items so newly arrived messages "snap in" the way they do in
   * iMessage / WhatsApp. Always false for virtualized history rows so
   * scroll-induced remounts don't constantly re-animate.
   */
  animateEntrance?: boolean;
  children: ReactNode;
}

// Bubble entrance: 180ms fade + small upward translate. Calibrated to feel
// snappy without distracting during a streaming agent turn (where many items
// land in quick succession).
const BUBBLE_ENTRANCE_DURATION_MS = 180;

function StreamItemWrapper({ gapBelow, animateEntrance, children }: StreamItemWrapperProps) {
  const reducedMotion = useReducedMotion();
  const wrapperStyle = useMemo(
    () => [stylesheet.streamItemWrapper, { marginBottom: gapBelow }],
    [gapBelow],
  );
  if (animateEntrance && !reducedMotion) {
    return (
      <Animated.View style={wrapperStyle} entering={FadeInUp.duration(BUBBLE_ENTRANCE_DURATION_MS)}>
        {children}
      </Animated.View>
    );
  }
  return <View style={wrapperStyle}>{children}</View>;
}
