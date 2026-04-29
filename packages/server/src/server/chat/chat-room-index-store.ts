// Persistence for the chat room metadata index.
//
// Rooms are few (handfuls per daemon), so a single JSON file is fine. Per-room
// MESSAGES live in the per-room JSONL files managed by `DurableChatMessageStore`.
// This file just holds the metadata: id, name, purpose, timestamps, epoch.
//
// Atomic writes via temp+rename, same convention as the rest of the server.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "pino";

import { StoredChatRoomSchema, type StoredChatRoom } from "./chat-types.js";

const ChatRoomIndexPayloadSchema = z.object({
  version: z.literal(1).optional(),
  rooms: z.array(StoredChatRoomSchema),
});

interface ChatRoomIndexStoreOptions {
  filePath: string;
  logger: Logger;
}

export class ChatRoomIndexStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private rooms = new Map<string, StoredChatRoom>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: ChatRoomIndexStoreOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger.child({ component: "chat-room-index" });
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.rooms.clear();
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = ChatRoomIndexPayloadSchema.parse(JSON.parse(raw));
      for (const room of parsed.rooms) {
        this.rooms.set(room.id, room);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error({ err, filePath: this.filePath }, "failed to load chat room index");
      }
    }
    this.loaded = true;
  }

  /** Replace the in-memory snapshot wholesale (used by migration). */
  setAll(rooms: readonly StoredChatRoom[]): void {
    this.rooms.clear();
    for (const room of rooms) {
      this.rooms.set(room.id, room);
    }
    this.loaded = true;
  }

  list(): StoredChatRoom[] {
    return Array.from(this.rooms.values());
  }

  get(id: string): StoredChatRoom | undefined {
    return this.rooms.get(id);
  }

  put(room: StoredChatRoom): void {
    this.rooms.set(room.id, room);
  }

  delete(id: string): boolean {
    return this.rooms.delete(id);
  }

  /** Persist the current in-memory snapshot. Serialized via promise chain. */
  async flush(): Promise<void> {
    const next = this.writeChain.then(() => this.doFlush());
    this.writeChain = next.catch(() => undefined);
    await next;
  }

  private async doFlush(): Promise<void> {
    const payload = {
      version: 1 as const,
      rooms: Array.from(this.rooms.values()).sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      ),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}
