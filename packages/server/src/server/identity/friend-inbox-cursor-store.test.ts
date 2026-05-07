import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  advanceInboxCursor,
  inboxCursorFilePath,
  loadInboxCursor,
  saveInboxCursor,
} from "./friend-inbox-cursor-store.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ottie-inbox-cursor-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("inbox cursor store — Phase 3.b/2d", () => {
  test("loadInboxCursor returns empty cursor when no file exists", () => {
    const cursor = loadInboxCursor(home);
    expect(cursor.v).toBe(1);
    expect(cursor.lastSeenSeq).toBe("");
  });

  test("save then load roundtrips lastSeenSeq", () => {
    saveInboxCursor(home, {
      v: 1,
      lastSeenSeq: "0000000000001234-abcdef0123456789",
      updatedAt: "2026-05-07T03:00:00.000Z",
    });
    const cursor = loadInboxCursor(home);
    expect(cursor.lastSeenSeq).toBe("0000000000001234-abcdef0123456789");
    expect(cursor.updatedAt).toBe("2026-05-07T03:00:00.000Z");
  });

  test("loadInboxCursor returns blank cursor when file is corrupt", () => {
    const filePath = inboxCursorFilePath(home);
    // Make sure parent dir exists then drop garbage in.
    saveInboxCursor(home, { v: 1, lastSeenSeq: "ok", updatedAt: "2026" });
    writeFileSync(filePath, "{ this is not json", { mode: 0o600 });
    const cursor = loadInboxCursor(home);
    expect(cursor.lastSeenSeq).toBe("");
  });

  test("loadInboxCursor returns blank cursor on schema-shape mismatch", () => {
    saveInboxCursor(home, { v: 1, lastSeenSeq: "ok", updatedAt: "2026" });
    writeFileSync(inboxCursorFilePath(home), JSON.stringify({ v: 1 /* missing fields */ }));
    const cursor = loadInboxCursor(home);
    expect(cursor.lastSeenSeq).toBe("");
  });

  test("advanceInboxCursor persists and returns the new value", () => {
    const before = Date.now();
    const updated = advanceInboxCursor(home, "0000000000005000-abcdefabcdef1234");
    expect(updated.lastSeenSeq).toBe("0000000000005000-abcdefabcdef1234");
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(before);
    // Persisted: a fresh load sees the same value.
    expect(loadInboxCursor(home).lastSeenSeq).toBe("0000000000005000-abcdefabcdef1234");
  });
});
