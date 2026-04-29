import { z } from "zod";

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
