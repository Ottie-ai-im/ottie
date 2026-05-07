import { z } from "zod";

/**
 * Phase 4 v3/c §7.5.1 — coordination events that ride the peer-sync
 * transport between an owner's own daemons. Distinct from
 * `DeviceListEvent` (peer-sync's first user) but shares the same
 * envelope shape: signed by the emitting daemon's self-device
 * Ed25519 key, dispatched via the existing peer-session registry.
 *
 * Two kinds today:
 *
 *   - `ai-share-intent-broadcast`: emitted by whichever owner-device
 *     the user tapped "Share AI" on. Carries the friend's root
 *     pubkey + an intentId so other owner-devices can render a
 *     "Share with Bob — use this device?" surface in their UI.
 *   - `ai-share-intent-resolution`: emitted by whichever owner-
 *     device the user picked to claim the intent. Carries the
 *     same intentId so the others can dismiss their pending UI.
 *
 * Trust model:
 *   - Both kinds carry `sourceDeviceId` and a signature over the
 *     canonical payload. Receivers verify with the emitter's
 *     `signPublicKeyB64` from their local copy of the device list
 *     (same lookup the existing device-list events use). An event
 *     whose source isn't in the local device list is dropped — same
 *     anti-replay guarantee as device-list events.
 *
 * Why a separate file from device-list-event-types: keeps the device
 * list module focused on device-list semantics, and lets ai-share
 * coordination grow its own kinds without polluting that schema.
 */

const COORDINATION_COMMON = {
  v: z.literal(1),
  /** Wall-clock millis (ISO) when emitter sent this. */
  emittedAt: z.string(),
  /** Monotonic per-source counter. Unique with sourceDeviceId. */
  seq: z.number().int().nonnegative(),
  /** deviceId of the daemon that emitted the event. */
  sourceDeviceId: z.string().min(1),
  /**
   * Signature by `sourceDevice.signPrivateKey` over the canonical
   * bytestring (see `aiShareCoordinationPayload`). base64url, no
   * padding.
   */
  signatureB64: z.string().min(1),
} as const;

export const AiShareIntentBroadcastEventSchema = z.object({
  ...COORDINATION_COMMON,
  kind: z.literal("ai-share-intent-broadcast"),
  /** Stable per-intent id. UI polls / claims by this. */
  intentId: z.string().min(1),
  /** The friend the intent targets — pubkey-only; UI looks up display name locally. */
  peerRootPubKeyB64: z.string().min(1),
  /** ISO timestamp after which sibling daemons drop the pending UI. */
  expiresAt: z.string(),
});
export type AiShareIntentBroadcastEvent = z.infer<typeof AiShareIntentBroadcastEventSchema>;

export const AiShareIntentResolutionEventSchema = z.object({
  ...COORDINATION_COMMON,
  kind: z.literal("ai-share-intent-resolution"),
  /** Same id as the broadcast it's resolving. */
  intentId: z.string().min(1),
  /** Which device claimed the intent. */
  claimedByDeviceId: z.string().min(1),
  /** ISO timestamp when claim happened. */
  resolvedAt: z.string(),
});
export type AiShareIntentResolutionEvent = z.infer<typeof AiShareIntentResolutionEventSchema>;

export const AiShareCoordinationEventSchema = z.discriminatedUnion("kind", [
  AiShareIntentBroadcastEventSchema,
  AiShareIntentResolutionEventSchema,
]);
export type AiShareCoordinationEvent = z.infer<typeof AiShareCoordinationEventSchema>;

/**
 * Canonical bytestring the source-device's signPrivateKey signs.
 * Identical pattern to `deviceListEventPayload`: pin every field that
 * a relay-side adversary could tamper, in a stable order.
 *
 *   ottie-ai-share-intent-broadcast-v1
 *   {sourceDeviceId}
 *   {seq}
 *   {emittedAt}
 *   {intentId}
 *   {peerRootPubKeyB64}
 *   {expiresAt}
 *
 *   ottie-ai-share-intent-resolution-v1
 *   {sourceDeviceId}
 *   {seq}
 *   {emittedAt}
 *   {intentId}
 *   {claimedByDeviceId}
 *   {resolvedAt}
 */
export function aiShareCoordinationPayload(
  event:
    | Omit<AiShareIntentBroadcastEvent, "signatureB64" | "v">
    | Omit<AiShareIntentResolutionEvent, "signatureB64" | "v">,
): string {
  if (event.kind === "ai-share-intent-broadcast") {
    return [
      "ottie-ai-share-intent-broadcast-v1",
      event.sourceDeviceId,
      String(event.seq),
      event.emittedAt,
      event.intentId,
      event.peerRootPubKeyB64,
      event.expiresAt,
    ].join("\n");
  }
  return [
    "ottie-ai-share-intent-resolution-v1",
    event.sourceDeviceId,
    String(event.seq),
    event.emittedAt,
    event.intentId,
    event.claimedByDeviceId,
    event.resolvedAt,
  ].join("\n");
}
