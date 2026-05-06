import { z } from "zod";

import { DeviceSchema } from "./device-types.js";

/**
 * Phase 2.f — events that synchronize the device list across a single
 * user's daemons. Per design doc §5.5: no central DB, each daemon
 * broadcasts state-change events to its sibling devices, each device
 * keeps its own copy and applies events idempotently.
 *
 * Event signing model:
 *   - Every event carries `sourceDeviceId` — the deviceId of the daemon
 *     that emitted it.
 *   - The signature is over a canonical bytestring made of the event's
 *     identifying fields (kind, seq, sourceDeviceId, emittedAt, …),
 *     produced with the emitting device's own self-device Ed25519
 *     PRIVATE key (NOT root). Receivers verify with the emitter's
 *     `signPublicKeyB64` from their local copy of the device list.
 *
 *     Why not root-sign every event? Because each daemon has its own
 *     self-device key but only some daemons hold the root private key
 *     (the device that originally created the identity). Self-device
 *     signing means any authorized device can emit changes — the new
 *     device added via Phase 2.e/2 immediately gets the root keypair
 *     copy and could re-sign with root, but using self-device keeps the
 *     audit trail per-device and is enough cryptographic provenance for
 *     a single-user trust circle.
 *
 *   - An event is `accepted` only if its `sourceDeviceId` is currently
 *     in the receiver's device list. This prevents orphaned events
 *     from removed devices from re-adding themselves.
 *
 * Conflict resolution:
 *   - Each (sourceDeviceId, seq) pair is unique per emitter — emitters
 *     monotonically increment seq for every event they produce.
 *   - When two events touch the same `targetDeviceId` (eg. one daemon
 *     adds, another removes the same device), the one with the higher
 *     `(emittedAt, sourceDeviceId)` wins — last-writer-wins by
 *     wall-clock with a deterministic tie-break. Phase 2.f/0 sticks
 *     with this; Phase 2.f/1+ may grow into vector-clocks if needed.
 */

const COMMON_FIELDS = {
  v: z.literal(1),
  /** Wall-clock millis when emitter sent this. Used for last-writer-wins. */
  emittedAt: z.string(),
  /** Monotonic per-source counter. Unique with sourceDeviceId. */
  seq: z.number().int().nonnegative(),
  /** deviceId of the daemon that emitted the event. */
  sourceDeviceId: z.string().min(1),
  /**
   * Signature by `sourceDevice.signPrivateKey` over the canonical
   * bytestring (see `deviceListEventPayload`). base64url, no padding.
   */
  signatureB64: z.string().min(1),
} as const;

export const DeviceAddedEventSchema = z.object({
  ...COMMON_FIELDS,
  kind: z.literal("device-added"),
  /** The new Device record (already root-signed via Phase 2.e approve). */
  device: DeviceSchema,
});

export const DeviceRemovedEventSchema = z.object({
  ...COMMON_FIELDS,
  kind: z.literal("device-removed"),
  /** Which device is being removed. */
  removedDeviceId: z.string().min(1),
});

export const DeviceListEventSchema = z.discriminatedUnion("kind", [
  DeviceAddedEventSchema,
  DeviceRemovedEventSchema,
]);

export type DeviceAddedEvent = z.infer<typeof DeviceAddedEventSchema>;
export type DeviceRemovedEvent = z.infer<typeof DeviceRemovedEventSchema>;
export type DeviceListEvent = z.infer<typeof DeviceListEventSchema>;

/**
 * Canonical bytestring an event signs over. Pinned here so emitter and
 * verifier stay in lockstep across code paths. Format choice:
 *   - Newline-separated, prefix-tagged (matches deviceAuthorizationPayload)
 *   - Per-kind suffix so a "device-added" signature can never satisfy
 *     a "device-removed" verification, even for the same target id
 */
export function deviceListEventPayload(event: DeviceListEvent): string {
  const lines = [
    "ottie-device-list-event-v1",
    event.kind,
    String(event.seq),
    event.sourceDeviceId,
    event.emittedAt,
  ];
  if (event.kind === "device-added") {
    // Signing over the entire root-signed device record means a peer
    // can't forward a tampered version of someone else's signed device.
    lines.push(event.device.deviceId);
    lines.push(event.device.signPublicKeyB64);
    lines.push(event.device.role);
    lines.push(event.device.authorizedAt);
    lines.push(event.device.authorizationSignatureB64);
  } else {
    lines.push(event.removedDeviceId);
  }
  return lines.join("\n");
}
