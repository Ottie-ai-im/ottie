import { useEffect, useMemo } from "react";
import { usePathname } from "expo-router";
import { useShallow } from "zustand/shallow";
import { setVoiceCommandBridge } from "@/voice-control/voice-command-bridge";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useNavigationActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceTabsStore,
} from "@/stores/workspace-tabs-store";
import {
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import { generateMessageId } from "@/types/stream";
import { useAppSettings } from "@/hooks/use-settings";

interface ActiveTarget {
  serverId: string;
  agentId: string;
}

/**
 * Bridges React state (route, focused tab, daemon client) into the voice
 * controller's command handlers.
 *
 * Pattern reference: realtime-voice-component README §3 — "create a small
 * app-owned voice wrapper" with `getState() / setPrompt() / sendToast()`
 * style methods. Same shape here, but the methods are voice-relevant
 * actions (send / interrupt) and the state lives in Zustand stores.
 *
 * Mounting strategy:
 *   - Mount once at the app root (in _layout.tsx).
 *   - Self-gates on `betaFeatures.voiceControl.enabled` — when off, the
 *     bridge stays at its noop default so commands fail with a clear
 *     "bridge not mounted" message instead of silently working.
 *   - Re-binds whenever the resolved active agent or daemon client changes.
 *     Cleans up on unmount so React strict-mode remounts don't leak stale
 *     bridges.
 */
export function VoiceCommandBridgeProvider() {
  const { settings } = useAppSettings();
  const enabled = settings.betaFeatures.voiceControl.enabled;

  const pathname = usePathname();
  const navSelection = useNavigationActiveWorkspaceSelection();

  // Subscribe to the slice of workspace-tabs needed for active-agent
  // resolution. useShallow stabilizes the tuple so the resolver memo only
  // recomputes when actual values change.
  const { focusedTabIdByWorkspace, uiTabsByWorkspace } = useWorkspaceTabsStore(
    useShallow((s) => ({
      focusedTabIdByWorkspace: s.focusedTabIdByWorkspace,
      uiTabsByWorkspace: s.uiTabsByWorkspace,
    })),
  );

  const resolved = useMemo<ActiveTarget | null>(() => {
    // Direct agent route is unambiguous → use it.
    const direct = parseHostAgentRouteFromPathname(pathname);
    if (direct) return direct;

    // Else try to resolve via workspace + focused tab.
    const wsRoute =
      parseHostWorkspaceRouteFromPathname(pathname) ??
      (navSelection
        ? { serverId: navSelection.serverId, workspaceId: navSelection.workspaceId }
        : null);
    if (!wsRoute) return null;

    const persistKey = buildWorkspaceTabPersistenceKey(wsRoute);
    if (!persistKey) return null;
    const focusedTabId = focusedTabIdByWorkspace[persistKey];
    if (!focusedTabId) return null;
    const tabs = uiTabsByWorkspace[persistKey];
    const focusedTab = tabs?.find((tab) => tab.tabId === focusedTabId);
    if (!focusedTab || focusedTab.target.kind !== "agent") return null;

    return { serverId: wsRoute.serverId, agentId: focusedTab.target.agentId };
  }, [pathname, navSelection, focusedTabIdByWorkspace, uiTabsByWorkspace]);

  const client = useHostRuntimeClient(resolved?.serverId ?? "");

  useEffect(() => {
    if (!enabled) {
      setVoiceCommandBridge(null);
      return;
    }
    setVoiceCommandBridge({
      async sendToActiveAgent(text) {
        if (!resolved) return { ok: false, message: "No active agent" };
        if (!client) return { ok: false, message: "Daemon not connected" };
        const trimmed = text.trim();
        if (!trimmed) return { ok: false, message: "Empty message" };
        try {
          await client.sendAgentMessage(resolved.agentId, trimmed, {
            messageId: generateMessageId(),
            images: [],
            attachments: [],
          });
          // Truncate quote in the operator log so a long voice utterance
          // doesn't blow out the floating pill.
          const preview = trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
          return { ok: true, message: `Sent: "${preview}"` };
        } catch (err) {
          return {
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          };
        }
      },
      async interruptActiveAgent() {
        if (!resolved) return { ok: false, message: "No active agent" };
        if (!client) return { ok: false, message: "Daemon not connected" };
        try {
          await client.cancelAgent(resolved.agentId);
          return { ok: true, message: "Interrupted active agent" };
        } catch (err) {
          return {
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          };
        }
      },
      describeActiveTarget() {
        if (!resolved) return null;
        return `${resolved.serverId}/${resolved.agentId}`;
      },
    });
    return () => setVoiceCommandBridge(null);
  }, [enabled, resolved, client]);

  return null;
}
