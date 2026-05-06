import { z } from "zod";

/**
 * Phase 3.a/3 — schema for an external peer (a friend) under THIS user's
 * identity. Cross-identity analog of `Device`. A `Peer` is identity-to-
 * identity (root pubkey on both sides), per design doc §5.4 + §16.2 —
 * not device-to-device. Each side stores a `Peer` entry for the other.
 *
 * The mutual-acceptance flow (3.a/3) writes both entries:
 *   - Bob's daemon writes a `Peer` entry for Alice on receiving the
 *     approval reply, signed by Alice's root over the binding payload
 *     `peerAuthorizationPayload(...)`.
 *   - Alice's daemon writes a `Peer` entry for Bob on the moment she
 *     taps Approve, signed by Bob's root over the same shape (just with
 *     Alice's role = "originator" and Bob's = "responder" — the
 *     candidate signature she received during 3.a/2 already covers this
 *     binding, so we re-use it as the authorization signature).
 *
 * Why two separate signatures (one per side) on disk? The signature
 * stored is by the OTHER party's root, so its meaning to the local
 * verifier is "they signed off on this pairing". Replaying it across
 * a different friend pairing fails because the payload includes both
 * root pubkeys + the offer nonce.
 */
export const PeerSchema = z.object({
  v: z.literal(1),
  /**
   * The peer's root identity public key (Ed25519 JWK 'x' base64url).
   * This is the trust anchor for everything the peer ever sends.
   */
  peerRootSignPublicKeyB64: z.string().min(1),
  /** The peer's display name at the moment of pairing. May drift later. */
  peerDisplayName: z.string().min(1).max(64),
  /** ISO timestamp of when this side accepted the pair. */
  pairedAt: z.string(),
  /**
   * Status of the relationship. Phase 3.a/3 only ever writes "active";
   * Phase 5 introduces "blocked" (soft block — peer can send, owner
   * doesn't receive) and "removed" (peer was unfriended). The on-disk
   * shape carries all three so old daemons reading new daemons' files
   * don't trip on unknown enum values.
   */
  status: z.enum(["active", "blocked", "removed"]),
  /**
   * The offer nonce that bound this pairing. Stored so a future
   * "resync"/diagnostics path can look up which specific handshake
   * produced this peer entry.
   */
  pairingNonceB64: z.string().min(1),
  /**
   * Signature by the peer's root sign private key over
   * `peerAuthorizationPayload(...)`. Proves the peer's root key is
   * actually present on the other side — defends against a UI bug or
   * transport bug accidentally writing a `Peer` whose pubkey we
   * couldn't have verified.
   */
  authorizationSignatureB64: z.string().min(1),
  /**
   * Phase 3.b+ will populate this with the peer's published device list
   * (so we know which of their daemons to route messages to). Empty
   * here in Phase 3.a — the friend list is identity-only at first.
   */
  peerDevices: z.array(z.unknown()).optional(),
});

export type StoredPeer = z.infer<typeof PeerSchema>;

/**
 * On-disk shape of `$OTTIE_HOME/identity/peers.json`. Empty until the
 * first friend is added.
 */
export const PeerListSchema = z.object({
  v: z.literal(1),
  peers: z.array(PeerSchema),
});

export type StoredPeerList = z.infer<typeof PeerListSchema>;

/**
 * Canonical payload signed by the OTHER side's root key as the
 * `authorizationSignatureB64` on a stored `Peer`. The offer nonce + both
 * root pubkeys + the role label bind the signature to a specific
 * friend-pair handshake — replaying it across pairings fails verifier
 * because the bound triple won't match.
 *
 * Format (pinned, version-bump on any change):
 *
 *   "ottie-peer-auth-v1"
 *   "originator" | "responder"
 *   originatorRootSignPublicKeyB64
 *   responderRootSignPublicKeyB64
 *   pairingNonceB64
 */
export function peerAuthorizationPayload(input: {
  signerRole: "originator" | "responder";
  originatorRootSignPublicKeyB64: string;
  responderRootSignPublicKeyB64: string;
  pairingNonceB64: string;
}): string {
  return [
    "ottie-peer-auth-v1",
    input.signerRole,
    input.originatorRootSignPublicKeyB64,
    input.responderRootSignPublicKeyB64,
    input.pairingNonceB64,
  ].join("\n");
}
