import { z } from "zod";

/**
 * Phase 3.b/1b — friend-sync handshake messages between two daemons of
 * DIFFERENT users. Cross-identity analog of `peer-sync-types.ts`. Sits
 * on top of the same Cloudflare Workers relay using a separate
 * `friend-sync:<nonce>` connectionId prefix so the relay-transport
 * dispatcher routes it to its own handler.
 *
 * Differences from peer-sync (intra-identity):
 *   - The hello is signed by the daemon's ROOT sign private key, not
 *     its self-device key. The verifier looks up the expected pubkey in
 *     `peers.json` (Phase 3.a/3) instead of `devices.json`.
 *   - The signed-payload prefix is `ottie-friend-sync-hello-v1` (vs
 *     `ottie-peer-sync-hello-v1` for peer-sync), so a hello captured on
 *     one channel can never replay onto the other.
 *   - The hello carries the sender's `fromRootPubKey` so the receiver
 *     can index into peers.json. Peer-sync uses `fromDeviceId` because
 *     intra-identity routing is keyed by device, not identity.
 *
 * Protocol shape (one round-trip):
 *
 *     Initiator A (Bob)                          Responder B (Alice)
 *     ─────────────────                          ───────────────────
 *     buildFriendHello(self=Bob)         ──►    verifyFriendHello + accept
 *                                                 buildFriendHello(self=Alice)
 *     verifyFriendHello + accept         ◄──
 *     deriveSharedKey(ourEphPriv, peerEphPub)   deriveSharedKey(...)
 *
 * Both sides:
 *   - Generate a fresh X25519 ephemeral keypair (NOT reused across
 *     connections — forward secrecy).
 *   - Sign `(fromRootPubKey, fromDeviceId, ephPubKeyB64, nonceB64)`
 *     with their root Ed25519 PRIVATE key.
 *   - Verify the peer's signature using the peer's `peerRootSignPublic
 *     KeyB64` from local peers.json (anchor of trust established in
 *     Phase 3.a/3).
 *   - Derive a shared key via ECDH; from then on every frame is NaCl
 *     box encrypted with that shared key.
 *
 * Same SIGMA-I shape + properties as peer-sync (mutual auth +
 * ephemeral-key auth + forward secrecy). What it doesn't yet provide:
 *   - Replay protection across reconnects beyond the per-handshake
 *     nonce. Phase 3.b/1d will fold per-room sequence numbers into
 *     the post-handshake message flow.
 *   - Post-quantum security — out of scope.
 */

export const FriendHelloSchema = z.object({
  v: z.literal(1),
  kind: z.literal("friend-hello"),
  /**
   * Sender's root identity public key (Ed25519 JWK 'x' base64url, 32
   * raw bytes / 43 chars). Receiver MUST find a matching entry in
   * peers.json with status="active" — otherwise reject the connection.
   */
  fromRootPubKey: z.string().min(1),
  /**
   * Sender's daemon serverId. Useful for audit + multi-device routing
   * later; not directly used for trust (the rootPubKey is the anchor).
   */
  fromDeviceId: z.string().min(1),
  /** X25519 ephemeral public key, JWK 'x' base64url, 32 bytes. */
  ephPubKeyB64: z.string().min(1),
  /** 32 bytes random base64url. Per-handshake; defeats simple replay. */
  nonceB64: z.string().min(1),
  /**
   * Ed25519 signature by the sender's ROOT sign private key over
   * `friendHelloPayload(...)`. Verifier looks up the matching public
   * key in their local peers.json by `fromRootPubKey`.
   */
  signatureB64: z.string().min(1),
});

export type FriendHello = z.infer<typeof FriendHelloSchema>;

/**
 * Canonical bytestring the friend-hello signature covers. Pinned here
 * so sender and verifier stay in lockstep across code paths. Format
 * mirrors `peerHelloPayload` and `peerAuthorizationPayload` — newline-
 * separated, prefix-tagged so the same root key signing a different
 * record type can never produce a colliding payload.
 */
export function friendHelloPayload(input: {
  fromRootPubKey: string;
  fromDeviceId: string;
  ephPubKeyB64: string;
  nonceB64: string;
}): string {
  return [
    "ottie-friend-sync-hello-v1",
    input.fromRootPubKey,
    input.fromDeviceId,
    input.ephPubKeyB64,
    input.nonceB64,
  ].join("\n");
}

/**
 * Wire shape for an encrypted friend-sync frame. The plaintext inside
 * is the application-layer payload (a chat-message envelope for Phase
 * 3.b/1d, AI-share frames in Phase 4). Carrier envelope only —
 * semantics live one layer up.
 */
export const FriendSyncFrameSchema = z.object({
  v: z.literal(1),
  kind: z.literal("friend-sync-frame"),
  /**
   * NaCl box ciphertext (24-byte nonce ‖ XSalsa20-Poly1305 ciphertext),
   * standard base64. Same format as `PeerSyncFrame.ciphertextB64` so
   * a future inspector can hex-dump them with the same code.
   */
  ciphertextB64: z.string().min(1),
});

export type FriendSyncFrame = z.infer<typeof FriendSyncFrameSchema>;
