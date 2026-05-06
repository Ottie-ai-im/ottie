import { z } from "zod";

import { DeviceLinkOfferSchema } from "./device-link-types.js";
import { DeviceSchema } from "./device-types.js";
import { type StoredRootIdentity } from "./identity-types.js";

// Pure-zod schemas (no node:fs / node:crypto imports) so this module — and the
// shared messages.ts that re-exports it — can be bundled by Metro for the
// React Native client. Mirrors the chat-rpc-schemas / chat-cursor-schemas
// split: anything used on the wire stays Metro-friendly.

/**
 * Public-facing identity payload returned to clients. The private signing key
 * is never sent over the wire — only the public key, display name, and
 * timestamps are exposed. Storage version `v` is included so old clients can
 * gate features on schema evolution if it ever happens.
 */
export const PublicRootIdentitySchema = z.object({
  v: z.literal(1),
  rootSignPublicKeyB64: z.string().min(1),
  displayName: z.string().min(1),
  createdAt: z.string(),
});

export type PublicRootIdentity = z.infer<typeof PublicRootIdentitySchema>;

/**
 * Wire shape of `IdentityService.getState()`. Mirrors the daemon-side
 * discriminated union but replaces the in-memory `bundle` with the
 * public-only `PublicRootIdentity` (no private key) and the `Error` instance
 * with a string error message.
 */
export const IdentityStateOnWireSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("uninitialized") }),
  z.object({ kind: z.literal("loaded"), identity: PublicRootIdentitySchema }),
  z.object({ kind: z.literal("load-failed"), error: z.string() }),
]);

export type IdentityStateOnWire = z.infer<typeof IdentityStateOnWireSchema>;

// ----- identity/get -------------------------------------------------------

export const IdentityGetRequestSchema = z.object({
  type: z.literal("identity/get"),
  requestId: z.string(),
});

export const IdentityGetResponseSchema = z.object({
  type: z.literal("identity/get/response"),
  payload: z.object({
    requestId: z.string(),
    state: IdentityStateOnWireSchema.nullable(),
    error: z.string().nullable(),
  }),
});

// ----- identity/initialize ------------------------------------------------

export const IdentityInitializeRequestSchema = z.object({
  type: z.literal("identity/initialize"),
  requestId: z.string(),
  displayName: z.string().min(1).max(64),
});

export const IdentityInitializeResponseSchema = z.object({
  type: z.literal("identity/initialize/response"),
  payload: z.object({
    requestId: z.string(),
    identity: PublicRootIdentitySchema.nullable(),
    error: z.string().nullable(),
  }),
});

/**
 * Convert the on-disk shape (`StoredRootIdentity` — which contains the private
 * key) into the wire shape (`PublicRootIdentity` — public-only fields). The
 * private signing key is intentionally *never* included.
 */
export function toPublicRootIdentity(stored: StoredRootIdentity): PublicRootIdentity {
  return {
    v: stored.v,
    rootSignPublicKeyB64: stored.signPublicKeyB64,
    displayName: stored.displayName,
    createdAt: stored.createdAt,
  };
}

// ----- device/list (Phase 2.b) -------------------------------------------
// Wire shape reuses DeviceSchema directly — the on-disk record is already
// public-only (no private key), so no projection layer is needed.
// device-types.ts is itself pure-zod and Metro-bundleable.

export { DeviceSchema };
export type { StoredDevice as PublicDevice } from "./device-types.js";

export const DevicesListRequestSchema = z.object({
  type: z.literal("device/list"),
  requestId: z.string(),
});

export const DevicesListResponseSchema = z.object({
  type: z.literal("device/list/response"),
  payload: z.object({
    requestId: z.string(),
    devices: z.array(DeviceSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/generate (Phase 2.c) ----------------------------------
// Existing device asks the daemon to create a one-time device-link offer
// the user will display (as a QR or copy-link) for the new device to scan.

export const DeviceLinkGenerateRequestSchema = z.object({
  type: z.literal("device/link/generate"),
  requestId: z.string(),
  /**
   * Optional TTL override in milliseconds. Defaults to 10 minutes server-
   * side. Bounded by the daemon to keep offers short-lived; a UI shouldn't
   * normally pass anything here.
   */
  ttlMs: z.number().int().positive().optional(),
});

export const DeviceLinkGenerateResponseSchema = z.object({
  type: z.literal("device/link/generate/response"),
  payload: z.object({
    requestId: z.string(),
    /** The wire-shape offer; null when the daemon refused to create one. */
    offer: DeviceLinkOfferSchema.nullable(),
    /** Encoded `ottie://device-link#payload=…` deep link for QR / clipboard. */
    deepLink: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/cancel (Phase 2.c) ------------------------------------
// User backs out of "Add device". Drops the pending offer so its nonce
// can't be redeemed even if the QR was photographed.

export const DeviceLinkCancelRequestSchema = z.object({
  type: z.literal("device/link/cancel"),
  requestId: z.string(),
  nonceB64: z.string().min(1),
});

export const DeviceLinkCancelResponseSchema = z.object({
  type: z.literal("device/link/cancel/response"),
  payload: z.object({
    requestId: z.string(),
    cancelled: z.boolean(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/redeem (Phase 2.d) ------------------------------------
// New device's daemon redeems a deep-link / QR offer:
//   - decodes the offer
//   - generates a fresh device keypair + ephemeral X25519 keypair
//   - encrypts a candidate-Device payload with NaCl box
//   - opens a one-shot relay WebSocket to the OLD device
//   - sends the envelope, awaits an ack-or-error reply
// On accepted: caller gets the candidate echo (deviceLabel/role/etc.) and
// continues to the Phase 2.e approval-wait flow on the new device.

export const DeviceLinkRedeemRequestSchema = z.object({
  type: z.literal("device/link/redeem"),
  requestId: z.string(),
  /** Either a full deep-link string or just the base64url payload portion. */
  deepLink: z.string().min(1),
  /** Human-readable label the new device wants to register itself under. */
  deviceLabel: z.string().min(1).max(64),
  /** Whether the new device runs a daemon or is client-only. */
  role: z.enum(["daemon", "client"]),
});

/**
 * Wire-friendly summary of the candidate that was sent. Mirrors the
 * minimum the new device's UI needs to show "Sent → waiting for approval"
 * — the long-lived signing private key is intentionally NOT included on
 * the wire.
 */
export const DeviceLinkRedeemAcceptedSchema = z.object({
  status: z.literal("accepted"),
  /** UUID for the new device, the same one the candidate carried. */
  deviceId: z.string().min(1),
  /** Echo of the deviceLabel from the request, for confirmation UI. */
  deviceLabel: z.string().min(1),
  /** Echo of role. */
  role: z.enum(["daemon", "client"]),
  /** Display name of the OLD device's identity, for the "linking to <name>" UI. */
  remoteDisplayName: z.string().min(1),
  /** Old device's root signing public key — anchor of trust for Phase 2.e. */
  remoteRootSignPublicKeyB64: z.string().min(1),
});

export const DeviceLinkRedeemRejectedSchema = z.object({
  status: z.literal("rejected"),
  /**
   * Coded error: "no_offer" / "decrypt_failed" / "nonce_mismatch" /
   * "bad_schema" / "bad_json" / "bad_frame" / "too_large" / "timeout" /
   * "connection_closed" / "socket_error" / "offer_expired" /
   * "build_failed" / "send_failed" / "unexpected_response".
   */
  errorCode: z.string().min(1),
  errorMessage: z.string(),
});

export const DeviceLinkRedeemOutcomeSchema = z.discriminatedUnion("status", [
  DeviceLinkRedeemAcceptedSchema,
  DeviceLinkRedeemRejectedSchema,
]);

export const DeviceLinkRedeemResponseSchema = z.object({
  type: z.literal("device/link/redeem/response"),
  payload: z.object({
    requestId: z.string(),
    outcome: DeviceLinkRedeemOutcomeSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type DeviceLinkRedeemOutcome = z.infer<typeof DeviceLinkRedeemOutcomeSchema>;

// ----- device/link/candidates (Phase 2.e) --------------------------------
// OLD device's UI lists currently-pending candidates so the user can pick
// one to approve or reject. The wire shape is intentionally MINIMAL — the
// ephPrivateKey + ephPublicKey lives daemon-side only and never leaves.

export const PendingDeviceLinkCandidateOnWireSchema = z.object({
  /** offer.nonceB64; the lookup key for approve/reject. */
  nonceB64: z.string().min(1),
  /** What the new device wants to be called. */
  deviceLabel: z.string().min(1),
  /** daemon | client. */
  role: z.enum(["daemon", "client"]),
  /** ISO timestamp when the new device generated the candidate. */
  generatedAt: z.string(),
  /** ISO timestamp when the daemon received the candidate. */
  receivedAt: z.string(),
  /** Wall-clock ms when this candidate stops being approvable. */
  expiresAtMs: z.number(),
});

export type PendingDeviceLinkCandidateOnWire = z.infer<
  typeof PendingDeviceLinkCandidateOnWireSchema
>;

export const DeviceLinkCandidatesRequestSchema = z.object({
  type: z.literal("device/link/candidates"),
  requestId: z.string(),
});

export const DeviceLinkCandidatesResponseSchema = z.object({
  type: z.literal("device/link/candidates/response"),
  payload: z.object({
    requestId: z.string(),
    candidates: z.array(PendingDeviceLinkCandidateOnWireSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/approve (Phase 2.e) -----------------------------------

export const DeviceLinkApproveRequestSchema = z.object({
  type: z.literal("device/link/approve"),
  requestId: z.string(),
  nonceB64: z.string().min(1),
});

export const DeviceLinkApproveResponseSchema = z.object({
  type: z.literal("device/link/approve/response"),
  payload: z.object({
    requestId: z.string(),
    /** True if the encrypted reply was sent and the new device's record landed in devices.json. */
    approved: z.boolean(),
    /** Resulting devices.json snapshot, after appending the freshly-signed device. */
    devices: z.array(DeviceSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/reject (Phase 2.e) ------------------------------------

export const DeviceLinkRejectRequestSchema = z.object({
  type: z.literal("device/link/reject"),
  requestId: z.string(),
  nonceB64: z.string().min(1),
  /** Optional reason shown on the new device's screen. */
  reason: z.string().max(200).optional(),
});

export const DeviceLinkRejectResponseSchema = z.object({
  type: z.literal("device/link/reject/response"),
  payload: z.object({
    requestId: z.string(),
    rejected: z.boolean(),
    error: z.string().nullable(),
  }),
});
