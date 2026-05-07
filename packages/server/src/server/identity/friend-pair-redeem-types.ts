import { z } from "zod";

/**
 * Phase 3.a/0 — wire-shape schemas for the receiver → sender friend-pair
 * redemption handshake. Cross-identity analog of Phase 2.d's device-link
 * redemption.
 *
 * Flow recap (offer side is in `friend-pair-types.ts`):
 *
 *   1. Alice generates an offer with an ephemeral X25519 keypair. The QR/
 *      link carries the public half (`offer.ephPublicKeyB64`) and a single-
 *      use `offer.nonceB64`. The private half stays in
 *      `FriendPairPendingStore` (Phase 3.a/1) until the offer is redeemed
 *      or expires.
 *
 *   2. Bob decodes the offer, builds a `FriendCandidate` describing his
 *      identity (root sign pubkey + display name) and a fresh ephemeral
 *      X25519 keypair for ECDH.
 *
 *   3. Bob derives a shared key (NaCl box, Curve25519 + XSalsa20-Poly1305)
 *      from his X25519 secret + the offer's X25519 public, encrypts the
 *      candidate, and packages everything into a `FriendPairRedemption`.
 *      Crucially, the candidate carries an Ed25519 signature, made with
 *      Bob's root sign private key, that binds:
 *        - Bob's claimed root sign public key
 *        - Alice's offer ephemeral public key
 *        - Bob's ephemeral public key
 *        - the offer nonce
 *      so a relay-side adversary cannot substitute a different identity
 *      while keeping the same encrypted payload (SIGMA-I-style mutual
 *      auth, identical pattern to `peer-sync-handshake.ts`).
 *
 *   4. Alice looks up the pending offer by `offerNonceB64`, derives the
 *      same shared key from her retained X25519 secret + Bob's X25519
 *      public, decrypts, verifies the signature against the candidate's
 *      claimed root pubkey, and shows the user "Pair as a friend with
 *      <displayName> (<pubkey-prefix>)?".
 *
 *   5. On approve, Alice replies with her own signed friend-confirm
 *      record (Phase 3.a/3 — separate file). Both sides then persist a
 *      `Peer` entry (§6.1).
 */

/**
 * The plaintext payload Bob's daemon sends inside the encrypted bundle.
 * This is what Alice's daemon decrypts and shows the user before they
 * approve. It does NOT contain anything secret — Bob's root sign private
 * key never leaves his machine; only the public half travels.
 */
export const FriendCandidateSchema = z.object({
  v: z.literal(1),
  kind: z.literal("friend-candidate"),
  /**
   * Bob's root identity public key (Ed25519 JWK 'x', 32 bytes / 43 chars).
   * This becomes the trust anchor for every signed message Bob ever sends
   * Alice — peer-pair, chat messages, AI-share offers in later phases.
   */
  rootSignPublicKeyB64: z.string().min(1),
  /** Bob's display name, shown in Alice's confirm dialog. */
  displayName: z.string().min(1).max(64),
  /**
   * Ed25519 signature, base64url, made by Bob's root sign private key over
   * the canonical payload `friendCandidatePayload(...)`. Binds the
   * candidate identity to the specific ECDH session — see file header.
   */
  signatureB64: z.string().min(1),
  /**
   * ISO-8601 timestamp when Bob's daemon generated the candidate. Lets
   * Alice's daemon reject candidates that arrive way after the offer
   * expired — defense in depth on top of the offer's own `exp`.
   */
  generatedAt: z.string(),
  /**
   * Phase 3.b/1a: Bob's stable daemon serverId. Lets Alice's daemon route
   * back to Bob's daemon when opening a long-lived friend-sync chat
   * session in Phase 3.b/1c. Optional so old responder daemons that pre-
   * date 3.b/1a still pair successfully (they just won't be reachable
   * for chat until they re-pair under the new build).
   */
  serverId: z.string().optional(),
  /**
   * Phase 3.b/1a: relay host:port Bob's daemon was reachable at. Mirrors
   * the offer's `relayEndpoint`; same back-compat reason as `serverId`.
   */
  relayEndpoint: z.string().optional(),
  /**
   * Phase 3.b/2a: Bob's long-lived X25519 public key (raw 32-byte JWK 'x'
   * base64url) for offline-inbox encryption. Alice stores this in her
   * peer record so she can NaCl-box future messages under it when Bob
   * is offline. NOT covered by the candidate signature — Alice doesn't
   * verify a sig over this field — because Bob just signed an X25519
   * ephemeral pubkey under his root key in the same payload (binding
   * proves Bob's root key controls the session); pairing this with a
   * separately-claimed long-term encryption key would let a swapped
   * encryption key still pass verification. We treat the encryption
   * pubkey as advisory routing metadata: worst case, a tampered key
   * means inbox messages stop decrypting at Bob's end and he has to
   * re-pair. The signing-key trust anchor is unaffected.
   *
   * Optional for back-compat: responders running pre-3.b/2a builds will
   * omit this field, and Alice's daemon will store the peer without an
   * encryption key (offline-inbox to that peer falls back to live-only).
   */
  encryptionPublicKeyB64: z.string().optional(),
});

export type FriendCandidate = z.infer<typeof FriendCandidateSchema>;

/**
 * Wire shape sent over the relay from Bob's daemon to Alice's daemon.
 * Only the encrypted portion is confidential; the envelope fields are
 * routing metadata and Bob's ephemeral public key (which is inherently
 * public — Alice needs it to derive the shared key).
 */
export const FriendPairRedemptionSchema = z.object({
  v: z.literal(1),
  kind: z.literal("friend-pair-redemption"),
  /** Mirrors the offer's nonce so Alice can find the matching pending offer. */
  offerNonceB64: z.string().min(1),
  /**
   * Bob's ephemeral X25519 public key (raw 32-byte Curve25519, JWK
   * base64url, no padding). One-time-use; the corresponding secret stays
   * on Bob's daemon and is dropped once the redemption succeeds or times
   * out.
   */
  candidateEphPublicKeyB64: z.string().min(1),
  /**
   * NaCl box ciphertext (24-byte nonce ‖ XSalsa20-Poly1305 ciphertext),
   * encoded in regular base64. Same wire encoding as device-link redemption
   * so the two flows can share helpers.
   */
  ciphertextB64: z.string().min(1),
});

export type FriendPairRedemption = z.infer<typeof FriendPairRedemptionSchema>;

/**
 * Canonical payload Bob's root sign key signs to produce
 * `FriendCandidate.signatureB64`. Pinned format (literal prefix + four
 * delimited fields) so any future addition needs an explicit version
 * bump rather than silently changing the signed bytes.
 *
 *   "friend-pair-redemption.v1" | offerNonceB64 | offerEphPubKeyB64
 *                               | candidateEphPubKeyB64
 */
export function friendCandidatePayload(input: {
  offerNonceB64: string;
  offerEphPublicKeyB64: string;
  candidateEphPublicKeyB64: string;
}): string {
  return [
    "friend-pair-redemption.v1",
    input.offerNonceB64,
    input.offerEphPublicKeyB64,
    input.candidateEphPublicKeyB64,
  ].join("|");
}
