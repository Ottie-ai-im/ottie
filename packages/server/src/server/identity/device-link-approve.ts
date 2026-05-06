import {
  decrypt,
  deriveSharedKey,
  encrypt,
  importPublicKey,
  importSecretKey,
} from "@ottie/relay/e2ee";

import {
  DeviceLinkApprovalReplySchema,
  type DeviceLinkApprovalEnvelope,
  type DeviceLinkApprovalReply,
} from "./device-link-approve-types.js";
import { buildAuthorizedDevice } from "./device-list-store.js";
import type { CandidateDevice } from "./device-link-redeem-types.js";
import type { StoredDevice } from "./device-types.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

/**
 * Phase 2.e — pure crypto helpers for the OLD device's approval reply.
 *
 * Like `device-link-redeem.ts`, this module is I/O-free so the roundtrip
 * (sign → encrypt → decrypt → schema-validate) can be tested without a
 * real relay or filesystem.
 *
 * The shared key is derived once from the SAME ECDH halves Phase 2.d
 * already used (old device's retained ephPrivateKey + new device's
 * ephPublicKey). Reusing the key for the reply means no extra keypair
 * generation and no new ephemeral exchange — Phase 2.d's setup is
 * idempotent for this single round-trip.
 */

export interface ApproveDeviceLinkCandidateInput {
  /** The candidate received in Phase 2.d. Drives the signed-device fields. */
  candidate: CandidateDevice;
  /** Old device's retained X25519 secret from the original offer. */
  ephPrivateKeyB64: string;
  /** New device's X25519 public from the redemption envelope. */
  newDeviceEphPublicKeyB64: string;
  /** Loaded root identity. Its private key signs the new device record. */
  rootIdentity: RootIdentityBundle;
  /**
   * The OLD device's current devices.json contents (BEFORE adding this
   * new device). Helper appends `signedDevice` and ships the result to
   * the new device as its initial peer-list snapshot.
   */
  existingDevices: readonly StoredDevice[];
  /** Override clock (tests). */
  nowMs?: number;
}

export interface ApproveDeviceLinkCandidateResult {
  /** Encrypted envelope to send over the relay back to the new device. */
  envelope: DeviceLinkApprovalEnvelope;
  /** The freshly-signed StoredDevice. OLD device must persist it. */
  signedDevice: StoredDevice;
  /** Mirror of what's inside the envelope, for caller logging / UI. */
  reply: DeviceLinkApprovalReply;
}

export function approveDeviceLinkCandidate(
  input: ApproveDeviceLinkCandidateInput,
): ApproveDeviceLinkCandidateResult {
  const authorizedAt = new Date(input.nowMs ?? Date.now()).toISOString();

  // 1. Sign the candidate's pubkey + metadata with the root identity.
  // This is the cryptographic capability the new device needs to prove
  // it was authorized by the user.
  const signedDevice = buildAuthorizedDevice({
    deviceId: input.candidate.deviceId,
    deviceLabel: input.candidate.deviceLabel,
    role: input.candidate.role,
    signPublicKeyB64: input.candidate.signPublicKeyB64,
    authorizedAt,
    rootIdentity: input.rootIdentity,
  });

  // 2. Build the plaintext approval payload. The peer-device snapshot
  // INCLUDES the freshly-signed device so the new device's first
  // devices.json contains itself + every device the OLD device knows
  // about. (The OLD device persists its own copy separately.)
  const reply: DeviceLinkApprovalReply = {
    v: 1,
    kind: "device-link-approval",
    status: "approved",
    rootIdentity: input.rootIdentity.stored,
    signedDevice,
    peerDevices: [...input.existingDevices, signedDevice],
  };

  // 3. Encrypt with the shared key derived from Phase 2.d's keys.
  const envelope = encryptApprovalReply({
    reply,
    ephPrivateKeyB64: input.ephPrivateKeyB64,
    newDeviceEphPublicKeyB64: input.newDeviceEphPublicKeyB64,
  });

  return { envelope, signedDevice, reply };
}

export interface RejectDeviceLinkCandidateInput {
  ephPrivateKeyB64: string;
  newDeviceEphPublicKeyB64: string;
  /** Optional reason shown on the new device's screen. */
  rejectionReason?: string;
}

export function rejectDeviceLinkCandidate(input: RejectDeviceLinkCandidateInput): {
  envelope: DeviceLinkApprovalEnvelope;
  reply: DeviceLinkApprovalReply;
} {
  const reply: DeviceLinkApprovalReply = {
    v: 1,
    kind: "device-link-approval",
    status: "rejected",
    ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
  };
  const envelope = encryptApprovalReply({
    reply,
    ephPrivateKeyB64: input.ephPrivateKeyB64,
    newDeviceEphPublicKeyB64: input.newDeviceEphPublicKeyB64,
  });
  return { envelope, reply };
}

export interface DecryptDeviceLinkApprovalEnvelopeInput {
  envelope: DeviceLinkApprovalEnvelope;
  /** New device's retained ephemeral X25519 secret from Phase 2.d sender. */
  newDeviceEphPrivateKeyB64: string;
  /** Old device's ephemeral X25519 public — embedded in the original offer. */
  offerEphPublicKeyB64: string;
}

/**
 * Inverse of `approveDeviceLinkCandidate`/`rejectDeviceLinkCandidate`.
 * Used by the new device's sender once the OLD device's approval reply
 * arrives over the still-open relay socket. Throws on tamper, wrong key,
 * or schema mismatch — caller should surface as "approval reply
 * rejected" and tear down the link attempt.
 */
export function decryptDeviceLinkApprovalEnvelope(
  input: DecryptDeviceLinkApprovalEnvelopeInput,
): DeviceLinkApprovalReply {
  const ourSecret = importSecretKey(b64urlToB64(input.newDeviceEphPrivateKeyB64));
  const peerPublic = importPublicKey(b64urlToB64(input.offerEphPublicKeyB64));
  const sharedKey = deriveSharedKey(ourSecret, peerPublic);

  const ciphertext = base64ToArrayBuffer(input.envelope.ciphertextB64);
  const plaintext = decrypt(sharedKey, ciphertext);
  if (typeof plaintext !== "string") {
    throw new Error("Approval envelope ciphertext did not decrypt to text");
  }
  const parsed = JSON.parse(plaintext);
  return DeviceLinkApprovalReplySchema.parse(parsed);
}

// ----- internal: shared encrypt path used by approve + reject ------------

function encryptApprovalReply(args: {
  reply: DeviceLinkApprovalReply;
  ephPrivateKeyB64: string;
  newDeviceEphPublicKeyB64: string;
}): DeviceLinkApprovalEnvelope {
  const ourSecret = importSecretKey(b64urlToB64(args.ephPrivateKeyB64));
  const peerPublic = importPublicKey(b64urlToB64(args.newDeviceEphPublicKeyB64));
  const sharedKey = deriveSharedKey(ourSecret, peerPublic);

  const ciphertext = encrypt(sharedKey, JSON.stringify(args.reply));
  const ciphertextB64 = arrayBufferToBase64(ciphertext);

  return {
    v: 1,
    kind: "device-link-approval-envelope",
    ciphertextB64,
  };
}

// ----- ArrayBuffer ↔ regular base64 + JWK base64url adapter -------------
// Mirror of helpers in `device-link-redeem.ts`. Kept duplicated rather
// than shared because the two modules are conceptually independent
// halves and a future SimpleX-style transport adapter would clone this
// shape rather than depend on it.

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
