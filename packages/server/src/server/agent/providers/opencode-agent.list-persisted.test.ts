import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { OpenCodeAgentClient } from "./opencode-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

// SES-02 / CONCERNS H4 — listPersistedAgents must return recovered
// session descriptors after a daemon restart, not the legacy stub `[]`.
//
// The test substitutes the OpenCode sessions root via the
// `OTTIE_OPENCODE_HOME` env-var seam (per plan 01-03 Task 3 sub-task A),
// writes synthetic info JSON files matching OpenCode's on-disk layout
// (`storage/session/info/<sessionId>.json`), and asserts the descriptors
// flow back through the Claude-mirrored pipeline.

function setupTempStorage(layout: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "opencode-list-persisted-"));
  const infoDir = path.join(root, "storage", "session", "info");
  mkdirSync(infoDir, { recursive: true });
  for (const [filename, contents] of Object.entries(layout)) {
    writeFileSync(path.join(infoDir, filename), contents);
  }
  return root;
}

const PRESERVED_OTTIE_OPENCODE_HOME = process.env.OTTIE_OPENCODE_HOME;

afterEach(() => {
  // Restore env-var snapshot so other suites are not contaminated.
  if (PRESERVED_OTTIE_OPENCODE_HOME === undefined) {
    delete process.env.OTTIE_OPENCODE_HOME;
  } else {
    process.env.OTTIE_OPENCODE_HOME = PRESERVED_OTTIE_OPENCODE_HOME;
  }
});

describe("OpenCode listPersistedAgents", () => {
  const logger = createTestLogger();

  test("returns descriptors for valid session info files", async () => {
    const root = setupTempStorage({
      "session-abc.json": JSON.stringify({
        id: "session-abc",
        title: "Refactor message router",
        directory: "/tmp/repo-a",
        time: { created: 1000, updated: 2000 },
      }),
      "session-def.json": JSON.stringify({
        id: "session-def",
        title: "Fix daemon bug",
        directory: "/tmp/repo-b",
        time: { created: 3000, updated: 4000 },
      }),
    });
    process.env.OTTIE_OPENCODE_HOME = root;

    const client = new OpenCodeAgentClient(logger);
    const result = await client.listPersistedAgents({ limit: 10 });

    expect(result.length).toBeGreaterThanOrEqual(2);
    const ids = result.map((d) => d.sessionId).sort();
    expect(ids).toContain("session-abc");
    expect(ids).toContain("session-def");

    const abc = result.find((d) => d.sessionId === "session-abc");
    expect(abc).toBeDefined();
    expect(abc?.provider).toBe("opencode");
    expect(abc?.cwd).toBe("/tmp/repo-a");
    expect(abc?.title).toBe("Refactor message router");
    expect(abc?.persistence.provider).toBe("opencode");
    expect(abc?.persistence.sessionId).toBe("session-abc");
    expect(abc?.persistence.nativeHandle).toBe("session-abc");
  });

  test("returns [] when storage root does not exist", async () => {
    process.env.OTTIE_OPENCODE_HOME = path.join(tmpdir(), `opencode-nonexistent-${Date.now()}`);
    const client = new OpenCodeAgentClient(logger);
    const result = await client.listPersistedAgents();
    expect(result).toEqual([]);
  });

  test("skips malformed JSON files instead of throwing", async () => {
    const root = setupTempStorage({
      "valid.json": JSON.stringify({
        id: "session-good",
        title: "Good session",
        directory: "/tmp/repo-good",
      }),
      "broken.json": "{not valid json at all",
    });
    process.env.OTTIE_OPENCODE_HOME = root;

    const client = new OpenCodeAgentClient(logger);
    const result = await client.listPersistedAgents();

    // Malformed file dropped; valid one passes through.
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe("session-good");
  });

  test("skips files missing required fields (id or directory)", async () => {
    const root = setupTempStorage({
      "missing-id.json": JSON.stringify({ title: "x", directory: "/tmp/x" }),
      "missing-dir.json": JSON.stringify({ id: "x", title: "x" }),
      "complete.json": JSON.stringify({
        id: "session-complete",
        title: "Complete",
        directory: "/tmp/r",
      }),
    });
    process.env.OTTIE_OPENCODE_HOME = root;

    const client = new OpenCodeAgentClient(logger);
    const result = await client.listPersistedAgents();
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe("session-complete");
  });

  test("synthesizes a title when none is present in the info file", async () => {
    const root = setupTempStorage({
      "untitled.json": JSON.stringify({
        id: "session-untitled-12345678",
        directory: "/tmp/r",
      }),
    });
    process.env.OTTIE_OPENCODE_HOME = root;

    const client = new OpenCodeAgentClient(logger);
    const result = await client.listPersistedAgents();
    expect(result).toHaveLength(1);
    // Synthesized title format: `OpenCode session ${sessionId.slice(0, 8)}`.
    // sessionId "session-untitled-12345678".slice(0, 8) === "session-"
    expect(result[0]?.title).toBe("OpenCode session session-");
  });

  test("respects the limit option", async () => {
    const root = setupTempStorage({
      "s1.json": JSON.stringify({ id: "s1", directory: "/r1" }),
      "s2.json": JSON.stringify({ id: "s2", directory: "/r2" }),
      "s3.json": JSON.stringify({ id: "s3", directory: "/r3" }),
    });
    process.env.OTTIE_OPENCODE_HOME = root;

    const client = new OpenCodeAgentClient(logger);
    const result = await client.listPersistedAgents({ limit: 2 });
    expect(result).toHaveLength(2);
  });

  test("falls back to projectID when directory is absent", async () => {
    const root = setupTempStorage({
      "via-project.json": JSON.stringify({
        id: "session-via-project",
        title: "from projectID",
        projectID: "/tmp/legacy-cwd",
      }),
    });
    process.env.OTTIE_OPENCODE_HOME = root;

    const client = new OpenCodeAgentClient(logger);
    const result = await client.listPersistedAgents();
    expect(result).toHaveLength(1);
    expect(result[0]?.cwd).toBe("/tmp/legacy-cwd");
  });
});
