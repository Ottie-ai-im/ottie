import { z } from "zod";

/**
 * Phase 2.d — wire-shape schemas for the new-device → existing-device
 * device-link redemption handshake.
 *
 * Flow recap (offer side is in `device-link-types.ts`):
 *
 *   1. Existing device generates an offer with an ephemeral X25519 keypair.
 *      The QR/link carries the public half (`offer.ephPublicKeyB64`) and a
 *      single-use `offer.nonceB64`. The private half stays in
 *      `DeviceLinkPendingStore` until the offer is redeemed or expires.
 *
 *   2. New device decodes the offer, generates:
 *        - a fresh Ed25519 device keypair (its long-lived signing identity)
 *        - a fresh X25519 ephemeral keypair (for ECDH with the offer)
 *      then builds a `CandidateDevice` describing itself.
 *
 *   3. New device derives a shared key (NaCl box, Curve25519 + XSalsa20-
 *      Poly1305) from its X25519 secret + the offer's X25519 public, encrypts
 *      the candidate, and packages everything into a `DeviceLinkRedemption`.
 *
 *   4. Existing device looks up the pending offer by `offerNonceB64`,
 *      derives the same shared key from its retained X25519 secret + the
 *      new device's X25519 public, decrypts, and shows the user "Approve
 *      <label> as a new device under your identity?".
 *
 *   5. On approve, existing device signs an authorized `Device` with its
 *      root key and replies (Phase 2.e — separate file). On reject /
 *      timeout, the offer is dropped and the new device shows an error.
 */

/**
 * The plaintext payload the new device sends inside the encrypted bundle.
 * This is what the existing device decrypts and shows the user before they
 * approve. It does NOT contain anything secret — the new device's signing
 * private key never leaves it. The existing device only signs the public
 * half + metadata.
 */
export const CandidateDeviceSchema = z.object({
  v: z.literal(1),
  kind: z.literal("candidate-device"),
  /** Fresh UUID minted by the new device. Becomes the persisted `Device.deviceId`. */
  deviceId: z.string().min(1),
  /** Human-readable label (defaults to OS hostname; user-editable on the new device). */
  deviceLabel: z.string().min(1).max(64),
  /** Daemon-host vs client-only — must match how the new device runs. */
  role: z.enum(["daemon", "client"]),
  /** Ed25519 public signing key (32 bytes, JWK 'x' base64url). */
  signPublicKeyB64: z.string().min(1),
  /**
   * ISO-8601 timestamp when the new device generated the candidate. Lets
   * the existing device reject candidates that arrive way after the offer
   * expired — defense in depth on top of the offer's own `exp`.
   */
  generatedAt: z.string(),
});

export type CandidateDevice = z.infer<typeof CandidateDeviceSchema>;

/**
 * Wire shape sent over the relay from the new device to the existing device.
 * Only the encrypted portion is confidential; the envelope fields are
 * routing metadata and the new device's ephemeral public key (which is
 * inherently public — the existing device needs it to derive the shared
 * key).
 */
export const DeviceLinkRedemptionSchema = z.object({
  v: z.literal(1),
  kind: z.literal("device-link-redemption"),
  /** Mirrors the offer's nonce so the existing device can find the matching pending offer. */
  offerNonceB64: z.string().min(1),
  /**
   * New device's ephemeral X25519 public key (raw 32-byte Curve25519, JWK
   * base64url, no padding). One-time-use; the corresponding secret stays on
   * the new device and is dropped once the redemption succeeds or times out.
   */
  newDeviceEphPublicKeyB64: z.string().min(1),
  /**
   * NaCl box ciphertext (24-byte nonce ‖ XSalsa20-Poly1305 ciphertext),
   * encoded in regular base64 (matches `arrayBufferToBase64` in the relay
   * package — keeps wire encoding identical to the daemon↔client transport
   * so we can reuse the same helpers across both sides later).
   */
  ciphertextB64: z.string().min(1),
});

export type DeviceLinkRedemption = z.infer<typeof DeviceLinkRedemptionSchema>;
