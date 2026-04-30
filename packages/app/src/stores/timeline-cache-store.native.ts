// Native (iOS / Android) backend for the per-(serverId, agentId) timeline
// cache. Uses expo-sqlite — one DB per app, two tables:
//
//   messages(server_id, agent_id, item_id, position, item_json,
//            PRIMARY KEY (server_id, agent_id, item_id))
//   agents(server_id, agent_id, epoch, end_seq, start_seq,
//          PRIMARY KEY (server_id, agent_id))
//
// `position` is a monotonic write counter so we can return rows in insertion
// order without depending on any seq field (some StreamItem variants don't
// carry one). The seq cursor for catch-up lives separately in `agents`.
//
// API surface mirrors the legacy AsyncStorage cache exactly so callers
// (use-timeline-cache-sync, use-agent-initialization) don't change.
//
// Failure posture: every public function logs and swallows errors. Losing
// the cache is annoying but never blocks the user — fetch_agent_timeline
// from the daemon repopulates it on the next reconnect.

import * as SQLite from "expo-sqlite";
import type { StreamItem } from "@/types/stream";
import {
  type CachedTimelineCursor,
  deserializeItems,
  scheduleSaveWithDebounce,
  serializeItems,
} from "./timeline-cache-store-shared";

const DB_NAME = "ottie-timeline-cache.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS messages (
          server_id TEXT NOT NULL,
          agent_id  TEXT NOT NULL,
          item_id   TEXT NOT NULL,
          position  INTEGER NOT NULL,
          item_json TEXT NOT NULL,
          PRIMARY KEY (server_id, agent_id, item_id)
        );
        CREATE INDEX IF NOT EXISTS ix_messages_pos
          ON messages (server_id, agent_id, position);
        CREATE TABLE IF NOT EXISTS agents (
          server_id  TEXT NOT NULL,
          agent_id   TEXT NOT NULL,
          epoch      TEXT NOT NULL DEFAULT '',
          start_seq  INTEGER NOT NULL DEFAULT 0,
          end_seq    INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (server_id, agent_id)
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

interface Row {
  item_json: string;
}

export async function loadCachedTimeline(
  serverId: string,
  agentId: string,
): Promise<StreamItem[] | null> {
  if (!serverId || !agentId) return null;
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<Row>(
      "SELECT item_json FROM messages WHERE server_id = ? AND agent_id = ? ORDER BY position ASC",
      serverId,
      agentId,
    );
    if (rows.length === 0) return null;
    const parsed: unknown[] = [];
    for (const row of rows) {
      try {
        parsed.push(JSON.parse(row.item_json));
      } catch {
        // Drop corrupted rows individually; one bad row shouldn't poison the
        // whole agent's cache.
      }
    }
    return deserializeItems(parsed);
  } catch (error) {
    console.warn("[TimelineCache/native] load failed", error);
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
    const db = await getDb();
    const serialized = serializeItems(items);

    await db.withTransactionAsync(async () => {
      // Replace strategy: clear and re-insert. Cheaper than a diff at this
      // scale (writes happen on a 500ms debounce), and sidesteps the
      // hardest cases — items being mutated in place (status flips,
      // streaming text edits) — by always shipping the latest snapshot.
      await db.runAsync(
        "DELETE FROM messages WHERE server_id = ? AND agent_id = ?",
        serverId,
        agentId,
      );
      // Bind one row at a time so we can pass a TEXT JSON column without
      // worrying about parameterized-IN-list size limits.
      let position = 0;
      for (const obj of serialized) {
        const itemId = typeof obj.id === "string" ? obj.id : `pos:${position}`;
        position += 1;
        await db.runAsync(
          "INSERT OR REPLACE INTO messages (server_id, agent_id, item_id, position, item_json) VALUES (?, ?, ?, ?, ?)",
          serverId,
          agentId,
          itemId,
          position,
          JSON.stringify(obj),
        );
      }
    });
  } catch (error) {
    console.warn("[TimelineCache/native] save failed", error);
  }
}

export async function clearCachedTimeline(serverId: string, agentId: string): Promise<void> {
  if (!serverId || !agentId) return;
  try {
    const db = await getDb();
    await db.runAsync(
      "DELETE FROM messages WHERE server_id = ? AND agent_id = ?",
      serverId,
      agentId,
    );
    await db.runAsync("DELETE FROM agents WHERE server_id = ? AND agent_id = ?", serverId, agentId);
  } catch (error) {
    console.warn("[TimelineCache/native] clear failed", error);
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
  if (!serverId || !agentId) return null;
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{
      epoch: string;
      start_seq: number;
      end_seq: number;
    }>(
      "SELECT epoch, start_seq, end_seq FROM agents WHERE server_id = ? AND agent_id = ?",
      serverId,
      agentId,
    );
    if (!row) return null;
    return { epoch: row.epoch, startSeq: row.start_seq, endSeq: row.end_seq };
  } catch (error) {
    console.warn("[TimelineCache/native] loadCursor failed", error);
    return null;
  }
}

export async function saveCachedCursor(
  serverId: string,
  agentId: string,
  cursor: CachedTimelineCursor,
): Promise<void> {
  if (!serverId || !agentId) return;
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO agents (server_id, agent_id, epoch, start_seq, end_seq, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, agent_id) DO UPDATE SET
         epoch = excluded.epoch,
         start_seq = excluded.start_seq,
         end_seq = excluded.end_seq,
         updated_at = excluded.updated_at`,
      serverId,
      agentId,
      cursor.epoch,
      cursor.startSeq,
      cursor.endSeq,
      new Date().toISOString(),
    );
  } catch (error) {
    console.warn("[TimelineCache/native] saveCursor failed", error);
  }
}
