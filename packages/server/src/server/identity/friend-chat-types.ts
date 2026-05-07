import { z } from "zod";

import { ChatMessageSchema } from "../chat/chat-types.js";

/**
 * Phase 3.b/1d — wire shape of a chat message between two friends.
 *
 * The envelope flows inside an already-encrypted FriendSyncFrame (3.b/1c)
 * so the relay sees only opaque ciphertext. The session-level SIGMA-I
 * already authenticates the *root identity* on the other side, so a
 * naive design could skip per-message signatures entirely. We don't,
 * because:
 *
 *   1. Multi-device. A user has one root identity but many daemons. A
 *      message originated on Alice's phone, fanned out via Phase 2.f
 *      peer-sync to her laptop, and only THEN forwarded to Bob over
 *      friend-sync, must still be verifiable as "Alice signed this" —
 *      not just "the laptop's daemon claimed Alice signed this". Per-
 *      message root signature is the only thing that survives the fan-
 *      out without re-trusting an intermediate device.
 *
 *   2. Offline KV inbox (3.b/2). When Alice sends while Bob is offline,
 *      the message will sit at rest in Cloudflare KV. The session-level
 *      auth doesn't carry through that store. The per-message
 *      signature does — it's verifiable any time, at rest, by any party
 *      who has Alice's root pubkey.
 *
 *   3. Audit. Bob can later show Carol a receipt-of-conversation by
 *      handing over `{message, authorSignatureB64, authorRootPubKey}`
 *      and Carol can verify Alice signed it without ever talking to
 *      Alice directly.
 *
 * The message body inside the envelope is an existing
 * `ChatMessageSchema` (extended in 3.b/0 with optional
 * `authorRootPubKey`, `authorDeviceId`, `kind`). For p2p chat, both new
 * fields MUST be set when a human typed the message.
 */

export const FriendChatMessageEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("friend-chat-message"),
  /**
   * Stable p2p room id (`p2p:<sortedA>|<sortedB>`, see chat-types.ts
   * `p2pRoomId`). Bob's daemon checks this matches the pair of root
   * pubkeys of the friend-sync session — refuses to write a message
   * into a room that doesn't include him.
   */
  roomId: z.string().min(1),
  /** The chat-message itself. authorRootPubKey + authorDeviceId required. */
  message: ChatMessageSchema,
  /**
   * Ed25519 signature, base64url, by the author's ROOT sign private
   * key over `friendChatMessagePayload(...)`. Verifier uses the
   * pubkey embedded in `message.authorRootPubKey` (which the receiver
   * cross-checks against the friend-sync session peer to defend
   * against a relay-side substitution).
   */
  authorSignatureB64: z.string().min(1),
});

export type FriendChatMessageEnvelope = z.infer<typeof FriendChatMessageEnvelopeSchema>;

/**
 * Canonical payload covered by the author's root signature. Newline-
 * separated, prefix-tagged so the same root key signing a different
 * record type can never produce a colliding payload (mirrors
 * peerHelloPayload / peerAuthorizationPayload / friendCandidatePayload
 * conventions).
 *
 * Format (pinned, version-bump on any change):
 *
 *   "ottie-friend-chat-message-v1"
 *   roomId
 *   message.id
 *   message.body
 *   message.createdAt
 *   message.authorRootPubKey
 *   message.authorDeviceId
 *   message.clientMessageId
 *   message.replyToMessageId | ""           (null → empty string)
 *   message.kind | "text"                   (unset → "text" default)
 */
export function friendChatMessagePayload(input: {
  roomId: string;
  messageId: string;
  body: string;
  createdAt: string;
  authorRootPubKey: string;
  authorDeviceId: string;
  clientMessageId: string;
  replyToMessageId: string | null;
  kind: string | undefined;
}): string {
  return [
    "ottie-friend-chat-message-v1",
    input.roomId,
    input.messageId,
    input.body,
    input.createdAt,
    input.authorRootPubKey,
    input.authorDeviceId,
    input.clientMessageId,
    input.replyToMessageId ?? "",
    input.kind ?? "text",
  ].join("\n");
}
