import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionInboundMessage, SessionOutboundMessage } from "../../shared/messages.js";
import { MessageRouter } from "../session/router.js";

import { LocalTokenService, registerLocalTokenHandlers } from "./local-token-service.js";

// `regenerate()` writes through `generateAndWriteLocalToken` and re-resolves the
// mode. Using a real temp $OTTIE_HOME (instead of mocks) per
// `packages/server/CLAUDE.md` "Real deps over mocks" — the file system IS the
// contract here, and a vi.mock would obscure the actual write semantics.
let tempHome: string;
let prevOttieHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(path.join(os.tmpdir(), "ottie-local-token-service-"));
  prevOttieHome = process.env.OTTIE_HOME;
  process.env.OTTIE_HOME = tempHome;
  delete process.env.OTTIE_LOCAL_TOKEN;
});

afterEach(() => {
  if (prevOttieHome === undefined) {
    delete process.env.OTTIE_HOME;
  } else {
    process.env.OTTIE_HOME = prevOttieHome;
  }
  try {
    rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("LocalTokenService", () => {
  describe("getStatus", () => {
    it("Mode A → mode='loopback-trust', tokenPresent=false", async () => {
      const service = new LocalTokenService({ kind: "loopback-trust" });
      const status = await service.getStatus();
      expect(status.mode).toBe("loopback-trust");
      expect(status.tokenPresent).toBe(false);
    });

    it("Mode B → mode='token-file', tokenPresent=true", async () => {
      const service = new LocalTokenService({ kind: "token-file", token: "abc" });
      const status = await service.getStatus();
      expect(status.mode).toBe("token-file");
      expect(status.tokenPresent).toBe(true);
    });

    it("Mode C → mode='explicit', tokenPresent=true", async () => {
      const service = new LocalTokenService({ kind: "explicit", token: "abc" });
      const status = await service.getStatus();
      expect(status.mode).toBe("explicit");
      expect(status.tokenPresent).toBe(true);
    });
  });

  describe("regenerate (happy path)", () => {
    it("starting from Mode A, regenerate() writes a token and transitions to Mode B", async () => {
      const service = new LocalTokenService({ kind: "loopback-trust" });
      const result = await service.regenerate();
      expect(result.success).toBe(true);

      const status = await service.getStatus();
      expect(status.mode).toBe("token-file");
      expect(status.tokenPresent).toBe(true);
    });

    it("calling regenerate() twice produces two different tokens on disk", async () => {
      const service = new LocalTokenService({ kind: "loopback-trust" });
      await service.regenerate();

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      const t1 = fs.readFileSync(path.join(tempHome, "local-token"), "utf8");

      await service.regenerate();
      const t2 = fs.readFileSync(path.join(tempHome, "local-token"), "utf8");

      expect(t1).not.toBe(t2);
    });
  });

  describe("regenerate (error path)", () => {
    it("returns {success: false, error} when generateAndWriteLocalToken throws", async () => {
      // Force a write error: replace OTTIE_HOME with a path the process cannot
      // write to. Use a path that points into a regular file (not a directory)
      // so create-dir/write fails.
      const badPath = path.join(tempHome, "not-a-dir");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      fs.writeFileSync(badPath, "i am a file");

      // Now point OTTIE_HOME at a path INSIDE the regular file — mkdirSync
      // (called from resolveOttieHome) will fail with ENOTDIR.
      process.env.OTTIE_HOME = path.join(badPath, "subdir");

      const service = new LocalTokenService({ kind: "loopback-trust" });
      const result = await service.regenerate();
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("registerLocalTokenHandlers", () => {
  it("registers exactly the two inbound local-token RPC kinds on the router", () => {
    const router = new MessageRouter();
    const service = new LocalTokenService({ kind: "loopback-trust" });
    const emitted: SessionOutboundMessage[] = [];

    registerLocalTokenHandlers(router, service, (msg) => {
      emitted.push(msg);
    });

    expect(router.has("local_token_status_request")).toBe(true);
    expect(router.has("local_token_regenerate_request")).toBe(true);
    // Sanity: response kinds are NOT registered (router only handles inbound).
    expect(router.has("local_token_status_response")).toBe(false);
    expect(router.has("local_token_regenerate_response")).toBe(false);
  });

  it("status_request handler emits a status_response with the resolved mode + tokenPresent", async () => {
    const router = new MessageRouter();
    const service = new LocalTokenService({ kind: "explicit", token: "x" });
    const emitted: SessionOutboundMessage[] = [];

    registerLocalTokenHandlers(router, service, (msg) => emitted.push(msg));

    const inbound: SessionInboundMessage = {
      type: "local_token_status_request",
      requestId: "req-1",
    };
    await router.dispatch(inbound);

    expect(emitted).toHaveLength(1);
    const msg = emitted[0];
    expect(msg.type).toBe("local_token_status_response");
    if (msg.type === "local_token_status_response") {
      expect(msg.requestId).toBe("req-1");
      expect(msg.mode).toBe("explicit");
      expect(msg.tokenPresent).toBe(true);
    }
  });

  it("regenerate_request handler emits a regenerate_response with success=true on the happy path", async () => {
    const router = new MessageRouter();
    const service = new LocalTokenService({ kind: "loopback-trust" });
    const emitted: SessionOutboundMessage[] = [];

    registerLocalTokenHandlers(router, service, (msg) => emitted.push(msg));

    const inbound: SessionInboundMessage = {
      type: "local_token_regenerate_request",
      requestId: "req-2",
    };
    await router.dispatch(inbound);

    expect(emitted).toHaveLength(1);
    const msg = emitted[0];
    expect(msg.type).toBe("local_token_regenerate_response");
    if (msg.type === "local_token_regenerate_response") {
      expect(msg.requestId).toBe("req-2");
      expect(msg.success).toBe(true);
      expect(msg.error).toBeUndefined();
    }
  });

  it("regenerate_request handler emits a regenerate_response with success=false + error on failure", async () => {
    // Spy-mock generateAndWriteLocalToken indirectly by pointing OTTIE_HOME
    // at an invalid path (see error-path test above for the same setup).
    const badPath = path.join(tempHome, "not-a-dir-2");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(badPath, "i am a file");
    process.env.OTTIE_HOME = path.join(badPath, "subdir");

    const router = new MessageRouter();
    const service = new LocalTokenService({ kind: "loopback-trust" });
    const emitted: SessionOutboundMessage[] = [];

    registerLocalTokenHandlers(router, service, (msg) => emitted.push(msg));

    const inbound: SessionInboundMessage = {
      type: "local_token_regenerate_request",
      requestId: "req-3",
    };
    await router.dispatch(inbound);

    expect(emitted).toHaveLength(1);
    const msg = emitted[0];
    expect(msg.type).toBe("local_token_regenerate_response");
    if (msg.type === "local_token_regenerate_response") {
      expect(msg.requestId).toBe("req-3");
      expect(msg.success).toBe(false);
      expect(typeof msg.error).toBe("string");
      expect((msg.error ?? "").length).toBeGreaterThan(0);
    }
  });

  it("status_request emit-callback receives the message synchronously after dispatch resolves", async () => {
    // Sanity: order matters — status response must arrive after dispatch settles.
    const router = new MessageRouter();
    const service = new LocalTokenService({ kind: "loopback-trust" });
    const emitFn = vi.fn();

    registerLocalTokenHandlers(router, service, emitFn);

    expect(emitFn).not.toHaveBeenCalled();
    await router.dispatch({
      type: "local_token_status_request",
      requestId: "ordering-check",
    });
    expect(emitFn).toHaveBeenCalledTimes(1);
  });
});
