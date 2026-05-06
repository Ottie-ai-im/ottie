import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";

import {
  decrypt,
  deriveSharedKey,
  encrypt,
  importPublicKey,
  importSecretKey,
} from "@ottie/relay/e2ee";

import {
  FriendPairApprovalReplySchema,
  type FriendPairApprovalEnvelope,
  type FriendPairApprovalReply,
} from "./friend-pair-approve-types.js";
import type { FriendCandidate } from "./friend-pair-redeem-types.js";
import type { FriendPairOffer } from "./friend-pair-types.js";
import { peerAuthorizationPayload, type StoredPeer } from "./peer-types.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

/**
 * Phase 3.a/3 — pure crypto helpers for the originator's (Alice's)
 * approval reply. Cross-identity analog of `device-link-approve.ts`.
 *
 * Like the device-link variant this is I/O-free so the roundtrip can
 * be tested without a real relay or filesystem. Reuses the SAME shared
 * key derived during Phase 3.a/2's redemption (Alice's retained
 * `ephPrivateKeyB64` + Bob's `candidateEphPublicKeyB64`) — no fresh
 * keypair generation needed.
 *
 * Differences from device-link approval:
 *   - The reply does NOT carry a root keypair or any signing material.
 *     Friends are SEPARATE identities; Bob keeps his own root.
 *   - The signed payload is `peerAuthorizationPayload(...)`, NOT
 *     `deviceAuthorizationPayload(...)` — friend pairing is a different
 *     trust relationship and the canonical bytes must not collide.
 *   - On approve, both sides build a `Peer` entry; the helper here also
 *     produces Alice's local `Peer` for Bob (so callers don't have to
 *     re-do the signature) and Bob's authorization signature for him to
 *     verify and persist into HIS local `Peer` for Alice.
 */

export interface ApproveFriendPairCandidateInput {
  /** The candidate received in Phase 3.a/2. */
  candidate: FriendCandidate;
  /** Original offer, also from the parked candidate record. */
  offer: FriendPairOffer;
  /** Alice's retained X25519 secret from the original offer. */
  ephPrivateKeyB64: string;
  /** Bob's X25519 public from the redemption envelope. */
  candidateEphPublicKeyB64: string;
  /** Loaded root identity. Its private key signs the approval payload. */
  rootIdentity: RootIdentityBundle;
  /** Override clock (tests). */
  nowMs?: number;
}

export interface ApproveFriendPairCandidateResult {
  /** Encrypted envelope to send over the relay back to Bob's daemon. */
  envelope: FriendPairApprovalEnvelope;
  /** Mirror of what's inside the envelope, for caller logging / UI. */
  reply: FriendPairApprovalReply;
  /**
   * Alice's local `Peer` entry for Bob — already complete, ready to
   * upsert into peers.json. Authorization sig was already supplied by
   * Bob during Phase 3.a/2 (it's the candidate's signature over the
   * SIGMA-I session payload), so we re-use it: Bob signed with HIS root
   * key over a payload that includes Alice's offer eph pub + Bob's eph
   * pub, which is just as good a "Bob accepts Alice" proof as the
   * approval reply Alice is now signing for Bob.
   */
  selfPeer: StoredPeer;
}

export function approveFriendPairCandidate(
  input: ApproveFriendPairCandidateInput,
): ApproveFriendPairCandidateResult {
  const approvedAt = new Date(input.nowMs ?? Date.now()).toISOString();

  // 1. Sign the canonical authorization payload with Alice's root key.
  const payload = peerAuthorizationPayload({
    signerRole: "originator",
    originatorRootSignPublicKeyB64: input.rootIdentity.stored.signPublicKeyB64,
    responderRootSignPublicKeyB64: input.candidate.rootSignPublicKeyB64,
    pairingNonceB64: input.offer.nonceB64,
  });
  const authorizationSignatureB64 = signEd25519(input.rootIdentity.signPrivateKey, payload);

  // 2. Build the plaintext approval payload Alice ships to Bob.
  const reply: FriendPairApprovalReply = {
    v: 1,
    kind: "friend-pair-approval",
    status: "approved",
    originatorRootSignPublicKeyB64: input.rootIdentity.stored.signPublicKeyB64,
    originatorDisplayName: input.rootIdentity.stored.displayName,
    authorizationSignatureB64,
    approvedAt,
  };

  // 3. Encrypt with the same shared key Phase 3.a/2 used.
  const envelope = encryptApprovalReply({
    reply,
    ephPrivateKeyB64: input.ephPrivateKeyB64,
    candidateEphPublicKeyB64: input.candidateEphPublicKeyB64,
  });

  // 4. Build Alice's local `Peer` for Bob. The auth signature uses the
  // SIGMA-I signature Bob sent during 3.a/2 — that's a proof made by
  // Bob's root key that Bob owned the ECDH session that landed under
  // Alice's pending offer, which is exactly what we want to record as
  // "Bob accepted Alice's pair offer".
  const selfPeer: StoredPeer = {
    v: 1,
    peerRootSignPublicKeyB64: input.candidate.rootSignPublicKeyB64,
    peerDisplayName: input.candidate.displayName,
    pairedAt: approvedAt,
    status: "active",
    pairingNonceB64: input.offer.nonceB64,
    authorizationSignatureB64: input.candidate.signatureB64,
  };

  return { envelope, reply, selfPeer };
}

export interface RejectFriendPairCandidateInput {
  ephPrivateKeyB64: string;
  candidateEphPublicKeyB64: string;
  /** Optional reason shown on Bob's screen. */
  rejectionReason?: string;
}

export function rejectFriendPairCandidate(input: RejectFriendPairCandidateInput): {
  envelope: FriendPairApprovalEnvelope;
  reply: FriendPairApprovalReply;
} {
  const reply: FriendPairApprovalReply = {
    v: 1,
    kind: "friend-pair-approval",
    status: "rejected",
    ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
  };
  const envelope = encryptApprovalReply({
    reply,
    ephPrivateKeyB64: input.ephPrivateKeyB64,
    candidateEphPublicKeyB64: input.candidateEphPublicKeyB64,
  });
  return { envelope, reply };
}

export interface DecryptFriendPairApprovalEnvelopeInput {
  envelope: FriendPairApprovalEnvelope;
  /** Bob's retained ephemeral X25519 secret from Phase 3.a/2 sender. */
  candidateEphPrivateKeyB64: string;
  /** Alice's ephemeral X25519 public — embedded in the original offer. */
  offerEphPublicKeyB64: string;
}

/**
 * Inverse of `approveFriendPairCandidate` / `rejectFriendPairCandidate`.
 * Used by Bob's daemon once Alice's approval reply arrives over the
 * still-open Phase 3.a/2 socket. Throws on tamper, wrong key, or schema
 * mismatch — caller should surface as "approval reply rejected" and tear
 * down the pair attempt.
 *
 * Does NOT verify the embedded signature. Pair with `verifyFriendPair
 * Approval` to perform the SIGMA-I-style binding check before trusting
 * the payload.
 */
export function decryptFriendPairApprovalEnvelope(
  input: DecryptFriendPairApprovalEnvelopeInput,
): FriendPairApprovalReply {
  const ourSecret = importSecretKey(b64urlToB64(input.candidateEphPrivateKeyB64));
  const peerPublic = importPublicKey(b64urlToB64(input.offerEphPublicKeyB64));
  const sharedKey = deriveSharedKey(ourSecret, peerPublic);

  const ciphertext = base64ToArrayBuffer(input.envelope.ciphertextB64);
  const plaintext = decrypt(sharedKey, ciphertext);
  if (typeof plaintext !== "string") {
    throw new Error("Friend-pair approval envelope ciphertext did not decrypt to text");
  }
  const parsed = JSON.parse(plaintext);
  return FriendPairApprovalReplySchema.parse(parsed);
}

export type VerifyFriendPairApprovalOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface VerifyFriendPairApprovalInput {
  reply: Extract<FriendPairApprovalReply, { status: "approved" }>;
  /** Alice's root sign pubkey from the offer Bob redeemed. */
  expectedOriginatorRootSignPublicKeyB64: string;
  /** Bob's own root sign pubkey (the candidate's claimed identity). */
  responderRootSignPublicKeyB64: string;
  /** The pairing nonce from the offer. */
  pairingNonceB64: string;
}

/**
 * Verify the Ed25519 signature on an APPROVED `FriendPairApprovalReply`.
 *
 * Returns ok:true iff:
 *   - The reply's claimed originator pubkey matches what was in the
 *     offer Bob scanned (defends against a swapped reply).
 *   - The signature verifies under that pubkey over
 *     `peerAuthorizationPayload({signerRole: "originator", ...})` with
 *     both root pubkeys + the pairing nonce.
 */
export function verifyFriendPairApproval(
  input: VerifyFriendPairApprovalInput,
): VerifyFriendPairApprovalOutcome {
  if (input.reply.originatorRootSignPublicKeyB64 !== input.expectedOriginatorRootSignPublicKeyB64) {
    return {
      ok: false,
      reason: "Approval reply's originator pubkey does not match the offer Bob scanned",
    };
  }

  let pubKey: KeyObject;
  try {
    pubKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: input.reply.originatorRootSignPublicKeyB64 },
      format: "jwk",
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Originator pubkey unparseable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const payload = peerAuthorizationPayload({
    signerRole: "originator",
    originatorRootSignPublicKeyB64: input.reply.originatorRootSignPublicKeyB64,
    responderRootSignPublicKeyB64: input.responderRootSignPublicKeyB64,
    pairingNonceB64: input.pairingNonceB64,
  });
  let sigBytes: Buffer;
  try {
    sigBytes = base64UrlDecode(input.reply.authorizationSignatureB64);
  } catch (err) {
    return {
      ok: false,
      reason: `Authorization signature unparseable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const ok = verify(null, Buffer.from(payload, "utf8"), pubKey, sigBytes);
  if (!ok) {
    return { ok: false, reason: "Approval signature did not verify" };
  }
  return { ok: true };
}

// ----- internal: shared encrypt path used by approve + reject ------------

function encryptApprovalReply(args: {
  reply: FriendPairApprovalReply;
  ephPrivateKeyB64: string;
  candidateEphPublicKeyB64: string;
}): FriendPairApprovalEnvelope {
  const ourSecret = importSecretKey(b64urlToB64(args.ephPrivateKeyB64));
  const peerPublic = importPublicKey(b64urlToB64(args.candidateEphPublicKeyB64));
  const sharedKey = deriveSharedKey(ourSecret, peerPublic);

  const ciphertext = encrypt(sharedKey, JSON.stringify(args.reply));
  const ciphertextB64 = arrayBufferToBase64(ciphertext);

  return {
    v: 1,
    kind: "friend-pair-approval-envelope",
    ciphertextB64,
  };
}

function signEd25519(privateKey: KeyObject, payload: string): string {
  const sig = sign(null, Buffer.from(payload, "utf8"), privateKey);
  return sig.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
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
