// Cross-platform helpers for the per-(serverId, agentId) local message cache.
//
// The actual storage backend differs per platform (expo-sqlite on native,
// IndexedDB on web). Both implementations share the wire format and the
// debouncer below so the public API stays identical: `loadCachedTimeline`,
// `saveCachedTimeline`, `clearCachedTimeline`, `scheduleSaveCachedTimeline`.
//
// We deliberately do NOT cap the cache: per the IM-style redesign the local
// store is the user-facing source of truth on cold start, so trimming
// silently would re-introduce the "old messages disappeared" bug we're
// trying to fix. Both backends scale comfortably to 10k+ rows per agent.

import type { StreamItem } from "@/types/stream";

export interface PersistedItem {
  // Stream item with timestamp serialized as ISO string. All other fields
  // pass through unchanged because the StreamItem union is plain-object only
  // (verified in types/stream.ts).
  [key: string]: unknown;
}

export function serializeItems(items: StreamItem[]): PersistedItem[] {
  return items.map((item) => {
    const timestamp =
      item.timestamp instanceof Date ? item.timestamp.toISOString() : item.timestamp;
    return { ...(item as object), timestamp } as PersistedItem;
  });
}

export function deserializeItems(raw: unknown): StreamItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StreamItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.kind !== "string" || typeof obj.id !== "string") continue;
    const ts = obj.timestamp;
    let timestamp: Date;
    if (ts instanceof Date) {
      timestamp = ts;
    } else if (typeof ts === "string" || typeof ts === "number") {
      const parsed = new Date(ts);
      if (Number.isNaN(parsed.getTime())) continue;
      timestamp = parsed;
    } else {
      continue;
    }
    out.push({ ...(obj as object), timestamp } as StreamItem);
  }
  return out;
}

/**
 * Debounce save calls per (serverId, agentId) — one pending write each, the
 * latest input wins. Both native and web backends use this same scheduler so
 * the throttling behavior is identical.
 */
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface ScheduleSaveOptions {
  debounceMs?: number;
  /** Backend-supplied save function. */
  save: (serverId: string, agentId: string, items: StreamItem[]) => Promise<void>;
}

export function scheduleSaveWithDebounce(
  serverId: string,
  agentId: string,
  items: StreamItem[],
  options: ScheduleSaveOptions,
): void {
  if (!serverId || !agentId) return;
  const key = `${serverId.trim()}::${agentId.trim()}`;
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    void options.save(serverId, agentId, items);
  }, options.debounceMs ?? 500);
  pendingTimers.set(key, timer);
}

/** Per-agent metadata persisted alongside messages (cursor for incremental fetch). */
export interface CachedTimelineCursor {
  epoch: string;
  /** Highest seq seen locally for this agent — sent as `cursor.seq` on next fetch_agent_timeline_request. */
  endSeq: number;
  /** Lowest seq seen locally — useful for "load older" prefetch. */
  startSeq: number;
}
