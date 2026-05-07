import { z } from "zod";

/**
 * Phase 3.a/3 — wire-shape schemas for the originator's (Alice's) approval
 * reply to a candidate that arrived in Phase 3.a/2. Cross-identity analog
 * of `DeviceLinkApprovalReply` / `DeviceLinkApprovalEnvelope`.
 *
 * Flow:
 *   1. User taps "Approve" / "Reject" on Alice's UI for a pending
 *      friend candidate (parked by friend-pair-receiver in 3.a/2).
 *   2. Alice's daemon signs the canonical authorization payload (see
 *      `peer-types.ts.peerAuthorizationPayload`) with her root sign
 *      private key. The signed value gives Bob's daemon proof that
 *      Alice's root key actually approved THIS specific pairing —
 *      defends against UI bug or transport bug accidentally writing
 *      a `Peer` whose pubkey we couldn't have verified.
 *   3. Alice's daemon packages a `FriendPairApprovalReply` and encrypts
 *      it with the SAME shared key the candidate was decrypted with —
 *      both halves of the ECDH (Alice's `ephPrivateKeyB64` and Bob's
 *      `candidateEphPublicKeyB64`) are still in memory from 3.a/2, so
 *      we just reuse them. No fresh keypairs needed.
 *   4. Sends the resulting `FriendPairApprovalEnvelope` over the still-
 *      open Phase 3.a/2 socket back to Bob's daemon.
 *   5. Bob's daemon decrypts, verifies Alice's signature against
 *      `offer.rootSignPublicKeyB64`, persists a `Peer` entry for Alice.
 *
 * Critical difference from device-link approval: the approval reply does
 * NOT carry the root private key (or anything else identity-bearing of
 * Alice's). Friend pairing is between two SEPARATE identities — neither
 * shares signing material with the other. Alice's reply only proves
 * "Alice's root key approved this pairing"; Bob keeps using his own
 * identity from his own root keypair.
 */

/**
 * The plaintext approval payload — what Bob's daemon sees after
 * decrypting the envelope. Discriminated by `status` so a single schema
 * carries both happy and rejected paths without optional-field soup.
 */
export const FriendPairApprovalReplySchema = z.discriminatedUnion("status", [
  z.object({
    v: z.literal(1),
    kind: z.literal("friend-pair-approval"),
    status: z.literal("approved"),
    /**
     * Alice's root sign public key. Mirrors `offer.rootSignPublicKeyB64`
     * — Bob already has it from the offer he scanned, but having it in
     * the reply too makes the payload self-contained for verification
     * tests.
     */
    originatorRootSignPublicKeyB64: z.string().min(1),
    /** Alice's display name. Useful if she edited it between offer and approve. */
    originatorDisplayName: z.string().min(1).max(64),
    /**
     * Ed25519 signature, base64url, by Alice's root over
     * `peerAuthorizationPayload({ signerRole: "originator", ... })`.
     * Becomes the `authorizationSignatureB64` on Bob's stored `Peer`
     * entry for Alice.
     */
    authorizationSignatureB64: z.string().min(1),
    /** ISO timestamp of the approval. */
    approvedAt: z.string(),
    /**
     * Phase 3.b/2a: Alice's long-lived X25519 public key (raw 32-byte
     * JWK 'x' base64url) for offline-inbox encryption. Mirror of the
     * `encryptionPublicKeyB64` field on the responder's candidate — Bob's
     * daemon stores this in his peer record so he can NaCl-box future
     * messages under it when Alice is offline. Same trust caveat as on
     * the candidate side (see friend-pair-redeem-types.ts): not covered
     * by the authorization signature, treated as advisory routing metadata.
     * Optional for back-compat with originators running pre-3.b/2a builds.
     */
    encryptionPublicKeyB64: z.string().optional(),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal("friend-pair-approval"),
    status: z.literal("rejected"),
    /** Optional human-readable reason; the UI shows this to Bob. */
    rejectionReason: z.string().optional(),
  }),
]);

export type FriendPairApprovalReply = z.infer<typeof FriendPairApprovalReplySchema>;

/**
 * Wire shape sent over the relay socket from Alice's daemon back to
 * Bob's. Only the encrypted portion (`ciphertextB64`) carries the
 * approval payload — the envelope itself is tiny metadata so the relay
 * sees only a "kind=friend-pair-approval-envelope, ciphertext=..."
 * JSON blob, never Alice's signature inside.
 *
 * No ephemeral pubkey here because Phase 3.a/2 already exchanged it:
 * both sides retained the shared key locally, so the reply just rides
 * on it.
 */
export const FriendPairApprovalEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("friend-pair-approval-envelope"),
  /**
   * NaCl box ciphertext (24-byte nonce ‖ XSalsa20-Poly1305 ciphertext),
   * standard base64 encoded — same format as
   * `FriendPairRedemption.ciphertextB64`.
   */
  ciphertextB64: z.string().min(1),
});

export type FriendPairApprovalEnvelope = z.infer<typeof FriendPairApprovalEnvelopeSchema>;
