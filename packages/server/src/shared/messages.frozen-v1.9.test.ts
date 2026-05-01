import { describe, expect, it } from "vitest";

import {
  AgentUpdateMessageSchema,
  CreateAgentRequestMessageSchema,
  SendAgentMessageRequestSchema,
  SessionInboundMessageSchema,
} from "./messages.js";

// ---------------------------------------------------------------------------
// v1.9 wire-compatibility frozen fixtures (ARCH-02 / Plan 01-01)
//
// These fixtures pin v1.9-shipped wire shapes against today's Zod schemas.
// CI runs them on every PR. If a schema change in messages.ts narrows a field
// (optional → required, nullable → non-null, string → enum, etc.) one of
// these parses will fail and the change MUST be revised.
//
// Hand-rolled (not captured from a real v1.9 daemon) — that's fine because
// the schema source IS the contract. Each fixture omits fields v1.9 didn't
// know about, so any field newly made required will fail to parse here.
//
// DO NOT EDIT FIXTURES. The whole point is that they never change.
// ---------------------------------------------------------------------------

// FROZEN — do not edit. Snapshot of v1.9-shipped agent_update wire shape.
const V1_9_AGENT_UPDATE_FIXTURE = {
  type: "agent_update",
  payload: {
    kind: "upsert",
    agent: {
      id: "agt_v19_001",
      provider: "codex",
      cwd: "/work/repo",
      model: "gpt-5",
      createdAt: "2025-01-15T08:30:00.000Z",
      updatedAt: "2025-01-15T08:35:00.000Z",
      lastUserMessageAt: "2025-01-15T08:34:50.000Z",
      status: "running",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: {
        provider: "codex",
        sessionId: "sess_v19_001",
      },
      title: "Investigate flaky build",
    },
  },
} as const;

// FROZEN — do not edit. Snapshot of v1.9-shipped create_agent_request wire shape.
const V1_9_CREATE_AGENT_FIXTURE = {
  type: "create_agent_request",
  requestId: "req-v19-create-1",
  config: {
    provider: "codex",
    cwd: "/work/repo",
    modeId: "default",
  },
  initialPrompt: "Audit the auth flow.",
} as const;

// FROZEN — do not edit. Snapshot of v1.9-shipped send_agent_message_request wire shape.
const V1_9_SEND_MESSAGE_FIXTURE = {
  type: "send_agent_message_request",
  requestId: "req-v19-send-1",
  agentId: "agt_v19_001",
  text: "Show me the relevant tests.",
  messageId: "msg-v19-client-1",
} as const;

// FROZEN — do not edit. Snapshot of v1.9-shipped agent_permission_response (deny path).
const V1_9_PERMISSION_RESPONSE_FIXTURE = {
  type: "agent_permission_response",
  agentId: "agt_v19_001",
  requestId: "perm-v19-001",
  response: {
    behavior: "deny",
    message: "Don't touch credentials.",
  },
} as const;

describe("v1.9 wire compatibility", () => {
  it("v1.9 daemon -> client agent_update parses with current schema", () => {
    const parsed = AgentUpdateMessageSchema.parse(V1_9_AGENT_UPDATE_FIXTURE);
    expect(parsed.type).toBe("agent_update");
    expect(parsed.payload.kind).toBe("upsert");
    if (parsed.payload.kind === "upsert") {
      // Behavioral compat: v1.9 client renders title || "Untitled".
      expect(parsed.payload.agent.title || "Untitled").toBe("Investigate flaky build");
    }
  });

  it("v1.9 client -> daemon create_agent_request parses with current schema", () => {
    const parsed = CreateAgentRequestMessageSchema.parse(V1_9_CREATE_AGENT_FIXTURE);
    expect(parsed.type).toBe("create_agent_request");
    expect(parsed.config.provider).toBe("codex");
    expect(parsed.initialPrompt).toBe("Audit the auth flow.");
  });

  it("v1.9 client -> daemon send_agent_message_request parses with current schema", () => {
    const parsed = SendAgentMessageRequestSchema.parse(V1_9_SEND_MESSAGE_FIXTURE);
    expect(parsed.type).toBe("send_agent_message_request");
    expect(parsed.text || "").toBe("Show me the relevant tests.");
    expect(parsed.messageId).toBe("msg-v19-client-1");
    expect(parsed.attachments?.length ?? 0).toBe(0);
  });

  it("v1.9 client -> daemon agent_permission_response (deny) routes through SessionInboundMessageSchema", () => {
    const parsed = SessionInboundMessageSchema.parse(V1_9_PERMISSION_RESPONSE_FIXTURE);
    expect(parsed.type).toBe("agent_permission_response");
    if (parsed.type === "agent_permission_response") {
      expect(parsed.response.behavior).toBe("deny");
    }
  });
});
