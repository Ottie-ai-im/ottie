import { describe, expect, it } from "vitest";

import { parseInboundMessage } from "./parse.js";

describe("session/parse — parseInboundMessage", () => {
  it("returns ok=true for a valid inbound message (ping)", () => {
    // ping is the simplest WSInboundMessage variant — minimal fixture
    const result = parseInboundMessage({ type: "ping" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("ping");
    }
  });

  it("returns ok=true for a wrapped session message (create_agent_request)", () => {
    // Mirrors the pattern from messages.attachments.test.ts — exercises the discriminated
    // union path through WSSessionInboundSchema so the boundary is end-to-end validated.
    const result = parseInboundMessage({
      type: "session",
      message: {
        type: "create_agent_request",
        requestId: "req-1",
        config: {
          provider: "codex",
          cwd: "/tmp/repo",
        },
        initialPrompt: "Review this PR",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("session");
    }
  });

  it("returns ok=false with a ZodError when the payload is missing the type field", () => {
    const result = parseInboundMessage({ message: "no-type-field" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns ok=false when type is not a known discriminator value", () => {
    const result = parseInboundMessage({ type: "totally-unknown-kind" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("never throws on bad input (does not propagate ZodError out of safeParse)", () => {
    expect(() => parseInboundMessage(null)).not.toThrow();
    expect(() => parseInboundMessage(undefined)).not.toThrow();
    expect(() => parseInboundMessage(42)).not.toThrow();
  });
});
