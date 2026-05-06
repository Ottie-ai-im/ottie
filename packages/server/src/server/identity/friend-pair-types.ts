import { z } from "zod";

/**
 * Phase 3.a — wire shape of a friend-pair offer. Cross-identity analog of
 * Phase 2.c's `DeviceLinkOffer`. The user generating the offer (Alice)
 * encodes one of these in a QR/link, and the user who scans it (Bob) sees
 * "Pair as a friend with Alice?" before deciding.
 *
 * The offer carries everything Bob's daemon needs to:
 *   1. Reach Alice's daemon through the relay (relayEndpoint, serverId).
 *   2. Verify Alice's identity (rootSignPublicKeyB64) and show Bob
 *      "Add <displayName> as a friend?" alongside the public-key fingerprint.
 *   3. Establish an ephemeral encrypted channel (ephPublicKeyB64) so Bob's
 *      candidate-friend record can be sent confidentially even though the
 *      relay only routes opaque bytes.
 *   4. Defeat replay/extension attacks (nonceB64, exp).
 *
 * The corresponding ephemeral *private* key never leaves Alice's daemon —
 * it stays in the pending-offers store until the offer is redeemed by Bob
 * or expires.
 *
 * Difference from device-link: Alice and Bob are different identities, so
 * the eventual "Approve" step on Alice's side stores a `Peer` record, not
 * a signed `Device` under Alice's root key. The on-the-wire crypto core is
 * identical (X25519 ECDH + NaCl box).
 */
export const FriendPairOfferSchema = z.object({
  v: z.literal(1),
  kind: z.literal("friend-pair"),
  /** Alice's daemon stable server id. Bob's daemon routes its redemption here. */
  serverId: z.string().min(1),
  /**
   * Alice's root identity public key (Ed25519, JWK 'x' base64url, 32 raw
   * bytes / 43 chars). This is the trust anchor for every signed message
   * Alice will ever send Bob.
   */
  rootSignPublicKeyB64: z.string().min(1),
  /** Alice's display name, shown in Bob's confirm dialog. */
  displayName: z.string().min(1).max(64),
  /** Ephemeral X25519 public key (32 bytes, JWK 'x' base64url). One-time-use. */
  ephPublicKeyB64: z.string().min(1),
  /** 32-byte random nonce, base64url. Prevents replay of stale offers. */
  nonceB64: z.string().min(1),
  /** ISO-8601 expiry. Alice's daemon rejects redemption attempts past this. */
  exp: z.string(),
  /** host:port of the relay. Reused from the daemon's existing relay config. */
  relayEndpoint: z.string().min(1),
});

export type FriendPairOffer = z.infer<typeof FriendPairOfferSchema>;

/**
 * On-disk / in-memory record kept by Alice's daemon while an offer is
 * outstanding. The ephemeral private key is the secret that lets Alice
 * decrypt the candidate-friend payload Bob will send. We never persist
 * this — daemon restarts invalidate any pending offers, which is the right
 * safety property (no zombie offers across reboots, identical to device-
 * link).
 */
export interface PendingFriendPairOffer {
  /** The wire-shape offer that was encoded into the QR/link. */
  offer: FriendPairOffer;
  /** Base64url-encoded X25519 private key matching offer.ephPublicKeyB64. */
  ephPrivateKeyB64: string;
  /** Wall-clock millis at which this offer expires. Mirrors offer.exp. */
  expiresAtMs: number;
}

/**
 * Encode an offer into the canonical deep-link string. Format:
 *
 *   ottie://friend-pair#payload=<base64url-json>
 *
 * The web app at app.claws.company also accepts this via fragment so users
 * can paste a link in either env. Keeping the payload in the URL fragment
 * (#) rather than query (?) prevents it from leaking into server logs.
 */
export function encodeFriendPairOffer(offer: FriendPairOffer): string {
  const json = JSON.stringify(offer);
  const b64 = Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `ottie://friend-pair#payload=${b64}`;
}

/**
 * Inverse of `encodeFriendPairOffer`. Throws on malformed input or schema
 * mismatch — callers are expected to surface that to the user as
 * "this isn't a valid friend-pair code".
 */
export function decodeFriendPairOffer(input: string): FriendPairOffer {
  const marker = "payload=";
  const idx = input.indexOf(marker);
  if (idx < 0) {
    throw new Error("Friend-pair payload missing 'payload=' marker");
  }
  const b64url = input.slice(idx + marker.length);
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf8");
  const parsed = JSON.parse(json);
  return FriendPairOfferSchema.parse(parsed);
}
