// One-shot migration from the legacy single-file chat store
// (`$OTTIE_HOME/chat/rooms.json` containing `{ rooms, messages }`) to the new
// layout:
//   $OTTIE_HOME/chat/rooms-index.json         (room metadata)
//   $OTTIE_HOME/chat/rooms/<roomId>.jsonl     (one file per room, append-only)
//
// Migration is idempotent: if `rooms.json` is missing OR a sentinel file
// `rooms.json.migrated` exists, this is a no-op. Once migration succeeds the
// original file is renamed (not deleted) so it survives accidental
// regressions and can be inspected during incident response.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "pino";

import { ChatRoomIndexStore } from "./chat-room-index-store.js";
import { ChatMessageSchema, ChatRoomSchema, type StoredChatMessage } from "./chat-types.js";
import { DurableChatMessageStore } from "./durable-chat-message-store.js";

const LegacyChatStorePayloadSchema = z.object({
  rooms: z.array(ChatRoomSchema),
  messages: z.array(ChatMessageSchema),
});

interface MigrateOptions {
  ottieHome: string;
  logger: Logger;
  roomIndex: ChatRoomIndexStore;
  messageStore: DurableChatMessageStore;
}

export interface MigrateResult {
  migrated: boolean;
  roomCount: number;
  messageCount: number;
}

export async function migrateLegacyChatStore(options: MigrateOptions): Promise<MigrateResult> {
  const log = options.logger.child({ component: "chat-store-migration" });
  const legacyPath = path.join(options.ottieHome, "chat", "rooms.json");
  const sentinelPath = `${legacyPath}.migrated`;

  // Already migrated? Nothing to do.
  try {
    await fs.stat(sentinelPath);
    return { migrated: false, roomCount: 0, messageCount: 0 };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  let raw: string;
  try {
    raw = await fs.readFile(legacyPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No legacy file at all — fresh install. Nothing to migrate.
      return { migrated: false, roomCount: 0, messageCount: 0 };
    }
    throw err;
  }

  const parsed = LegacyChatStorePayloadSchema.parse(JSON.parse(raw));

  // Group messages by roomId, sorted by createdAt to assign monotonic seq.
  const grouped = new Map<string, StoredChatMessage[]>();
  for (const msg of parsed.messages) {
    if (!grouped.has(msg.roomId)) grouped.set(msg.roomId, []);
    grouped.get(msg.roomId)!.push({
      ...msg,
      // Legacy messages had no seq or clientMessageId. Synthesize them so the
      // strict stored schema validates.
      seq: 0, // placeholder; reassigned below in createdAt order
      clientMessageId: msg.clientMessageId ?? msg.id,
    });
  }

  let totalMessages = 0;
  for (const [roomId, msgs] of grouped) {
    msgs.sort((left, right) => {
      // Stable sort: primary by createdAt, fallback by id for determinism on
      // identical timestamps.
      const cmp = left.createdAt.localeCompare(right.createdAt);
      if (cmp !== 0) return cmp;
      return left.id.localeCompare(right.id);
    });
    msgs.forEach((m, i) => {
      m.seq = i + 1;
    });
    await options.messageStore.bulkInsert(roomId, msgs);
    totalMessages += msgs.length;
  }

  // Promote rooms into the index. Synthesize an epoch per room.
  options.roomIndex.setAll(
    parsed.rooms.map((room) => ({
      ...room,
      epoch: room.epoch ?? randomUUID(),
    })),
  );
  await options.roomIndex.flush();

  // Park the legacy file out of the way. Renaming (not deleting) means a
  // recovery path still exists if the new layout is ever found wanting.
  await fs.rename(legacyPath, sentinelPath);

  log.info(
    { rooms: parsed.rooms.length, messages: totalMessages, sentinelPath },
    "migrated legacy chat store",
  );

  return {
    migrated: true,
    roomCount: parsed.rooms.length,
    messageCount: totalMessages,
  };
}
