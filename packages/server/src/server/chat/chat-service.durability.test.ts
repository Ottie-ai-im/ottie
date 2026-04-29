// Regression tests for the chat service's new persistence behavior. These
// pin down the invariants that PR #2 (chat_subscribe / chat_ack RPCs) and
// PR #3 (client local-store + reconnect) depend on:
//   1. Each dispatched message gets a strictly monotonic per-room seq.
//   2. Posting with the same clientMessageId twice returns the same message.
//   3. A daemon restart preserves messages and their seq numbers.
//   4. Each room's messages live in their own JSONL file under chat/rooms/.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";

import { FileBackedChatService } from "./chat-service.js";

describe("FileBackedChatService durability", () => {
  let ottieHome: string;
  let service: FileBackedChatService;

  beforeEach(async () => {
    ottieHome = await mkdtemp(path.join(tmpdir(), "ottie-chat-durability-"));
    service = new FileBackedChatService({ ottieHome, logger: pino({ level: "silent" }) });
    await service.initialize();
  });

  afterEach(async () => {
    await rm(ottieHome, { recursive: true, force: true });
  });

  test("dispatchMessage assigns strictly monotonic seq per room", async () => {
    const room = await service.createRoom({ name: "seq-test" });

    const m1 = await service.dispatchMessage({
      room: room.id,
      authorAgentId: "agent-a",
      body: "first",
    });
    const m2 = await service.dispatchMessage({
      room: room.id,
      authorAgentId: "agent-a",
      body: "second",
    });
    const m3 = await service.dispatchMessage({
      room: room.id,
      authorAgentId: "agent-a",
      body: "third",
    });

    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
    expect(m3.seq).toBe(3);
  });

  test("seq counters are independent across rooms", async () => {
    const a = await service.createRoom({ name: "alpha" });
    const b = await service.createRoom({ name: "beta" });

    const a1 = await service.dispatchMessage({ room: a.id, authorAgentId: "x", body: "a1" });
    const b1 = await service.dispatchMessage({ room: b.id, authorAgentId: "x", body: "b1" });
    const a2 = await service.dispatchMessage({ room: a.id, authorAgentId: "x", body: "a2" });

    expect(a1.seq).toBe(1);
    expect(a2.seq).toBe(2);
    expect(b1.seq).toBe(1); // independent counter
  });

  test("re-dispatch with the same clientMessageId returns the original message", async () => {
    const room = await service.createRoom({ name: "retry-test" });
    const cmid = "client-uuid-1";

    const first = await service.dispatchMessage({
      room: room.id,
      authorAgentId: "agent-a",
      body: "hello",
      clientMessageId: cmid,
    });
    const retry = await service.dispatchMessage({
      room: room.id,
      authorAgentId: "agent-a",
      body: "this body is ignored on retry",
      clientMessageId: cmid,
    });

    expect(retry.id).toBe(first.id);
    expect(retry.seq).toBe(first.seq);
    expect(retry.body).toBe("hello"); // original body kept

    const allMessages = await service.readMessages({ room: room.id, limit: 10 });
    expect(allMessages).toHaveLength(1);
  });

  test("server-originated messages without clientMessageId still get one (synthesized from id)", async () => {
    const room = await service.createRoom({ name: "synth-cmid" });
    const m = await service.dispatchMessage({
      room: room.id,
      authorAgentId: "agent-a",
      body: "no client id supplied",
    });

    expect(m.clientMessageId).toBeDefined();
    expect(m.clientMessageId).toBe(m.id);
  });

  test("each room has its own JSONL file under chat/rooms/", async () => {
    const a = await service.createRoom({ name: "alpha-jsonl" });
    const b = await service.createRoom({ name: "beta-jsonl" });
    await service.dispatchMessage({ room: a.id, authorAgentId: "x", body: "a1" });
    await service.dispatchMessage({ room: b.id, authorAgentId: "x", body: "b1" });
    await service.dispatchMessage({ room: a.id, authorAgentId: "x", body: "a2" });

    const aFile = path.join(ottieHome, "chat", "rooms", `${a.id}.jsonl`);
    const bFile = path.join(ottieHome, "chat", "rooms", `${b.id}.jsonl`);
    await stat(aFile);
    await stat(bFile);

    const aRaw = await readFile(aFile, "utf8");
    const aLines = aRaw.split("\n").filter((l) => l.length > 0);
    expect(aLines).toHaveLength(2);
    const aFirst = JSON.parse(aLines[0]!);
    expect(aFirst.body).toBe("a1");
    expect(aFirst.seq).toBe(1);
  });

  test("daemon restart preserves messages, seq, and clientMessageId idempotency", async () => {
    const room1 = await service.createRoom({ name: "persist-test" });
    const cmid = "client-uuid-restart";
    const m1 = await service.dispatchMessage({
      room: room1.id,
      authorAgentId: "agent-a",
      body: "before-restart",
      clientMessageId: cmid,
    });
    const m2 = await service.dispatchMessage({
      room: room1.id,
      authorAgentId: "agent-a",
      body: "second",
    });

    // Simulate daemon restart by constructing a fresh service against the
    // same OTTIE_HOME — same file system, brand-new in-memory caches.
    const restarted = new FileBackedChatService({ ottieHome, logger: pino({ level: "silent" }) });
    await restarted.initialize();

    const messages = await restarted.readMessages({ room: room1.id, limit: 10 });
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.body)).toEqual(["before-restart", "second"]);
    expect(messages.map((m) => m.seq)).toEqual([1, 2]);

    // Idempotency cache also rebuilt from disk: a retry with the same
    // clientMessageId after restart returns the original message.
    const retry = await restarted.dispatchMessage({
      room: room1.id,
      authorAgentId: "agent-a",
      body: "ignored",
      clientMessageId: cmid,
    });
    expect(retry.id).toBe(m1.id);

    // No new message was created.
    const after = await restarted.readMessages({ room: room1.id, limit: 10 });
    expect(after).toHaveLength(2);

    // Subsequent dispatches resume seq numbering from where we left off.
    const m3 = await restarted.dispatchMessage({
      room: room1.id,
      authorAgentId: "agent-a",
      body: "after-restart",
    });
    expect(m3.seq).toBe(3);

    // Suppress unused-var warning for m2 (the assertion uses it implicitly via the array).
    void m2;
  });

  test("rooms have an epoch that survives restart", async () => {
    const created = await service.createRoom({ name: "epoch-test" });
    expect(created.epoch).toBeDefined();
    const originalEpoch = created.epoch!;

    const restarted = new FileBackedChatService({ ottieHome, logger: pino({ level: "silent" }) });
    await restarted.initialize();
    const inspected = await restarted.inspectRoom({ room: created.id });
    expect(inspected.room.epoch).toBe(originalEpoch);
  });

  test("setOnMessageDispatched listener fires once per message, with the seq-bearing record", async () => {
    const seen: number[] = [];
    service.setOnMessageDispatched((m) => {
      seen.push(m.seq);
    });
    const room = await service.createRoom({ name: "hook-test" });
    await service.dispatchMessage({ room: room.id, authorAgentId: "x", body: "a" });
    await service.dispatchMessage({ room: room.id, authorAgentId: "x", body: "b" });
    await service.dispatchMessage({ room: room.id, authorAgentId: "x", body: "c" });
    expect(seen).toEqual([1, 2, 3]);
  });

  test("setOnMessageDispatched is not invoked for clientMessageId retries (no duplicate broadcast)", async () => {
    const seen: string[] = [];
    service.setOnMessageDispatched((m) => {
      seen.push(m.id);
    });
    const room = await service.createRoom({ name: "retry-hook" });
    const cmid = "client-uuid-X";
    const first = await service.dispatchMessage({
      room: room.id,
      authorAgentId: "x",
      body: "once",
      clientMessageId: cmid,
    });
    await service.dispatchMessage({
      room: room.id,
      authorAgentId: "x",
      body: "ignored",
      clientMessageId: cmid,
    });
    expect(seen).toEqual([first.id]);
  });

  test("a thrown listener doesn't break dispatchMessage", async () => {
    service.setOnMessageDispatched(() => {
      throw new Error("listener boom");
    });
    const room = await service.createRoom({ name: "throwing-listener" });
    const m = await service.dispatchMessage({ room: room.id, authorAgentId: "x", body: "ok" });
    expect(m.seq).toBe(1);
  });

  test("deleting a room removes its JSONL file from disk", async () => {
    const room = await service.createRoom({ name: "to-delete" });
    await service.dispatchMessage({ room: room.id, authorAgentId: "x", body: "transient" });
    const filePath = path.join(ottieHome, "chat", "rooms", `${room.id}.jsonl`);
    await stat(filePath); // exists

    await service.deleteRoom({ room: room.id });

    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
