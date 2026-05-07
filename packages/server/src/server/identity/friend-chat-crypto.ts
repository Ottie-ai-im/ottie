import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";

import { type ChatMessage } from "../chat/chat-types.js";

import { friendChatMessagePayload, type FriendChatMessageEnvelope } from "./friend-chat-types.js";

/**
 * Phase 3.b/1d — pure crypto helpers for the chat-message envelope.
 * I/O free; sign/verify roundtrip is unit-testable without sockets,
 * daemons, or a relay.
 *
 * Sender side (`buildFriendChatMessageEnvelope`):
 *   - Take a `ChatMessage` whose `authorRootPubKey` + `authorDeviceId`
 *     are populated.
 *   - Compute the canonical payload via `friendChatMessagePayload`.
 *   - Sign with the author's root sign private key.
 *   - Wrap into a `FriendChatMessageEnvelope` ready to JSON-stringify
 *     into a FriendSyncFrame plaintext.
 *
 * Receiver side (`verifyFriendChatMessageEnvelope`):
 *   - Re-derive the canonical payload from the envelope's fields.
 *   - Verify the signature against the embedded `authorRootPubKey`.
 *   - Optional: check `authorRootPubKey` against the expected peer
 *     (the rootPubKey that established the friend-sync session) so a
 *     relay-side adversary can't ship a foreign-signed message
 *     through Bob's session with Alice and have him render it as if
 *     Alice sent it.
 */

export interface BuildFriendChatMessageEnvelopeInput {
  /**
   * The room id the message belongs to. Producer must compute it via
   * `p2pRoomId` from the two paired root pubkeys.
   */
  roomId: string;
  /**
   * The message body. Must already have `authorRootPubKey`,
   * `authorDeviceId`, and `clientMessageId` populated. The `kind`
   * defaults semantically to `"text"` if unset.
   */
  message: ChatMessage;
  /** Author's root sign private key. Never sent. */
  authorRootSignPrivateKey: KeyObject;
}

export function buildFriendChatMessageEnvelope(
  input: BuildFriendChatMessageEnvelopeInput,
): FriendChatMessageEnvelope {
  const m = input.message;
  if (!m.authorRootPubKey || m.authorRootPubKey.length === 0) {
    throw new Error("message.authorRootPubKey is required for p2p chat envelopes");
  }
  if (!m.authorDeviceId || m.authorDeviceId.length === 0) {
    throw new Error("message.authorDeviceId is required for p2p chat envelopes");
  }
  if (!m.clientMessageId || m.clientMessageId.length === 0) {
    throw new Error("message.clientMessageId is required for p2p chat envelopes");
  }

  const payload = friendChatMessagePayload({
    roomId: input.roomId,
    messageId: m.id,
    body: m.body,
    createdAt: m.createdAt,
    authorRootPubKey: m.authorRootPubKey,
    authorDeviceId: m.authorDeviceId,
    clientMessageId: m.clientMessageId,
    replyToMessageId: m.replyToMessageId,
    kind: m.kind,
  });
  const sig = sign(null, Buffer.from(payload, "utf8"), input.authorRootSignPrivateKey);
  const authorSignatureB64 = sig
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return {
    v: 1,
    kind: "friend-chat-message",
    roomId: input.roomId,
    message: m,
    authorSignatureB64,
  };
}

export type VerifyFriendChatMessageEnvelopeOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface VerifyFriendChatMessageEnvelopeInput {
  envelope: FriendChatMessageEnvelope;
  /**
   * The peer's root pubkey from the friend-sync session that delivered
   * this envelope. The envelope's `message.authorRootPubKey` MUST
   * match — otherwise a relay-side adversary could ship a foreign-
   * signed message through Bob's session with Alice and have him
   * render it as if Alice sent it.
   */
  expectedPeerRootPubKey: string;
  /**
   * Expected p2p room id, derived from `(self, peer)` via
   * `p2pRoomId(...)`. Refuse envelopes whose roomId doesn't match.
   * Defends against a peer (or attacker) trying to inject a message
   * into a room they don't belong to (e.g. a group room).
   */
  expectedRoomId: string;
}

export function verifyFriendChatMessageEnvelope(
  input: VerifyFriendChatMessageEnvelopeInput,
): VerifyFriendChatMessageEnvelopeOutcome {
  const m = input.envelope.message;

  if (input.envelope.roomId !== input.expectedRoomId) {
    return {
      ok: false,
      reason: `Envelope roomId ${input.envelope.roomId} doesn't match expected ${input.expectedRoomId}`,
    };
  }
  if (!m.authorRootPubKey) {
    return { ok: false, reason: "Envelope message is missing authorRootPubKey" };
  }
  if (m.authorRootPubKey !== input.expectedPeerRootPubKey) {
    return {
      ok: false,
      reason: `Message authorRootPubKey ${m.authorRootPubKey.slice(0, 8)}… does not match peer ${input.expectedPeerRootPubKey.slice(0, 8)}…`,
    };
  }
  if (!m.authorDeviceId) {
    return { ok: false, reason: "Envelope message is missing authorDeviceId" };
  }
  if (!m.clientMessageId) {
    return { ok: false, reason: "Envelope message is missing clientMessageId" };
  }

  let pubKey: KeyObject;
  try {
    pubKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: m.authorRootPubKey },
      format: "jwk",
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Author root pubkey unparseable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const payload = friendChatMessagePayload({
    roomId: input.envelope.roomId,
    messageId: m.id,
    body: m.body,
    createdAt: m.createdAt,
    authorRootPubKey: m.authorRootPubKey,
    authorDeviceId: m.authorDeviceId,
    clientMessageId: m.clientMessageId,
    replyToMessageId: m.replyToMessageId,
    kind: m.kind,
  });

  let sigBytes: Buffer;
  try {
    sigBytes = base64UrlDecode(input.envelope.authorSignatureB64);
  } catch (err) {
    return {
      ok: false,
      reason: `Author signature unparseable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const ok = verify(null, Buffer.from(payload, "utf8"), pubKey, sigBytes);
  if (!ok) {
    return { ok: false, reason: "Chat message signature did not verify" };
  }
  return { ok: true };
}

function base64UrlDecode(b64url: string): Buffer {
  const standard = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (standard.length % 4)) % 4;
  return Buffer.from(standard + "=".repeat(padLen), "base64");
}
