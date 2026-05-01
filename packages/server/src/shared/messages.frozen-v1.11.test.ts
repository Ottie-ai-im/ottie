import { describe, expect, it } from "vitest";

import {
  LocalTokenRegenerateRequestSchema,
  LocalTokenRegenerateResponseSchema,
  LocalTokenStatusRequestSchema,
  LocalTokenStatusResponseSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

// ---------------------------------------------------------------------------
// v1.11 wire-compatibility frozen fixtures (ARCH-02 / Plan 01-05)
//
// v1.11 ships four new message kinds for the Settings → Advanced → Local
// daemon panel (D-13). These fixtures pin the v1.11-shipped wire shapes
// against today's Zod schemas; CI runs them on every PR. If a future change
// in messages.ts narrows any of these schemas (e.g. drops `.optional()` from
// `mode` or `tokenPresent`), one of the parses below will fail and the change
// MUST be revised per the CLAUDE.md backward-compatibility rule.
//
// Hand-rolled (not captured from a real v1.11 daemon) — the schema source IS
// the contract. The "all fields present" + "optional fields omitted" pair on
// `local_token_status_response` exercises the `.optional()` discipline both
// directions.
//
// DO NOT EDIT FIXTURES. The whole point is that they never change.
// ---------------------------------------------------------------------------

// FROZEN — do not edit. Snapshot of v1.11-shipped local_token_status_request wire shape.
const V1_11_LOCAL_TOKEN_STATUS_REQUEST_FIXTURE = {
  type: "local_token_status_request",
  requestId: "req-v111-status-1",
} as const;

// FROZEN — do not edit. Snapshot of v1.11-shipped local_token_status_response (all fields present).
const V1_11_LOCAL_TOKEN_STATUS_RESPONSE_FULL_FIXTURE = {
  type: "local_token_status_response",
  requestId: "req-v111-status-1",
  mode: "token-file",
  tokenPresent: true,
} as const;

// FROZEN — do not edit. Snapshot of v1.11-shipped local_token_status_response (optional fields omitted — old daemon could send response with only required fields).
const V1_11_LOCAL_TOKEN_STATUS_RESPONSE_MINIMAL_FIXTURE = {
  type: "local_token_status_response",
  requestId: "req-v111-status-2",
} as const;

// FROZEN — do not edit. Snapshot of v1.11-shipped local_token_regenerate_request wire shape.
const V1_11_LOCAL_TOKEN_REGENERATE_REQUEST_FIXTURE = {
  type: "local_token_regenerate_request",
  requestId: "req-v111-regen-1",
} as const;

// FROZEN — do not edit. Snapshot of v1.11-shipped local_token_regenerate_response (success path).
const V1_11_LOCAL_TOKEN_REGENERATE_RESPONSE_SUCCESS_FIXTURE = {
  type: "local_token_regenerate_response",
  requestId: "req-v111-regen-1",
  success: true,
} as const;

// FROZEN — do not edit. Snapshot of v1.11-shipped local_token_regenerate_response (error path).
const V1_11_LOCAL_TOKEN_REGENERATE_RESPONSE_ERROR_FIXTURE = {
  type: "local_token_regenerate_response",
  requestId: "req-v111-regen-2",
  success: false,
  error: "EACCES: permission denied",
} as const;

describe("v1.11 wire compatibility — local-token RPC kinds (ARCH-03)", () => {
  it("v1.11 client -> daemon local_token_status_request fixture parses cleanly", () => {
    const parsed = LocalTokenStatusRequestSchema.parse(V1_11_LOCAL_TOKEN_STATUS_REQUEST_FIXTURE);
    expect(parsed.type).toBe("local_token_status_request");
    expect(parsed.requestId).toBe("req-v111-status-1");
  });

  it("v1.11 daemon -> client local_token_status_response (all fields present) parses cleanly", () => {
    const parsed = LocalTokenStatusResponseSchema.parse(
      V1_11_LOCAL_TOKEN_STATUS_RESPONSE_FULL_FIXTURE,
    );
    expect(parsed.type).toBe("local_token_status_response");
    expect(parsed.mode).toBe("token-file");
    expect(parsed.tokenPresent).toBe(true);
  });

  it("v1.11 daemon -> client local_token_status_response (optional fields omitted) parses cleanly", () => {
    // Forward-compat check: an older daemon could send the response without
    // the optional `mode` and `tokenPresent` fields. Today's client must still
    // parse it (graceful degradation — UI shows "Unknown" or similar).
    const parsed = LocalTokenStatusResponseSchema.parse(
      V1_11_LOCAL_TOKEN_STATUS_RESPONSE_MINIMAL_FIXTURE,
    );
    expect(parsed.type).toBe("local_token_status_response");
    expect(parsed.mode).toBeUndefined();
    expect(parsed.tokenPresent).toBeUndefined();
  });

  it("v1.11 client -> daemon local_token_regenerate_request fixture parses cleanly", () => {
    const parsed = LocalTokenRegenerateRequestSchema.parse(
      V1_11_LOCAL_TOKEN_REGENERATE_REQUEST_FIXTURE,
    );
    expect(parsed.type).toBe("local_token_regenerate_request");
    expect(parsed.requestId).toBe("req-v111-regen-1");
  });

  it("v1.11 daemon -> client local_token_regenerate_response (success) parses cleanly", () => {
    const parsed = LocalTokenRegenerateResponseSchema.parse(
      V1_11_LOCAL_TOKEN_REGENERATE_RESPONSE_SUCCESS_FIXTURE,
    );
    expect(parsed.type).toBe("local_token_regenerate_response");
    expect(parsed.success).toBe(true);
    expect(parsed.error).toBeUndefined();
  });

  it("v1.11 daemon -> client local_token_regenerate_response (error) parses cleanly", () => {
    const parsed = LocalTokenRegenerateResponseSchema.parse(
      V1_11_LOCAL_TOKEN_REGENERATE_RESPONSE_ERROR_FIXTURE,
    );
    expect(parsed.type).toBe("local_token_regenerate_response");
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("EACCES: permission denied");
  });

  it("v1.11 inbound RPCs route through SessionInboundMessageSchema (registered on the discriminator)", () => {
    const statusReq = SessionInboundMessageSchema.parse(V1_11_LOCAL_TOKEN_STATUS_REQUEST_FIXTURE);
    expect(statusReq.type).toBe("local_token_status_request");

    const regenReq = SessionInboundMessageSchema.parse(
      V1_11_LOCAL_TOKEN_REGENERATE_REQUEST_FIXTURE,
    );
    expect(regenReq.type).toBe("local_token_regenerate_request");
  });

  it("v1.11 outbound RPCs route through SessionOutboundMessageSchema (registered on the discriminator)", () => {
    const statusResp = SessionOutboundMessageSchema.parse(
      V1_11_LOCAL_TOKEN_STATUS_RESPONSE_FULL_FIXTURE,
    );
    expect(statusResp.type).toBe("local_token_status_response");

    const regenResp = SessionOutboundMessageSchema.parse(
      V1_11_LOCAL_TOKEN_REGENERATE_RESPONSE_SUCCESS_FIXTURE,
    );
    expect(regenResp.type).toBe("local_token_regenerate_response");
  });
});
