// Per-client chat cursor persistence.
//
// Each client (mobile app, desktop, web) is identified by a stable clientId.
// We track, per room, the highest seq that client has acknowledged seeing
// (`lastDeliveredSeq`) and reading (`lastReadSeq`). Other clients/agents in
// the same room consume these cursors to compute message status (sent →
// delivered → read) for messages that THEY authored.
//
// Storage: `$OTTIE_HOME/chat/cursors/<clientId>.json`. Atomic writes via
// temp+rename, same convention as the rest of the server.
//
// Invariants enforced here:
//   - Cursors only advance. `update(roomId, 5, "delivered")` is a no-op if
//     `lastDeliveredSeq` is already 7. This is the "stale ack" guard — a
//     reconnecting client that replays old acks won't roll the read pointer
//     backward.
//   - `read` implies `delivered`. Setting `lastReadSeq` to N also bumps
//     `lastDeliveredSeq` to at least N.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "pino";
import {
  ChatCursorKindSchema,
  type ChatCursorKind,
  ChatRoomCursorSchema,
  type ChatRoomCursor,
} from "./chat-cursor-schemas.js";

// Re-export so existing server-side imports of these schemas keep working.
export { ChatCursorKindSchema, ChatRoomCursorSchema };
export type { ChatCursorKind, ChatRoomCursor };

const ChatClientCursorsSchema = z.object({
  version: z.literal(1).optional(),
  clientId: z.string(),
  rooms: z.record(z.string(), ChatRoomCursorSchema),
});

interface ChatCursorStoreOptions {
  rootDir: string;
  logger: Logger;
}

interface UpdateResult {
  /** Whether the cursor actually advanced (false = stale ack, no change). */
  advanced: boolean;
  /** The cursor state after the update. */
  cursor: ChatRoomCursor;
}

/** Sanitize clientId so it's safe as a single filesystem segment. */
function safeClientFilename(clientId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(clientId)) {
    throw new Error(`Invalid clientId for chat cursor store: ${clientId}`);
  }
  return `${clientId}.json`;
}

export class ChatCursorStore {
  private readonly rootDir: string;
  private readonly logger: Logger;

  /** In-memory cursors per client. Lazy-loaded on first access. */
  private readonly cache = new Map<string, Map<string, ChatRoomCursor>>();
  private readonly loadPromises = new Map<string, Promise<Map<string, ChatRoomCursor>>>();
  private readonly writeChains = new Map<string, Promise<void>>();

  constructor(options: ChatCursorStoreOptions) {
    this.rootDir = options.rootDir;
    this.logger = options.logger.child({ component: "chat-cursor-store" });
  }

  /** Get the cursor for (client, room). Returns null if no acks recorded yet. */
  async get(clientId: string, roomId: string): Promise<ChatRoomCursor | null> {
    const rooms = await this.loadClient(clientId);
    return rooms.get(roomId) ?? null;
  }

  /** Get all cursors for a client, keyed by roomId. */
  async getAll(clientId: string): Promise<Record<string, ChatRoomCursor>> {
    const rooms = await this.loadClient(clientId);
    const out: Record<string, ChatRoomCursor> = {};
    for (const [roomId, cursor] of rooms) {
      out[roomId] = { ...cursor };
    }
    return out;
  }

  /**
   * Advance the cursor to at least `seq` for the given kind. If the existing
   * cursor is already past that point, this is a no-op (`advanced: false`).
   * Setting kind=read also implicitly bumps delivered to at least `seq`.
   */
  async update(
    clientId: string,
    roomId: string,
    seq: number,
    kind: ChatCursorKind,
  ): Promise<UpdateResult> {
    if (!Number.isInteger(seq) || seq < 0) {
      throw new Error(`Invalid ack seq: ${seq}`);
    }
    const rooms = await this.loadClient(clientId);
    const existing = rooms.get(roomId) ?? {
      lastDeliveredSeq: 0,
      lastReadSeq: 0,
      updatedAt: new Date(0).toISOString(),
    };

    const newDelivered =
      kind === "delivered"
        ? Math.max(existing.lastDeliveredSeq, seq)
        : Math.max(existing.lastDeliveredSeq, seq); // read implies delivered
    const newRead = kind === "read" ? Math.max(existing.lastReadSeq, seq) : existing.lastReadSeq;

    if (newDelivered === existing.lastDeliveredSeq && newRead === existing.lastReadSeq) {
      return { advanced: false, cursor: { ...existing } };
    }

    const next: ChatRoomCursor = {
      lastDeliveredSeq: newDelivered,
      lastReadSeq: newRead,
      updatedAt: new Date().toISOString(),
    };
    rooms.set(roomId, next);
    await this.flush(clientId);
    return { advanced: true, cursor: { ...next } };
  }

  /**
   * Drop the cursor entry for one room (used when a room is deleted).
   * Optional clientId means "all clients" — call when a room goes away.
   */
  async deleteRoom(roomId: string): Promise<void> {
    const dir = this.rootDir;
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const clientId = entry.slice(0, -".json".length);
      const rooms = await this.loadClient(clientId);
      if (rooms.delete(roomId)) {
        await this.flush(clientId);
      }
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private fileFor(clientId: string): string {
    return path.join(this.rootDir, safeClientFilename(clientId));
  }

  private async loadClient(clientId: string): Promise<Map<string, ChatRoomCursor>> {
    const cached = this.cache.get(clientId);
    if (cached) return cached;
    const inFlight = this.loadPromises.get(clientId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const map = new Map<string, ChatRoomCursor>();
      try {
        const raw = await fs.readFile(this.fileFor(clientId), "utf8");
        const parsed = ChatClientCursorsSchema.parse(JSON.parse(raw));
        for (const [roomId, cursor] of Object.entries(parsed.rooms)) {
          map.set(roomId, cursor);
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          this.logger.warn({ err, clientId }, "failed to load chat cursors; starting empty");
        }
      }
      this.cache.set(clientId, map);
      return map;
    })();

    this.loadPromises.set(clientId, promise);
    try {
      return await promise;
    } finally {
      this.loadPromises.delete(clientId);
    }
  }

  private async flush(clientId: string): Promise<void> {
    const previous = this.writeChains.get(clientId) ?? Promise.resolve();
    const next = previous.then(() => this.doFlush(clientId));
    this.writeChains.set(
      clientId,
      next.catch(() => undefined),
    );
    await next;
  }

  private async doFlush(clientId: string): Promise<void> {
    const rooms = this.cache.get(clientId);
    if (!rooms) return;

    const payload = {
      version: 1 as const,
      clientId,
      rooms: Object.fromEntries(rooms.entries()),
    };

    const filePath = this.fileFor(clientId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(tempPath, filePath);
  }
}
