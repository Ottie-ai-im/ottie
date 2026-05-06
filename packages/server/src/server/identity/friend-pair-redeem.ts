import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

import {
  decrypt,
  deriveSharedKey,
  encrypt,
  importPublicKey,
  importSecretKey,
} from "@ottie/relay/e2ee";

import {
  FriendCandidateSchema,
  friendCandidatePayload,
  type FriendCandidate,
  type FriendPairRedemption,
} from "./friend-pair-redeem-types.js";
import { decodeFriendPairOffer, type FriendPairOffer } from "./friend-pair-types.js";

/**
 * Phase 3.a/0 — pure crypto helpers for the receiver (Bob) side of the
 * friend-pair handshake, plus the verifier for the sender (Alice) side.
 * I/O free, mirroring `device-link-redeem.ts` so callers and tests can
 * exercise the full encrypt-sign-decrypt-verify roundtrip without sockets,
 * disk, or a real relay.
 *
 * The redeem flow has two halves that meet in the middle:
 *
 *   Bob (responder)              Alice (originator)
 *   ---------------              ------------------
 *   buildFriendPairRedemption  → decryptFriendPairRedemption
 *                                + verifyFriendCandidate
 *   (signs with own root)       (verifies sig with claimed root pubkey)
 *
 * Both halves derive the same X25519 shared key. NaCl box (Curve25519 +
 * XSalsa20-Poly1305) wraps the candidate JSON; the wire envelope only
 * exposes Bob's ephemeral public key + nonce, which are not confidential.
 *
 * The candidate's Ed25519 signature binds Bob's claimed root pubkey to
 * the specific ECDH session, defeating relay-side substitution attacks
 * (SIGMA-I-style mutual auth — same intuition as `peer-sync-handshake.ts`).
 */

// ----- responder side (Bob) ---------------------------------------------

export interface FriendPairLocalSecrets {
  /** X25519 ephemeral private key (JWK 'd' base64url). Held for retry; dropped after. */
  ephPrivateKeyB64: string;
}

export interface BuildFriendPairRedemptionInput {
  /** Either the wire `FriendPairOffer` (already decoded) or a deep-link string to decode. */
  offer: FriendPairOffer | string;
  /** Bob's root identity public key (Ed25519, JWK 'x' base64url). Goes into the candidate. */
  selfRootSignPublicKeyB64: string;
  /** Bob's root identity private key (Ed25519 KeyObject). Used to sign the candidate; never sent. */
  selfRootSignPrivateKey: KeyObject;
  /** Bob's display name, shown to Alice in her approve dialog. */
  selfDisplayName: string;
  /** Override clock for tests. Defaults to Date.now(). */
  nowMs?: number;
}

export interface BuildFriendPairRedemptionResult {
  /** The wire envelope to send to Alice's daemon through the relay. */
  redemption: FriendPairRedemption;
  /** The plaintext candidate payload that was encrypted (mirror, for caller logging/UI). */
  candidate: FriendCandidate;
  /** The decoded offer, returned for caller's UI ("Pairing with <displayName>"). */
  offer: FriendPairOffer;
  /** Local secrets Bob's daemon must keep until the redemption completes or times out. */
  localSecrets: FriendPairLocalSecrets;
}

/**
 * Produce a `FriendPairRedemption` envelope ready to send over the relay.
 * Generates a fresh ephemeral X25519 keypair, derives the shared key with
 * the offer, signs the canonical session payload with Bob's root sign
 * private key, and encrypts the resulting `FriendCandidate`.
 */
export function buildFriendPairRedemption(
  input: BuildFriendPairRedemptionInput,
): BuildFriendPairRedemptionResult {
  const offer = typeof input.offer === "string" ? decodeFriendPairOffer(input.offer) : input.offer;

  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(offer.exp) <= nowMs) {
    throw new Error("Friend-pair offer has expired");
  }

  const trimmedName = input.selfDisplayName.trim();
  if (trimmedName.length === 0) {
    throw new Error("selfDisplayName must not be empty");
  }
  if (trimmedName.length > 64) {
    throw new Error("selfDisplayName must be 64 characters or fewer");
  }

  // Ephemeral X25519 keypair for ECDH with the offer. One-shot — dropped
  // after the redemption either succeeds or times out.
  const { publicKey: ephPublicKey, privateKey: ephPrivateKey } = generateKeyPairSync("x25519");
  const candidateEphPublicKeyB64 = exportX25519PublicKeyJwk(ephPublicKey);
  const ephPrivateKeyB64 = exportX25519PrivateKeyJwk(ephPrivateKey);

  // Sign the session-bound payload with Bob's root sign private key. This
  // is the SIGMA-I-style binding that lets Alice trust the candidate root
  // pubkey actually controls the ECDH exchange she's currently completing.
  const payload = friendCandidatePayload({
    offerNonceB64: offer.nonceB64,
    offerEphPublicKeyB64: offer.ephPublicKeyB64,
    candidateEphPublicKeyB64,
  });
  const signatureB64 = signEd25519(input.selfRootSignPrivateKey, payload);

  const candidate: FriendCandidate = {
    v: 1,
    kind: "friend-candidate",
    rootSignPublicKeyB64: input.selfRootSignPublicKeyB64,
    displayName: trimmedName,
    signatureB64,
    generatedAt: new Date(nowMs).toISOString(),
  };

  // Derive shared key from our ephemeral X25519 secret + offer's ephemeral
  // X25519 public. The relay's import helpers expect standard base64 with
  // padding, so re-pad the JWK base64url form on the way in.
  const ourEphSecret = importSecretKey(b64urlToB64(ephPrivateKeyB64));
  const offerEphPublic = importPublicKey(b64urlToB64(offer.ephPublicKeyB64));
  const sharedKey = deriveSharedKey(ourEphSecret, offerEphPublic);

  const ciphertext = encrypt(sharedKey, JSON.stringify(candidate));
  const ciphertextB64 = arrayBufferToBase64(ciphertext);

  return {
    redemption: {
      v: 1,
      kind: "friend-pair-redemption",
      offerNonceB64: offer.nonceB64,
      candidateEphPublicKeyB64,
      ciphertextB64,
    },
    candidate,
    offer,
    localSecrets: { ephPrivateKeyB64 },
  };
}

// ----- originator side (Alice) ------------------------------------------

export interface DecryptFriendPairRedemptionInput {
  /** The envelope received from Bob's daemon. */
  redemption: FriendPairRedemption;
  /** Alice's retained X25519 secret for THIS offer (from `PendingFriendPairOffer`). */
  ephPrivateKeyB64: string;
}

/**
 * Decrypt and schema-validate a `FriendPairRedemption`. Throws on tamper,
 * wrong key, or schema mismatch — callers should surface that as
 * "friend-pair redemption rejected" without leaking specifics.
 *
 * This intentionally does NOT verify the embedded signature. Pair with
 * `verifyFriendCandidate` — splitting them lets callers distinguish
 * decrypt failures (wrong key / tamper) from auth failures (forged root)
 * for cleaner error reporting.
 */
export function decryptFriendPairRedemption(
  input: DecryptFriendPairRedemptionInput,
): FriendCandidate {
  const ourSecret = importSecretKey(b64urlToB64(input.ephPrivateKeyB64));
  const peerPublic = importPublicKey(b64urlToB64(input.redemption.candidateEphPublicKeyB64));
  const sharedKey = deriveSharedKey(ourSecret, peerPublic);

  const ciphertext = base64ToArrayBuffer(input.redemption.ciphertextB64);
  const plaintext = decrypt(sharedKey, ciphertext);
  if (typeof plaintext !== "string") {
    throw new Error("Friend-pair redemption ciphertext did not decrypt to text");
  }
  const parsed = JSON.parse(plaintext);
  return FriendCandidateSchema.parse(parsed);
}

export type VerifyFriendCandidateOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface VerifyFriendCandidateInput {
  candidate: FriendCandidate;
  /** The offer that was redeemed (Alice already has this in her pending store). */
  offer: FriendPairOffer;
  /** The matching wire envelope (carries Bob's eph public key for the binding). */
  redemption: FriendPairRedemption;
}

/**
 * Verify the embedded Ed25519 signature on a decrypted `FriendCandidate`.
 *
 * The signature must verify under `candidate.rootSignPublicKeyB64` over the
 * canonical `friendCandidatePayload(...)` derived from the offer + envelope.
 * A successful verify proves:
 *   - whoever generated this candidate controls the claimed root sign
 *     private key (so the displayed displayName + pubkey-fingerprint pair
 *     in the UI is what Alice will actually be paired with), AND
 *   - the candidate is bound to *this specific* offer (offer nonce + offer
 *     eph pub key) and *this specific* responder eph keypair, so a relay-
 *     side adversary cannot rebind the same encrypted blob to a different
 *     handshake.
 */
export function verifyFriendCandidate(
  input: VerifyFriendCandidateInput,
): VerifyFriendCandidateOutcome {
  let pubKey: KeyObject;
  try {
    pubKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: input.candidate.rootSignPublicKeyB64 },
      format: "jwk",
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Candidate root public key unparseable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const payload = friendCandidatePayload({
    offerNonceB64: input.offer.nonceB64,
    offerEphPublicKeyB64: input.offer.ephPublicKeyB64,
    candidateEphPublicKeyB64: input.redemption.candidateEphPublicKeyB64,
  });
  let sigBytes: Buffer;
  try {
    sigBytes = base64UrlDecode(input.candidate.signatureB64);
  } catch (err) {
    return {
      ok: false,
      reason: `Candidate signature unparseable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const ok = verify(null, Buffer.from(payload, "utf8"), pubKey, sigBytes);
  if (!ok) {
    return { ok: false, reason: "Candidate signature did not verify" };
  }
  return { ok: true };
}

// ----- internal: signing + base64 helpers -------------------------------

function signEd25519(privateKey: KeyObject, payload: string): string {
  const sig = sign(null, Buffer.from(payload, "utf8"), privateKey);
  return sig.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function exportX25519PublicKeyJwk(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) {
    throw new Error("X25519 public key JWK missing 'x' field");
  }
  return jwk.x;
}

function exportX25519PrivateKeyJwk(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { d?: string };
  if (!jwk.d) {
    throw new Error("X25519 private key JWK missing 'd' field");
  }
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

function base64UrlDecode(b64url: string): Buffer {
  return Buffer.from(b64urlToB64(b64url), "base64");
}
