import { useEffect, useRef } from "react";
import {
  endAgentRunActivity,
  isLiveActivitySupported,
  startAgentRunActivity,
} from "@ottie/expo-live-activity";

import { isNative } from "@/constants/platform";
import { useSessionStore } from "@/stores/session-store";

// Drives the iOS Live Activity / Dynamic Island for the currently-running
// agent on this server. Lives at the session-context level — same scope as
// usePushTokenRegistration so it gets one instance per active server.
//
// v1 behavior:
//   - Watch `sessions[serverId].agents` and pick the most-recently-active
//     agent whose status is "running".
//   - When that agent flips to running → start an Activity.
//   - When it leaves running → end the Activity (status from the final
//     lifecycle: completed / error / dismissed).
//   - When the focus shifts to a different running agent → end the old
//     activity and start a new one. v1 surfaces ONE activity at a time;
//     iOS supports more but the UX of multiple concurrent "agent running"
//     pills competes for the Dynamic Island and confuses the user.
//   - tool-call-name stays null in v1. v1.1 fills it from timeline events.
//
// Non-iOS / iOS < 16.1 / Live Activities disabled in Settings: every call
// is a silent no-op courtesy of the native module's optional bindings.

interface LiveActivityState {
  agentId: string | null;
  activityId: string | null;
  startedAt: string | null;
}

interface AgentSnapshot {
  id: string;
  title: string | null;
  provider: string;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  lastActivityAtMs: number;
}

export function useLiveActivityTracker(params: { serverId: string }): void {
  const { serverId } = params;
  const stateRef = useRef<LiveActivityState>({
    agentId: null,
    activityId: null,
    startedAt: null,
  });
  const supportedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    void (async () => {
      const ok = await isLiveActivitySupported();
      if (!cancelled) supportedRef.current = ok;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isNative) return;

    let cancelled = false;

    const sync = async (current: AgentSnapshot | null): Promise<void> => {
      if (cancelled) return;
      if (supportedRef.current === false) return;

      const prev = stateRef.current;

      // Same agent still running: nothing to do until v1.1 adds tool-call updates.
      if (current && prev.agentId === current.id && prev.activityId) return;

      // Transition out (no current running agent OR a different agent took over).
      if (prev.activityId && prev.agentId !== current?.id) {
        const finalStatus: "completed" | "error" = "completed";
        const startedAt = prev.startedAt ?? new Date().toISOString();
        await endAgentRunActivity({
          activityId: prev.activityId,
          finalState: { startedAt, status: finalStatus, toolCall: null },
          // Keep the "completed" pill on screen briefly so the user sees
          // the result before iOS clears it. Capped at ~4s by the system.
          dismissAfterMs: 3000,
        });
        stateRef.current = { agentId: null, activityId: null, startedAt: null };
      }

      // Transition in (no previous, but a current running agent exists).
      if (current && stateRef.current.activityId === null) {
        const startedAt = new Date().toISOString();
        const activityId = await startAgentRunActivity({
          agentLabel: current.title?.trim() || `Agent ${current.id.slice(0, 6)}`,
          providerLabel: current.provider,
          startedAt,
          status: "running",
          toolCall: null,
        });
        if (cancelled) {
          // Tracker tore down between request and resolve; clean up.
          if (activityId) {
            await endAgentRunActivity({ activityId, dismissAfterMs: 0 });
          }
          return;
        }
        if (activityId) {
          stateRef.current = { agentId: current.id, activityId, startedAt };
        }
      }
    };

    const unsubscribe = useSessionStore.subscribe((state, prevState) => {
      const session = state.sessions[serverId];
      const prevSession = prevState.sessions[serverId];
      if (session === prevSession) return;
      const next = pickMostRecentRunningAgent(state, serverId);
      void sync(next);
    });

    // Prime once on mount so we don't miss the case where an agent was
    // already running before this hook attached.
    void sync(pickMostRecentRunningAgent(useSessionStore.getState(), serverId));

    return () => {
      cancelled = true;
      unsubscribe();
      const tracked = stateRef.current.activityId;
      if (tracked) {
        // Best-effort tear-down. The await is fire-and-forget — React 18
        // strict mode will mount us a second time anyway, so we accept
        // that the activity may briefly persist past the hook's lifetime.
        void endAgentRunActivity({ activityId: tracked, dismissAfterMs: 0 });
        stateRef.current = { agentId: null, activityId: null, startedAt: null };
      }
    };
  }, [serverId]);
}

function pickMostRecentRunningAgent(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
): AgentSnapshot | null {
  const session = state.sessions[serverId];
  if (!session) return null;
  let best: AgentSnapshot | null = null;
  for (const agent of session.agents.values()) {
    if (agent.status !== "running") continue;
    const lastActivityAtMs = agent.lastActivityAt.getTime();
    if (!best || lastActivityAtMs > best.lastActivityAtMs) {
      best = {
        id: agent.id,
        title: agent.title,
        provider: agent.provider,
        status: agent.status,
        lastActivityAtMs,
      };
    }
  }
  return best;
}
