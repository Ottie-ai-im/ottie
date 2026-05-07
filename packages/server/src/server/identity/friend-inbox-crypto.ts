import { generateKeyPairSync, type KeyObject } from "node:crypto";

import {
  decrypt,
  deriveSharedKey,
  encrypt,
  importPublicKey,
  importSecretKey,
} from "@ottie/relay/e2ee";

import {
  FriendChatMessageEnvelopeSchema,
  type FriendChatMessageEnvelope,
} from "./friend-chat-types.js";
import { InboxBlobSchema, type InboxBlob } from "./friend-inbox-types.js";

/**
 * Phase 3.b/2c — pure crypto helpers for the offline-inbox blob.
 *
 * Sender (`encryptInboxBlob`):
 *   1. Generate a fresh X25519 ephemeral keypair.
 *   2. Derive the shared key with `recipientEncryptionPublicKeyB64`
 *      (peer's long-lived X25519 pubkey from peer-record, populated in
 *      Phase 3.b/2a).
 *   3. NaCl-box the envelope JSON.
 *   4. Drop the ephemeral secret. Return the wire blob.
 *
 * Recipient (`decryptInboxBlob`):
 *   1. Re-derive the shared key with the sender's ephemeral pubkey
 *      (from the blob) + the recipient's long-lived X25519 secret
 *      (from the loaded RootIdentityBundle).
 *   2. Open the box → JSON envelope.
 *   3. Schema-validate against `FriendChatMessageEnvelopeSchema`.
 *
 * Trust:
 *   - Decryption alone proves nothing about WHO sent the blob — anyone
 *     with the recipient's pubkey can encrypt under it. The proof of
 *     authorship lives inside the envelope: it carries an Ed25519
 *     signature by the sender's root sign privkey over the canonical
 *     `friendChatMessagePayload(...)`. Callers MUST verify that
 *     signature before trusting the inner message; this module only
 *     gets you to a decrypted, schema-valid envelope.
 */

// ----- sender ------------------------------------------------------------

export interface EncryptInboxBlobInput {
  envelope: FriendChatMessageEnvelope;
  /** Peer's long-lived X25519 pubkey (JWK 'x' base64url). */
  recipientEncryptionPublicKeyB64: string;
}

export interface EncryptInboxBlobResult {
  blob: InboxBlob;
  /** JSON-encoded blob ready to POST as the relay /inbox request body. */
  serializedBlob: string;
}

export function encryptInboxBlob(input: EncryptInboxBlobInput): EncryptInboxBlobResult {
  if (!input.recipientEncryptionPublicKeyB64) {
    throw new Error("recipientEncryptionPublicKeyB64 must not be empty");
  }

  // One-shot ephemeral X25519 keypair. Forward secrecy isn't formally
  // achieved (recipient's long-term key persists), but using a fresh
  // ephemeral on every send compartmentalizes any sender-side key leak.
  const { publicKey: ephPublicKey, privateKey: ephPrivateKey } = generateKeyPairSync("x25519");
  const ephPublicKeyB64 = exportX25519PublicJwk(ephPublicKey);
  const ephPrivateKeyB64 = exportX25519PrivateJwk(ephPrivateKey);

  const ourSecret = importSecretKey(b64urlToB64(ephPrivateKeyB64));
  const theirPublic = importPublicKey(b64urlToB64(input.recipientEncryptionPublicKeyB64));
  const sharedKey = deriveSharedKey(ourSecret, theirPublic);

  const ciphertext = encrypt(sharedKey, JSON.stringify(input.envelope));
  const ciphertextB64 = arrayBufferToBase64(ciphertext);

  const blob: InboxBlob = {
    v: 1,
    ephPublicKeyB64,
    ciphertextB64,
  };
  return { blob, serializedBlob: JSON.stringify(blob) };
}

// ----- recipient ---------------------------------------------------------

export interface DecryptInboxBlobInput {
  /**
   * The raw bytes of the blob value as fetched from relay /inbox. Either
   * the parsed JSON object (when the caller already JSON.parsed) or the
   * raw string — both are accepted.
   */
  blob: unknown;
  /**
   * Recipient's long-lived X25519 PRIVATE key (JWK 'd' base64url). From
   * `RootIdentityBundle.encryptionPrivateKeyB64`.
   */
  selfEncryptionPrivateKeyB64: string;
}

export type DecryptInboxBlobOutcome =
  | { ok: true; envelope: FriendChatMessageEnvelope }
  | { ok: false; reason: string };

/**
 * Decrypt and schema-validate an inbox blob. Does NOT verify the inner
 * envelope's Ed25519 signature — call `verifyFriendChatMessageEnvelope`
 * with the resulting envelope before trusting it.
 */
export function decryptInboxBlob(input: DecryptInboxBlobInput): DecryptInboxBlobOutcome {
  let parsed: unknown;
  if (typeof input.blob === "string") {
    try {
      parsed = JSON.parse(input.blob);
    } catch (err) {
      return { ok: false, reason: `Inbox blob is not valid JSON: ${describe(err)}` };
    }
  } else {
    parsed = input.blob;
  }

  const blobValidation = InboxBlobSchema.safeParse(parsed);
  if (!blobValidation.success) {
    return { ok: false, reason: `Inbox blob schema invalid: ${blobValidation.error.message}` };
  }
  const blob = blobValidation.data;

  let envelopeJson: string;
  try {
    const ourSecret = importSecretKey(b64urlToB64(input.selfEncryptionPrivateKeyB64));
    const theirPublic = importPublicKey(b64urlToB64(blob.ephPublicKeyB64));
    const sharedKey = deriveSharedKey(ourSecret, theirPublic);
    const ciphertext = base64ToArrayBuffer(blob.ciphertextB64);
    const plaintext = decrypt(sharedKey, ciphertext);
    if (typeof plaintext !== "string") {
      return { ok: false, reason: "Inbox blob ciphertext did not decrypt to text" };
    }
    envelopeJson = plaintext;
  } catch (err) {
    return { ok: false, reason: `Inbox blob decrypt failed: ${describe(err)}` };
  }

  let envelopeParsed: unknown;
  try {
    envelopeParsed = JSON.parse(envelopeJson);
  } catch (err) {
    return { ok: false, reason: `Decrypted inner payload is not valid JSON: ${describe(err)}` };
  }
  const envelopeValidation = FriendChatMessageEnvelopeSchema.safeParse(envelopeParsed);
  if (!envelopeValidation.success) {
    return {
      ok: false,
      reason: `Decrypted envelope schema invalid: ${envelopeValidation.error.message}`,
    };
  }
  return { ok: true, envelope: envelopeValidation.data };
}

// ----- internal -----------------------------------------------------------

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function exportX25519PublicJwk(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("X25519 public key JWK missing 'x' field");
  return jwk.x;
}

function exportX25519PrivateJwk(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { d?: string };
  if (!jwk.d) throw new Error("X25519 private key JWK missing 'd' field");
  return jwk.d;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buffer)).toString("base64");
}

function base64ToArrayBuffer(input: string): ArrayBuffer {
  const padded = b64urlToB64(input.trim());
  const bytes = Buffer.from(padded, "base64");
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

function b64urlToB64(input: string): string {
  const standard = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (standard.length % 4)) % 4;
  return standard + "=".repeat(padLen);
}
