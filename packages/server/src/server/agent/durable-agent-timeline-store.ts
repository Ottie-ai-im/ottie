// Append-only JSONL implementation of AgentTimelineStore.
//
// Each agent gets a file at `<rootDir>/<agentId>.jsonl`. Every committed
// timeline row becomes one JSON line `{seq, timestamp, item}`. Writes are
// serialized per-agent via a promise chain so concurrent bulkInsert calls
// don't interleave bytes.
//
// On first access for an agent we lazy-load + parse the file into an
// in-memory cache; subsequent reads are O(1) on the cache. Append also
// updates the cache so we don't have to re-read.
//
// This solves the "daemon restart loses chat history" problem: the
// in-memory `InMemoryAgentTimelineStore` continues to be the live source of
// truth for the running daemon; on restart, AgentManager seeds itself from
// here via `getLatestCommittedSeq` / `getCommittedRows` and clients can
// fetch_agent_timeline against the durable backing.

import { mkdir, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "./agent-timeline-store-types.js";

const DEFAULT_FETCH_LIMIT = 200;

type FetchDirection = NonNullable<AgentTimelineFetchOptions["direction"]>;

interface FetchWindow {
  minSeq: number;
  maxSeq: number;
  nextSeq: number;
}

function buildEmptyFetchResult(
  direction: FetchDirection,
  window: FetchWindow,
): AgentTimelineFetchResult {
  return {
    epoch: "",
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: false,
    hasNewer: false,
    rows: [],
  };
}

function cloneRow(row: AgentTimelineRow): AgentTimelineRow {
  return Object.assign({}, row);
}

function selectTail(
  rows: AgentTimelineRow[],
  limit: number,
  selectAll: boolean,
  minSeq: number,
  direction: FetchDirection,
  window: FetchWindow,
): AgentTimelineFetchResult {
  const selected =
    selectAll || limit >= rows.length ? rows.slice() : rows.slice(rows.length - limit);
  const hasOlder = selected.length > 0 && selected[0]!.seq > minSeq;
  return {
    epoch: "",
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder,
    hasNewer: false,
    rows: selected.map(cloneRow),
  };
}

function selectAfter(
  rows: AgentTimelineRow[],
  baseSeq: number,
  limit: number,
  selectAll: boolean,
  minSeq: number,
  maxSeq: number,
  direction: FetchDirection,
  window: FetchWindow,
): AgentTimelineFetchResult {
  const startIdx = rows.findIndex((row) => row.seq > baseSeq);
  if (startIdx < 0) {
    return {
      epoch: "",
      direction,
      reset: false,
      staleCursor: false,
      gap: false,
      window,
      hasOlder: baseSeq >= minSeq,
      hasNewer: false,
      rows: [],
    };
  }
  const selected = selectAll ? rows.slice(startIdx) : rows.slice(startIdx, startIdx + limit);
  const hasOlder = selected[0]!.seq > minSeq;
  const lastSelected = selected[selected.length - 1];
  const hasNewer = Boolean(lastSelected && lastSelected.seq < maxSeq);
  return {
    epoch: "",
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder,
    hasNewer,
    rows: selected.map(cloneRow),
  };
}

function selectBefore(
  rows: AgentTimelineRow[],
  beforeSeq: number,
  limit: number,
  selectAll: boolean,
  minSeq: number,
  direction: FetchDirection,
  window: FetchWindow,
): AgentTimelineFetchResult {
  const endExclusive = rows.findIndex((row) => row.seq >= beforeSeq);
  const bounded = endExclusive < 0 ? rows : rows.slice(0, endExclusive);
  const selected =
    selectAll || limit >= bounded.length ? bounded : bounded.slice(bounded.length - limit);
  const hasOlder = selected.length > 0 && selected[0]!.seq > minSeq;
  const hasNewer = endExclusive >= 0;
  return {
    epoch: "",
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder,
    hasNewer,
    rows: selected.map(cloneRow),
  };
}

interface DurableAgentTimelineStoreOptions {
  /** Directory where per-agent JSONL files live. Created lazily on first write. */
  rootDir: string;
}

/** Sanitizes an agentId so it's safe as a filesystem segment. UUIDs already are, but be defensive. */
function safeAgentFilename(agentId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(agentId)) {
    throw new Error(`Invalid agentId for durable timeline store: ${agentId}`);
  }
  return `${agentId}.jsonl`;
}

function normalizeMessageId(messageId: string | undefined): string | undefined {
  if (typeof messageId !== "string") return undefined;
  const t = messageId.trim();
  return t.length > 0 ? t : undefined;
}

export class DurableAgentTimelineStore implements AgentTimelineStore {
  private readonly rootDir: string;
  private readonly cache = new Map<string, AgentTimelineRow[]>();
  private readonly writeChains = new Map<string, Promise<void>>();
  private readonly loadPromises = new Map<string, Promise<AgentTimelineRow[]>>();

  constructor(options: DurableAgentTimelineStoreOptions) {
    this.rootDir = options.rootDir;
  }

  // ─── AgentTimelineStore interface ──────────────────────────────────────

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow> {
    const rows = await this.loadRows(agentId);
    const lastSeq = rows.length > 0 ? rows[rows.length - 1]!.seq : 0;
    const row: AgentTimelineRow = {
      seq: lastSeq + 1,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      item,
    };
    await this.writeRows(agentId, [row]);
    return cloneRow(row);
  }

  async fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    const rows = await this.loadRows(agentId);
    const direction = options?.direction ?? "tail";
    const requestedLimit = options?.limit;
    const limit =
      requestedLimit === undefined ? DEFAULT_FETCH_LIMIT : Math.max(0, Math.floor(requestedLimit));
    const cursor = options?.cursor;
    const minSeq = rows.length ? rows[0]!.seq : 0;
    const maxSeq = rows.length ? rows[rows.length - 1]!.seq : 0;
    const nextSeq = maxSeq + 1;
    const window = { minSeq, maxSeq, nextSeq };
    const selectAll = limit === 0;

    if (rows.length === 0) {
      return buildEmptyFetchResult(direction, window);
    }

    if (direction === "tail") {
      return selectTail(rows, limit, selectAll, minSeq, direction, window);
    }
    if (direction === "after") {
      return selectAfter(
        rows,
        cursor?.seq ?? 0,
        limit,
        selectAll,
        minSeq,
        maxSeq,
        direction,
        window,
      );
    }
    return selectBefore(rows, cursor?.seq ?? nextSeq, limit, selectAll, minSeq, direction, window);
  }

  async getLatestCommittedSeq(agentId: string): Promise<number> {
    const rows = await this.loadRows(agentId);
    return rows.length > 0 ? rows[rows.length - 1]!.seq : 0;
  }

  async getCommittedRows(agentId: string): Promise<AgentTimelineRow[]> {
    const rows = await this.loadRows(agentId);
    return rows.map(cloneRow);
  }

  async getLastItem(agentId: string): Promise<AgentTimelineItem | null> {
    const rows = await this.loadRows(agentId);
    return rows.length > 0 ? rows[rows.length - 1]!.item : null;
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const rows = await this.loadRows(agentId);
    const chunks: string[] = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const item = rows[i]!.item;
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
    const rows = await this.loadRows(agentId);
    return rows.some((row) => {
      if (row.item.type !== "user_message") return false;
      const rowMessageId = normalizeMessageId(row.item.messageId);
      return rowMessageId === messageId && row.item.text === options.text;
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    // Wait for any in-flight writes for this agent before removing the file.
    const chain = this.writeChains.get(agentId);
    if (chain) {
      await chain.catch(() => undefined);
    }
    this.cache.delete(agentId);
    this.loadPromises.delete(agentId);
    this.writeChains.delete(agentId);
    const filePath = this.fileFor(agentId);
    await rm(filePath, { force: true });
  }

  async bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.writeRows(agentId, rows);
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private fileFor(agentId: string): string {
    return join(this.rootDir, safeAgentFilename(agentId));
  }

  private async loadRows(agentId: string): Promise<AgentTimelineRow[]> {
    const cached = this.cache.get(agentId);
    if (cached) return cached;

    const inFlight = this.loadPromises.get(agentId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const filePath = this.fileFor(agentId);
      let text: string;
      try {
        text = await readFile(filePath, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          this.cache.set(agentId, []);
          return [];
        }
        throw err;
      }
      const rows: AgentTimelineRow[] = [];
      let lineNum = 0;
      for (const line of text.split("\n")) {
        lineNum += 1;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as AgentTimelineRow;
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof parsed.seq === "number" &&
            typeof parsed.timestamp === "string" &&
            parsed.item != null &&
            typeof parsed.item === "object"
          ) {
            rows.push(parsed);
          }
        } catch {
          // skip malformed line; log via outer if needed. We err on the side
          // of returning whatever we can parse so a single corrupted line
          // doesn't take out the whole agent's history.
          // eslint-disable-next-line no-console
          console.warn(`[durable-timeline] skipping malformed line ${lineNum} in ${filePath}`);
        }
      }
      // Guard against out-of-order writes — sort by seq just in case.
      rows.sort((a, b) => a.seq - b.seq);
      this.cache.set(agentId, rows);
      return rows;
    })();

    this.loadPromises.set(agentId, promise);
    try {
      return await promise;
    } finally {
      this.loadPromises.delete(agentId);
    }
  }

  private async writeRows(agentId: string, newRows: readonly AgentTimelineRow[]): Promise<void> {
    // Serialize writes per-agent so chunks don't interleave on disk.
    const previous = this.writeChains.get(agentId) ?? Promise.resolve();
    const next = previous.then(() => this.doWrite(agentId, newRows));
    this.writeChains.set(
      agentId,
      next.catch(() => undefined),
    );
    await next;
  }

  private async doWrite(agentId: string, newRows: readonly AgentTimelineRow[]): Promise<void> {
    // Make sure the cache reflects pre-existing rows so the in-memory copy
    // stays consistent with disk after this append.
    const existing = await this.loadRows(agentId);

    // Drop any rows whose seq <= existing max — bulkInsert may include rows
    // that were already persisted (e.g. when re-seeding from provider on
    // start). Idempotency keeps the file clean.
    const lastSeq = existing.length > 0 ? existing[existing.length - 1]!.seq : 0;
    const fresh = newRows.filter((row) => row.seq > lastSeq);
    if (fresh.length === 0) return;

    const filePath = this.fileFor(agentId);
    await mkdir(dirname(filePath), { recursive: true });

    const payload = fresh.map((row) => `${JSON.stringify(row)}\n`).join("");

    // First write creates the file; subsequent writes append. Both atomic at
    // the kernel level for small payloads.
    if (existing.length === 0) {
      await writeFile(filePath, payload, { flag: "a", encoding: "utf8" });
    } else {
      await appendFile(filePath, payload, { encoding: "utf8" });
    }

    // Update cache after disk succeeds.
    const cached = this.cache.get(agentId);
    if (cached) {
      cached.push(...fresh.map(cloneRow));
    }
  }
}
