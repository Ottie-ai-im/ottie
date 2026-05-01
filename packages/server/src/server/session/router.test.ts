import { describe, expect, it, vi } from "vitest";

import type { SessionInboundMessage } from "../../shared/messages.js";
import { SessionInboundMessageSchema } from "../../shared/messages.js";

import { MessageRouter, RouterMissError, type RouterHandler } from "./router.js";

// Helper: build a minimal SessionInboundMessage of a given kind for dispatch tests.
// The router only inspects msg.type — we only need a typed shell, not a fully-valid
// payload. Cast through unknown so we can construct stubs without forging the entire
// discriminator schema.
function fakeMsg(type: string): SessionInboundMessage {
  return { type } as unknown as SessionInboundMessage;
}

describe("session/router — MessageRouter", () => {
  it("register/dispatch round-trips on the registered kind", async () => {
    const router = new MessageRouter();
    const handler = vi.fn(async () => {});
    router.register("ping", handler);

    await router.dispatch(fakeMsg("ping"));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: "ping" });
  });

  it("has(kind) reports registered/unregistered kinds correctly", () => {
    const router = new MessageRouter();
    expect(router.has("foo")).toBe(false);
    router.register("foo", () => {});
    expect(router.has("foo")).toBe(true);
    expect(router.has("bar")).toBe(false);
  });

  it("throws on duplicate registration", () => {
    const router = new MessageRouter();
    const noop: RouterHandler = () => {};
    router.register("dup", noop);
    expect(() => router.register("dup", noop)).toThrow(/Duplicate handler/);
  });

  it("dispatch on unregistered kind throws RouterMissError", async () => {
    const router = new MessageRouter();
    await expect(router.dispatch(fakeMsg("never-registered"))).rejects.toBeInstanceOf(
      RouterMissError,
    );
  });

  it("RouterMissError carries the unknown kind", async () => {
    const router = new MessageRouter();
    let captured: unknown;
    try {
      await router.dispatch(fakeMsg("mystery-kind"));
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(RouterMissError);
    if (captured instanceof RouterMissError) {
      expect(captured.kind).toBe("mystery-kind");
    }
  });

  it("supports synchronous handlers (returning void) via the union type", async () => {
    const router = new MessageRouter();
    let called = false;
    router.register("sync", () => {
      called = true;
    });
    await router.dispatch(fakeMsg("sync"));
    expect(called).toBe(true);
  });

  it("the SessionInboundMessage discriminator enumerates a non-trivial set of kinds (sanity check)", () => {
    // Sanity check that the discriminator we'd register against has many kinds.
    // The carve registers ONE kind (agent_permission_response) in Phase 1; this assertion
    // documents that ambition by anchoring the test against the shared schema source.
    const kinds = SessionInboundMessageSchema.options
      .map((option) => {
        const shape = (option as { shape?: { type?: { value?: unknown } } }).shape;
        return shape?.type?.value;
      })
      .filter((v): v is string => typeof v === "string");
    expect(kinds.length).toBeGreaterThan(50);
    expect(kinds).toContain("agent_permission_response");
  });
});
