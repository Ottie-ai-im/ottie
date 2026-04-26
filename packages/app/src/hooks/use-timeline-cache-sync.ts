// Mirrors session-store.agentStreamTail to AsyncStorage, debounced per agent.
// Mount once at the app root. Read-side lives in use-agent-initialization.ts.

import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { scheduleSaveCachedTimeline } from "@/stores/timeline-cache-store";
import type { StreamItem } from "@/types/stream";

export function useTimelineCacheSync(): void {
  useEffect(() => {
    const seen = new Map<string, StreamItem[]>(); // key=`${serverId}:${agentId}` → last-seen ref

    const unsubscribe = useSessionStore.subscribe((state) => {
      for (const [serverId, session] of Object.entries(state.sessions)) {
        const tail = session?.agentStreamTail;
        if (!tail) continue;
        for (const [agentId, items] of tail) {
          const key = `${serverId}:${agentId}`;
          if (seen.get(key) === items) continue;
          seen.set(key, items);
          scheduleSaveCachedTimeline(serverId, agentId, items);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
