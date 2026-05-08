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
  FriendHelloSchema,
  FriendSyncFrameSchema,
  FriendSyncKeepaliveSchema,
  friendHelloPayload,
  type FriendHello,
  type FriendSyncFrame,
} from "./friend-sync-types.js";
import type { StoredPeer } from "./peer-types.js";

/**
 * Phase 3.b/1b — pure crypto + state-machine helpers for the friend-sync
 * cross-identity handshake. I/O free, mirroring `peer-sync-handshake.ts`
 * so the same shape (sign/verify/derive-key/encrypt/decrypt) is unit-
 * testable without sockets, daemons, or a relay.
 *
 * See `friend-sync-types.ts` header for the protocol shape.
 */

// ----- build (initiator + responder share this) -------------------------

export interface BuildFriendHelloInput {
  /** Sender's root sign public key (Ed25519 JWK 'x'). */
  selfRootPubKey: string;
  /** Sender's own daemon serverId — for audit + multi-device routing. */
  selfDeviceId: string;
  /** Sender's root sign PRIVATE key. Never leaves the daemon. */
  selfRootSignPrivateKey: KeyObject;
  /** Override clock / nonce for tests; ignored in production. */
  nonceBytes?: Buffer;
}

export interface BuildFriendHelloResult {
  hello: FriendHello;
  /** X25519 ephemeral PRIVATE key (JWK 'd' base64url). Keep until handshake settles. */
  ephPrivateKeyB64: string;
}

export function buildFriendHello(input: BuildFriendHelloInput): BuildFriendHelloResult {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  const jwkPriv = privateKey.export({ format: "jwk" }) as { d: string };
  const nonceBytes = input.nonceBytes ?? randomBytes(32);
  const nonceB64 = nonceBytes.toString("base64url").replace(/=+$/, "");

  const partial = {
    fromRootPubKey: input.selfRootPubKey,
    fromDeviceId: input.selfDeviceId,
    ephPubKeyB64: jwkPub.x,
    nonceB64,
  };
  const sig = sign(
    null,
    Buffer.from(friendHelloPayload(partial), "utf8"),
    input.selfRootSignPrivateKey,
  );
  const signatureB64 = sig
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return {
    hello: {
      v: 1,
      kind: "friend-hello",
      ...partial,
      signatureB64,
    },
    ephPrivateKeyB64: jwkPriv.d,
  };
}

// ----- verify (initiator + responder share this) ------------------------

export type VerifyFriendHelloOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface VerifyFriendHelloInput {
  hello: FriendHello;
  /** The receiver's local peers.json entry for the sender. */
  expectedPeer: StoredPeer;
}

/**
 * Verify a `FriendHello` against the receiver's local peers.json entry:
 *   - The claimed `fromRootPubKey` matches the peer record (defends
 *     against an attacker swapping the rootPubKey alongside the sig).
 *   - The peer is currently active (refuse helloes from blocked /
 *     removed peers).
 *   - The signature verifies under that peer's `peerRootSignPublicKeyB64`.
 *
 * Schema-level validation happens at the boundary (incoming socket
 * frames are parsed via FriendHelloSchema.safeParse) — by the time a
 * caller invokes this function, the shape is already known good.
 */
export function verifyFriendHello(input: VerifyFriendHelloInput): VerifyFriendHelloOutcome {
  if (input.hello.fromRootPubKey !== input.expectedPeer.peerRootSignPublicKeyB64) {
    return {
      ok: false,
      reason: `Hello fromRootPubKey ${input.hello.fromRootPubKey.slice(0, 8)}… does not match expected peer ${input.expectedPeer.peerRootSignPublicKeyB64.slice(0, 8)}…`,
    };
  }

  if (input.expectedPeer.status !== "active") {
    return {
      ok: false,
      reason: `Refusing friend-sync hello from ${input.expectedPeer.status} peer`,
    };
  }

  let peerPubKey: KeyObject;
  try {
    peerPubKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: input.expectedPeer.peerRootSignPublicKeyB64 },
      format: "jwk",
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Peer root public key unparseable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const payload = friendHelloPayload({
    fromRootPubKey: input.hello.fromRootPubKey,
    fromDeviceId: input.hello.fromDeviceId,
    ephPubKeyB64: input.hello.ephPubKeyB64,
    nonceB64: input.hello.nonceB64,
  });
  const sigBytes = base64UrlDecode(input.hello.signatureB64);
  const ok = verify(null, Buffer.from(payload, "utf8"), peerPubKey, sigBytes);
  if (!ok) {
    return { ok: false, reason: "Friend hello signature did not verify" };
  }
  return { ok: true };
}

// ----- ECDH + frame encryption -----------------------------------------

/**
 * Compute the shared key from our X25519 ephemeral private + peer's
 * X25519 ephemeral public. Both sides arrive at the same key.
 *
 * The relay's `importPublicKey` / `importSecretKey` expect padded
 * standard base64; FriendHello fields are JWK base64url. We re-pad here
 * once at the boundary so callers don't have to think about it.
 */
export function deriveFriendSessionSharedKey(input: {
  ourEphPrivKeyB64: string;
  peerEphPubKeyB64: string;
}): SharedKey {
  const ourSecret = importSecretKey(b64urlToB64(input.ourEphPrivKeyB64));
  const peerPublic = importPublicKey(b64urlToB64(input.peerEphPubKeyB64));
  return deriveSharedKey(ourSecret, peerPublic);
}

/**
 * Wrap a plaintext payload (typically a chat-message envelope JSON for
 * Phase 3.b/1d) in a FriendSyncFrame. The shared key is the one returned
 * by `deriveFriendSessionSharedKey`. Each frame carries its own NaCl box
 * nonce so frames can be sent in any order without external state.
 */
export function encryptFriendSyncFrame(args: {
  sharedKey: SharedKey;
  plaintext: string;
}): FriendSyncFrame {
  const ciphertext = encrypt(args.sharedKey, args.plaintext);
  const ciphertextB64 = arrayBufferToBase64(ciphertext);
  return { v: 1, kind: "friend-sync-frame", ciphertextB64 };
}

export function decryptFriendSyncFrame(args: {
  sharedKey: SharedKey;
  frame: FriendSyncFrame;
}): string {
  const ciphertext = base64ToArrayBuffer(args.frame.ciphertextB64);
  const plaintext = decrypt(args.sharedKey, ciphertext);
  if (typeof plaintext !== "string") {
    throw new Error("Friend-sync frame decrypted to non-text");
  }
  return plaintext;
}

// Re-export schemas for convenience so callers only import this file.
export { FriendHelloSchema, FriendSyncFrameSchema, FriendSyncKeepaliveSchema };

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
