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
