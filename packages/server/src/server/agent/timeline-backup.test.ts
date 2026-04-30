import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteAgentTimelineStore } from "./sqlite-agent-timeline-store.js";
import { createTimelineBackupScheduler } from "./timeline-backup.js";

describe("timeline-backup", () => {
  let workDir: string;
  let dbPath: string;
  let backupsDir: string;
  let store: SqliteAgentTimelineStore;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "ottie-backup-"));
    dbPath = join(workDir, "timeline.sqlite3");
    backupsDir = join(workDir, "backups");
    store = new SqliteAgentTimelineStore({ dbPath });
    // Seed enough so VACUUM INTO has something to copy.
    await store.bulkInsert("agent-1", [
      {
        seq: 1,
        timestamp: "2026-04-29T00:00:00.000Z",
        item: { type: "user_message", text: "hello", messageId: "m1" },
      },
      {
        seq: 2,
        timestamp: "2026-04-29T00:00:01.000Z",
        item: { type: "assistant_message", text: "hi" },
      },
    ]);
  });

  afterEach(async () => {
    store.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("snapshotNow writes a sqlite file to backupsDir", async () => {
    const scheduler = createTimelineBackupScheduler({
      liveDb: store.getDatabaseHandleForInternalUse(),
      backupsDir,
    });
    const dest = await scheduler.snapshotNow();
    expect(dest.startsWith(backupsDir)).toBe(true);
    expect(dest.endsWith(".sqlite3")).toBe(true);

    const reopened = new SqliteAgentTimelineStore({ dbPath: dest });
    try {
      const rows = await reopened.getCommittedRows("agent-1");
      expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    } finally {
      reopened.close();
    }
  });

  it("snapshotNow honors a custom target path", async () => {
    await mkdir(backupsDir, { recursive: true });
    const target = join(backupsDir, "manual.sqlite3");
    const scheduler = createTimelineBackupScheduler({
      liveDb: store.getDatabaseHandleForInternalUse(),
      backupsDir,
    });
    const dest = await scheduler.snapshotNow(target);
    expect(dest).toBe(target);
  });

  it("retention deletes oldest snapshots beyond `keep`", async () => {
    const scheduler = createTimelineBackupScheduler({
      liveDb: store.getDatabaseHandleForInternalUse(),
      backupsDir,
      keep: 2,
    });
    // Pre-populate three older fake snapshot files with different mtimes.
    await mkdir(backupsDir, { recursive: true });
    const fakes = ["timeline-old1.sqlite3", "timeline-old2.sqlite3", "timeline-old3.sqlite3"].map(
      (n) => join(backupsDir, n),
    );
    for (const f of fakes) {
      await writeFile(f, "fake", "utf8");
    }
    // Touch them to enforce ordering: old1 oldest, old3 newest.
    const fs = await import("node:fs/promises");
    await fs.utimes(fakes[0]!, new Date(2020, 0, 1), new Date(2020, 0, 1));
    await fs.utimes(fakes[1]!, new Date(2021, 0, 1), new Date(2021, 0, 1));
    await fs.utimes(fakes[2]!, new Date(2022, 0, 1), new Date(2022, 0, 1));

    // Real snapshot is the newest by mtime — should keep itself + old3.
    await scheduler.snapshotNow();
    const remaining = (await readdir(backupsDir)).sort();
    // We kept = 2 → 2 most recent. The real snapshot + timeline-old3.
    expect(remaining.length).toBe(2);
    expect(remaining.includes("timeline-old3.sqlite3")).toBe(true);
  });

  it("start with intervalMs=0 disables scheduling", () => {
    const infoSpy = vi.fn();
    const scheduler = createTimelineBackupScheduler({
      liveDb: store.getDatabaseHandleForInternalUse(),
      backupsDir,
      intervalMs: 0,
      logger: { info: infoSpy, warn: vi.fn() },
    });
    scheduler.start();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    scheduler.stop();
  });
});
