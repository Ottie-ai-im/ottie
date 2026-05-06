import { z } from "zod";

import { DeviceSchema } from "./device-types.js";
import { RootIdentitySchema } from "./identity-types.js";

/**
 * Phase 2.e — wire-shape schemas for the OLD device's approval reply
 * to a candidate that arrived in Phase 2.d.
 *
 * Flow:
 *   1. User taps "Approve" / "Reject" on the OLD device's UI.
 *   2. OLD device signs the candidate Device record with its root key
 *      (existing `buildAuthorizedDevice`), appends to its devices.json.
 *   3. OLD device packages a `DeviceLinkApprovalReply` and encrypts it
 *      with the SAME shared key the candidate was decrypted with — both
 *      halves of the ECDH (the old device's `ephPrivateKey` and the new
 *      device's `newDeviceEphPublicKey`) are still in memory from Phase
 *      2.d, so we just reuse them. No fresh keypairs needed.
 *   4. Sends the resulting `DeviceLinkApprovalEnvelope` over the still-
 *      open Phase 2.d socket back to the new device.
 *   5. New device decrypts, persists root identity + signed device +
 *      peer device list, and is now bootstrapped.
 *
 * Why ship the root private key in the reply payload? Because in ottie's
 * threat model, every authorized device of a single user must be able
 * to authorize ADDITIONAL devices later (no "primary device" hierarchy
 * — see design doc §6). So the rootPrivKey is replicated to every
 * device the user adds. This is a deliberate tradeoff: the user ships
 * trust to themselves on each new device, accepting that compromising
 * any one device compromises the identity (matches WhatsApp / Telegram
 * multi-device).
 */

/**
 * The plaintext approval payload — what the new device sees after
 * decrypting the envelope. Discriminated by `status` so a single schema
 * carries both happy and rejected paths without optional-field soup.
 */
export const DeviceLinkApprovalReplySchema = z.discriminatedUnion("status", [
  z.object({
    v: z.literal(1),
    kind: z.literal("device-link-approval"),
    status: z.literal("approved"),
    /**
     * Full root-identity bundle (incl. private signing key) so the new
     * device can act on behalf of the identity (sign future devices,
     * sign friend-pair offers, etc.). See header comment for rationale.
     */
    rootIdentity: RootIdentitySchema,
    /**
     * The new device's own record, signed by the OLD device's root key.
     * The new device persists this verbatim into its own devices.json.
     */
    signedDevice: DeviceSchema,
    /**
     * Snapshot of the OLD device's devices.json AT THE MOMENT OF
     * APPROVAL — includes the OLD device itself, any previously-linked
     * peer devices, AND the freshly-signed `signedDevice`. The new
     * device persists this whole list as its starting devices.json.
     * Phase 2.f will keep this list in sync going forward.
     */
    peerDevices: z.array(DeviceSchema),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal("device-link-approval"),
    status: z.literal("rejected"),
    /** Optional human-readable reason; the UI shows this to the new device. */
    rejectionReason: z.string().optional(),
  }),
]);

export type DeviceLinkApprovalReply = z.infer<typeof DeviceLinkApprovalReplySchema>;

/**
 * Wire shape sent over the relay socket from the OLD device back to the
 * NEW device. Only the encrypted portion (`ciphertextB64`) carries the
 * approval payload — the envelope itself is tiny metadata so the relay
 * sees only a "kind=device-link-approval-envelope, ciphertext=..." JSON
 * blob, never the keypair / root private key inside.
 *
 * No ephemeral pubkey here because Phase 2.d already exchanged it: both
 * sides retained the shared key locally, so the reply just rides on it.
 */
export const DeviceLinkApprovalEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("device-link-approval-envelope"),
  /**
   * NaCl box ciphertext (24-byte nonce ‖ XSalsa20-Poly1305 ciphertext),
   * standard base64 encoded — same format as
   * `DeviceLinkRedemption.ciphertextB64`.
   */
  ciphertextB64: z.string().min(1),
});

export type DeviceLinkApprovalEnvelope = z.infer<typeof DeviceLinkApprovalEnvelopeSchema>;
