import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import pino from "pino";

import { DurableChatMessageStore } from "./durable-chat-message-store.js";
import type { StoredChatMessage } from "./chat-types.js";

function makeMessage(
  overrides: Partial<StoredChatMessage> & {
    seq: number;
    roomId: string;
  },
): StoredChatMessage {
  return {
    id: overrides.id ?? `msg-${overrides.seq}`,
    roomId: overrides.roomId,
    authorAgentId: overrides.authorAgentId ?? "agent-a",
    body: overrides.body ?? `body ${overrides.seq}`,
    replyToMessageId: overrides.replyToMessageId ?? null,
    mentionAgentIds: overrides.mentionAgentIds ?? [],
    createdAt: overrides.createdAt ?? new Date(2026, 0, overrides.seq).toISOString(),
    seq: overrides.seq,
    clientMessageId: overrides.clientMessageId ?? `cmid-${overrides.seq}`,
  };
}

describe("DurableChatMessageStore", () => {
  let rootDir: string;
  let store: DurableChatMessageStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "ottie-chat-jsonl-"));
    store = new DurableChatMessageStore({ rootDir, logger: pino({ level: "silent" }) });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("appends one JSONL line per message, in order, with no rewrite of prior lines", async () => {
    const roomId = "room-1";
    await store.append(roomId, makeMessage({ roomId, seq: 1, body: "first" }));
    await store.append(roomId, makeMessage({ roomId, seq: 2, body: "second" }));
    await store.append(roomId, makeMessage({ roomId, seq: 3, body: "third" }));

    const raw = await readFile(path.join(rootDir, `${roomId}.jsonl`), "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as StoredChatMessage);
    expect(parsed.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(parsed.map((m) => m.body)).toEqual(["first", "second", "third"]);
  });

  test("getMessages returns the same messages a fresh store reads from disk", async () => {
    const roomId = "room-2";
    await store.append(roomId, makeMessage({ roomId, seq: 1 }));
    await store.append(roomId, makeMessage({ roomId, seq: 2 }));

    const fresh = new DurableChatMessageStore({ rootDir, logger: pino({ level: "silent" }) });
    const loaded = await fresh.getMessages(roomId);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((m) => m.seq)).toEqual([1, 2]);
    expect(await fresh.getLatestSeq(roomId)).toBe(2);
  });

  test("getMessages on an unknown room returns [] and getLatestSeq returns 0", async () => {
    expect(await store.getMessages("ghost")).toEqual([]);
    expect(await store.getLatestSeq("ghost")).toBe(0);
  });

  test("idempotent: re-appending a message with seq <= latest is silently dropped", async () => {
    const roomId = "room-3";
    await store.append(roomId, makeMessage({ roomId, seq: 1, body: "real" }));
    await store.append(roomId, makeMessage({ roomId, seq: 2, body: "real" }));

    // Replay seq=1 — should not corrupt the file or duplicate the message.
    await store.append(roomId, makeMessage({ roomId, seq: 1, body: "should-be-ignored" }));
    const messages = await store.getMessages(roomId);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.body).toBe("real");
    expect(messages[1]!.seq).toBe(2);
  });

  test("rejects appending to a different roomId than the file's", async () => {
    await expect(store.append("room-a", makeMessage({ roomId: "room-b", seq: 1 }))).rejects.toThrow(
      /roomId mismatch/,
    );
  });

  test("rejects unsafe roomIds that contain path separators", async () => {
    await expect(
      store.append("../escape", makeMessage({ roomId: "../escape", seq: 1 })),
    ).rejects.toThrow(/Invalid roomId/);
  });

  test("bulkInsert preserves order and rejects non-monotonic batches", async () => {
    const roomId = "room-4";
    await store.bulkInsert(roomId, [
      makeMessage({ roomId, seq: 1 }),
      makeMessage({ roomId, seq: 2 }),
      makeMessage({ roomId, seq: 3 }),
    ]);
    const messages = await store.getMessages(roomId);
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3]);

    await expect(
      store.bulkInsert(roomId, [
        makeMessage({ roomId, seq: 5 }),
        makeMessage({ roomId, seq: 4 }), // out of order — rejected
      ]),
    ).rejects.toThrow(/non-monotonic seq/);
  });

  test("deleteRoom removes the JSONL file and clears the cache", async () => {
    const roomId = "room-5";
    await store.append(roomId, makeMessage({ roomId, seq: 1 }));
    expect(await store.getLatestSeq(roomId)).toBe(1);

    await store.deleteRoom(roomId);

    // File gone.
    await expect(readFile(path.join(rootDir, `${roomId}.jsonl`), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    // And a fresh read returns empty (cache was cleared).
    expect(await store.getMessages(roomId)).toEqual([]);
    expect(await store.getLatestSeq(roomId)).toBe(0);
  });

  test("concurrent appends are serialized — no interleaved bytes", async () => {
    const roomId = "room-6";
    const N = 50;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.append(roomId, makeMessage({ roomId, seq: i + 1 })),
      ),
    );

    const raw = await readFile(path.join(rootDir, `${roomId}.jsonl`), "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(N);
    // Every line must be valid JSON — if writes interleaved we'd see partial
    // objects or malformed lines.
    const parsed = lines.map((l) => JSON.parse(l) as StoredChatMessage);
    const seqs = parsed.map((m) => m.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  test("survives a malformed line in the JSONL file by skipping it", async () => {
    const roomId = "room-7";
    await store.append(roomId, makeMessage({ roomId, seq: 1, body: "good" }));
    // Corrupt the file by appending a garbage line plus a valid one.
    const filePath = path.join(rootDir, `${roomId}.jsonl`);
    const raw = await readFile(filePath, "utf8");
    const validNext = JSON.stringify(makeMessage({ roomId, seq: 2, body: "after-corrupt" }));
    await rm(filePath);
    await store.append(roomId, makeMessage({ roomId, seq: 1, body: "good" }));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, raw + "this-is-not-json\n" + validNext + "\n", "utf8");

    const fresh = new DurableChatMessageStore({ rootDir, logger: pino({ level: "silent" }) });
    const messages = await fresh.getMessages(roomId);
    // Two valid messages, the malformed line was skipped.
    expect(messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(messages[1]!.body).toBe("after-corrupt");
  });
});
