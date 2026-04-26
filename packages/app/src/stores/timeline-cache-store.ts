// Per-(serverId, agentId) cache of the rendered StreamItem[] tail. Persisted
// to AsyncStorage so cold-start can render last-seen messages immediately
// before the daemon WebSocket reconnects and `fetch_agent_timeline` returns.
//
// Companion to packages/server/src/server/agent/durable-agent-timeline-store.ts:
//   - Server: append-only JSONL, source of truth.
//   - Client: this cache, ephemeral best-effort copy. On reconnect we still
//     fetch_agent_timeline; the cache only fills the gap during the round trip.
//
// Stored shape uses ISO strings for timestamps to survive JSON roundtrip.
//
// Capacity: we cap each agent at 200 cached items to keep AsyncStorage
// payloads small. The full timeline is always re-fetchable from the daemon.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StreamItem } from "@/types/stream";

const STORAGE_PREFIX = "@ottie:timeline-cache:";
const MAX_ROWS_PER_AGENT = 200;

function buildKey(serverId: string, agentId: string): string {
  return `${STORAGE_PREFIX}${serverId.trim()}:${agentId.trim()}`;
}

interface PersistedItem {
  // Stream item with timestamp serialized as ISO string.
  // Other Date-typed fields inside the union (none today) would need handling here too.
  [key: string]: unknown;
}

function serializeItems(items: StreamItem[]): PersistedItem[] {
  return items.map((item) => {
    // Only timestamp is a Date today across the union (see types/stream.ts).
    const timestamp =
      item.timestamp instanceof Date ? item.timestamp.toISOString() : item.timestamp;
    return { ...(item as object), timestamp } as PersistedItem;
  });
}

function deserializeItems(raw: unknown): StreamItem[] | null {
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

export async function loadCachedTimeline(
  serverId: string,
  agentId: string,
): Promise<StreamItem[] | null> {
  if (!serverId || !agentId) return null;
  try {
    const raw = await AsyncStorage.getItem(buildKey(serverId, agentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return deserializeItems(parsed);
  } catch (error) {
    console.warn("[TimelineCache] Failed to load cached timeline", error);
    return null;
  }
}

export async function saveCachedTimeline(
  serverId: string,
  agentId: string,
  items: StreamItem[],
): Promise<void> {
  if (!serverId || !agentId) return;
  try {
    // Trim to the last MAX_ROWS_PER_AGENT to bound storage.
    const trimmed = items.length > MAX_ROWS_PER_AGENT ? items.slice(-MAX_ROWS_PER_AGENT) : items;
    const payload = JSON.stringify(serializeItems(trimmed));
    await AsyncStorage.setItem(buildKey(serverId, agentId), payload);
  } catch (error) {
    console.warn("[TimelineCache] Failed to persist timeline", error);
  }
}

export async function clearCachedTimeline(serverId: string, agentId: string): Promise<void> {
  if (!serverId || !agentId) return;
  try {
    await AsyncStorage.removeItem(buildKey(serverId, agentId));
  } catch (error) {
    console.warn("[TimelineCache] Failed to clear timeline", error);
  }
}

/**
 * Debounced writer used to throttle persistence while a stream is rapidly
 * mutating (typing, deltas). One pending write per (serverId, agentId).
 */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleSaveCachedTimeline(
  serverId: string,
  agentId: string,
  items: StreamItem[],
  debounceMs = 500,
): void {
  if (!serverId || !agentId) return;
  const key = buildKey(serverId, agentId);
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pending.delete(key);
    void saveCachedTimeline(serverId, agentId, items);
  }, debounceMs);
  pending.set(key, timer);
}
