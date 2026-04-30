import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteAgentTimelineStore } from "./sqlite-agent-timeline-store.js";
import { importLegacyJsonlIfNeeded } from "./timeline-jsonl-import.js";

describe("importLegacyJsonlIfNeeded", () => {
  let rootDir: string;
  let dbPath: string;
  let store: SqliteAgentTimelineStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "ottie-jsonl-import-"));
    dbPath = join(rootDir, "timeline.sqlite3");
    store = new SqliteAgentTimelineStore({ dbPath });
  });

  afterEach(async () => {
    store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  async function writeJsonl(agentId: string, lines: object[]): Promise<void> {
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, `${agentId}.jsonl`),
      lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
      "utf8",
    );
  }

  it("imports rows from jsonl into sqlite and writes sentinel", async () => {
    await writeJsonl("agent-1", [
      { seq: 1, timestamp: "t1", item: { type: "user_message", text: "hi", messageId: "m1" } },
      { seq: 2, timestamp: "t2", item: { type: "assistant_message", text: "hello" } },
    ]);

    const summary = await importLegacyJsonlIfNeeded({ jsonlRootDir: rootDir, store });
    expect(summary?.agentsImported).toBe(1);
    expect(summary?.rowsImported).toBe(2);

    const rows = await store.getCommittedRows("agent-1");
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);

    const sentinel = await readFile(join(rootDir, ".jsonl-imported"), "utf8");
    expect(JSON.parse(sentinel).agentsImported).toBe(1);
  });

  it("is a no-op when sentinel exists", async () => {
    await writeFile(join(rootDir, ".jsonl-imported"), "{}", "utf8");
    await writeJsonl("agent-1", [
      { seq: 1, timestamp: "t1", item: { type: "user_message", text: "x", messageId: "m" } },
    ]);

    const summary = await importLegacyJsonlIfNeeded({ jsonlRootDir: rootDir, store });
    expect(summary).toBeNull();
    expect(await store.getCommittedRows("agent-1")).toEqual([]);
  });

  it("skips agents whose sqlite already has equal-or-higher max seq", async () => {
    await store.bulkInsert("agent-2", [
      { seq: 1, timestamp: "t", item: { type: "user_message", text: "preexist", messageId: "p" } },
      { seq: 2, timestamp: "t", item: { type: "assistant_message", text: "ok" } },
    ]);
    await writeJsonl("agent-2", [
      { seq: 1, timestamp: "t", item: { type: "user_message", text: "preexist", messageId: "p" } },
      { seq: 2, timestamp: "t", item: { type: "assistant_message", text: "ok" } },
    ]);

    const summary = await importLegacyJsonlIfNeeded({ jsonlRootDir: rootDir, store });
    expect(summary?.agentsImported).toBe(0);
    // Still has the original 2 rows
    expect((await store.getCommittedRows("agent-2")).length).toBe(2);
  });

  it("skips malformed lines but imports the rest", async () => {
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "agent-3.jsonl"),
      [
        `${JSON.stringify({ seq: 1, timestamp: "t", item: { type: "user_message", text: "ok", messageId: "m1" } })}`,
        "{ this is not json",
        `${JSON.stringify({ seq: 2, timestamp: "t", item: { type: "assistant_message", text: "fine" } })}`,
        "",
      ].join("\n"),
      "utf8",
    );

    const summary = await importLegacyJsonlIfNeeded({ jsonlRootDir: rootDir, store });
    expect(summary?.agentsImported).toBe(1);
    expect(summary?.rowsImported).toBe(2);
  });

  it("returns null when jsonl root dir does not exist", async () => {
    const ghost = join(rootDir, "does-not-exist");
    const summary = await importLegacyJsonlIfNeeded({ jsonlRootDir: ghost, store });
    expect(summary).toBeNull();
  });
});
