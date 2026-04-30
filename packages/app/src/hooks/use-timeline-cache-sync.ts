// Mirrors session-store.agentStreamTail and agentTimelineCursor to local
// storage (SQLite on native, IndexedDB on web), debounced per agent. Mount
// once at the app root. Read-side lives in use-agent-initialization.ts.
//
// We also persist the cursor so cold-start can issue
// fetch_agent_timeline_request(direction:"after") with an accurate
// since-cursor — without it, the daemon would replay every message every
// time the app opens (full timeline on every reconnect = slow + wasteful).

import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { saveCachedCursor, scheduleSaveCachedTimeline } from "@/stores/timeline-cache-store";
import type { StreamItem } from "@/types/stream";

export function useTimelineCacheSync(): void {
  useEffect(() => {
    // last-saved snapshot per (serverId, agentId) so we don't write on
    // every store update — only when the value actually changed.
    const lastTail = new Map<string, StreamItem[]>();
    const lastCursor = new Map<string, string>();

    const unsubscribe = useSessionStore.subscribe((state) => {
      for (const [serverId, session] of Object.entries(state.sessions)) {
        if (!session) continue;

        const tail = session.agentStreamTail;
        if (tail) {
          for (const [agentId, items] of tail) {
            const key = `${serverId}:${agentId}`;
            if (lastTail.get(key) === items) continue;
            lastTail.set(key, items);
            scheduleSaveCachedTimeline(serverId, agentId, items);
          }
        }

        const cursors = session.agentTimelineCursor;
        if (cursors) {
          for (const [agentId, cursor] of cursors) {
            const key = `${serverId}:${agentId}`;
            // Stringify-compare keeps the watch shallow without allocating
            // per-tick — cursor objects are tiny.
            const fingerprint = `${cursor.epoch}|${cursor.startSeq}|${cursor.endSeq}`;
            if (lastCursor.get(key) === fingerprint) continue;
            lastCursor.set(key, fingerprint);
            void saveCachedCursor(serverId, agentId, cursor);
          }
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
