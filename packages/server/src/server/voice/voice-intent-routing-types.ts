import type { z } from "zod";
import type {
  VoiceRouteCommandSchema,
  VoiceRouteRequestSchema,
  VoiceRouteResponseMessageSchema,
} from "@server/shared/messages.js";

/**
 * Strongly-typed shapes derived from the wire schema — keep them at the
 * routing module's edge so the implementation file doesn't import the
 * entire shared messages module.
 */

export type VoiceRouteCommand = z.infer<typeof VoiceRouteCommandSchema>;
export type VoiceRouteRequestPayload = z.infer<typeof VoiceRouteRequestSchema>;

/**
 * Routing-only result — same shape as the wire response payload but without
 * `requestId`. The session handler is responsible for stamping that on
 * before emitting; the routing module shouldn't need to know about it.
 */
export type VoiceRouteResultPayload = Omit<
  z.infer<typeof VoiceRouteResponseMessageSchema>["payload"],
  "requestId"
>;
