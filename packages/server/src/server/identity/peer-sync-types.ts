import { z } from "zod";

/**
 * Phase 2.f/2 — peer-sync handshake messages between two daemons of the
 * same user. Sits ON TOP of the existing relay (Phase 2.d transport),
 * using a separate `peer-sync:<nonce>` connectionId prefix so the same
 * `connectionHandlers` dispatcher routes it to its own handler.
 *
 * Protocol shape (one round-trip):
 *
 *     Initiator A                            Responder B
 *     ───────────                            ───────────
 *     buildPeerHello(self=A) ────────────►  verifyPeerHello + accept
 *                                            buildPeerHello(self=B)
 *     verifyPeerHello + accept ◄────────────
 *     deriveSharedKey(ourEphPriv,                 deriveSharedKey(...)
 *                     peerEphPub)
 *
 * Both sides:
 *   - Generate a fresh X25519 ephemeral keypair (NOT reused across connections)
 *   - Sign `(fromDeviceId, ephPubKeyB64, nonceB64)` with their own self-
 *     device long-term Ed25519 PRIVATE key
 *   - Verify the peer's signature using the public key already stored in
 *     the local devices.json (anchor of trust)
 *   - Derive a shared key via ECDH; from then on every frame is NaCl box
 *     encrypted with that shared key
 *
 * This is the SIGMA-I shape: "sign your ephemeral pubkey under your
 * long-term identity key, exchange ephemerals, ECDH". Provides:
 *   - Mutual authentication (each side proves they have their long-term
 *     private key)
 *   - Ephemeral-key authentication (the signature binds the ephemeral
 *     pubkey to the identity, so a relay MitM that swaps ephPubKey
 *     cannot also produce a valid signature)
 *   - Forward secrecy (compromise of long-term keys later does not
 *     decrypt past sessions, because the ephemerals are discarded)
 *
 * What this protocol does NOT yet provide (deliberate Phase 2.f/2 scope):
 *   - Replay protection across reconnects — Phase 2.f/3 will fold the
 *     event-store's `lastSeenSeqBySource` map into the post-handshake
 *     resync step, which makes any replayed event a no-op anyway.
 *   - Post-quantum security — out of scope; can be layered later.
 */

export const PeerHelloSchema = z.object({
  v: z.literal(1),
  kind: z.literal("peer-hello"),
  /** Sender's deviceId (must be in receiver's local devices.json). */
  fromDeviceId: z.string().min(1),
  /** X25519 ephemeral public key, JWK 'x' base64url, 32 bytes. */
  ephPubKeyB64: z.string().min(1),
  /** 32 bytes random base64url. Per-handshake; defeats simple replay. */
  nonceB64: z.string().min(1),
  /**
   * Ed25519 signature by the sender's self-device PRIVATE key over
   * `peerHelloPayload(...)`. Verifier looks up the matching public key
   * in their local device list by `fromDeviceId`.
   */
  signatureB64: z.string().min(1),
});

export type PeerHello = z.infer<typeof PeerHelloSchema>;

/**
 * Canonical bytestring the peer-hello signature covers. Pinned here so
 * sender and verifier stay in lockstep across code paths. Format mirrors
 * `deviceAuthorizationPayload` and `deviceListEventPayload` — newline-
 * separated, prefix-tagged so the same key can never sign a different
 * record type with a colliding payload.
 */
export function peerHelloPayload(input: {
  fromDeviceId: string;
  ephPubKeyB64: string;
  nonceB64: string;
}): string {
  return ["ottie-peer-sync-hello-v1", input.fromDeviceId, input.ephPubKeyB64, input.nonceB64].join(
    "\n",
  );
}

/**
 * Wire shape for an encrypted peer-sync frame. The plaintext inside is
 * the application-layer payload (a `DeviceListEvent` JSON for Phase 2.f
 * /3, batches of events later). Carrier envelope only — semantics live
 * one layer up.
 */
export const PeerSyncFrameSchema = z.object({
  v: z.literal(1),
  kind: z.literal("peer-sync-frame"),
  /**
   * NaCl box ciphertext (24-byte nonce ‖ XSalsa20-Poly1305 ciphertext),
   * standard base64. Same format as DeviceLinkRedemption.ciphertextB64
   * so a future inspector can hex-dump them with the same code.
   */
  ciphertextB64: z.string().min(1),
});

export type PeerSyncFrame = z.infer<typeof PeerSyncFrameSchema>;
