import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";

import { ChatCursorStore } from "./chat-cursor-store.js";

describe("ChatCursorStore", () => {
  let rootDir: string;
  let store: ChatCursorStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "ottie-chat-cursors-"));
    store = new ChatCursorStore({ rootDir, logger: pino({ level: "silent" }) });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("get returns null when no acks recorded", async () => {
    expect(await store.get("client-1", "room-1")).toBeNull();
    expect(await store.getAll("client-1")).toEqual({});
  });

  test("delivered ack records the cursor", async () => {
    const result = await store.update("client-1", "room-1", 5, "delivered");
    expect(result.advanced).toBe(true);
    expect(result.cursor.lastDeliveredSeq).toBe(5);
    expect(result.cursor.lastReadSeq).toBe(0);

    const fetched = await store.get("client-1", "room-1");
    expect(fetched?.lastDeliveredSeq).toBe(5);
    expect(fetched?.lastReadSeq).toBe(0);
  });

  test("read ack bumps both delivered and read cursors", async () => {
    const result = await store.update("client-1", "room-1", 7, "read");
    expect(result.advanced).toBe(true);
    expect(result.cursor.lastDeliveredSeq).toBe(7);
    expect(result.cursor.lastReadSeq).toBe(7);
  });

  test("cursors only advance — stale acks are no-ops", async () => {
    await store.update("client-1", "room-1", 10, "delivered");
    await store.update("client-1", "room-1", 8, "read");

    // Stale delivered ack at 5 — no change to delivered (still 10).
    // But read=8 was the previous high-water mark for read, so a read ack
    // at 5 is a no-op for both fields.
    const stale = await store.update("client-1", "room-1", 5, "delivered");
    expect(stale.advanced).toBe(false);
    expect(stale.cursor.lastDeliveredSeq).toBe(10);
    expect(stale.cursor.lastReadSeq).toBe(8);

    // Even stale read at 5 is a no-op.
    const staleRead = await store.update("client-1", "room-1", 5, "read");
    expect(staleRead.advanced).toBe(false);
  });

  test("read ack at seq > existing delivered bumps both", async () => {
    await store.update("client-1", "room-1", 3, "delivered");
    const result = await store.update("client-1", "room-1", 7, "read");
    expect(result.advanced).toBe(true);
    expect(result.cursor.lastDeliveredSeq).toBe(7); // bumped from 3
    expect(result.cursor.lastReadSeq).toBe(7);
  });

  test("read ack at seq < existing delivered bumps only read", async () => {
    await store.update("client-1", "room-1", 10, "delivered");
    const result = await store.update("client-1", "room-1", 5, "read");
    expect(result.advanced).toBe(true);
    expect(result.cursor.lastDeliveredSeq).toBe(10); // unchanged (already higher)
    expect(result.cursor.lastReadSeq).toBe(5);
  });

  test("cursors are scoped per client and per room", async () => {
    await store.update("client-1", "room-A", 5, "delivered");
    await store.update("client-1", "room-B", 9, "read");
    await store.update("client-2", "room-A", 7, "read");

    expect((await store.get("client-1", "room-A"))?.lastDeliveredSeq).toBe(5);
    expect((await store.get("client-1", "room-B"))?.lastReadSeq).toBe(9);
    expect((await store.get("client-2", "room-A"))?.lastReadSeq).toBe(7);
    // Cross-client isolation:
    expect(await store.get("client-2", "room-B")).toBeNull();
  });

  test("cursors persist across store recreation (daemon restart)", async () => {
    await store.update("client-1", "room-1", 5, "delivered");
    await store.update("client-1", "room-1", 3, "read");

    const fresh = new ChatCursorStore({ rootDir, logger: pino({ level: "silent" }) });
    const cursor = await fresh.get("client-1", "room-1");
    expect(cursor).not.toBeNull();
    expect(cursor?.lastDeliveredSeq).toBe(5);
    expect(cursor?.lastReadSeq).toBe(3);
  });

  test("rejects unsafe clientIds with path separators", async () => {
    await expect(store.update("../escape", "room-1", 1, "delivered")).rejects.toThrow(
      /Invalid clientId/,
    );
  });

  test("rejects negative or non-integer seq", async () => {
    await expect(store.update("client-1", "room-1", -1, "delivered")).rejects.toThrow(
      /Invalid ack seq/,
    );
    await expect(store.update("client-1", "room-1", 1.5, "delivered")).rejects.toThrow(
      /Invalid ack seq/,
    );
  });

  test("deleteRoom drops the room from every client's cursor map", async () => {
    await store.update("client-1", "room-A", 5, "delivered");
    await store.update("client-1", "room-B", 8, "delivered");
    await store.update("client-2", "room-A", 3, "delivered");

    await store.deleteRoom("room-A");

    expect(await store.get("client-1", "room-A")).toBeNull();
    expect(await store.get("client-2", "room-A")).toBeNull();
    // Other rooms unaffected.
    expect((await store.get("client-1", "room-B"))?.lastDeliveredSeq).toBe(8);
  });

  test("getAll returns a snapshot keyed by roomId", async () => {
    await store.update("client-1", "room-A", 5, "delivered");
    await store.update("client-1", "room-B", 8, "read");
    const all = await store.getAll("client-1");
    expect(Object.keys(all).sort()).toEqual(["room-A", "room-B"]);
    expect(all["room-A"]!.lastDeliveredSeq).toBe(5);
    expect(all["room-B"]!.lastReadSeq).toBe(8);
  });
});
