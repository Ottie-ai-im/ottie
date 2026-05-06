import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

import {
  decrypt,
  deriveSharedKey,
  encrypt,
  importPublicKey,
  importSecretKey,
  type SharedKey,
} from "@ottie/relay/e2ee";

import {
  PeerHelloSchema,
  PeerSyncFrameSchema,
  peerHelloPayload,
  type PeerHello,
  type PeerSyncFrame,
} from "./peer-sync-types.js";
import type { StoredDevice } from "./device-types.js";

/**
 * Phase 2.f/2 — pure crypto + state machines for the peer-sync
 * handshake. I/O free, so the same shape as Phase 2.d/0 + 2.e/0:
 * sign/verify/derive-key/encrypt/decrypt all unit-testable without
 * sockets, daemons, or relays.
 *
 * See `peer-sync-types.ts` header comment for the protocol shape.
 */

// ----- build (initiator + responder share this) -------------------------

export interface BuildPeerHelloInput {
  selfDeviceId: string;
  /** Ed25519 self-device PRIVATE key — never leaves this daemon. */
  selfSignPrivateKey: KeyObject;
  /** Override clock for tests; ignored in non-test code paths. */
  nonceBytes?: Buffer;
}

export interface BuildPeerHelloResult {
  hello: PeerHello;
  /** X25519 ephemeral PRIVATE key (JWK 'd' base64url). Keep until the handshake settles. */
  ephPrivateKeyB64: string;
}

export function buildPeerHello(input: BuildPeerHelloInput): BuildPeerHelloResult {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  const jwkPriv = privateKey.export({ format: "jwk" }) as { d: string };
  const nonceBytes = input.nonceBytes ?? randomBytes(32);
  const nonceB64 = nonceBytes.toString("base64url").replace(/=+$/, "");

  const partial = {
    fromDeviceId: input.selfDeviceId,
    ephPubKeyB64: jwkPub.x,
    nonceB64,
  };
  const sig = sign(null, Buffer.from(peerHelloPayload(partial), "utf8"), input.selfSignPrivateKey);
  const signatureB64 = sig
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return {
    hello: {
      v: 1,
      kind: "peer-hello",
      ...partial,
      signatureB64,
    },
    ephPrivateKeyB64: jwkPriv.d,
  };
}

// ----- verify (initiator + responder share this) ------------------------

export type VerifyPeerHelloOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface VerifyPeerHelloInput {
  hello: PeerHello;
  /** The receiver's local copy of the source device record. */
  expectedSourceDevice: StoredDevice;
}

/**
 * Verify a `PeerHello` against the receiver's local device record:
 *   - The claimed `fromDeviceId` matches the device record we fetched
 *   - The signature verifies under that device's `signPublicKeyB64`
 *
 * Schema-level validation happens at the boundary (incoming socket
 * frames are parsed via PeerHelloSchema.safeParse) — by the time a
 * caller invokes this function, the shape is already known good.
 */
export function verifyPeerHello(input: VerifyPeerHelloInput): VerifyPeerHelloOutcome {
  if (input.hello.fromDeviceId !== input.expectedSourceDevice.deviceId) {
    return {
      ok: false,
      reason: `Hello fromDeviceId ${input.hello.fromDeviceId} does not match expected device ${input.expectedSourceDevice.deviceId}`,
    };
  }

  let sourcePubKey: KeyObject;
  try {
    sourcePubKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: input.expectedSourceDevice.signPublicKeyB64 },
      format: "jwk",
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Source device public key unparseable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const payload = peerHelloPayload({
    fromDeviceId: input.hello.fromDeviceId,
    ephPubKeyB64: input.hello.ephPubKeyB64,
    nonceB64: input.hello.nonceB64,
  });
  const sigBytes = base64UrlDecode(input.hello.signatureB64);
  const ok = verify(null, Buffer.from(payload, "utf8"), sourcePubKey, sigBytes);
  if (!ok) {
    return { ok: false, reason: "Hello signature did not verify" };
  }
  return { ok: true };
}

// ----- ECDH + frame encryption -----------------------------------------

/**
 * Compute the shared key from our X25519 ephemeral private + peer's
 * X25519 ephemeral public. Both sides arrive at the same key.
 *
 * The relay's `importPublicKey` / `importSecretKey` expect padded
 * standard base64; PeerHello fields are JWK base64url. We re-pad here
 * once at the boundary so callers don't have to think about it.
 */
export function deriveSessionSharedKey(input: {
  ourEphPrivKeyB64: string;
  peerEphPubKeyB64: string;
}): SharedKey {
  const ourSecret = importSecretKey(b64urlToB64(input.ourEphPrivKeyB64));
  const peerPublic = importPublicKey(b64urlToB64(input.peerEphPubKeyB64));
  return deriveSharedKey(ourSecret, peerPublic);
}

/**
 * Wrap a plaintext payload (typically a DeviceListEvent JSON for Phase
 * 2.f/3) in a PeerSyncFrame. The shared key is the one returned by
 * `deriveSessionSharedKey`. Each frame carries its own NaCl box nonce
 * so frames can be sent in any order without external state.
 */
export function encryptPeerSyncFrame(args: {
  sharedKey: SharedKey;
  plaintext: string;
}): PeerSyncFrame {
  const ciphertext = encrypt(args.sharedKey, args.plaintext);
  const ciphertextB64 = arrayBufferToBase64(ciphertext);
  return { v: 1, kind: "peer-sync-frame", ciphertextB64 };
}

export function decryptPeerSyncFrame(args: { sharedKey: SharedKey; frame: PeerSyncFrame }): string {
  const ciphertext = base64ToArrayBuffer(args.frame.ciphertextB64);
  const plaintext = decrypt(args.sharedKey, ciphertext);
  if (typeof plaintext !== "string") {
    throw new Error("Peer-sync frame decrypted to non-text");
  }
  return plaintext;
}

// Re-export schemas for convenience so callers only import this file.
export { PeerHelloSchema, PeerSyncFrameSchema };

// ----- internal: base64 / base64url helpers -----------------------------

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
