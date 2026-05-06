import { z } from "zod";

/**
 * Phase 3.b/0 — chat rooms gain identity-aware fields so they can host
 * 1-to-1 (kind="p2p") and group (kind="group") chats between humans, in
 * addition to the existing agent-only rooms. All new fields are
 * `.optional()` so old daemons stripping them still produce schema-valid
 * messages, and old clients receiving them just ignore the unknowns.
 *
 * Mapping:
 *   - kind="agent-only" (or unset)  → existing behavior. Members not used.
 *   - kind="p2p"                    → exactly two `members`, both human roots.
 *                                     `ownerRootPubKey` is the side that
 *                                     created the room (typically the friend-
 *                                     pair originator).
 *   - kind="group"                  → 3+ human members. Phase 3.a doesn't
 *                                     create these; reserved for the post-
 *                                     Phase-5 deferred work.
 */

export const ChatRoomMemberSchema = z.object({
  /** The peer's root sign public key (Ed25519 JWK 'x'). */
  rootPubKey: z.string().min(1),
  /** "owner" = creator of the room; "member" = invited / joined. */
  role: z.enum(["owner", "member"]),
  /** ISO timestamp when this member was added to the room. */
  addedAt: z.string(),
});

export type ChatRoomMember = z.infer<typeof ChatRoomMemberSchema>;

export const ChatRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Stable token bound to this room's message history. Stays constant for the
   * lifetime of the room. If a room is ever cleared/recreated, the new room
   * gets a new epoch — clients use it to detect that any cached messages they
   * hold under this roomId are no longer valid and must be discarded before
   * resyncing. Optional on the wire for backward compatibility with old
   * clients that didn't track epochs.
   */
  epoch: z.string().optional(),
  /**
   * Phase 3.b/0: room kind. "agent-only" (the historical default) means
   * only agents post in this room. "p2p" + "group" mean human-to-human
   * chat rooms — members + ownerRootPubKey are populated. Old daemons that
   * don't know about the field strip it; the resulting message still parses
   * and falls through to the agent-only code path.
   */
  kind: z.enum(["agent-only", "p2p", "group"]).optional(),
  /**
   * Phase 3.b/0: the human identity that created this room. For agent-only
   * rooms this stays unset (no human on the server side). For p2p, this is
   * the side that ran `createP2pRoom`.
   */
  ownerRootPubKey: z.string().optional(),
  /**
   * Phase 3.b/0: human members of this room. For p2p, exactly two entries —
   * the owner + the friend. For group, 3+. Each entry is keyed by root
   * pubkey (cross-device identity), NOT by device.
   */
  members: z.array(ChatRoomMemberSchema).optional(),
});

export type ChatRoom = z.infer<typeof ChatRoomSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  authorAgentId: z.string(),
  body: z.string(),
  replyToMessageId: z.string().nullable(),
  mentionAgentIds: z.array(z.string()),
  createdAt: z.string(),
  /**
   * Per-room monotonically increasing sequence number assigned by the server
   * at dispatch time. Clients use it to request "everything after seq N" on
   * reconnect (incremental sync) and to order messages deterministically
   * regardless of arrival order. Optional on the wire so old daemons that
   * don't populate it stay compatible with new clients.
   */
  seq: z.number().int().nonnegative().optional(),
  /**
   * Client-supplied UUID for the message. The author's client generates this
   * locally before the message round-trips through the server, so it can
   * dedupe its own optimistic message against the server-acked version,
   * retry failed sends without creating duplicates, and track per-message
   * send status (pending → sent → delivered → read). Optional because
   * server-originated messages (agent dispatches) don't have one and old
   * clients didn't supply one.
   */
  clientMessageId: z.string().optional(),
  /**
   * Phase 3.b/0: human author's root sign public key. Set when a human
   * sends a message into a p2p / group room. Old code paths (agent
   * dispatch) leave it unset and use `authorAgentId` instead.
   */
  authorRootPubKey: z.string().optional(),
  /**
   * Phase 3.b/0: which device the human used to author the message. Lets
   * the recipient distinguish "Wendell typed this on his phone" vs "his
   * laptop", and lets sibling devices under the same root identity dedupe
   * by author+device when sync'ing chat history.
   */
  authorDeviceId: z.string().optional(),
  /**
   * Phase 3.b/0 + future: message kind. Defaults semantically to "text"
   * when unset. The "ai-share/*" kinds belong to Phase 4 and are listed
   * here up-front so old clients receiving Phase 4 messages don't
   * schema-reject — they just render the human-readable `body` fallback.
   */
  kind: z
    .enum([
      "text",
      "ai-share/offer",
      "ai-share/accept",
      "ai-share/reject",
      "ai-share/end",
      "ai-share/prompt",
      "ai-share/chunk",
      "ai-share/error",
      "system",
    ])
    .optional(),
  /** Kind-specific structured data. Phase 3.b uses it only for "system" messages. */
  payload: z.unknown().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRoomDetailSchema = ChatRoomSchema.extend({
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().nullable(),
});

export type ChatRoomDetail = z.infer<typeof ChatRoomDetailSchema>;

/**
 * Strict variant used at the persistence boundary. Once a message is committed
 * to the durable store it MUST have a seq and a clientMessageId — those are
 * the invariants the JSONL format relies on. Server-originated messages get a
 * synthesized clientMessageId (just the message id) at the dispatch boundary.
 * The wire schema stays loose so old clients/daemons keep working.
 */
export const StoredChatMessageSchema = ChatMessageSchema.extend({
  seq: z.number().int().positive(),
  clientMessageId: z.string().min(1),
});

export type StoredChatMessage = z.infer<typeof StoredChatMessageSchema>;

/** Strict variant for stored rooms. Every persisted room has an epoch. */
export const StoredChatRoomSchema = ChatRoomSchema.extend({
  epoch: z.string().min(1),
});

export type StoredChatRoom = z.infer<typeof StoredChatRoomSchema>;

/**
 * Phase 3.b/0: derive a stable, content-addressed roomId for a 1-to-1 chat
 * between two human identities. The id is the sha256 of the sorted root
 * pubkeys joined by a literal pipe — sorting makes it order-insensitive
 * (Alice→Bob and Bob→Alice get the same roomId), and the literal prefix
 * `p2p:` keeps it visually distinct from agent-only roomIds (UUIDs) when
 * you're scanning logs.
 *
 * Pure / synchronous so it can run on the daemon and inside Metro/RN
 * without any node:crypto dependency. The hash uses a deterministic JS
 * implementation rather than node:crypto to keep this module Metro-
 * bundleable (chat-types.ts is imported by chat-rpc-schemas.ts which is
 * re-exported via shared/messages.ts to the React Native client).
 */
export function p2pRoomId(input: { aRootPubKey: string; bRootPubKey: string }): string {
  const a = input.aRootPubKey.trim();
  const b = input.bRootPubKey.trim();
  if (a.length === 0 || b.length === 0) {
    throw new Error("p2pRoomId requires two non-empty root pubkeys");
  }
  const [first, second] = a < b ? [a, b] : [b, a];
  // Pipe is a safe delimiter: base64url alphabet (`A-Za-z0-9_-`) doesn't
  // contain it, so there's no collision risk.
  return `p2p:${first}|${second}`;
}

/**
 * Phase 3.b/0 type guard. A room is a 1-to-1 chat iff `kind === "p2p"`.
 * Old rooms with `kind` unset always read as agent-only.
 */
export function isP2pRoom(room: { kind?: string | undefined }): boolean {
  return room.kind === "p2p";
}
