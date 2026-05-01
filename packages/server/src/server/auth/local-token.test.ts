import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  generateAndWriteLocalToken,
  resolveLocalTokenMode,
  verifyBearerToken,
  type LocalTokenMode,
} from "./local-token.js";

// ---------------------------------------------------------------------------
// Test harness: each test gets a fresh temp $OTTIE_HOME so state is isolated.
// We pass an explicit `env` object to resolveLocalTokenMode/generateAndWriteLocalToken
// rather than mutating process.env globally — keeps parallel test runs safe.
// ---------------------------------------------------------------------------

let tempHome: string;
let testEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  tempHome = mkdtempSync(path.join(os.tmpdir(), "ottie-local-token-"));
  testEnv = { OTTIE_HOME: tempHome };
});

afterEach(() => {
  // Best-effort cleanup; tests do not rely on this for correctness.
  try {
    // Use rmSync via fs/promises so we don't shell out.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    fs.rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("resolveLocalTokenMode", () => {
  it("returns Mode C (explicit) when OTTIE_LOCAL_TOKEN is set and non-empty", async () => {
    const env: NodeJS.ProcessEnv = { ...testEnv, OTTIE_LOCAL_TOKEN: "abc123" };
    const mode = await resolveLocalTokenMode(env);
    expect(mode.kind).toBe("explicit");
    if (mode.kind === "explicit") {
      expect(mode.token).toBe("abc123");
    }
  });

  it("does NOT treat empty OTTIE_LOCAL_TOKEN as Mode C", async () => {
    const env: NodeJS.ProcessEnv = { ...testEnv, OTTIE_LOCAL_TOKEN: "" };
    const mode = await resolveLocalTokenMode(env);
    expect(mode.kind).toBe("loopback-trust");
  });

  it("returns Mode B (token-file) when the file exists with non-empty content", async () => {
    writeFileSync(path.join(tempHome, "local-token"), "filetoken-xyz", { mode: 0o600 });
    const mode = await resolveLocalTokenMode(testEnv);
    expect(mode.kind).toBe("token-file");
    if (mode.kind === "token-file") {
      expect(mode.token).toBe("filetoken-xyz");
    }
  });

  it("trims trailing whitespace/newline from the token file", async () => {
    writeFileSync(path.join(tempHome, "local-token"), "filetoken-xyz\n");
    const mode = await resolveLocalTokenMode(testEnv);
    expect(mode.kind).toBe("token-file");
    if (mode.kind === "token-file") {
      expect(mode.token).toBe("filetoken-xyz");
    }
  });

  it("falls through to Mode A when the file is empty (whitespace-only)", async () => {
    writeFileSync(path.join(tempHome, "local-token"), "   \n");
    const mode = await resolveLocalTokenMode(testEnv);
    expect(mode.kind).toBe("loopback-trust");
  });

  it("returns Mode A (loopback-trust) when env unset and file absent (ENOENT)", async () => {
    const mode = await resolveLocalTokenMode(testEnv);
    expect(mode.kind).toBe("loopback-trust");
  });

  it("env-var takes precedence over file (Mode C wins)", async () => {
    writeFileSync(path.join(tempHome, "local-token"), "filetoken-xyz");
    const env: NodeJS.ProcessEnv = { ...testEnv, OTTIE_LOCAL_TOKEN: "envtoken-abc" };
    const mode = await resolveLocalTokenMode(env);
    expect(mode.kind).toBe("explicit");
    if (mode.kind === "explicit") {
      expect(mode.token).toBe("envtoken-abc");
    }
  });
});

describe("generateAndWriteLocalToken", () => {
  it("writes a 32-byte base64url token (43 chars unpadded) and returns it", async () => {
    const token = await generateAndWriteLocalToken(testEnv);
    // base64url(32 bytes) = 43 chars (no `=` padding).
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The file content matches what we returned.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const onDisk = fs.readFileSync(path.join(tempHome, "local-token"), "utf8");
    expect(onDisk).toBe(token);
  });

  it("writes the file with mode 0o600 on POSIX", async () => {
    if (process.platform === "win32") {
      // Windows ACL strategy is a follow-up (Phase 5); skip the mode assertion.
      return;
    }
    await generateAndWriteLocalToken(testEnv);
    const stats = statSync(path.join(tempHome, "local-token"));
    // The lower 9 bits of mode are owner/group/other rwx; mask with 0o777.
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("a freshly written token resolves into Mode B on the next read", async () => {
    const token = await generateAndWriteLocalToken(testEnv);
    const mode = await resolveLocalTokenMode(testEnv);
    expect(mode.kind).toBe("token-file");
    if (mode.kind === "token-file") {
      expect(mode.token).toBe(token);
    }
  });

  it("regenerating produces a different token (new random bytes each call)", async () => {
    const t1 = await generateAndWriteLocalToken(testEnv);
    const t2 = await generateAndWriteLocalToken(testEnv);
    expect(t1).not.toBe(t2);
  });
});

describe("verifyBearerToken", () => {
  const modeA: LocalTokenMode = { kind: "loopback-trust" };
  const modeB: LocalTokenMode = { kind: "token-file", token: "expected-token-12345" };
  const modeC: LocalTokenMode = { kind: "explicit", token: "expected-token-12345" };

  it("Mode A always accepts — even undefined or wrong token", () => {
    expect(verifyBearerToken(undefined, modeA)).toBe(true);
    expect(verifyBearerToken("anything", modeA)).toBe(true);
    expect(verifyBearerToken("", modeA)).toBe(true);
  });

  it("Mode B rejects undefined / empty provided token", () => {
    expect(verifyBearerToken(undefined, modeB)).toBe(false);
    expect(verifyBearerToken("", modeB)).toBe(false);
  });

  it("Mode B accepts the matching token", () => {
    expect(verifyBearerToken("expected-token-12345", modeB)).toBe(true);
  });

  it("Mode B rejects a mismatching same-length token (constant-time compare path)", () => {
    // Same length (20 chars), one char differs.
    expect(verifyBearerToken("expected-token-12346", modeB)).toBe(false);
  });

  it("Mode B rejects a different-length token without throwing (length guard)", () => {
    expect(verifyBearerToken("short", modeB)).toBe(false);
    expect(verifyBearerToken("expected-token-12345-extra-bytes", modeB)).toBe(false);
  });

  it("Mode C behaves identically to Mode B for compare semantics", () => {
    expect(verifyBearerToken("expected-token-12345", modeC)).toBe(true);
    expect(verifyBearerToken("wrong", modeC)).toBe(false);
    expect(verifyBearerToken(undefined, modeC)).toBe(false);
  });
});

describe("resolveLocalTokenMode error path (fail-closed on non-ENOENT fs errors)", () => {
  it("propagates non-ENOENT errors (e.g. EACCES) instead of silently dropping to Mode A", async () => {
    // Create the token-path as a directory so readFile fails with EISDIR (not ENOENT).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(path.join(tempHome, "local-token"));
    await expect(resolveLocalTokenMode(testEnv)).rejects.toThrow();
  });
});
