import type { z } from "zod";

import { WSInboundMessageSchema, type WSInboundMessage } from "../../shared/messages.js";

/**
 * Result of parsing an inbound WebSocket message at the daemon boundary.
 *
 * Discriminated union (per docs/CODING_STANDARDS.md "discriminated unions over bags
 * of booleans/optionals"). Callers narrow on `ok` and consume `message` or `error`.
 *
 * Never throws — the boundary surfaces parse failures as data so that the caller
 * (router / WS upgrade handler) decides whether to emit an `rpc_error`, close the
 * socket, or invoke the existing `handleInvalidInboundMessage` path. This matches
 * the existing failure path in websocket-server.ts which uses `safeParse` directly.
 */
export type ParseInboundResult =
  | { ok: true; message: WSInboundMessage }
  | { ok: false; error: z.ZodError };

/**
 * Parse a raw WebSocket payload against the `WSInboundMessageSchema` discriminated
 * union (carve C-2 — Strangler-Fig boundary lift, see research §3.3 step C-2 and
 * `.planning/phases/01-architectural-foundations-gating-bug-fixes/01-PATTERNS.md`).
 *
 * Behavior is byte-identical to `WSInboundMessageSchema.safeParse(raw)` — the only
 * thing this function adds is the discriminated-union return shape.
 */
export function parseInboundMessage(raw: unknown): ParseInboundResult {
  const result = WSInboundMessageSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, message: result.data };
  }
  return { ok: false, error: result.error };
}
