import { describe, expect, it } from "vitest";

import {
  AgentUpdateMessageSchema,
  CreateAgentRequestMessageSchema,
  SendAgentMessageRequestSchema,
  SessionInboundMessageSchema,
} from "./messages.js";

// ---------------------------------------------------------------------------
// v1.8 wire-compatibility frozen fixtures (ARCH-02 / Plan 01-01)
//
// These fixtures pin v1.8-shipped wire shapes against today's Zod schemas.
// CI runs them on every PR. If a schema change in messages.ts narrows a field
// (optional → required, nullable → non-null, string → enum, etc.) one of
// these parses will fail and the change MUST be revised.
//
// Hand-rolled (not captured from a real v1.8 daemon) — that's fine because
// the schema source IS the contract. Each fixture omits fields v1.8 didn't
// know about, so any field newly made required will fail to parse here.
//
// DO NOT EDIT FIXTURES. The whole point is that they never change.
// ---------------------------------------------------------------------------

// FROZEN — do not edit. Snapshot of v1.8-shipped agent_update wire shape.
const V1_8_AGENT_UPDATE_FIXTURE = {
  type: "agent_update",
  payload: {
    kind: "upsert",
    agent: {
      id: "agt_v18_001",
      provider: "claude",
      cwd: "/repo",
      model: "claude-3-5-sonnet",
      createdAt: "2024-09-01T00:00:00.000Z",
      updatedAt: "2024-09-01T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: false,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
    },
  },
} as const;

// FROZEN — do not edit. Snapshot of v1.8-shipped create_agent_request wire shape.
const V1_8_CREATE_AGENT_FIXTURE = {
  type: "create_agent_request",
  requestId: "req-v18-create-1",
  config: {
    provider: "claude",
    cwd: "/repo",
  },
} as const;

// FROZEN — do not edit. Snapshot of v1.8-shipped send_agent_message_request wire shape.
const V1_8_SEND_MESSAGE_FIXTURE = {
  type: "send_agent_message_request",
  requestId: "req-v18-send-1",
  agentId: "agt_v18_001",
  text: "Look at the failing test.",
} as const;

// FROZEN — do not edit. Snapshot of v1.8-shipped agent_permission_response wire shape.
const V1_8_PERMISSION_RESPONSE_FIXTURE = {
  type: "agent_permission_response",
  agentId: "agt_v18_001",
  requestId: "perm-v18-001",
  response: {
    behavior: "allow",
  },
} as const;

describe("v1.8 wire compatibility", () => {
  it("v1.8 daemon -> client agent_update parses with current schema", () => {
    const parsed = AgentUpdateMessageSchema.parse(V1_8_AGENT_UPDATE_FIXTURE);
    expect(parsed.type).toBe("agent_update");
    expect(parsed.payload.kind).toBe("upsert");
  });

  it("v1.8 client -> daemon create_agent_request parses with current schema", () => {
    const parsed = CreateAgentRequestMessageSchema.parse(V1_8_CREATE_AGENT_FIXTURE);
    expect(parsed.type).toBe("create_agent_request");
    expect(parsed.config.provider).toBe("claude");
    // Behavioral compat: a v1.8 client derives this and expects a string-or-empty.
    expect((parsed.initialPrompt ?? "")).toBe("");
  });

  it("v1.8 client -> daemon send_agent_message_request parses with current schema", () => {
    const parsed = SendAgentMessageRequestSchema.parse(V1_8_SEND_MESSAGE_FIXTURE);
    expect(parsed.type).toBe("send_agent_message_request");
    // Behavioral compat: a v1.8 client uses `text || ""` — must remain string.
    expect(parsed.text || "").toBe("Look at the failing test.");
    // Behavioral compat: attachments length defaults to 0 for v1.8 clients.
    expect(parsed.attachments?.length ?? 0).toBe(0);
  });

  it("v1.8 client -> daemon agent_permission_response routes through SessionInboundMessageSchema", () => {
    const parsed = SessionInboundMessageSchema.parse(V1_8_PERMISSION_RESPONSE_FIXTURE);
    expect(parsed.type).toBe("agent_permission_response");
    if (parsed.type === "agent_permission_response") {
      expect(parsed.response.behavior).toBe("allow");
    }
  });
});
