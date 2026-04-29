// Coordinates real-time chat delivery across active sessions.
//
// Sessions register interest in rooms via subscribe(); subsequent dispatched
// messages stream to them as `chat/message` events. When a subscriber acks
// delivery or read of a message, OTHER subscribers in the same room get a
// `chat/status` event so authors can update their UI from "sent" → "delivered"
// → "read".
//
// Architecture decisions:
//   - One manager instance per daemon. Holds the per-room subscriber sets
//     in memory only — sessions reattach on connect, so durability isn't
//     needed for the subscription itself.
//   - Cursors ARE durable (ChatCursorStore). On reconnect a session reads
//     its persisted cursor to pick up where it left off.
//   - Wired to FileBackedChatService via setOnMessageDispatched: every
//     successful dispatch lands here and gets fanned out.
//   - Authoring session is excluded from the broadcast so the author doesn't
//     receive a duplicate of its own message — the chat/post/response is
//     authoritative for the author. Status events DO go to the author.

import type { Logger } from "pino";

import { ChatCursorStore, type ChatCursorKind } from "./chat-cursor-store.js";
import type { FileBackedChatService } from "./chat-service.js";
import type { ChatMessage, StoredChatMessage } from "./chat-types.js";

/**
 * Stable identifier for a session — the websocket-server allocates one per
 * connected client. Multiple sessions can share the same clientId (e.g. a
 * user with the desktop app and the mobile app both online).
 */
export type SessionId = string;
export type ClientId = string;
export type RoomId = string;

export interface ChatMessageEvent {
  type: "chat/message";
  payload: {
    roomId: RoomId;
    message: ChatMessage;
  };
}

export interface ChatStatusEvent {
  type: "chat/status";
  payload: {
    roomId: RoomId;
    /**
     * The seq the acking client has now reached for this kind. Older messages
     * (seq <= this value) are also implicitly at this state.
     */
    seq: number;
    kind: ChatCursorKind;
    /** Which client did the acking. Authors use this to update per-recipient UI. */
    fromClientId: ClientId;
  };
}

export type ChatBroadcastEvent = ChatMessageEvent | ChatStatusEvent;

export interface ChatSubscriber {
  sessionId: SessionId;
  clientId: ClientId;
  send: (event: ChatBroadcastEvent) => void;
}

export interface ChatSubscribeResult {
  /** Messages with seq > sinceSeq, returned synchronously to gap-fill. */
  gapFill: ChatMessage[];
  /** Latest seq currently committed for this room. */
  latestSeq: number;
  /**
   * Set when the client supplied an epoch that doesn't match the current
   * room's epoch — meaning the client's local cache is bound to a previous
   * incarnation of this room. Client must discard local data and treat
   * gapFill as a fresh, full-from-zero history (which it is — sinceSeq=0
   * is implicit for a reset room).
   */
  reset: boolean;
  /**
   * The current room epoch. If the client passed one, this lets it update
   * its stored epoch on reset==true.
   */
  epoch: string;
}

interface SubscriberRecord {
  sessionId: SessionId;
  clientId: ClientId;
  send: (event: ChatBroadcastEvent) => void;
}

interface ChatSubscriptionManagerOptions {
  chatService: FileBackedChatService;
  cursorStore: ChatCursorStore;
  logger: Logger;
}

export class ChatSubscriptionManager {
  private readonly chatService: FileBackedChatService;
  private readonly cursorStore: ChatCursorStore;
  private readonly logger: Logger;

  /** room → set of subscribers actively pushing live messages. */
  private readonly subscribersByRoom = new Map<RoomId, Map<SessionId, SubscriberRecord>>();
  /** session → set of rooms it is currently subscribed to (for fast unsubscribeAll). */
  private readonly roomsBySession = new Map<SessionId, Set<RoomId>>();

  /**
   * Maps clientMessageId → authoring sessionId for messages dispatched
   * while a subscriber session was online. Used to suppress echoing the
   * author's own message back to them. Bounded — entries expire when the
   * authoring session disconnects.
   */
  private readonly authorSessionByClientMessageId = new Map<string, SessionId>();

  constructor(options: ChatSubscriptionManagerOptions) {
    this.chatService = options.chatService;
    this.cursorStore = options.cursorStore;
    this.logger = options.logger.child({ component: "chat-subscription-manager" });
  }

  /** Wire up the chat-service hook. Call once at bootstrap. */
  start(): void {
    this.chatService.setOnMessageDispatched((message) => {
      this.broadcastMessage(message);
    });
  }

  /** Detach the chat-service hook. Call on shutdown for clean teardown. */
  stop(): void {
    this.chatService.setOnMessageDispatched(null);
    this.subscribersByRoom.clear();
    this.roomsBySession.clear();
    this.authorSessionByClientMessageId.clear();
  }

  /**
   * Register interest in a room. Returns gap-fill messages (seq > sinceSeq)
   * synchronously; subsequent messages stream via the subscriber's `send`
   * callback. Idempotent — calling subscribe twice for the same (session,
   * room) replaces the previous subscriber record.
   */
  async subscribe(
    subscriber: ChatSubscriber,
    input: { roomId: RoomId; sinceSeq: number; epoch?: string },
  ): Promise<ChatSubscribeResult> {
    const sinceSeq = Math.max(0, Math.floor(input.sinceSeq));
    const inspected = await this.chatService.inspectRoom({ room: input.roomId });
    const room = inspected.room;
    const currentEpoch = room.epoch ?? "";

    // If the client's epoch doesn't match, return reset+full history. The
    // client should discard whatever it had locally for this room.
    const reset = input.epoch !== undefined && input.epoch !== currentEpoch;
    const effectiveSince = reset ? 0 : sinceSeq;

    const messages = await this.chatService.readMessages({
      room: input.roomId,
      limit: 0, // 0 = all
    });
    const gapFill = messages.filter((m) => (m.seq ?? 0) > effectiveSince);
    const latestSeq = messages.length > 0 ? (messages[messages.length - 1]!.seq ?? 0) : 0;

    // Register the subscriber AFTER computing gap-fill so we don't race with
    // a concurrent dispatch that would otherwise be in both gapFill AND a
    // streamed event (we'd dedupe by seq on the client, but it's nicer to
    // not emit dupes in the first place).
    this.registerSubscriber(input.roomId, subscriber);

    return { gapFill, latestSeq, reset, epoch: currentEpoch };
  }

  unsubscribe(sessionId: SessionId, roomId: RoomId): void {
    const subs = this.subscribersByRoom.get(roomId);
    if (subs) {
      subs.delete(sessionId);
      if (subs.size === 0) this.subscribersByRoom.delete(roomId);
    }
    const rooms = this.roomsBySession.get(sessionId);
    if (rooms) {
      rooms.delete(roomId);
      if (rooms.size === 0) this.roomsBySession.delete(sessionId);
    }
  }

  /** Drop every subscription this session held. Call on session close. */
  unsubscribeAll(sessionId: SessionId): void {
    const rooms = this.roomsBySession.get(sessionId);
    if (!rooms) return;
    for (const roomId of rooms) {
      const subs = this.subscribersByRoom.get(roomId);
      if (subs) {
        subs.delete(sessionId);
        if (subs.size === 0) this.subscribersByRoom.delete(roomId);
      }
    }
    this.roomsBySession.delete(sessionId);
    // Clear the author-session map of entries pointing at this session;
    // suppression no longer matters for a disconnected author.
    for (const [cmid, owner] of this.authorSessionByClientMessageId) {
      if (owner === sessionId) {
        this.authorSessionByClientMessageId.delete(cmid);
      }
    }
  }

  /**
   * Record that `sessionId` is the author of a message identified by
   * `clientMessageId`. Called from the chat/post handler before dispatch so
   * the broadcast can suppress echoing back to the author.
   */
  registerAuthor(clientMessageId: string, sessionId: SessionId): void {
    this.authorSessionByClientMessageId.set(clientMessageId, sessionId);
  }

  /**
   * Apply an ack and broadcast a chat/status event to OTHER subscribers in
   * that room. The acking session itself is excluded — it already knows.
   * Stale acks (cursor doesn't advance) don't broadcast.
   */
  async ack(input: {
    sessionId: SessionId;
    clientId: ClientId;
    roomId: RoomId;
    seq: number;
    kind: ChatCursorKind;
  }): Promise<{ advanced: boolean }> {
    const result = await this.cursorStore.update(
      input.clientId,
      input.roomId,
      input.seq,
      input.kind,
    );
    if (!result.advanced) {
      return { advanced: false };
    }
    this.broadcastStatus({
      roomId: input.roomId,
      seq: input.seq,
      kind: input.kind,
      fromClientId: input.clientId,
      excludeSessionId: input.sessionId,
    });
    return { advanced: true };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private registerSubscriber(roomId: RoomId, subscriber: ChatSubscriber): void {
    const record: SubscriberRecord = {
      sessionId: subscriber.sessionId,
      clientId: subscriber.clientId,
      send: subscriber.send,
    };
    let subs = this.subscribersByRoom.get(roomId);
    if (!subs) {
      subs = new Map<SessionId, SubscriberRecord>();
      this.subscribersByRoom.set(roomId, subs);
    }
    subs.set(subscriber.sessionId, record);

    let rooms = this.roomsBySession.get(subscriber.sessionId);
    if (!rooms) {
      rooms = new Set<RoomId>();
      this.roomsBySession.set(subscriber.sessionId, rooms);
    }
    rooms.add(roomId);
  }

  private broadcastMessage(message: StoredChatMessage): void {
    const subs = this.subscribersByRoom.get(message.roomId);
    if (!subs || subs.size === 0) return;

    const authorSessionId = message.clientMessageId
      ? this.authorSessionByClientMessageId.get(message.clientMessageId)
      : undefined;

    const event: ChatMessageEvent = {
      type: "chat/message",
      payload: { roomId: message.roomId, message },
    };

    for (const sub of subs.values()) {
      if (authorSessionId !== undefined && sub.sessionId === authorSessionId) {
        // The author already got this via chat/post/response.
        continue;
      }
      try {
        sub.send(event);
      } catch (err) {
        this.logger.warn(
          { err, roomId: message.roomId, sessionId: sub.sessionId },
          "subscriber send failed",
        );
      }
    }
  }

  private broadcastStatus(input: {
    roomId: RoomId;
    seq: number;
    kind: ChatCursorKind;
    fromClientId: ClientId;
    excludeSessionId: SessionId;
  }): void {
    const subs = this.subscribersByRoom.get(input.roomId);
    if (!subs || subs.size === 0) return;

    const event: ChatStatusEvent = {
      type: "chat/status",
      payload: {
        roomId: input.roomId,
        seq: input.seq,
        kind: input.kind,
        fromClientId: input.fromClientId,
      },
    };

    for (const sub of subs.values()) {
      if (sub.sessionId === input.excludeSessionId) continue;
      try {
        sub.send(event);
      } catch (err) {
        this.logger.warn(
          { err, roomId: input.roomId, sessionId: sub.sessionId },
          "subscriber send failed (status)",
        );
      }
    }
  }
}
