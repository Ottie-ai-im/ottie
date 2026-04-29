// Client-side chat types.
//
// Mirrors the server's wire types from @server/server/chat/chat-types.js but
// adds per-message send status (the WhatsApp-style ✓ ✓✓ progression). Status
// only lives on the client — the server tracks per-client cursors and the
// client computes status by intersecting its own messages with the cursor
// state of other room participants.

import type { ChatMessage, ChatRoom } from "@server/server/chat/chat-types";

/**
 * Send status for a message authored by THIS client. Server-authored or
 * other-client-authored messages don't carry a meaningful status (we just
 * display them as received).
 */
export type ChatMessageStatus =
  | "pending" // Composed locally, not yet sent (offline or in-flight).
  | "sent" // Server acked dispatch and assigned a seq.
  | "delivered" // At least one OTHER participant's client acked delivery.
  | "read" // At least one OTHER participant's client acked read.
  | "failed"; // Send attempt failed; user can retry.

export interface LocalChatMessage extends ChatMessage {
  /**
   * Send status. For received messages (authorClientId !== self), this is
   * always "sent" and never updates — status is only meaningful for messages
   * THIS client authored.
   */
  status: ChatMessageStatus;
  /**
   * The clientId of the daemon-side identifier for the message author.
   * Distinct from authorAgentId (which is the human/agent label) — used to
   * decide whether a message is "mine" for status-tracking purposes.
   */
  authorClientId?: string;
}

/**
 * Snapshot of the local store's state for one room. Stable across reads —
 * if no messages have changed, the same array reference is returned.
 */
export interface LocalRoomState {
  /** Messages sorted ascending by seq (pending messages with no seq go last). */
  messages: LocalChatMessage[];
  /** Highest committed seq seen for this room. 0 if none yet. */
  lastCommittedSeq: number;
  /** Server-supplied epoch for this room. Empty string until first sync. */
  epoch: string;
}

/**
 * Options for {@link LocalChatStore.upsertCommittedMessage}.
 */
export interface UpsertCommittedOptions {
  /**
   * If true, this message is the "ack" for an outbox entry whose
   * clientMessageId matches. Pending → sent transition.
   */
  fromOwnDispatch?: boolean;
}

/**
 * Per-room subscriber callback. Fired whenever the room's state changes.
 * The store guarantees the callback is invoked with the LATEST state, not
 * stale snapshots.
 */
export type RoomSubscriber = (state: LocalRoomState) => void;

/**
 * The minimum surface area that the React UI / sync controller needs.
 * Implementations are free to use any backing store (AsyncStorage,
 * IndexedDB, SQLite) as long as they satisfy this contract.
 */
export interface LocalChatStore {
  /** Initialize: load all rooms' state from persistence. Idempotent. */
  load(): Promise<void>;

  /** Get a snapshot of one room's state. Returns null if room is unknown. */
  getRoomState(roomId: string): LocalRoomState | null;

  /** Subscribe to room changes. Returns an unsubscribe function. */
  subscribeRoom(roomId: string, listener: RoomSubscriber): () => void;

  /**
   * Insert/update a server-confirmed message. Idempotent on (roomId, seq) —
   * a re-insert with the same seq is a no-op for the canonical message but
   * may transition a "pending" matching clientMessageId to "sent".
   */
  upsertCommittedMessage(
    message: LocalChatMessage,
    options?: UpsertCommittedOptions,
  ): Promise<void>;

  /**
   * Bulk-insert committed messages from a gap-fill. Atomic per room — either
   * all insert or none, never a partial write.
   */
  bulkUpsertCommitted(roomId: string, messages: readonly LocalChatMessage[]): Promise<void>;

  /**
   * Add an optimistic outgoing message to the outbox. Status starts as
   * "pending". Returns the local record so the caller can render it
   * immediately.
   */
  enqueueOutgoing(message: {
    roomId: string;
    clientMessageId: string;
    authorAgentId: string;
    authorClientId?: string;
    body: string;
    replyToMessageId: string | null;
    mentionAgentIds: string[];
    createdAt: string;
  }): Promise<LocalChatMessage>;

  /**
   * Mark an outbox message as failed (send error, timeout, etc). Doesn't
   * remove it — user can retry.
   */
  markOutgoingFailed(clientMessageId: string): Promise<void>;

  /**
   * List every pending or failed outgoing message across all rooms. Used
   * on reconnect to retry sends.
   */
  getOutbox(): LocalChatMessage[];

  /**
   * Update a recipient's read/delivered cursor for a room. Used to
   * recompute "delivered" / "read" status of messages WE sent.
   */
  updateRecipientCursor(input: {
    roomId: string;
    fromClientId: string;
    seq: number;
    kind: "delivered" | "read";
  }): Promise<void>;

  /**
   * Replace a room's known epoch. If the new epoch differs from the existing
   * one, all cached messages for the room are dropped — caller is expected
   * to follow up with bulkUpsertCommitted from the server's reset-aware
   * subscribe response.
   */
  setRoomEpoch(roomId: string, epoch: string): Promise<void>;

  /**
   * Drop everything for a room. Used when the server reports the room was
   * deleted.
   */
  dropRoom(roomId: string): Promise<void>;
}

/**
 * Helper: turn a wire ChatMessage into a LocalChatMessage with `status`
 * defaulting to "sent" (the right value for any message the server has
 * already committed and pushed to us).
 */
export function fromWireMessage(
  wire: ChatMessage,
  options?: { status?: ChatMessageStatus; authorClientId?: string },
): LocalChatMessage {
  return {
    ...wire,
    status: options?.status ?? "sent",
    authorClientId: options?.authorClientId,
  };
}

/** Server's wire ChatRoom re-exported under a clearer name for client code. */
export type LocalChatRoom = ChatRoom;
