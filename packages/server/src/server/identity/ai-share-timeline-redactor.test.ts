import { describe, expect, test } from "vitest";

import type { AgentManagerEvent } from "../agent/agent-manager.js";
import type { AgentTimelineItem } from "../agent/agent-sdk-types.js";
import { redactAgentEventForShare } from "./ai-share-timeline-redactor.js";

/**
 * The redactor is the load-bearing piece of v2/d's §7 promise: "Bob
 * sees prompt + response only; Alice keeps tool-call details to
 * herself." These tests pin the policy so a future refactor that adds
 * a new timeline kind doesn't accidentally start leaking tool I/O.
 */

const AGENT_ID = "agent-shared-1";

function streamEvent(item: AgentTimelineItem): AgentManagerEvent {
  return {
    type: "agent_stream",
    agentId: AGENT_ID,
    event: { type: "timeline", item, provider: "claude" },
  };
}

describe("redactAgentEventForShare", () => {
  test("forwards assistant_message verbatim", () => {
    const out = redactAgentEventForShare(
      streamEvent({ type: "assistant_message", text: "Sorted." }),
      { agentId: AGENT_ID },
    );
    expect(out).toEqual({ kind: "assistant_message", text: "Sorted." });
  });

  test("forwards reasoning verbatim", () => {
    const out = redactAgentEventForShare(
      streamEvent({ type: "reasoning", text: "I should partition…" }),
      { agentId: AGENT_ID },
    );
    expect(out).toEqual({ kind: "reasoning", text: "I should partition…" });
  });

  test("forwards user_message and stamps promptId when caller passes one", () => {
    const out = redactAgentEventForShare(
      streamEvent({ type: "user_message", text: "explain quicksort" }),
      { agentId: AGENT_ID, lastPromptIdForUserMessage: "aip_42" },
    );
    expect(out).toEqual({
      kind: "user_message",
      text: "explain quicksort",
      promptId: "aip_42",
    });
  });

  test("DROPS tool_call timeline items — friend never sees tool calls", () => {
    const toolCallItem: AgentTimelineItem = {
      type: "tool_call",
      id: "t1",
      name: "Read",
      tool: "Read",
      detail: { kind: "read", path: "/etc/passwd" },
      status: "completed",
    } as AgentTimelineItem;
    const out = redactAgentEventForShare(streamEvent(toolCallItem), { agentId: AGENT_ID });
    expect(out).toBeNull();
  });

  test("DROPS todo timeline items", () => {
    const out = redactAgentEventForShare(
      streamEvent({ type: "todo", items: [{ text: "do thing", completed: false }] }),
      { agentId: AGENT_ID },
    );
    expect(out).toBeNull();
  });

  test("DROPS permission_requested + permission_resolved (owner-only modals)", () => {
    const reqEvent: AgentManagerEvent = {
      type: "agent_stream",
      agentId: AGENT_ID,
      event: {
        type: "permission_requested",
        provider: "claude",
        request: {
          id: "p1",
          provider: "claude",
          name: "Edit",
          kind: "tool",
        },
      },
    };
    expect(redactAgentEventForShare(reqEvent, { agentId: AGENT_ID })).toBeNull();
    const resEvent: AgentManagerEvent = {
      type: "agent_stream",
      agentId: AGENT_ID,
      event: {
        type: "permission_resolved",
        provider: "claude",
        requestId: "p1",
        resolution: { behavior: "allow" },
      },
    };
    expect(redactAgentEventForShare(resEvent, { agentId: AGENT_ID })).toBeNull();
  });

  test("DROPS usage_updated (token counts kept owner-side)", () => {
    const event: AgentManagerEvent = {
      type: "agent_stream",
      agentId: AGENT_ID,
      event: {
        type: "usage_updated",
        provider: "claude",
        usage: { inputTokens: 1, outputTokens: 1 } as never,
      },
    };
    expect(redactAgentEventForShare(event, { agentId: AGENT_ID })).toBeNull();
  });

  test("DROPS agent_state events (chatty, leak fields)", () => {
    const out = redactAgentEventForShare(
      { type: "agent_state", agent: { id: AGENT_ID } as never },
      { agentId: AGENT_ID },
    );
    expect(out).toBeNull();
  });

  test("DROPS events from a different agent (defense in depth)", () => {
    const out = redactAgentEventForShare(
      {
        type: "agent_stream",
        agentId: "other-agent",
        event: {
          type: "timeline",
          item: { type: "assistant_message", text: "leak" },
          provider: "claude",
        },
      },
      { agentId: AGENT_ID },
    );
    expect(out).toBeNull();
  });

  test("forwards turn_started / turn_completed as status pills", () => {
    expect(
      redactAgentEventForShare(
        {
          type: "agent_stream",
          agentId: AGENT_ID,
          event: { type: "turn_started", provider: "claude" },
        },
        { agentId: AGENT_ID },
      ),
    ).toEqual({ kind: "turn_started" });
    expect(
      redactAgentEventForShare(
        {
          type: "agent_stream",
          agentId: AGENT_ID,
          event: { type: "turn_completed", provider: "claude" },
        },
        { agentId: AGENT_ID },
      ),
    ).toEqual({ kind: "turn_completed" });
  });

  test("forwards turn_failed as error", () => {
    const out = redactAgentEventForShare(
      {
        type: "agent_stream",
        agentId: AGENT_ID,
        event: {
          type: "turn_failed",
          provider: "claude",
          error: "context overflow",
        },
      },
      { agentId: AGENT_ID },
    );
    expect(out).toEqual({ kind: "error", message: "context overflow" });
  });
});
