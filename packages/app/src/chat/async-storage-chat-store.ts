// AsyncStorage-backed local chat store.
//
// Persistence layout: one key per room.
//   ottie-chat:room:<roomId> → JSON of { epoch, lastCommittedSeq, messages[] }
//   ottie-chat:outbox        → JSON of { clientMessageId → LocalChatMessage } across all rooms
//   ottie-chat:cursors:<roomId> → JSON of { [fromClientId]: { lastDeliveredSeq, lastReadSeq } }
//
// Why AsyncStorage and not SQLite: matches the existing client-side pattern
// (draft-store, sidebar-collapsed-sections-store, usage-store), no native
// dep needed, "just works" on web (falls through to localStorage). For 99%
// of expected loads (a few rooms × thousands of messages × ~200 bytes each
// = single-digit MB) this is fine. If a single room ever balloons past
// ~10MB, swap THIS file for an expo-sqlite implementation behind the same
// LocalChatStore interface — no consumer changes required.
//
// Concurrency: per-room writes are serialized via promise chains so two
// rapid upserts can't interleave reads-then-writes.

import AsyncStorage from "@react-native-async-storage/async-storage";

import type {
  ChatMessageStatus,
  LocalChatMessage,
  LocalChatStore,
  LocalRoomState,
  RoomSubscriber,
  UpsertCommittedOptions,
} from "./local-chat-types.js";

const ROOM_KEY_PREFIX = "ottie-chat:room:";
const OUTBOX_KEY = "ottie-chat:outbox";
const CURSOR_KEY_PREFIX = "ottie-chat:cursors:";

interface PersistedRoom {
  epoch: string;
  lastCommittedSeq: number;
  /**
   * Committed messages only. Outbox lives in a separate key so it survives
   * room cache invalidation on epoch reset.
   */
  messages: LocalChatMessage[];
}

interface RecipientCursors {
  /** keyed by other clientId */
  [fromClientId: string]: { lastDeliveredSeq: number; lastReadSeq: number };
}

function roomKey(roomId: string): string {
  return `${ROOM_KEY_PREFIX}${roomId}`;
}

function cursorKey(roomId: string): string {
  return `${CURSOR_KEY_PREFIX}${roomId}`;
}

/** Order: committed messages by seq asc, then pending/failed by createdAt asc. */
function sortMessages(messages: LocalChatMessage[]): LocalChatMessage[] {
  return messages.slice().sort((a, b) => {
    const aSeq = a.seq ?? Number.POSITIVE_INFINITY;
    const bSeq = b.seq ?? Number.POSITIVE_INFINITY;
    if (aSeq !== bSeq) return aSeq - bSeq;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export class AsyncStorageChatStore implements LocalChatStore {
  private readonly rooms = new Map<string, PersistedRoom>();
  private readonly recipientCursors = new Map<string, RecipientCursors>();
  private outbox = new Map<string, LocalChatMessage>(); // keyed by clientMessageId
  private readonly listeners = new Map<string, Set<RoomSubscriber>>();
  private readonly writeChains = new Map<string, Promise<void>>();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;

    const keys = await AsyncStorage.getAllKeys();
    const ottieKeys = keys.filter(
      (k) => k.startsWith(ROOM_KEY_PREFIX) || k.startsWith(CURSOR_KEY_PREFIX) || k === OUTBOX_KEY,
    );

    if (ottieKeys.length === 0) {
      this.loaded = true;
      return;
    }

    const entries = await AsyncStorage.multiGet(ottieKeys);
    for (const [key, value] of entries) {
      if (value == null) continue;
      try {
        const parsed: unknown = JSON.parse(value);
        if (key === OUTBOX_KEY) {
          this.outbox = parseOutbox(parsed);
        } else if (key.startsWith(ROOM_KEY_PREFIX)) {
          const roomId = key.slice(ROOM_KEY_PREFIX.length);
          const room = parsePersistedRoom(parsed);
          if (room) this.rooms.set(roomId, room);
        } else if (key.startsWith(CURSOR_KEY_PREFIX)) {
          const roomId = key.slice(CURSOR_KEY_PREFIX.length);
          const cursors = parseRecipientCursors(parsed);
          if (cursors) this.recipientCursors.set(roomId, cursors);
        }
      } catch {
        // Corrupt entry — drop it. Next write will overwrite cleanly.
      }
    }

    this.loaded = true;
  }

  getRoomState(roomId: string): LocalRoomState | null {
    const room = this.rooms.get(roomId);
    const outboxForRoom = Array.from(this.outbox.values()).filter((m) => m.roomId === roomId);
    if (!room && outboxForRoom.length === 0) return null;

    const committed = room?.messages ?? [];
    return {
      messages: sortMessages([...committed, ...outboxForRoom]),
      lastCommittedSeq: room?.lastCommittedSeq ?? 0,
      epoch: room?.epoch ?? "",
    };
  }

  subscribeRoom(roomId: string, listener: RoomSubscriber): () => void {
    let listeners = this.listeners.get(roomId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(roomId, listeners);
    }
    listeners.add(listener);
    return () => {
      const set = this.listeners.get(roomId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(roomId);
    };
  }

  async upsertCommittedMessage(
    message: LocalChatMessage,
    options?: UpsertCommittedOptions,
  ): Promise<void> {
    if (typeof message.seq !== "number" || message.seq <= 0) {
      throw new Error(`upsertCommittedMessage requires a positive seq; got ${String(message.seq)}`);
    }
    // Snapshot seq in a local so the type narrows past the inner closure
    // boundaries below.
    const seq = message.seq;
    await this.runForRoom(message.roomId, async () => {
      const room = this.ensureRoom(message.roomId);
      const existingIdx = room.messages.findIndex((m) => m.seq === seq);
      const merged: LocalChatMessage = {
        ...message,
        status: "sent",
      };
      if (existingIdx >= 0) {
        room.messages[existingIdx] = merged;
      } else {
        room.messages.push(merged);
      }
      room.lastCommittedSeq = Math.max(room.lastCommittedSeq, seq);

      // If this message was our own dispatch, drop the matching outbox entry.
      if (options?.fromOwnDispatch && message.clientMessageId) {
        this.outbox.delete(message.clientMessageId);
        await this.persistOutbox();
      } else if (message.clientMessageId && this.outbox.has(message.clientMessageId)) {
        // Reconnect / push edge case: server pushed us our own message before
        // chat/post/response landed. Treat as own-dispatch ack regardless.
        this.outbox.delete(message.clientMessageId);
        await this.persistOutbox();
      }

      await this.persistRoom(message.roomId);
    });
    this.notify(message.roomId);
  }

  async bulkUpsertCommitted(roomId: string, messages: readonly LocalChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    for (const m of messages) {
      if (typeof m.seq !== "number" || m.seq <= 0) {
        throw new Error(`bulkUpsertCommitted: every message needs a positive seq`);
      }
      if (m.roomId !== roomId) {
        throw new Error(
          `bulkUpsertCommitted: message.roomId=${m.roomId} doesn't match argument ${roomId}`,
        );
      }
    }
    await this.runForRoom(roomId, async () => {
      const room = this.ensureRoom(roomId);
      const bySeq = new Map<number, LocalChatMessage>();
      for (const m of room.messages) {
        bySeq.set(m.seq!, m);
      }
      for (const m of messages) {
        bySeq.set(m.seq!, { ...m, status: "sent" });
        if (m.clientMessageId) {
          // Server is now authoritative for this clientMessageId — drop outbox.
          this.outbox.delete(m.clientMessageId);
        }
      }
      room.messages = Array.from(bySeq.values());
      room.lastCommittedSeq = Math.max(room.lastCommittedSeq, ...messages.map((m) => m.seq!));
      await this.persistRoom(roomId);
      await this.persistOutbox();
    });
    this.notify(roomId);
  }

  async enqueueOutgoing(message: {
    roomId: string;
    clientMessageId: string;
    authorAgentId: string;
    authorClientId?: string;
    body: string;
    replyToMessageId: string | null;
    mentionAgentIds: string[];
    createdAt: string;
  }): Promise<LocalChatMessage> {
    if (this.outbox.has(message.clientMessageId)) {
      // Idempotent: same clientMessageId returns the existing record.
      return this.outbox.get(message.clientMessageId)!;
    }
    const local: LocalChatMessage = {
      id: message.clientMessageId, // pre-server: use clientMessageId as id
      roomId: message.roomId,
      authorAgentId: message.authorAgentId,
      authorClientId: message.authorClientId,
      body: message.body,
      replyToMessageId: message.replyToMessageId,
      mentionAgentIds: message.mentionAgentIds,
      createdAt: message.createdAt,
      clientMessageId: message.clientMessageId,
      status: "pending",
    };
    this.outbox.set(message.clientMessageId, local);
    await this.persistOutbox();
    this.notify(message.roomId);
    return local;
  }

  async markOutgoingFailed(clientMessageId: string): Promise<void> {
    const existing = this.outbox.get(clientMessageId);
    if (!existing) return;
    existing.status = "failed";
    await this.persistOutbox();
    this.notify(existing.roomId);
  }

  getOutbox(): LocalChatMessage[] {
    return Array.from(this.outbox.values()).filter(
      (m) => m.status === "pending" || m.status === "failed",
    );
  }

  async updateRecipientCursor(input: {
    roomId: string;
    fromClientId: string;
    seq: number;
    kind: "delivered" | "read";
  }): Promise<void> {
    await this.runForRoom(input.roomId, async () => {
      const cursors = this.recipientCursors.get(input.roomId) ?? {};
      const existing = cursors[input.fromClientId] ?? { lastDeliveredSeq: 0, lastReadSeq: 0 };
      const newDelivered = Math.max(existing.lastDeliveredSeq, input.seq);
      const newRead =
        input.kind === "read" ? Math.max(existing.lastReadSeq, input.seq) : existing.lastReadSeq;
      if (newDelivered === existing.lastDeliveredSeq && newRead === existing.lastReadSeq) {
        return; // stale ack — no-op
      }
      cursors[input.fromClientId] = { lastDeliveredSeq: newDelivered, lastReadSeq: newRead };
      this.recipientCursors.set(input.roomId, cursors);
      await this.persistCursors(input.roomId);

      // Recompute status for our own messages in this room based on the
      // updated cursor max across all recipients.
      this.recomputeOwnMessageStatus(input.roomId);
      await this.persistRoom(input.roomId);
    });
    this.notify(input.roomId);
  }

  async setRoomEpoch(roomId: string, epoch: string): Promise<void> {
    await this.runForRoom(roomId, async () => {
      const existing = this.rooms.get(roomId);
      if (existing && existing.epoch === epoch) return;
      const fresh: PersistedRoom = {
        epoch,
        lastCommittedSeq: 0,
        messages: [],
      };
      this.rooms.set(roomId, fresh);
      await this.persistRoom(roomId);
      // Cursors for this room are now meaningless — drop them.
      this.recipientCursors.delete(roomId);
      await AsyncStorage.removeItem(cursorKey(roomId));
    });
    this.notify(roomId);
  }

  async dropRoom(roomId: string): Promise<void> {
    await this.runForRoom(roomId, async () => {
      this.rooms.delete(roomId);
      this.recipientCursors.delete(roomId);
      await AsyncStorage.removeItem(roomKey(roomId));
      await AsyncStorage.removeItem(cursorKey(roomId));
      // Drop any outbox entries for this room too.
      let outboxChanged = false;
      for (const [cmid, msg] of this.outbox) {
        if (msg.roomId === roomId) {
          this.outbox.delete(cmid);
          outboxChanged = true;
        }
      }
      if (outboxChanged) await this.persistOutbox();
    });
    this.notify(roomId);
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private ensureRoom(roomId: string): PersistedRoom {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { epoch: "", lastCommittedSeq: 0, messages: [] };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  private notify(roomId: string): void {
    const listeners = this.listeners.get(roomId);
    if (!listeners || listeners.size === 0) return;
    const state = this.getRoomState(roomId);
    if (!state) return;
    for (const l of listeners) {
      try {
        l(state);
      } catch {
        // listener error mustn't break our caller
      }
    }
  }

  private async persistRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) {
      await AsyncStorage.removeItem(roomKey(roomId));
      return;
    }
    await AsyncStorage.setItem(roomKey(roomId), JSON.stringify(room));
  }

  private async persistOutbox(): Promise<void> {
    const obj: Record<string, LocalChatMessage> = {};
    for (const [k, v] of this.outbox) obj[k] = v;
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(obj));
  }

  private async persistCursors(roomId: string): Promise<void> {
    const cursors = this.recipientCursors.get(roomId);
    if (!cursors) {
      await AsyncStorage.removeItem(cursorKey(roomId));
      return;
    }
    await AsyncStorage.setItem(cursorKey(roomId), JSON.stringify(cursors));
  }

  /**
   * Walk all of OUR messages in this room and update their status based on
   * the recipient cursor state. "Our" = the message has a clientMessageId
   * (only authored messages have one) and status was already at sent or
   * later (we don't downgrade pending/failed via this path).
   */
  private recomputeOwnMessageStatus(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const cursors = this.recipientCursors.get(roomId);
    if (!cursors) return;

    let maxDelivered = 0;
    let maxRead = 0;
    for (const c of Object.values(cursors)) {
      if (c.lastDeliveredSeq > maxDelivered) maxDelivered = c.lastDeliveredSeq;
      if (c.lastReadSeq > maxRead) maxRead = c.lastReadSeq;
    }

    for (const message of room.messages) {
      if (typeof message.seq !== "number") continue;
      // Only upgrade "sent" → "delivered" → "read". Never downgrade.
      const target = computeStatus(message.seq, maxDelivered, maxRead);
      if (target && rank(target) > rank(message.status)) {
        message.status = target;
      }
    }
  }

  /** Serialize per-room writes so concurrent upserts don't lose data. */
  private async runForRoom<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(roomId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const result = await fn();
      return result;
    });
    this.writeChains.set(
      roomId,
      next.then(() => undefined).catch(() => undefined),
    );
    return next;
  }
}

function computeStatus(
  seq: number,
  maxDelivered: number,
  maxRead: number,
): ChatMessageStatus | null {
  if (seq <= maxRead) return "read";
  if (seq <= maxDelivered) return "delivered";
  return null;
}

function rank(status: ChatMessageStatus): number {
  switch (status) {
    case "failed":
      return -1;
    case "pending":
      return 0;
    case "sent":
      return 1;
    case "delivered":
      return 2;
    case "read":
      return 3;
  }
}

// ─── Defensive parsers (skip corrupt entries) ──────────────────────────────

function parsePersistedRoom(value: unknown): PersistedRoom | null {
  if (!isObject(value)) return null;
  const epoch = typeof value.epoch === "string" ? value.epoch : "";
  const lastCommittedSeq = typeof value.lastCommittedSeq === "number" ? value.lastCommittedSeq : 0;
  if (!Array.isArray(value.messages)) return null;
  const messages: LocalChatMessage[] = [];
  for (const m of value.messages) {
    if (isLocalChatMessage(m)) messages.push(m);
  }
  return { epoch, lastCommittedSeq, messages };
}

function parseOutbox(value: unknown): Map<string, LocalChatMessage> {
  if (!isObject(value)) return new Map();
  const out = new Map<string, LocalChatMessage>();
  for (const [cmid, m] of Object.entries(value)) {
    if (typeof cmid === "string" && isLocalChatMessage(m)) {
      out.set(cmid, m);
    }
  }
  return out;
}

function parseRecipientCursors(value: unknown): RecipientCursors | null {
  if (!isObject(value)) return null;
  const out: RecipientCursors = {};
  for (const [k, v] of Object.entries(value)) {
    if (
      typeof k === "string" &&
      isObject(v) &&
      typeof v.lastDeliveredSeq === "number" &&
      typeof v.lastReadSeq === "number"
    ) {
      out[k] = { lastDeliveredSeq: v.lastDeliveredSeq, lastReadSeq: v.lastReadSeq };
    }
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalChatMessage(value: unknown): value is LocalChatMessage {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.roomId === "string" &&
    typeof value.authorAgentId === "string" &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.status === "string"
  );
}
