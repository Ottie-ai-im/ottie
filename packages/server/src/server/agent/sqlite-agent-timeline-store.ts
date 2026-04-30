// SQLite-backed implementation of AgentTimelineStore.
//
// Single-file database at `<rootDir>/timeline.sqlite3` holds every committed
// timeline row for every agent the daemon has ever managed. No retention cap.
// Replaces the per-agent JSONL store (`durable-agent-timeline-store.ts`) — has
// identical semantics so callers don't need to change.
//
// Schema:
//   messages(agent_id, seq, timestamp, item_json) PK (agent_id, seq)
//   index ix_messages_agent_seq_desc (agent_id, seq DESC) — tail/before scans
//
// Writes use better-sqlite3's synchronous API inside a single prepared insert
// per row. WAL mode keeps reads from blocking writes; the JS event loop only
// pauses for the duration of a single SQL statement (sub-millisecond at this
// scale). bulkInsert wraps the inserts in a transaction.
//
// `epoch` is intentionally returned as "" — the caller (AgentManager) owns
// the epoch concept (it lives on the in-memory store). This mirrors what the
// JSONL store did, keeping behavioral parity.
//
// Concurrency model: better-sqlite3 is synchronous, so all the
// per-agent write serialization the JSONL store had to do with promise
// chains is unnecessary here — SQLite itself serializes via its lock.
//
// TODO(future): if a message stream ever produces millions of rows for a
// single agent, switch fetch* paths to keyset pagination at the SQL layer
// instead of materializing the full timeline in `selectTail`. Today the
// fetch APIs are bounded by the requested limit and only cap at "all rows in
// agent" so this is a real concern only in pathological cases.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database, { type Database as DatabaseHandle, type Statement } from "better-sqlite3";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "./agent-timeline-store-types.js";

const DEFAULT_FETCH_LIMIT = 200;

interface SqliteAgentTimelineStoreOptions {
  /** Absolute path to the SQLite database file. Parent dir is created lazily. */
  dbPath: string;
}

interface MessageRowRaw {
  seq: number;
  timestamp: string;
  item_json: string;
}

interface FetchWindow {
  minSeq: number;
  maxSeq: number;
  nextSeq: number;
}

function emptyFetchResult(
  direction: NonNullable<AgentTimelineFetchOptions["direction"]>,
): AgentTimelineFetchResult {
  return {
    epoch: "",
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
    hasOlder: false,
    hasNewer: false,
    rows: [],
  };
}

function rowFromRaw(raw: MessageRowRaw): AgentTimelineRow {
  return {
    seq: raw.seq,
    timestamp: raw.timestamp,
    item: JSON.parse(raw.item_json) as AgentTimelineItem,
  };
}

function normalizeMessageId(messageId: string | undefined): string | undefined {
  if (typeof messageId !== "string") return undefined;
  const t = messageId.trim();
  return t.length > 0 ? t : undefined;
}

export class SqliteAgentTimelineStore implements AgentTimelineStore {
  private readonly db: DatabaseHandle;

  // Prepared statements — created once, reused for every call.
  private readonly stmtMaxSeq: Statement<[string], { max_seq: number | null }>;
  private readonly stmtMinSeq: Statement<[string], { min_seq: number | null }>;
  private readonly stmtInsert: Statement<[string, number, string, string]>;
  private readonly stmtSelectAll: Statement<[string], MessageRowRaw>;
  private readonly stmtSelectTail: Statement<[string, number], MessageRowRaw>;
  private readonly stmtSelectAfter: Statement<[string, number, number], MessageRowRaw>;
  private readonly stmtSelectAfterAll: Statement<[string, number], MessageRowRaw>;
  private readonly stmtSelectBefore: Statement<[string, number, number], MessageRowRaw>;
  private readonly stmtSelectBeforeAll: Statement<[string, number], MessageRowRaw>;
  private readonly stmtCountAfter: Statement<[string, number], { c: number }>;
  private readonly stmtLastItem: Statement<[string], MessageRowRaw>;
  private readonly stmtFindUserMsg: Statement<[string, string, string], { c: number }>;
  private readonly stmtDeleteAgent: Statement<[string]>;

  // Cached fast paths.
  private readonly stmtSelectAssistantTail: Statement<[string], MessageRowRaw>;

  // Idempotent bulkInsert wrapper.
  private readonly txnBulkInsert: (agentId: string, rows: readonly AgentTimelineRow[]) => void;

  constructor(options: SqliteAgentTimelineStoreOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new Database(options.dbPath);

    // Pragmas: WAL for concurrency, NORMAL for the speed/durability trade-off.
    // foreign_keys not strictly needed but keeps schema honest if we add FKs.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        agent_id   TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        timestamp  TEXT NOT NULL,
        item_json  TEXT NOT NULL,
        PRIMARY KEY (agent_id, seq)
      );
      CREATE INDEX IF NOT EXISTS ix_messages_agent_seq_desc
        ON messages (agent_id, seq DESC);
    `);

    this.stmtMaxSeq = this.db.prepare<[string], { max_seq: number | null }>(
      "SELECT MAX(seq) AS max_seq FROM messages WHERE agent_id = ?",
    );
    this.stmtMinSeq = this.db.prepare<[string], { min_seq: number | null }>(
      "SELECT MIN(seq) AS min_seq FROM messages WHERE agent_id = ?",
    );
    this.stmtInsert = this.db.prepare<[string, number, string, string]>(
      "INSERT OR IGNORE INTO messages (agent_id, seq, timestamp, item_json) VALUES (?, ?, ?, ?)",
    );
    this.stmtSelectAll = this.db.prepare<[string], MessageRowRaw>(
      "SELECT seq, timestamp, item_json FROM messages WHERE agent_id = ? ORDER BY seq ASC",
    );
    this.stmtSelectTail = this.db.prepare<[string, number], MessageRowRaw>(
      `SELECT seq, timestamp, item_json FROM messages
       WHERE agent_id = ? ORDER BY seq DESC LIMIT ?`,
    );
    this.stmtSelectAfter = this.db.prepare<[string, number, number], MessageRowRaw>(
      `SELECT seq, timestamp, item_json FROM messages
       WHERE agent_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    );
    this.stmtSelectAfterAll = this.db.prepare<[string, number], MessageRowRaw>(
      `SELECT seq, timestamp, item_json FROM messages
       WHERE agent_id = ? AND seq > ? ORDER BY seq ASC`,
    );
    this.stmtSelectBefore = this.db.prepare<[string, number, number], MessageRowRaw>(
      `SELECT seq, timestamp, item_json FROM messages
       WHERE agent_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
    );
    this.stmtSelectBeforeAll = this.db.prepare<[string, number], MessageRowRaw>(
      `SELECT seq, timestamp, item_json FROM messages
       WHERE agent_id = ? AND seq < ? ORDER BY seq ASC`,
    );
    this.stmtCountAfter = this.db.prepare<[string, number], { c: number }>(
      "SELECT COUNT(*) AS c FROM messages WHERE agent_id = ? AND seq > ?",
    );
    this.stmtLastItem = this.db.prepare<[string], MessageRowRaw>(
      `SELECT seq, timestamp, item_json FROM messages
       WHERE agent_id = ? ORDER BY seq DESC LIMIT 1`,
    );
    this.stmtFindUserMsg = this.db.prepare<[string, string, string], { c: number }>(
      `SELECT COUNT(*) AS c FROM messages
       WHERE agent_id = ?
         AND json_extract(item_json, '$.type') = 'user_message'
         AND TRIM(IFNULL(json_extract(item_json, '$.messageId'), '')) = ?
         AND IFNULL(json_extract(item_json, '$.text'), '') = ?
       LIMIT 1`,
    );
    this.stmtDeleteAgent = this.db.prepare<[string]>("DELETE FROM messages WHERE agent_id = ?");
    this.stmtSelectAssistantTail = this.db.prepare<[string], MessageRowRaw>(
      `SELECT seq, timestamp, item_json FROM messages
       WHERE agent_id = ? ORDER BY seq DESC`,
    );

    // Transactions in better-sqlite3 must be created via `db.transaction(fn)` —
    // the returned wrapper runs `fn` synchronously inside BEGIN/COMMIT.
    this.txnBulkInsert = this.db.transaction(
      (agentId: string, rows: readonly AgentTimelineRow[]): void => {
        for (const row of rows) {
          this.stmtInsert.run(agentId, row.seq, row.timestamp, JSON.stringify(row.item));
        }
      },
    );
  }

  // ─── AgentTimelineStore interface ──────────────────────────────────────

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow> {
    const lastSeq = this.stmtMaxSeq.get(agentId)?.max_seq ?? 0;
    const seq = lastSeq + 1;
    const timestamp = options?.timestamp ?? new Date().toISOString();
    const row: AgentTimelineRow = { seq, timestamp, item };
    this.stmtInsert.run(agentId, seq, timestamp, JSON.stringify(item));
    return row;
  }

  async fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    const direction = options?.direction ?? "tail";
    const requestedLimit = options?.limit;
    const limit =
      requestedLimit === undefined ? DEFAULT_FETCH_LIMIT : Math.max(0, Math.floor(requestedLimit));
    const selectAll = limit === 0;
    const cursor = options?.cursor;

    const minSeqRaw = this.stmtMinSeq.get(agentId)?.min_seq ?? null;
    const maxSeqRaw = this.stmtMaxSeq.get(agentId)?.max_seq ?? null;
    if (minSeqRaw === null || maxSeqRaw === null) {
      return emptyFetchResult(direction);
    }
    const window: FetchWindow = {
      minSeq: minSeqRaw,
      maxSeq: maxSeqRaw,
      nextSeq: maxSeqRaw + 1,
    };

    if (direction === "tail") {
      return this.fetchTail(agentId, limit, selectAll, window);
    }
    if (direction === "after") {
      return this.fetchAfter(agentId, cursor?.seq ?? 0, limit, selectAll, window);
    }
    return this.fetchBefore(agentId, cursor?.seq ?? window.nextSeq, limit, selectAll, window);
  }

  private fetchTail(
    agentId: string,
    limit: number,
    selectAll: boolean,
    window: FetchWindow,
  ): AgentTimelineFetchResult {
    const raws = selectAll
      ? this.stmtSelectAll.all(agentId)
      : this.stmtSelectTail.all(agentId, limit).toReversed();
    const rows = raws.map(rowFromRaw);
    return {
      epoch: "",
      direction: "tail",
      reset: false,
      staleCursor: false,
      gap: false,
      window,
      hasOlder: rows.length > 0 && rows[0]!.seq > window.minSeq,
      hasNewer: false,
      rows,
    };
  }

  private fetchAfter(
    agentId: string,
    baseSeq: number,
    limit: number,
    selectAll: boolean,
    window: FetchWindow,
  ): AgentTimelineFetchResult {
    const raws = selectAll
      ? this.stmtSelectAfterAll.all(agentId, baseSeq)
      : this.stmtSelectAfter.all(agentId, baseSeq, limit);
    const rows = raws.map(rowFromRaw);
    const lastSelected = rows[rows.length - 1];
    const hasNewer = Boolean(lastSelected && lastSelected.seq < window.maxSeq);
    const hasOlder = rows.length === 0 ? baseSeq >= window.minSeq : rows[0]!.seq > window.minSeq;
    return {
      epoch: "",
      direction: "after",
      reset: false,
      staleCursor: false,
      gap: false,
      window,
      hasOlder,
      hasNewer,
      rows,
    };
  }

  private fetchBefore(
    agentId: string,
    beforeSeq: number,
    limit: number,
    selectAll: boolean,
    window: FetchWindow,
  ): AgentTimelineFetchResult {
    const raws = selectAll
      ? this.stmtSelectBeforeAll.all(agentId, beforeSeq)
      : this.stmtSelectBefore.all(agentId, beforeSeq, limit).toReversed();
    const rows = raws.map(rowFromRaw);
    const hasOlder = rows.length > 0 && rows[0]!.seq > window.minSeq;
    const hasNewer = this.stmtCountAfter.get(agentId, beforeSeq - 1)!.c > 0;
    return {
      epoch: "",
      direction: "before",
      reset: false,
      staleCursor: false,
      gap: false,
      window,
      hasOlder,
      hasNewer,
      rows,
    };
  }

  async getLatestCommittedSeq(agentId: string): Promise<number> {
    return this.stmtMaxSeq.get(agentId)?.max_seq ?? 0;
  }

  async getCommittedRows(agentId: string): Promise<AgentTimelineRow[]> {
    return this.stmtSelectAll.all(agentId).map(rowFromRaw);
  }

  async getLastItem(agentId: string): Promise<AgentTimelineItem | null> {
    const raw = this.stmtLastItem.get(agentId);
    return raw ? rowFromRaw(raw).item : null;
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    // Walk backwards collecting consecutive `assistant_message` items.
    const raws = this.stmtSelectAssistantTail.all(agentId);
    const chunks: string[] = [];
    for (const raw of raws) {
      const item = rowFromRaw(raw).item;
      if (item.type !== "assistant_message") {
        if (chunks.length > 0) break;
        continue;
      }
      chunks.push(item.text);
    }
    if (chunks.length === 0) return null;
    return chunks.toReversed().join("");
  }

  async hasCommittedUserMessage(
    agentId: string,
    options: { messageId: string; text: string },
  ): Promise<boolean> {
    const messageId = normalizeMessageId(options.messageId);
    if (!messageId) return false;
    const hit = this.stmtFindUserMsg.get(agentId, messageId, options.text);
    return (hit?.c ?? 0) > 0;
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.stmtDeleteAgent.run(agentId);
  }

  async bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    if (rows.length === 0) return;
    this.txnBulkInsert(agentId, rows);
  }

  /** Closes the underlying database handle. Tests use this; production runs forever. */
  close(): void {
    this.db.close();
  }

  /**
   * Internal: exposes the better-sqlite3 handle so adjacent helpers (backup
   * scheduler, future maintenance scripts) can run things like `VACUUM
   * INTO`. Not part of the public AgentTimelineStore contract — callers
   * outside this package shouldn't reach in.
   */
  getDatabaseHandleForInternalUse(): DatabaseHandle {
    return this.db;
  }
}

/**
 * Default location for the timeline DB inside `$OTTIE_HOME`.
 *
 * Lives next to (not inside) the legacy `timeline/` JSONL directory so the
 * import-on-startup path can still find the old files.
 */
export function defaultTimelineDbPath(ottieHome: string): string {
  return join(ottieHome, "timeline", "timeline.sqlite3");
}
