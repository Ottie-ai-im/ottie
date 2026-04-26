import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DurableAgentTimelineStore } from "./durable-agent-timeline-store.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

describe("DurableAgentTimelineStore", () => {
  let rootDir: string;
  let store: DurableAgentTimelineStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "ottie-timeline-"));
    store = new DurableAgentTimelineStore({ rootDir });
  });

  afterEach(async () => {
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

  it("persists rows and survives a fresh store instance (simulates daemon restart)", async () => {
    await store.bulkInsert("agent-1", [row(1, "hi"), row(2, "world")]);

    const fresh = new DurableAgentTimelineStore({ rootDir });
    const rows = await fresh.getCommittedRows("agent-1");
    expect(rows.map((r) => r.item.type === "user_message" && r.item.text)).toEqual(["hi", "world"]);
    expect(await fresh.getLatestCommittedSeq("agent-1")).toBe(2);
  });

  it("dedupes bulk inserts by seq (idempotent re-seed)", async () => {
    await store.bulkInsert("agent-2", [row(1, "a"), row(2, "b")]);
    await store.bulkInsert("agent-2", [row(1, "a"), row(2, "b"), row(3, "c")]);
    const rows = await store.getCommittedRows("agent-2");
    expect(rows.length).toBe(3);
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

  it("deleteAgent clears file and cache", async () => {
    await store.bulkInsert("agent-5", [row(1, "a")]);
    await store.deleteAgent("agent-5");
    expect(await store.getCommittedRows("agent-5")).toEqual([]);

    const fresh = new DurableAgentTimelineStore({ rootDir });
    expect(await fresh.getCommittedRows("agent-5")).toEqual([]);
  });

  it("rejects path-traversal agentIds", async () => {
    await expect(store.bulkInsert("../etc/passwd", [row(1, "x")])).rejects.toThrow();
  });

  it("serializes concurrent bulk inserts without dropping rows", async () => {
    await Promise.all([
      store.bulkInsert("agent-6", [row(1, "a")]),
      store.bulkInsert("agent-6", [row(2, "b")]),
      store.bulkInsert("agent-6", [row(3, "c")]),
    ]);
    const rows = await store.getCommittedRows("agent-6");
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });
});
