import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { SqliteAgentTimelineStore } from "./sqlite-agent-timeline-store.js";

describe("SqliteAgentTimelineStore", () => {
  let rootDir: string;
  let dbPath: string;
  let store: SqliteAgentTimelineStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "ottie-sqlite-timeline-"));
    dbPath = join(rootDir, "timeline.sqlite3");
    store = new SqliteAgentTimelineStore({ dbPath });
  });

  afterEach(async () => {
    store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  function row(seq: number, text: string): AgentTimelineRow {
    return {
      seq,
      timestamp: `2026-04-26T00:00:0${seq}.000Z`,
      item: { type: "user_message", text, messageId: `msg-${seq}` },
    };
  }

  it("returns empty for unknown agent without throwing", async () => {
    expect(await store.getCommittedRows("unknown")).toEqual([]);
    expect(await store.getLatestCommittedSeq("unknown")).toBe(0);
    expect(await store.getLastItem("unknown")).toBeNull();
  });

  it("appendCommitted assigns monotonic seqs and survives reopen", async () => {
    await store.appendCommitted("a", { type: "user_message", text: "one", messageId: "m1" });
    await store.appendCommitted("a", { type: "user_message", text: "two", messageId: "m2" });
    expect(await store.getLatestCommittedSeq("a")).toBe(2);

    store.close();
    const fresh = new SqliteAgentTimelineStore({ dbPath });
    try {
      const rows = await fresh.getCommittedRows("a");
      expect(rows.map((r) => r.seq)).toEqual([1, 2]);
      expect(rows.map((r) => r.item.type === "user_message" && r.item.text)).toEqual([
        "one",
        "two",
      ]);
    } finally {
      fresh.close();
    }
    // re-open after the test so afterEach can close it cleanly
    store = new SqliteAgentTimelineStore({ dbPath });
  });

  it("dedupes bulk inserts by seq (idempotent re-seed)", async () => {
    await store.bulkInsert("agent-2", [row(1, "a"), row(2, "b")]);
    await store.bulkInsert("agent-2", [row(1, "a"), row(2, "b"), row(3, "c")]);
    const rows = await store.getCommittedRows("agent-2");
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("returns last assistant message coalesced across consecutive chunks", async () => {
    await store.bulkInsert("agent-3", [
      { seq: 1, timestamp: "t", item: { type: "user_message", text: "q", messageId: "m1" } },
      { seq: 2, timestamp: "t", item: { type: "assistant_message", text: "Hello " } },
      { seq: 3, timestamp: "t", item: { type: "assistant_message", text: "world." } },
    ]);
    expect(await store.getLastAssistantMessage("agent-3")).toBe("Hello world.");
  });

  it("getLastAssistantMessage stops at non-assistant gap", async () => {
    await store.bulkInsert("agent-3b", [
      { seq: 1, timestamp: "t", item: { type: "assistant_message", text: "old" } },
      { seq: 2, timestamp: "t", item: { type: "user_message", text: "q", messageId: "m1" } },
      { seq: 3, timestamp: "t", item: { type: "assistant_message", text: "new1 " } },
      { seq: 4, timestamp: "t", item: { type: "assistant_message", text: "new2" } },
    ]);
    expect(await store.getLastAssistantMessage("agent-3b")).toBe("new1 new2");
  });

  it("hasCommittedUserMessage matches by messageId+text", async () => {
    await store.bulkInsert("agent-4", [row(1, "hello")]);
    expect(
      await store.hasCommittedUserMessage("agent-4", { messageId: "msg-1", text: "hello" }),
    ).toBe(true);
    expect(
      await store.hasCommittedUserMessage("agent-4", { messageId: "msg-1", text: "different" }),
    ).toBe(false);
    expect(
      await store.hasCommittedUserMessage("agent-4", { messageId: "msg-other", text: "hello" }),
    ).toBe(false);
  });

  it("deleteAgent removes all rows for that agent only", async () => {
    await store.bulkInsert("a", [row(1, "x")]);
    await store.bulkInsert("b", [row(1, "y")]);
    await store.deleteAgent("a");
    expect(await store.getCommittedRows("a")).toEqual([]);
    expect((await store.getCommittedRows("b")).length).toBe(1);
  });

  it("fetchCommitted tail returns last N in seq order", async () => {
    await store.bulkInsert(
      "a",
      Array.from({ length: 10 }, (_, i) => row(i + 1, `m${i + 1}`)),
    );
    const result = await store.fetchCommitted("a", { direction: "tail", limit: 3 });
    expect(result.rows.map((r) => r.seq)).toEqual([8, 9, 10]);
    expect(result.window).toEqual({ minSeq: 1, maxSeq: 10, nextSeq: 11 });
    expect(result.hasOlder).toBe(true);
    expect(result.hasNewer).toBe(false);
  });

  it("fetchCommitted after returns rows strictly above cursor.seq", async () => {
    await store.bulkInsert(
      "a",
      Array.from({ length: 5 }, (_, i) => row(i + 1, `m${i + 1}`)),
    );
    const result = await store.fetchCommitted("a", {
      direction: "after",
      cursor: { epoch: "x", seq: 2 },
      limit: 100,
    });
    expect(result.rows.map((r) => r.seq)).toEqual([3, 4, 5]);
    expect(result.hasNewer).toBe(false);
  });

  it("fetchCommitted before returns rows strictly below cursor.seq, ascending", async () => {
    await store.bulkInsert(
      "a",
      Array.from({ length: 5 }, (_, i) => row(i + 1, `m${i + 1}`)),
    );
    const result = await store.fetchCommitted("a", {
      direction: "before",
      cursor: { epoch: "x", seq: 4 },
      limit: 2,
    });
    expect(result.rows.map((r) => r.seq)).toEqual([2, 3]);
    expect(result.hasOlder).toBe(true);
    expect(result.hasNewer).toBe(true);
  });

  it("limit=0 means 'all rows in selected window' (parity with JSONL store)", async () => {
    await store.bulkInsert(
      "a",
      Array.from({ length: 4 }, (_, i) => row(i + 1, `m${i + 1}`)),
    );
    const tail = await store.fetchCommitted("a", { direction: "tail", limit: 0 });
    expect(tail.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
  });

  it("appendCommitted is safe under concurrent calls (sqlite serializes)", async () => {
    await Promise.all([
      store.appendCommitted("c", { type: "user_message", text: "a", messageId: "1" }),
      store.appendCommitted("c", { type: "user_message", text: "b", messageId: "2" }),
      store.appendCommitted("c", { type: "user_message", text: "c", messageId: "3" }),
    ]);
    const rows = await store.getCommittedRows("c");
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });
});
