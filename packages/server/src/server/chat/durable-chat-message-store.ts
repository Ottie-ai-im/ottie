// Append-only JSONL persistence for chat messages.
//
// Each room gets a file at `<rootDir>/<roomId>.jsonl`. Every committed message
// becomes one JSON line. Writes are serialized per-room via a promise chain
// so concurrent appends don't interleave bytes. On first access for a room
// the file is parsed into an in-memory cache; subsequent reads are O(1).
//
// This replaces the previous single `chat/rooms.json` store which loaded and
// rewrote the entire chat history on every send. The JSONL layout scales to
// many thousands of messages per room, supports the "give me everything after
// seq N" sync protocol, and survives a SIGKILL mid-write (only the current
// in-flight line can be truncated, never previous lines).
//
// The pattern is borrowed from `durable-agent-timeline-store.ts` — chat is
// simpler than the agent timeline (no epoch reset, no fetch-window cursor
// machinery yet) so this store is a trimmed-down sibling.

import { mkdir, readFile, rm, appendFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Logger } from "pino";

import { StoredChatMessageSchema, type StoredChatMessage } from "./chat-types.js";

interface DurableChatMessageStoreOptions {
  /** Directory where per-room JSONL files live. Created lazily on first write. */
  rootDir: string;
  logger: Logger;
}

/** Sanitize a roomId so it's safe as a single filesystem segment. */
function safeRoomFilename(roomId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(roomId)) {
    throw new Error(`Invalid roomId for durable chat store: ${roomId}`);
  }
  return `${roomId}.jsonl`;
}

function cloneMessage(message: StoredChatMessage): StoredChatMessage {
  return Object.assign({}, message);
}

export class DurableChatMessageStore {
  private readonly rootDir: string;
  private readonly logger: Logger;
  private readonly cache = new Map<string, StoredChatMessage[]>();
  private readonly writeChains = new Map<string, Promise<void>>();
  private readonly loadPromises = new Map<string, Promise<StoredChatMessage[]>>();

  constructor(options: DurableChatMessageStoreOptions) {
    this.rootDir = options.rootDir;
    this.logger = options.logger.child({ component: "durable-chat-store" });
  }

  /**
   * Append a message to a room's JSONL file. The caller is responsible for
   * having already populated `seq` correctly (one greater than the room's
   * current latest seq); this store enforces idempotency by dropping any
   * message whose seq <= the latest already on disk.
   */
  async append(roomId: string, message: StoredChatMessage): Promise<void> {
    if (message.roomId !== roomId) {
      throw new Error(
        `chat-store: roomId mismatch (file=${roomId}, message.roomId=${message.roomId})`,
      );
    }
    StoredChatMessageSchema.parse(message);
    await this.writeMessages(roomId, [message]);
  }

  /**
   * Bulk-append multiple messages — used by migration from the old
   * single-file store. Messages must be in seq order.
   */
  async bulkInsert(roomId: string, messages: readonly StoredChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    for (const m of messages) {
      if (m.roomId !== roomId) {
        throw new Error(
          `chat-store: roomId mismatch in bulkInsert (file=${roomId}, message.roomId=${m.roomId})`,
        );
      }
      StoredChatMessageSchema.parse(m);
    }
    await this.writeMessages(roomId, messages);
  }

  /** Return all messages for the room, sorted by seq ascending. */
  async getMessages(roomId: string): Promise<StoredChatMessage[]> {
    const rows = await this.loadRows(roomId);
    return rows.map(cloneMessage);
  }

  async getLatestSeq(roomId: string): Promise<number> {
    const rows = await this.loadRows(roomId);
    return rows.length > 0 ? rows[rows.length - 1]!.seq : 0;
  }

  async deleteRoom(roomId: string): Promise<void> {
    // Wait for any in-flight writes to flush before removing the file so we
    // don't race a write into a re-created room with the same id.
    const chain = this.writeChains.get(roomId);
    if (chain) {
      await chain.catch(() => undefined);
    }
    this.cache.delete(roomId);
    this.loadPromises.delete(roomId);
    this.writeChains.delete(roomId);
    await rm(this.fileFor(roomId), { force: true });
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private fileFor(roomId: string): string {
    return join(this.rootDir, safeRoomFilename(roomId));
  }

  private async loadRows(roomId: string): Promise<StoredChatMessage[]> {
    const cached = this.cache.get(roomId);
    if (cached) return cached;

    const inFlight = this.loadPromises.get(roomId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const filePath = this.fileFor(roomId);
      let text: string;
      try {
        text = await readFile(filePath, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          this.cache.set(roomId, []);
          return [];
        }
        throw err;
      }

      const rows: StoredChatMessage[] = [];
      let lineNum = 0;
      for (const line of text.split("\n")) {
        lineNum += 1;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = StoredChatMessageSchema.parse(JSON.parse(trimmed));
          rows.push(parsed);
        } catch (err) {
          // A single corrupted line shouldn't take out the whole room — log
          // and keep going. This is the same defensive posture as the agent
          // timeline store.
          this.logger.warn(
            { roomId, lineNum, filePath, err },
            "skipping malformed chat message line",
          );
        }
      }
      // Defensive sort. Disk order should already be by seq because writes
      // are serialized, but fsync ordering on some filesystems is not the
      // strict guarantee we rely on.
      rows.sort((a, b) => a.seq - b.seq);
      this.cache.set(roomId, rows);
      return rows;
    })();

    this.loadPromises.set(roomId, promise);
    try {
      return await promise;
    } finally {
      this.loadPromises.delete(roomId);
    }
  }

  private async writeMessages(
    roomId: string,
    newRows: readonly StoredChatMessage[],
  ): Promise<void> {
    const previous = this.writeChains.get(roomId) ?? Promise.resolve();
    const next = previous.then(() => this.doWrite(roomId, newRows));
    this.writeChains.set(
      roomId,
      next.catch(() => undefined),
    );
    await next;
  }

  private async doWrite(roomId: string, newRows: readonly StoredChatMessage[]): Promise<void> {
    const existing = await this.loadRows(roomId);
    const lastSeq = existing.length > 0 ? existing[existing.length - 1]!.seq : 0;

    // Idempotency: drop anything whose seq has already been persisted.
    const fresh = newRows.filter((row) => row.seq > lastSeq);
    if (fresh.length === 0) return;

    // Sanity: seq must be strictly increasing within this batch.
    for (let i = 1; i < fresh.length; i += 1) {
      if (fresh[i]!.seq <= fresh[i - 1]!.seq) {
        throw new Error(
          `chat-store: non-monotonic seq in bulk write (room=${roomId}, ${fresh[i - 1]!.seq} → ${fresh[i]!.seq})`,
        );
      }
    }

    const filePath = this.fileFor(roomId);
    await mkdir(dirname(filePath), { recursive: true });

    const payload = fresh.map((row) => `${JSON.stringify(row)}\n`).join("");

    if (existing.length === 0) {
      // First-ever write to this file. `writeFile` with flag "a" creates if
      // missing and appends — same as appendFile but more explicit about the
      // create-if-absent intent.
      await writeFile(filePath, payload, { flag: "a", encoding: "utf8" });
    } else {
      await appendFile(filePath, payload, { encoding: "utf8" });
    }

    const cached = this.cache.get(roomId);
    if (cached) {
      cached.push(...fresh.map(cloneMessage));
    }
  }
}
