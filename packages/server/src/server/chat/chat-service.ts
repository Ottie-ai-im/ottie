import { randomUUID } from "node:crypto";
import path from "node:path";
import type pino from "pino";

import { ChatRoomIndexStore } from "./chat-room-index-store.js";
import {
  ChatMessageSchema,
  ChatRoomDetailSchema,
  type ChatMessage,
  type ChatRoomDetail,
  type StoredChatMessage,
  type StoredChatRoom,
} from "./chat-types.js";
import { DurableChatMessageStore } from "./durable-chat-message-store.js";
import { migrateLegacyChatStore } from "./chat-store-migration.js";

function normalizeRoomName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const CHAT_MENTION_PATTERN = /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export function parseMentionAgentIds(body: string): string[] {
  const mentionAgentIds = new Set<string>();
  for (const match of body.matchAll(CHAT_MENTION_PATTERN)) {
    const agentId = match[1]?.trim();
    if (agentId) {
      mentionAgentIds.add(agentId);
    }
  }
  return Array.from(mentionAgentIds).sort();
}

export class ChatServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChatServiceError";
    this.code = code;
  }
}

interface Waiter {
  roomId: string;
  afterMessageId: string | null;
  resolve: (messages: ChatMessage[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

export interface CreateChatRoomInput {
  name: string;
  purpose?: string | null;
}

export interface InspectChatRoomInput {
  room: string;
}

export interface DeleteChatRoomInput {
  room: string;
}

export interface PostChatMessageInput {
  room: string;
  authorAgentId: string;
  body: string;
  replyToMessageId?: string | null;
  /**
   * Client-supplied UUID. If provided, a duplicate post with the same
   * `clientMessageId` returns the original message instead of creating a new
   * one — supports safe retries from clients that didn't see the ack.
   */
  clientMessageId?: string | null;
}

export interface ReadChatMessagesInput {
  room: string;
  limit?: number;
  since?: string;
  authorAgentId?: string;
}

export interface WaitForChatMessagesInput {
  room: string;
  afterMessageId?: string | null;
  timeoutMs?: number;
}

export interface DeleteChatRoomResult {
  room: ChatRoomDetail;
}

export interface InspectChatRoomResult {
  room: ChatRoomDetail;
}

export class FileBackedChatService {
  private readonly logger: pino.Logger;
  private readonly ottieHome: string;
  private readonly roomIndex: ChatRoomIndexStore;
  private readonly messageStore: DurableChatMessageStore;

  /**
   * Per-room in-memory message cache. Backed by the durable JSONL store on
   * disk; populated on first access for a room and kept in sync with each
   * append. Reads (readMessages, waitForMessages) hit this cache, not disk.
   */
  private readonly messagesByRoomId = new Map<string, StoredChatMessage[]>();

  /** Rooms whose messages we've already loaded from disk into the cache. */
  private readonly loadedRoomMessages = new Set<string>();

  /** Per-room latest seq, kept in sync with messagesByRoomId. */
  private readonly latestSeqByRoomId = new Map<string, number>();

  /** Quick clientMessageId → message lookup for retry idempotency. */
  private readonly messageByClientId = new Map<string, StoredChatMessage>();

  private loaded = false;
  private readonly waitersByRoomId = new Map<string, Set<Waiter>>();

  /**
   * Optional listener invoked synchronously after a message has been
   * persisted and the in-memory caches updated, BEFORE notifyWaiters runs.
   * Used by the subscription manager to broadcast `chat/message` events to
   * subscribed sessions in real time. Kept as a single function (not a full
   * EventEmitter) because there is exactly one subscription manager per
   * daemon and explicit dependency wiring is clearer than pubsub.
   */
  private onMessageDispatched: ((message: StoredChatMessage) => void) | null = null;

  constructor(options: { ottieHome: string; logger: pino.Logger }) {
    this.ottieHome = options.ottieHome;
    this.logger = options.logger.child({ component: "chat-service" });
    this.roomIndex = new ChatRoomIndexStore({
      filePath: path.join(options.ottieHome, "chat", "rooms-index.json"),
      logger: this.logger,
    });
    this.messageStore = new DurableChatMessageStore({
      rootDir: path.join(options.ottieHome, "chat", "rooms"),
      logger: this.logger,
    });
  }

  async initialize(): Promise<void> {
    await this.load();
  }

  /**
   * Register a listener invoked once per dispatched message after it's been
   * persisted and the in-memory state has settled. Replaces any previously
   * registered listener — there's exactly one subscription manager per
   * daemon. Pass `null` to clear.
   */
  setOnMessageDispatched(listener: ((message: StoredChatMessage) => void) | null): void {
    this.onMessageDispatched = listener;
  }

  async createRoom(input: CreateChatRoomInput): Promise<ChatRoomDetail> {
    await this.load();
    const name = input.name.trim();
    if (name.length === 0) {
      throw new ChatServiceError("invalid_chat_room_name", "Chat room name is required");
    }
    if (this.findRoomByName(name)) {
      throw new ChatServiceError(
        "chat_room_name_taken",
        `Chat room already exists with name: ${name}`,
      );
    }

    const now = new Date().toISOString();
    const room: StoredChatRoom = {
      id: randomUUID(),
      name,
      purpose: trimToNull(input.purpose),
      createdAt: now,
      updatedAt: now,
      epoch: randomUUID(),
    };
    this.roomIndex.put(room);
    this.messagesByRoomId.set(room.id, []);
    this.loadedRoomMessages.add(room.id);
    this.latestSeqByRoomId.set(room.id, 0);
    await this.roomIndex.flush();
    return this.toRoomDetail(room);
  }

  async listRooms(): Promise<ChatRoomDetail[]> {
    await this.load();
    return this.roomIndex
      .list()
      .map((room) => this.toRoomDetail(room))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async inspectRoom(input: InspectChatRoomInput): Promise<InspectChatRoomResult> {
    await this.load();
    const room = await this.resolveRoom(input.room);
    return { room: this.toRoomDetail(room) };
  }

  async deleteRoom(input: DeleteChatRoomInput): Promise<DeleteChatRoomResult> {
    await this.load();
    const room = await this.resolveRoom(input.room);
    const detail = this.toRoomDetail(room);

    // Drop from index first so any in-flight resolveRoom calls fail cleanly.
    this.roomIndex.delete(room.id);
    await this.roomIndex.flush();

    // Then drop the message file and in-memory caches.
    await this.messageStore.deleteRoom(room.id);
    const cached = this.messagesByRoomId.get(room.id);
    if (cached) {
      for (const message of cached) {
        if (message.clientMessageId) {
          this.messageByClientId.delete(message.clientMessageId);
        }
      }
      this.messagesByRoomId.delete(room.id);
    }
    this.loadedRoomMessages.delete(room.id);
    this.latestSeqByRoomId.delete(room.id);

    this.rejectWaiters(
      room.id,
      new ChatServiceError("chat_room_deleted", `Chat room deleted: ${room.name}`),
    );
    return { room: detail };
  }

  async dispatchMessage(input: PostChatMessageInput): Promise<ChatMessage> {
    await this.load();
    const room = await this.resolveRoom(input.room);
    const body = input.body.trim();
    if (body.length === 0) {
      throw new ChatServiceError("invalid_chat_message", "Chat message body is required");
    }
    const authorAgentId = input.authorAgentId.trim();
    if (authorAgentId.length === 0) {
      throw new ChatServiceError("invalid_chat_author", "Chat message author is required");
    }

    // Retry idempotency: if the caller supplied a clientMessageId we've seen
    // before for this room, return the original. Stops dup messages when a
    // client retries after a network blip.
    const clientMessageId = trimToNull(input.clientMessageId);
    if (clientMessageId) {
      const existing = this.messageByClientId.get(clientMessageId);
      if (existing && existing.roomId === room.id) {
        return existing;
      }
    }

    await this.ensureRoomMessagesLoaded(room.id);
    const messages = this.messagesByRoomId.get(room.id)!;

    const replyToMessageId = trimToNull(input.replyToMessageId);
    if (replyToMessageId) {
      const replyTarget = messages.find((message) => message.id === replyToMessageId);
      if (!replyTarget) {
        throw new ChatServiceError(
          "chat_message_not_found",
          `Reply target not found: ${replyToMessageId}`,
        );
      }
    }

    const createdAt = new Date().toISOString();
    const id = randomUUID();
    const seq = (this.latestSeqByRoomId.get(room.id) ?? 0) + 1;
    const message: StoredChatMessage = {
      id,
      roomId: room.id,
      authorAgentId,
      body,
      replyToMessageId,
      mentionAgentIds: parseMentionAgentIds(body),
      createdAt,
      seq,
      clientMessageId: clientMessageId ?? id,
    };

    // Persist first; only update in-memory state after disk acks. If
    // persistence throws we surface the error to the caller before any
    // observer (waiter, future read) sees the message.
    await this.messageStore.append(room.id, message);

    messages.push(message);
    this.latestSeqByRoomId.set(room.id, seq);
    this.messageByClientId.set(message.clientMessageId, message);

    // Bump the room's updatedAt and persist the index.
    const updatedRoom: StoredChatRoom = { ...room, updatedAt: createdAt };
    this.roomIndex.put(updatedRoom);
    await this.roomIndex.flush();

    // Fire the dispatch hook BEFORE notifyWaiters so the subscription manager
    // sees every message, including ones that synchronously satisfy a waiter.
    // Errors in the listener must not affect the dispatcher's caller — log
    // and swallow.
    if (this.onMessageDispatched) {
      try {
        this.onMessageDispatched(message);
      } catch (err) {
        this.logger.error({ err, messageId: message.id }, "onMessageDispatched listener threw");
      }
    }

    this.notifyWaiters(room.id);
    return message;
  }

  async readMessages(input: ReadChatMessagesInput): Promise<ChatMessage[]> {
    await this.load();
    const room = await this.resolveRoom(input.room);
    await this.ensureRoomMessagesLoaded(room.id);
    const messages = [...this.messagesByRoomId.get(room.id)!];
    const since = trimToNull(input.since);
    const authorAgentId = trimToNull(input.authorAgentId);
    const limit = this.normalizeLimit(input.limit);

    const filtered = messages.filter((message) => {
      if (since && message.createdAt < since) {
        return false;
      }
      if (authorAgentId && message.authorAgentId !== authorAgentId) {
        return false;
      }
      return true;
    });

    if (limit === 0 || filtered.length <= limit) {
      return filtered;
    }
    return filtered.slice(filtered.length - limit);
  }

  async waitForMessages(input: WaitForChatMessagesInput): Promise<ChatMessage[]> {
    await this.load();
    const room = await this.resolveRoom(input.room);
    await this.ensureRoomMessagesLoaded(room.id);
    const timeoutMs = Math.max(0, Math.floor(input.timeoutMs ?? 0));
    const afterMessageId = trimToNull(input.afterMessageId);

    if (afterMessageId) {
      const existing = this.selectMessagesAfter(room.id, afterMessageId);
      if (existing.length > 0) {
        return existing;
      }
      const knownMessage = this.messagesByRoomId
        .get(room.id)!
        .some((message) => message.id === afterMessageId);
      if (!knownMessage) {
        throw new ChatServiceError(
          "chat_message_not_found",
          `Wait cursor not found: ${afterMessageId}`,
        );
      }
    }

    return new Promise<ChatMessage[]>((resolve, reject) => {
      const waiter: Waiter = {
        roomId: room.id,
        afterMessageId,
        resolve: (messages) => {
          if (waiter.timeout) {
            clearTimeout(waiter.timeout);
            waiter.timeout = null;
          }
          this.removeWaiter(waiter);
          resolve(messages);
        },
        reject: (error) => {
          if (waiter.timeout) {
            clearTimeout(waiter.timeout);
            waiter.timeout = null;
          }
          this.removeWaiter(waiter);
          reject(error);
        },
        timeout: null,
      };

      if (timeoutMs > 0) {
        waiter.timeout = setTimeout(() => {
          waiter.resolve([]);
        }, timeoutMs);
      }

      const roomWaiters = this.waitersByRoomId.get(room.id) ?? new Set<Waiter>();
      roomWaiters.add(waiter);
      this.waitersByRoomId.set(room.id, roomWaiters);
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    if (this.loaded) return;

    await this.roomIndex.load();

    // Run the legacy → JSONL migration. No-op if already migrated or if there
    // never was a legacy file. Migration populates roomIndex + messageStore;
    // ChatService load proceeds against the post-migration state below.
    await migrateLegacyChatStore({
      ottieHome: this.ottieHome,
      logger: this.logger,
      roomIndex: this.roomIndex,
      messageStore: this.messageStore,
    });

    this.loaded = true;
  }

  private async ensureRoomMessagesLoaded(roomId: string): Promise<void> {
    if (this.loadedRoomMessages.has(roomId)) return;
    const messages = await this.messageStore.getMessages(roomId);
    this.messagesByRoomId.set(roomId, messages);
    const lastSeq = messages.length > 0 ? messages[messages.length - 1]!.seq : 0;
    this.latestSeqByRoomId.set(roomId, lastSeq);
    for (const message of messages) {
      if (message.clientMessageId) {
        this.messageByClientId.set(message.clientMessageId, message);
      }
    }
    this.loadedRoomMessages.add(roomId);
  }

  private findRoomByName(name: string): StoredChatRoom | null {
    const normalizedName = normalizeRoomName(name);
    for (const room of this.roomIndex.list()) {
      if (normalizeRoomName(room.name) === normalizedName) {
        return room;
      }
    }
    return null;
  }

  private async resolveRoom(roomSelector: string): Promise<StoredChatRoom> {
    const selector = roomSelector.trim();
    if (selector.length === 0) {
      throw new ChatServiceError("invalid_chat_room", "Chat room name or ID is required");
    }
    const byId = this.roomIndex.get(selector);
    if (byId) {
      return byId;
    }
    const byName = this.findRoomByName(selector);
    if (byName) {
      return byName;
    }
    throw new ChatServiceError("chat_room_not_found", `Chat room not found: ${selector}`);
  }

  private toRoomDetail(room: StoredChatRoom): ChatRoomDetail {
    const messages = this.messagesByRoomId.get(room.id);
    const messageCount = messages?.length ?? 0;
    const lastMessageAt =
      messages && messages.length > 0 ? messages[messages.length - 1]!.createdAt : null;
    return ChatRoomDetailSchema.parse({
      ...room,
      messageCount,
      lastMessageAt,
    });
  }

  private normalizeLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return 20;
    }
    return Math.max(0, Math.floor(limit));
  }

  private selectMessagesAfter(roomId: string, afterMessageId: string): ChatMessage[] {
    const messages = this.messagesByRoomId.get(roomId) ?? [];
    const index = messages.findIndex((message) => message.id === afterMessageId);
    if (index === -1) {
      return [];
    }
    return messages.slice(index + 1);
  }

  private notifyWaiters(roomId: string): void {
    const waiters = this.waitersByRoomId.get(roomId);
    if (!waiters || waiters.size === 0) return;

    for (const waiter of Array.from(waiters)) {
      const messages =
        waiter.afterMessageId === null
          ? (this.messagesByRoomId.get(roomId) ?? []).slice(-1)
          : this.selectMessagesAfter(roomId, waiter.afterMessageId);
      if (messages.length === 0) {
        continue;
      }
      waiter.resolve(messages);
    }
  }

  private removeWaiter(waiter: Waiter): void {
    const waiters = this.waitersByRoomId.get(waiter.roomId);
    if (!waiters) return;
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.waitersByRoomId.delete(waiter.roomId);
    }
  }

  private rejectWaiters(roomId: string, error: Error): void {
    const waiters = this.waitersByRoomId.get(roomId);
    if (!waiters) return;
    for (const waiter of Array.from(waiters)) {
      waiter.reject(error);
    }
  }
}

// Keep the schema reference exported in case external callers still validate
// against it; we no longer use it ourselves but the wire schema lives in
// chat-types.ts.
export { ChatMessageSchema };
