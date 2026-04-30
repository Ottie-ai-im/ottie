// Web backend for the per-(serverId, agentId) timeline cache. Uses IndexedDB
// directly (no Dexie) to avoid an extra dep. Two object stores:
//
//   messages: keyPath = compoundKey(serverId, agentId, itemId)
//             index "by-agent" on (serverId, agentId, position)
//   agents:   keyPath = compoundKey(serverId, agentId)
//             holds { epoch, startSeq, endSeq, updatedAt } per agent
//
// `position` is a monotonic write counter so we can return rows in
// insertion order. The seq cursor used to drive `fetch_agent_timeline`
// catch-up lives separately in the `agents` store.
//
// Falls back to a no-op cache if `indexedDB` is unavailable (Node tests,
// SSR, blocked by browser).

import type { StreamItem } from "@/types/stream";
import {
  type CachedTimelineCursor,
  deserializeItems,
  scheduleSaveWithDebounce,
  serializeItems,
} from "./timeline-cache-store-shared";

const DB_NAME = "ottie-timeline-cache";
const DB_VERSION = 1;
const STORE_MESSAGES = "messages";
const STORE_AGENTS = "agents";

interface MessageRecord {
  key: string; // serverId|agentId|itemId
  serverId: string;
  agentId: string;
  itemId: string;
  position: number;
  itemJson: string;
}

interface AgentRecord {
  key: string; // serverId|agentId
  serverId: string;
  agentId: string;
  epoch: string;
  startSeq: number;
  endSeq: number;
  updatedAt: string;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function compoundKey(...parts: string[]): string {
  return parts.map((p) => p.replace(/\|/g, "\\|")).join("|");
}

function attach<T>(
  req: IDBRequest<T>,
  resolve: (v: T) => void,
  reject: (e: unknown) => void,
): void {
  req.addEventListener("success", () => resolve(req.result));
  req.addEventListener("error", () => reject(req.error ?? new Error("idb request failed")));
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.addEventListener("upgradeneeded", () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          const messages = db.createObjectStore(STORE_MESSAGES, { keyPath: "key" });
          messages.createIndex("by-agent", ["serverId", "agentId", "position"]);
        }
        if (!db.objectStoreNames.contains(STORE_AGENTS)) {
          db.createObjectStore(STORE_AGENTS, { keyPath: "key" });
        }
      });
      attach(req, resolve, reject);
    });
  }
  return dbPromise;
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    attach(req, resolve, reject);
  });
}

function txAsPromise(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.addEventListener("complete", () => resolve());
    tx.addEventListener("abort", () => reject(tx.error ?? new Error("idb tx aborted")));
    tx.addEventListener("error", () => reject(tx.error ?? new Error("idb tx error")));
  });
}

function rangeForAgent(serverId: string, agentId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [serverId, agentId, Number.NEGATIVE_INFINITY],
    [serverId, agentId, Number.POSITIVE_INFINITY],
  );
}

/**
 * Iterate the `by-agent` index in the given transaction, deleting every key
 * that falls inside the (serverId, agentId, *) range. Resolves once the
 * cursor walk completes — the surrounding transaction stays open the whole
 * time so callers can chain more work without races.
 */
function deleteAgentRows(
  tx: IDBTransaction,
  store: IDBObjectStore,
  serverId: string,
  agentId: string,
): Promise<void> {
  void tx; // tx kept in signature for self-documentation.
  return new Promise<void>((resolve, reject) => {
    const cursorReq = store.index("by-agent").openKeyCursor(rangeForAgent(serverId, agentId));
    const onSuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    cursorReq.addEventListener("success", onSuccess);
    cursorReq.addEventListener("error", () =>
      reject(cursorReq.error ?? new Error("delete cursor failed")),
    );
  });
}

export async function loadCachedTimeline(
  serverId: string,
  agentId: string,
): Promise<StreamItem[] | null> {
  if (!serverId || !agentId || !hasIndexedDb()) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MESSAGES, "readonly");
    const store = tx.objectStore(STORE_MESSAGES);
    const records = await reqAsPromise(
      store.index("by-agent").getAll(rangeForAgent(serverId, agentId)),
    );
    if (!records || records.length === 0) return null;
    records.sort((a, b) => a.position - b.position);
    const parsed: unknown[] = [];
    for (const rec of records as MessageRecord[]) {
      try {
        parsed.push(JSON.parse(rec.itemJson));
      } catch {
        // Drop corrupted rows individually.
      }
    }
    return deserializeItems(parsed);
  } catch (error) {
    console.warn("[TimelineCache/web] load failed", error);
    return null;
  }
}

export async function saveCachedTimeline(
  serverId: string,
  agentId: string,
  items: StreamItem[],
): Promise<void> {
  if (!serverId || !agentId || !hasIndexedDb()) return;
  try {
    const db = await openDb();
    const serialized = serializeItems(items);
    const tx = db.transaction(STORE_MESSAGES, "readwrite");
    const store = tx.objectStore(STORE_MESSAGES);

    await deleteAgentRows(tx, store, serverId, agentId);

    // Re-insert with monotonic positions matching array order. We don't
    // await each put — better-sqlite3-style we let them queue inside the
    // single transaction and txAsPromise resolves once the whole thing
    // commits.
    let position = 0;
    for (const obj of serialized) {
      const itemId = typeof obj.id === "string" ? obj.id : `pos:${position}`;
      position += 1;
      const record: MessageRecord = {
        key: compoundKey(serverId, agentId, itemId),
        serverId,
        agentId,
        itemId,
        position,
        itemJson: JSON.stringify(obj),
      };
      store.put(record);
    }

    await txAsPromise(tx);
  } catch (error) {
    console.warn("[TimelineCache/web] save failed", error);
  }
}

export async function clearCachedTimeline(serverId: string, agentId: string): Promise<void> {
  if (!serverId || !agentId || !hasIndexedDb()) return;
  try {
    const db = await openDb();
    const tx = db.transaction([STORE_MESSAGES, STORE_AGENTS], "readwrite");
    await deleteAgentRows(tx, tx.objectStore(STORE_MESSAGES), serverId, agentId);
    tx.objectStore(STORE_AGENTS).delete(compoundKey(serverId, agentId));
    await txAsPromise(tx);
  } catch (error) {
    console.warn("[TimelineCache/web] clear failed", error);
  }
}

export function scheduleSaveCachedTimeline(
  serverId: string,
  agentId: string,
  items: StreamItem[],
  debounceMs?: number,
): void {
  scheduleSaveWithDebounce(serverId, agentId, items, {
    debounceMs,
    save: saveCachedTimeline,
  });
}

export async function loadCachedCursor(
  serverId: string,
  agentId: string,
): Promise<CachedTimelineCursor | null> {
  if (!serverId || !agentId || !hasIndexedDb()) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_AGENTS, "readonly");
    const store = tx.objectStore(STORE_AGENTS);
    const record = (await reqAsPromise(store.get(compoundKey(serverId, agentId)))) as
      | AgentRecord
      | undefined;
    if (!record) return null;
    return { epoch: record.epoch, startSeq: record.startSeq, endSeq: record.endSeq };
  } catch (error) {
    console.warn("[TimelineCache/web] loadCursor failed", error);
    return null;
  }
}

export async function saveCachedCursor(
  serverId: string,
  agentId: string,
  cursor: CachedTimelineCursor,
): Promise<void> {
  if (!serverId || !agentId || !hasIndexedDb()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_AGENTS, "readwrite");
    const store = tx.objectStore(STORE_AGENTS);
    const record: AgentRecord = {
      key: compoundKey(serverId, agentId),
      serverId,
      agentId,
      epoch: cursor.epoch,
      startSeq: cursor.startSeq,
      endSeq: cursor.endSeq,
      updatedAt: new Date().toISOString(),
    };
    store.put(record);
    await txAsPromise(tx);
  } catch (error) {
    console.warn("[TimelineCache/web] saveCursor failed", error);
  }
}
