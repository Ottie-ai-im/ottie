import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import type { AgentManager } from "../agent/agent-manager.js";
import type {
  AgentPermissionResponse,
  AgentPermissionResult,
  AgentPromptInput,
} from "../agent/agent-sdk-types.js";
import type { SessionOutboundMessage } from "../../shared/messages.js";

import { PermissionHandler } from "./permission-handler.js";

// Minimal stub Logger surfacing only the methods PermissionHandler uses.
function makeLogger(): Logger {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  return logger as unknown as Logger;
}

interface Harness {
  handler: PermissionHandler;
  emitSpy: (msg: SessionOutboundMessage) => void;
  emitted: SessionOutboundMessage[];
  startFollowUpSpy: ReturnType<typeof vi.fn>;
  agentManager: { respondToPermission: ReturnType<typeof vi.fn> };
  logger: Logger;
}

function makeHarness(opts: {
  respondToPermissionResult?: AgentPermissionResult | undefined;
  respondToPermissionError?: Error;
}): Harness {
  const emitted: SessionOutboundMessage[] = [];
  const emitSpy = (msg: SessionOutboundMessage) => {
    emitted.push(msg);
  };
  const startFollowUpSpy = vi.fn();
  const agentManager = {
    respondToPermission: vi.fn(async () => {
      if (opts.respondToPermissionError) {
        throw opts.respondToPermissionError;
      }
      return opts.respondToPermissionResult;
    }),
  };
  const logger = makeLogger();
  const handler = new PermissionHandler({
    agentManager: agentManager as unknown as AgentManager,
    emit: emitSpy,
    logger,
    startFollowUpTurn: startFollowUpSpy,
  });
  return { handler, emitSpy, emitted, startFollowUpSpy, agentManager, logger };
}

const RESPONSE: AgentPermissionResponse = {
  behavior: "allow",
};

describe("session/permission-handler — PermissionHandler", () => {
  it("forwards a successful response to AgentManager and does NOT trigger a follow-up turn", async () => {
    const h = makeHarness({ respondToPermissionResult: undefined });

    await h.handler.handleResponse("agent-1", "req-1", RESPONSE);

    expect(h.agentManager.respondToPermission).toHaveBeenCalledTimes(1);
    expect(h.agentManager.respondToPermission).toHaveBeenCalledWith("agent-1", "req-1", RESPONSE);
    expect(h.startFollowUpSpy).not.toHaveBeenCalled();
    expect(h.emitted).toHaveLength(0);
  });

  it("triggers a follow-up turn when respondToPermission returns followUpPrompt", async () => {
    const followUp: AgentPromptInput = "please continue the implementation";
    const h = makeHarness({ respondToPermissionResult: { followUpPrompt: followUp } });

    await h.handler.handleResponse("agent-2", "req-2", RESPONSE);

    expect(h.startFollowUpSpy).toHaveBeenCalledTimes(1);
    expect(h.startFollowUpSpy).toHaveBeenCalledWith("agent-2", followUp);
    expect(h.emitted).toHaveLength(0);
  });

  it("does NOT trigger a follow-up when result.followUpPrompt is missing", async () => {
    const h = makeHarness({ respondToPermissionResult: {} });

    await h.handler.handleResponse("agent-3", "req-3", RESPONSE);

    expect(h.startFollowUpSpy).not.toHaveBeenCalled();
  });

  it("emits activity_log and re-throws when respondToPermission throws", async () => {
    const boom = new Error("kaboom");
    const h = makeHarness({ respondToPermissionError: boom });

    await expect(h.handler.handleResponse("agent-4", "req-4", RESPONSE)).rejects.toBe(boom);

    expect(h.emitted).toHaveLength(1);
    const log = h.emitted[0];
    expect(log).toBeDefined();
    if (log === undefined) return;
    expect(log.type).toBe("activity_log");
    if (log.type !== "activity_log") return;
    expect(log.payload.type).toBe("error");
    expect(log.payload.content).toContain("kaboom");
  });
});
