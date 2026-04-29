import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import pino from "pino";

import { ChatRoomIndexStore } from "./chat-room-index-store.js";
import { DurableChatMessageStore } from "./durable-chat-message-store.js";
import { migrateLegacyChatStore } from "./chat-store-migration.js";

interface LegacyPayload {
  rooms: Array<{
    id: string;
    name: string;
    purpose: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  messages: Array<{
    id: string;
    roomId: string;
    authorAgentId: string;
    body: string;
    replyToMessageId: string | null;
    mentionAgentIds: string[];
    createdAt: string;
  }>;
}

describe("migrateLegacyChatStore", () => {
  let ottieHome: string;
  let logger: pino.Logger;
  let roomIndex: ChatRoomIndexStore;
  let messageStore: DurableChatMessageStore;

  beforeEach(async () => {
    ottieHome = await mkdtemp(path.join(tmpdir(), "ottie-chat-migrate-"));
    logger = pino({ level: "silent" });
    roomIndex = new ChatRoomIndexStore({
      filePath: path.join(ottieHome, "chat", "rooms-index.json"),
      logger,
    });
    messageStore = new DurableChatMessageStore({
      rootDir: path.join(ottieHome, "chat", "rooms"),
      logger,
    });
  });

  afterEach(async () => {
    await rm(ottieHome, { recursive: true, force: true });
  });

  async function writeLegacyFile(payload: LegacyPayload): Promise<void> {
    const dir = path.join(ottieHome, "chat");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "rooms.json"), JSON.stringify(payload, null, 2), "utf8");
  }

  test("no-op when rooms.json doesn't exist", async () => {
    const result = await migrateLegacyChatStore({ ottieHome, logger, roomIndex, messageStore });
    expect(result).toEqual({ migrated: false, roomCount: 0, messageCount: 0 });
    expect(roomIndex.list()).toEqual([]);
  });

  test("migrates rooms + messages, assigns seq in createdAt order, parks the legacy file", async () => {
    await writeLegacyFile({
      rooms: [
        {
          id: "room-1",
          name: "alpha",
          purpose: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "room-2",
          name: "beta",
          purpose: "the second room",
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-04T00:00:00.000Z",
        },
      ],
      messages: [
        {
          // intentionally out of order — should be reassigned by createdAt
          id: "m-2",
          roomId: "room-1",
          authorAgentId: "agent-a",
          body: "second",
          replyToMessageId: null,
          mentionAgentIds: [],
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "m-1",
          roomId: "room-1",
          authorAgentId: "agent-a",
          body: "first",
          replyToMessageId: null,
          mentionAgentIds: [],
          createdAt: "2026-01-01T12:00:00.000Z",
        },
        {
          id: "m-3",
          roomId: "room-2",
          authorAgentId: "agent-b",
          body: "only",
          replyToMessageId: null,
          mentionAgentIds: [],
          createdAt: "2026-01-03T12:00:00.000Z",
        },
      ],
    });

    const result = await migrateLegacyChatStore({ ottieHome, logger, roomIndex, messageStore });
    expect(result).toEqual({ migrated: true, roomCount: 2, messageCount: 3 });

    // Index has both rooms with epochs.
    const rooms = roomIndex.list();
    expect(rooms).toHaveLength(2);
    for (const room of rooms) {
      expect(room.epoch).toMatch(/^[0-9a-f-]{36}$/);
    }

    // Room 1: messages reordered by createdAt, seq assigned 1..N.
    const room1Messages = await messageStore.getMessages("room-1");
    expect(room1Messages.map((m) => m.body)).toEqual(["first", "second"]);
    expect(room1Messages.map((m) => m.seq)).toEqual([1, 2]);
    // clientMessageId synthesized from id when missing.
    expect(room1Messages[0]!.clientMessageId).toBe("m-1");

    const room2Messages = await messageStore.getMessages("room-2");
    expect(room2Messages.map((m) => m.seq)).toEqual([1]);

    // Legacy file moved aside.
    const legacyPath = path.join(ottieHome, "chat", "rooms.json");
    const sentinelPath = `${legacyPath}.migrated`;
    await expect(stat(legacyPath)).rejects.toMatchObject({ code: "ENOENT" });
    const sentinel = await readFile(sentinelPath, "utf8");
    expect(JSON.parse(sentinel)).toMatchObject({
      rooms: expect.any(Array),
      messages: expect.any(Array),
    });
  });

  test("idempotent: running migration twice doesn't re-import or duplicate", async () => {
    await writeLegacyFile({
      rooms: [
        {
          id: "room-1",
          name: "alpha",
          purpose: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      messages: [
        {
          id: "m-1",
          roomId: "room-1",
          authorAgentId: "agent-a",
          body: "hi",
          replyToMessageId: null,
          mentionAgentIds: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const first = await migrateLegacyChatStore({ ottieHome, logger, roomIndex, messageStore });
    expect(first.migrated).toBe(true);

    // Re-run with a fresh in-memory index/store (simulating daemon restart):
    // the second run sees the sentinel and short-circuits.
    const freshIndex = new ChatRoomIndexStore({
      filePath: path.join(ottieHome, "chat", "rooms-index.json"),
      logger,
    });
    await freshIndex.load();
    const freshStore = new DurableChatMessageStore({
      rootDir: path.join(ottieHome, "chat", "rooms"),
      logger,
    });
    const second = await migrateLegacyChatStore({
      ottieHome,
      logger,
      roomIndex: freshIndex,
      messageStore: freshStore,
    });
    expect(second).toEqual({ migrated: false, roomCount: 0, messageCount: 0 });

    // Data still intact, no duplicates.
    expect(freshIndex.list()).toHaveLength(1);
    const messages = await freshStore.getMessages("room-1");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.seq).toBe(1);
  });
});
