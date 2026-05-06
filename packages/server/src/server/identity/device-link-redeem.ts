import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";

import {
  decrypt,
  deriveSharedKey,
  encrypt,
  importPublicKey,
  importSecretKey,
} from "@ottie/relay/e2ee";

import {
  CandidateDeviceSchema,
  type CandidateDevice,
  type DeviceLinkRedemption,
} from "./device-link-redeem-types.js";
import { decodeDeviceLinkOffer, type DeviceLinkOffer } from "./device-link-types.js";

/**
 * Phase 2.d — pure crypto helpers for the new-device side of the device-
 * link handshake. Kept I/O-free so it's trivial to unit-test the roundtrip
 * (encrypt-then-decrypt) without a real relay or filesystem.
 *
 * The redeem flow has two halves that meet in the middle:
 *
 *   New device                     Existing device
 *   -----------                    ---------------
 *   buildDeviceLinkRedemption  →   decryptDeviceLinkRedemption
 *   (with offer.ephPublicKey)      (with pending.ephPrivateKey)
 *
 * Both halves derive the same X25519 shared key. NaCl box (Curve25519 +
 * XSalsa20-Poly1305) wraps the candidate JSON; the wire envelope only
 * exposes the new device's ephemeral public key + nonce, which are not
 * confidential.
 */

export interface NewDeviceLocalSecrets {
  /** Fresh UUID — becomes the persisted Device.deviceId once approved. */
  deviceId: string;
  /** Ed25519 private key — stays on this device, never sent. */
  signPrivateKey: KeyObject;
  /** Mirror copy of the public key for convenience (also in the candidate). */
  signPublicKeyB64: string;
  /** The X25519 ephemeral secret key, base64url. Held for any retry; dropped afterwards. */
  ephPrivateKeyB64: string;
}

export interface BuildDeviceLinkRedemptionInput {
  /** Either the wire `DeviceLinkOffer` (already decoded) or a deep-link string to decode. */
  offer: DeviceLinkOffer | string;
  /** Human-readable label the new device wants to register itself under. */
  deviceLabel: string;
  /** Whether the new device is a daemon-host or client-only. */
  role: "daemon" | "client";
  /** Override clock for tests. Defaults to Date.now(). */
  nowMs?: number;
}

export interface BuildDeviceLinkRedemptionResult {
  /** The wire envelope to send to the existing device through the relay. */
  redemption: DeviceLinkRedemption;
  /** The plaintext candidate payload that was encrypted (mirror, for caller logging/UI). */
  candidate: CandidateDevice;
  /** The decoded offer, returned for caller's UI ("Linking to <displayName>"). */
  offer: DeviceLinkOffer;
  /** Local secrets the new device must keep until the redemption is approved. */
  localSecrets: NewDeviceLocalSecrets;
}

/**
 * Produce a `DeviceLinkRedemption` envelope ready to send over the relay.
 * Generates fresh keypairs, derives the shared key with the offer, and
 * encrypts a `CandidateDevice` describing this device.
 */
export function buildDeviceLinkRedemption(
  input: BuildDeviceLinkRedemptionInput,
): BuildDeviceLinkRedemptionResult {
  const offer = typeof input.offer === "string" ? decodeDeviceLinkOffer(input.offer) : input.offer;

  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(offer.exp) <= nowMs) {
    throw new Error("Device-link offer has expired");
  }

  // Long-lived Ed25519 device signing keypair. This is the new device's
  // identity-as-device and stays put until the device is removed.
  const { publicKey: signPublicKey, privateKey: signPrivateKey } = generateKeyPairSync("ed25519");
  const signPublicKeyB64 = exportEd25519PublicKey(signPublicKey);

  // Ephemeral X25519 keypair for ECDH with the offer. One-shot — dropped
  // after the redemption either succeeds or times out.
  const { publicKey: ephPublicKey, privateKey: ephPrivateKey } = generateKeyPairSync("x25519");
  const newDeviceEphPublicKeyB64 = exportX25519PublicKeyJwk(ephPublicKey);
  const ephPrivateKeyB64 = exportX25519PrivateKeyJwk(ephPrivateKey);

  const candidate: CandidateDevice = {
    v: 1,
    kind: "candidate-device",
    deviceId: randomUUID(),
    deviceLabel: input.deviceLabel,
    role: input.role,
    signPublicKeyB64,
    generatedAt: new Date(nowMs).toISOString(),
  };

  // Derive shared key from our ephemeral X25519 secret + offer's ephemeral
  // X25519 public. The offer's keys are already 32-byte raw Curve25519
  // (JWK 'x' / 'd'), wire-compatible with NaCl box. The relay's import
  // helpers expect standard base64 with padding, so re-pad the JWK form.
  const ourEphSecret = importSecretKey(b64urlToB64(ephPrivateKeyB64));
  const offerEphPublic = importPublicKey(b64urlToB64(offer.ephPublicKeyB64));
  const sharedKey = deriveSharedKey(ourEphSecret, offerEphPublic);

  const ciphertext = encrypt(sharedKey, JSON.stringify(candidate));
  const ciphertextB64 = arrayBufferToBase64(ciphertext);

  return {
    redemption: {
      v: 1,
      kind: "device-link-redemption",
      offerNonceB64: offer.nonceB64,
      newDeviceEphPublicKeyB64,
      ciphertextB64,
    },
    candidate,
    offer,
    localSecrets: {
      deviceId: candidate.deviceId,
      signPrivateKey,
      signPublicKeyB64,
      ephPrivateKeyB64,
    },
  };
}

export interface DecryptDeviceLinkRedemptionInput {
  /** The envelope received from the new device. */
  redemption: DeviceLinkRedemption;
  /** Existing device's retained X25519 secret for THIS offer (from `PendingDeviceLinkOffer`). */
  ephPrivateKeyB64: string;
}

/**
 * Inverse of `buildDeviceLinkRedemption`: existing device decrypts and
 * validates the candidate payload. Throws on tamper, wrong key, or schema
 * mismatch — callers should surface that as "device-link redemption
 * rejected" without leaking specifics.
 */
export function decryptDeviceLinkRedemption(
  input: DecryptDeviceLinkRedemptionInput,
): CandidateDevice {
  const ourSecret = importSecretKey(b64urlToB64(input.ephPrivateKeyB64));
  const peerPublic = importPublicKey(b64urlToB64(input.redemption.newDeviceEphPublicKeyB64));
  const sharedKey = deriveSharedKey(ourSecret, peerPublic);

  const ciphertext = base64ToArrayBuffer(input.redemption.ciphertextB64);
  const plaintext = decrypt(sharedKey, ciphertext);
  if (typeof plaintext !== "string") {
    throw new Error("Device-link redemption ciphertext did not decrypt to text");
  }
  const parsed = JSON.parse(plaintext);
  return CandidateDeviceSchema.parse(parsed);
}

// ----- JWK base64url ↔ raw 32-byte serialization --------------------------

function exportEd25519PublicKey(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) {
    throw new Error("Ed25519 public key JWK missing 'x' field");
  }
  return jwk.x;
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

// ----- ArrayBuffer ↔ regular base64 (matches the relay package) ----------

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

/** Convert JWK base64url (-/_, no padding) to standard base64 (+//, padded). */
function b64urlToB64(input: string): string {
  const standard = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (standard.length % 4)) % 4;
  return standard + "=".repeat(padLen);
}
