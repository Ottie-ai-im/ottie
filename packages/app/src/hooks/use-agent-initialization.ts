import { useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import type { DaemonClient } from "@server/client/daemon-client";
import {
  attachInitTimeout,
  createInitDeferred,
  getInitDeferred,
  getInitKey,
  rejectInitDeferred,
} from "@/utils/agent-initialization";
import { deriveInitialTimelineRequest } from "@/contexts/session-timeline-bootstrap-policy";
import { isWeb } from "@/constants/platform";
import { loadCachedCursor, loadCachedTimeline } from "@/stores/timeline-cache-store";
import type { AgentTimelineCursorState } from "@/stores/session-store";
import type { CachedTimelineCursor } from "@/stores/timeline-cache-store-shared";
import type { StreamItem } from "@/types/stream";

const INIT_TIMEOUT_MS = 5 * 60_000;
const NATIVE_INITIAL_TIMELINE_LIMIT = 200;
const UNBOUNDED_TIMELINE_LIMIT = 0;

interface ColdStartCatchupOptions {
  serverId: string;
  agentId: string;
  client: DaemonClient | null;
  provisionalCursor: AgentTimelineCursorState | null;
  initialTimelineLimit: number;
  onResolveFailure: (err: Error) => void;
}

async function runColdStartCatchup(opts: ColdStartCatchupOptions): Promise<void> {
  const { serverId, agentId } = opts;
  const sessionAtStart = useSessionStore.getState().sessions[serverId];

  await Promise.all([
    restoreCachedTail(
      serverId,
      agentId,
      sessionAtStart?.agentStreamTail?.get(agentId)?.length ?? 0,
    ),
    restoreCachedCursor(serverId, agentId, opts.provisionalCursor),
  ]);

  if (!opts.client) {
    opts.onResolveFailure(new Error("Host is not connected"));
    return;
  }

  // Re-derive after caches landed: a cached cursor would now switch us
  // from tail → after so the daemon only sends what's new.
  const session = useSessionStore.getState().sessions[serverId];
  const cursor = session?.agentTimelineCursor.get(agentId);
  const finalRequest = deriveInitialTimelineRequest({
    cursor: cursor ? { epoch: cursor.epoch, seq: cursor.endSeq } : null,
    hasAuthoritativeHistory: session?.agentAuthoritativeHistoryApplied.get(agentId) === true,
    initialTimelineLimit: opts.initialTimelineLimit,
  });

  opts.client.fetchAgentTimeline(agentId, finalRequest).catch((error) => {
    opts.onResolveFailure(error instanceof Error ? error : new Error(String(error)));
  });
}

async function restoreCachedTail(
  serverId: string,
  agentId: string,
  inMemoryTailLength: number,
): Promise<void> {
  if (inMemoryTailLength > 0) return;
  const cached = await loadCachedTimeline(serverId, agentId);
  if (!cached || cached.length === 0) return;
  const store = useSessionStore.getState();
  const tailNow = store.sessions[serverId]?.agentStreamTail?.get(agentId);
  if (tailNow && tailNow.length > 0) return;
  store.setAgentStreamTail(serverId, (prev) => mergeTail(prev, agentId, cached));
}

async function restoreCachedCursor(
  serverId: string,
  agentId: string,
  provisional: AgentTimelineCursorState | null,
): Promise<void> {
  if (provisional) return; // in-memory wins
  const cached = await loadCachedCursor(serverId, agentId);
  if (!cached) return;
  const store = useSessionStore.getState();
  const cursorNow = store.sessions[serverId]?.agentTimelineCursor.get(agentId);
  if (cursorNow) return;
  store.setAgentTimelineCursor(serverId, (prev) => mergeCursor(prev, agentId, cached));
}

function mergeTail(
  prev: Map<string, StreamItem[]>,
  agentId: string,
  cached: StreamItem[],
): Map<string, StreamItem[]> {
  const existing = prev.get(agentId);
  if (existing && existing.length > 0) {
    return prev;
  }
  const next = new Map(prev);
  next.set(agentId, cached);
  return next;
}

function mergeCursor(
  prev: Map<string, AgentTimelineCursorState>,
  agentId: string,
  cached: CachedTimelineCursor,
): Map<string, AgentTimelineCursorState> {
  if (prev.get(agentId)) {
    return prev;
  }
  const next = new Map(prev);
  next.set(agentId, cached);
  return next;
}

function resolveInitialTimelineLimit(): number {
  return isWeb ? UNBOUNDED_TIMELINE_LIMIT : NATIVE_INITIAL_TIMELINE_LIMIT;
}

export const __private__ = {
  deriveInitialTimelineRequest,
  resolveInitialTimelineLimit,
};

export function useAgentInitialization({
  serverId,
  client,
}: {
  serverId: string;
  client: DaemonClient | null;
}) {
  const setInitializingAgents = useSessionStore((state) => state.setInitializingAgents);
  const setAgentInitializing = useCallback(
    (agentId: string, initializing: boolean) => {
      setInitializingAgents(serverId, (prev) => {
        if (prev.get(agentId) === initializing) {
          return prev;
        }
        const next = new Map(prev);
        next.set(agentId, initializing);
        return next;
      });
    },
    [serverId, setInitializingAgents],
  );

  const ensureAgentIsInitialized = useCallback(
    (agentId: string): Promise<void> => {
      const key = getInitKey(serverId, agentId);
      const existing = getInitDeferred(key);
      if (existing) {
        return existing.promise;
      }

      // Provisional request — built from whatever we know in-memory right now.
      // We may rebuild it below once the cached cursor has loaded so the very
      // first init after a cold start uses `direction: "after"` instead of
      // re-fetching the entire timeline from seq=1.
      const initialSession = useSessionStore.getState().sessions[serverId];
      const provisionalCursor = initialSession?.agentTimelineCursor.get(agentId);
      const initialTimelineLimit = resolveInitialTimelineLimit();
      const hasAuthoritativeHistory =
        initialSession?.agentAuthoritativeHistoryApplied.get(agentId) === true;
      const provisionalRequest = deriveInitialTimelineRequest({
        cursor: provisionalCursor
          ? { epoch: provisionalCursor.epoch, seq: provisionalCursor.endSeq }
          : null,
        hasAuthoritativeHistory,
        initialTimelineLimit,
      });
      const initRequestDirection = provisionalRequest.direction === "after" ? "after" : "tail";

      const deferred = createInitDeferred(key, initRequestDirection);
      const timeoutId = setTimeout(() => {
        setAgentInitializing(agentId, false);
        rejectInitDeferred(
          key,
          new Error(`History sync timed out after ${Math.round(INIT_TIMEOUT_MS / 1000)}s`),
        );
      }, INIT_TIMEOUT_MS);
      attachInitTimeout(key, timeoutId);

      setAgentInitializing(agentId, true);

      // Cold-start path: in parallel, load the cached message tail and the
      // cached cursor, then issue the WS fetch — using the cached cursor if
      // we didn't already have one in memory, so the daemon only replays
      // the rows we don't have yet.
      void runColdStartCatchup({
        serverId,
        agentId,
        client,
        provisionalCursor: provisionalCursor ?? null,
        initialTimelineLimit,
        onResolveFailure: (err) => {
          setAgentInitializing(agentId, false);
          rejectInitDeferred(key, err);
        },
      });

      return deferred.promise;
    },
    [client, serverId, setAgentInitializing],
  );

  const refreshAgent = useCallback(
    async (agentId: string) => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      setAgentInitializing(agentId, true);

      try {
        await client.refreshAgent(agentId);
        const initialTimelineLimit = resolveInitialTimelineLimit();
        await client.fetchAgentTimeline(agentId, {
          direction: "tail",
          limit: initialTimelineLimit,
          projection: "canonical",
        });
      } catch (error) {
        setAgentInitializing(agentId, false);
        throw error;
      }
    },
    [client, setAgentInitializing],
  );

  return { ensureAgentIsInitialized, refreshAgent };
}
