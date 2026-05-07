import { z } from "zod";

/**
 * Phase 3.b/2c — wire shape for an offline-inbox blob (the value byte
 * stream a sender POSTs to relay's `/inbox/{recipientPubKey}`). Wraps a
 * `FriendChatMessageEnvelope` in NaCl box (Curve25519 + XSalsa20-
 * Poly1305) addressed to the recipient's long-lived X25519 pubkey
 * (`peerEncryptionPublicKeyB64`, established at friend-pair time in
 * Phase 3.b/2a).
 *
 * The relay is zero-knowledge: it never sees the inner envelope or its
 * plaintext body. Only the recipient (with their identity X25519 priv
 * key) can decrypt this blob; the inner envelope's Ed25519 signature is
 * still the trust anchor for "this is really from sender X".
 *
 * Format on the wire is JSON-serialized, then sent as the request body's
 * raw bytes. JSON keeps debugging cheap and avoids a custom binary
 * parser. The size overhead vs. a packed binary form is ~50 bytes —
 * negligible against the 64KB per-blob cap.
 */
export const InboxBlobSchema = z.object({
  v: z.literal(1),
  /**
   * Sender's per-message ephemeral X25519 public key (raw 32-byte JWK
   * 'x' base64url, no padding). One-shot: the matching secret is
   * dropped after the POST returns. Forward secrecy isn't formally
   * achieved (recipient's long-term key remains the same), but a
   * future leak of the sender's keypair doesn't decrypt anything that
   * was already in flight, and a future leak of the recipient's
   * long-term key only opens whatever's still in their inbox window.
   */
  ephPublicKeyB64: z.string().min(1),
  /**
   * NaCl-box ciphertext: 24-byte nonce ‖ XSalsa20-Poly1305 ciphertext,
   * standard base64 (matches `friend-pair-redeem.FriendPairRedemption.
   * ciphertextB64` for code reuse).
   */
  ciphertextB64: z.string().min(1),
});

export type InboxBlob = z.infer<typeof InboxBlobSchema>;
