import { describe, expect, it } from "vitest";

import {
  AgentUpdateMessageSchema,
  CreateAgentRequestMessageSchema,
  SendAgentMessageRequestSchema,
  SessionInboundMessageSchema,
} from "./messages.js";

// ---------------------------------------------------------------------------
// v1.10 wire-compatibility frozen fixtures (ARCH-02 / Plan 01-01)
//
// These fixtures pin v1.10-shipped wire shapes against today's Zod schemas.
// CI runs them on every PR. If a schema change in messages.ts narrows a field
// (optional → required, nullable → non-null, string → enum, etc.) one of
// these parses will fail and the change MUST be revised.
//
// Hand-rolled (not captured from a real v1.10 daemon) — that's fine because
// the schema source IS the contract. v1.10 fixtures are richer than v1.8/v1.9
// because the v1.10 wire surface had more shipped fields.
//
// DO NOT EDIT FIXTURES. The whole point is that they never change.
// ---------------------------------------------------------------------------

// FROZEN — do not edit. Snapshot of v1.10-shipped agent_update wire shape.
const V1_10_AGENT_UPDATE_FIXTURE = {
  type: "agent_update",
  payload: {
    kind: "upsert",
    agent: {
      id: "agt_v110_001",
      provider: "claude",
      cwd: "/dev/repo",
      model: "claude-3-5-sonnet",
      createdAt: "2025-04-01T12:00:00.000Z",
      updatedAt: "2025-04-01T12:30:00.000Z",
      lastUserMessageAt: "2025-04-01T12:29:50.000Z",
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: "default",
      availableModes: [
        { id: "plan", label: "Plan" },
        { id: "default", label: "Default" },
      ],
      pendingPermissions: [],
      persistence: {
        provider: "claude",
        sessionId: "sess_v110_001",
      },
      title: "Refactor session.ts",
      labels: { priority: "high" },
      requiresAttention: false,
    },
  },
} as const;

// FROZEN — do not edit. Snapshot of v1.10-shipped create_agent_request wire shape.
const V1_10_CREATE_AGENT_FIXTURE = {
  type: "create_agent_request",
  requestId: "req-v110-create-1",
  config: {
    provider: "claude",
    cwd: "/dev/repo",
    modeId: "default",
    model: "claude-3-5-sonnet",
  },
  workspaceId: "ws-v110-001",
  initialPrompt: "Carve session.ts MessageRouter.",
  clientMessageId: "client-msg-v110-1",
  labels: { initiated: "voice" },
} as const;

// FROZEN — do not edit. Snapshot of v1.10-shipped send_agent_message_request wire shape.
const V1_10_SEND_MESSAGE_FIXTURE = {
  type: "send_agent_message_request",
  requestId: "req-v110-send-1",
  agentId: "agt_v110_001",
  text: "Continue the carve.",
  messageId: "msg-v110-client-1",
} as const;

// FROZEN — do not edit. Snapshot of v1.10-shipped agent_permission_response (allow with action).
const V1_10_PERMISSION_RESPONSE_FIXTURE = {
  type: "agent_permission_response",
  agentId: "agt_v110_001",
  requestId: "perm-v110-001",
  response: {
    behavior: "allow",
    selectedActionId: "approve-once",
  },
} as const;

describe("v1.10 wire compatibility", () => {
  it("v1.10 daemon -> client agent_update parses with current schema", () => {
    const parsed = AgentUpdateMessageSchema.parse(V1_10_AGENT_UPDATE_FIXTURE);
    expect(parsed.type).toBe("agent_update");
    expect(parsed.payload.kind).toBe("upsert");
    if (parsed.payload.kind === "upsert") {
      // Behavioral compat: a v1.10 client renders title || "Untitled".
      expect(parsed.payload.agent.title || "Untitled").toBe("Refactor session.ts");
      // Behavioral compat: labels default to empty record if absent.
      expect(parsed.payload.agent.labels.priority).toBe("high");
    }
  });

  it("v1.10 client -> daemon create_agent_request parses with current schema", () => {
    const parsed = CreateAgentRequestMessageSchema.parse(V1_10_CREATE_AGENT_FIXTURE);
    expect(parsed.type).toBe("create_agent_request");
    expect(parsed.config.provider).toBe("claude");
    expect(parsed.initialPrompt).toBe("Carve session.ts MessageRouter.");
    // Behavioral compat: v1.10 client passes labels and expects them preserved.
    expect(parsed.labels.initiated).toBe("voice");
  });

  it("v1.10 client -> daemon send_agent_message_request parses with current schema", () => {
    const parsed = SendAgentMessageRequestSchema.parse(V1_10_SEND_MESSAGE_FIXTURE);
    expect(parsed.type).toBe("send_agent_message_request");
    expect(parsed.text || "").toBe("Continue the carve.");
    expect(parsed.messageId).toBe("msg-v110-client-1");
    expect(parsed.attachments?.length ?? 0).toBe(0);
  });

  it("v1.10 client -> daemon agent_permission_response (allow w/ action) routes through SessionInboundMessageSchema", () => {
    const parsed = SessionInboundMessageSchema.parse(V1_10_PERMISSION_RESPONSE_FIXTURE);
    expect(parsed.type).toBe("agent_permission_response");
    if (parsed.type === "agent_permission_response") {
      expect(parsed.response.behavior).toBe("allow");
      if (parsed.response.behavior === "allow") {
        expect(parsed.response.selectedActionId).toBe("approve-once");
      }
    }
  });
});
