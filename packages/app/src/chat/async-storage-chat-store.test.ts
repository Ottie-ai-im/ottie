// Behavioral tests for AsyncStorageChatStore. Mocks AsyncStorage with an
// in-memory map so we can exercise the persistence path without a real
// React Native environment.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AsyncStorageChatStore } from "./async-storage-chat-store.js";
import type { LocalChatMessage } from "./local-chat-types.js";

// In-memory AsyncStorage mock. Recreated per-test via beforeEach so state
// doesn't leak between tests.
const mockStore = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mockStore.set(k, v);
    },
    removeItem: async (k: string) => {
      mockStore.delete(k);
    },
    multiGet: async (keys: string[]) =>
      keys.map((k) => [k, mockStore.get(k) ?? null] as [string, string | null]),
    getAllKeys: async () => Array.from(mockStore.keys()),
    clear: async () => {
      mockStore.clear();
    },
  },
}));

function makeWireMessage(overrides: {
  seq: number;
  roomId: string;
  body?: string;
  clientMessageId?: string;
  authorAgentId?: string;
}): LocalChatMessage {
  return {
    id: `msg-${overrides.seq}`,
    roomId: overrides.roomId,
    authorAgentId: overrides.authorAgentId ?? "agent-other",
    body: overrides.body ?? `body ${overrides.seq}`,
    replyToMessageId: null,
    mentionAgentIds: [],
    createdAt: new Date(2026, 0, overrides.seq).toISOString(),
    seq: overrides.seq,
    clientMessageId: overrides.clientMessageId,
    status: "sent",
  };
}

describe("AsyncStorageChatStore", () => {
  let store: AsyncStorageChatStore;

  beforeEach(async () => {
    mockStore.clear();
    store = new AsyncStorageChatStore();
    await store.load();
  });

  afterEach(() => {
    mockStore.clear();
  });

  test("getRoomState returns null for unknown rooms", () => {
    expect(store.getRoomState("ghost")).toBeNull();
  });

  test("upsertCommittedMessage stores by seq, getRoomState returns sorted list", async () => {
    await store.upsertCommittedMessage(makeWireMessage({ seq: 2, roomId: "r1", body: "second" }));
    await store.upsertCommittedMessage(makeWireMessage({ seq: 1, roomId: "r1", body: "first" }));
    await store.upsertCommittedMessage(makeWireMessage({ seq: 3, roomId: "r1", body: "third" }));

    const state = store.getRoomState("r1")!;
    expect(state.messages.map((m) => m.body)).toEqual(["first", "second", "third"]);
    expect(state.lastCommittedSeq).toBe(3);
  });

  test("upsertCommittedMessage rejects messages without a positive seq", async () => {
    await expect(
      store.upsertCommittedMessage({ ...makeWireMessage({ seq: 0, roomId: "r1" }) }),
    ).rejects.toThrow(/positive seq/);
  });

  test("messages persist across store recreation (cold reload)", async () => {
    await store.upsertCommittedMessage(makeWireMessage({ seq: 1, roomId: "r1", body: "before" }));
    await store.upsertCommittedMessage(makeWireMessage({ seq: 2, roomId: "r1", body: "after" }));

    const fresh = new AsyncStorageChatStore();
    await fresh.load();

    const state = fresh.getRoomState("r1")!;
    expect(state.messages.map((m) => m.body)).toEqual(["before", "after"]);
    expect(state.lastCommittedSeq).toBe(2);
  });

  test("subscribeRoom fires on every change with the latest snapshot", async () => {
    const seen: number[] = [];
    const unsub = store.subscribeRoom("r1", (s) => {
      seen.push(s.messages.length);
    });
    await store.upsertCommittedMessage(makeWireMessage({ seq: 1, roomId: "r1" }));
    await store.upsertCommittedMessage(makeWireMessage({ seq: 2, roomId: "r1" }));
    expect(seen).toEqual([1, 2]);
    unsub();
    await store.upsertCommittedMessage(makeWireMessage({ seq: 3, roomId: "r1" }));
    expect(seen).toEqual([1, 2]); // no further notifications after unsubscribe
  });

  test("enqueueOutgoing returns a pending LocalChatMessage and is idempotent on clientMessageId", async () => {
    const m1 = await store.enqueueOutgoing({
      roomId: "r1",
      clientMessageId: "cmid-1",
      authorAgentId: "me",
      body: "hi",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-04-28T00:00:00.000Z",
    });
    expect(m1.status).toBe("pending");
    expect(m1.clientMessageId).toBe("cmid-1");

    // Re-enqueue with the same cmid: returns the original record, no duplicate.
    const m2 = await store.enqueueOutgoing({
      roomId: "r1",
      clientMessageId: "cmid-1",
      authorAgentId: "me",
      body: "hi",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-04-28T00:00:00.000Z",
    });
    expect(m2).toEqual(m1);
    expect(store.getOutbox()).toHaveLength(1);
  });

  test("getRoomState includes pending outbox messages alongside committed ones", async () => {
    await store.upsertCommittedMessage(
      makeWireMessage({ seq: 1, roomId: "r1", body: "committed" }),
    );
    await store.enqueueOutgoing({
      roomId: "r1",
      clientMessageId: "cmid-pending",
      authorAgentId: "me",
      body: "still sending",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-04-28T00:00:00.000Z",
    });
    const state = store.getRoomState("r1")!;
    expect(state.messages).toHaveLength(2);
    // Committed comes first (has a seq), pending is appended.
    expect(state.messages[0]!.body).toBe("committed");
    expect(state.messages[1]!.body).toBe("still sending");
    expect(state.messages[1]!.status).toBe("pending");
  });

  test("server ack of an outbox message transitions pending → sent and removes it from outbox", async () => {
    await store.enqueueOutgoing({
      roomId: "r1",
      clientMessageId: "cmid-1",
      authorAgentId: "me",
      body: "outgoing",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-04-28T00:00:00.000Z",
    });
    expect(store.getOutbox()).toHaveLength(1);

    // Server confirms the message, supplying the same clientMessageId.
    await store.upsertCommittedMessage(
      {
        ...makeWireMessage({
          seq: 5,
          roomId: "r1",
          body: "outgoing",
          clientMessageId: "cmid-1",
          authorAgentId: "me",
        }),
      },
      { fromOwnDispatch: true },
    );

    expect(store.getOutbox()).toHaveLength(0); // cleared
    const state = store.getRoomState("r1")!;
    const m = state.messages.find((msg) => msg.clientMessageId === "cmid-1")!;
    expect(m.status).toBe("sent");
    expect(m.seq).toBe(5);
  });

  test("markOutgoingFailed transitions pending → failed; getOutbox includes it for retry", async () => {
    await store.enqueueOutgoing({
      roomId: "r1",
      clientMessageId: "cmid-fail",
      authorAgentId: "me",
      body: "will fail",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-04-28T00:00:00.000Z",
    });
    await store.markOutgoingFailed("cmid-fail");
    expect(store.getOutbox()[0]!.status).toBe("failed");
  });

  test("recipient delivered cursor advances our messages from sent → delivered", async () => {
    // We send a message (own dispatch), it gets sent.
    await store.upsertCommittedMessage(
      makeWireMessage({
        seq: 1,
        roomId: "r1",
        clientMessageId: "cmid-1",
        body: "hi",
        authorAgentId: "me",
      }),
      { fromOwnDispatch: true },
    );
    // Initially status=sent.
    expect(store.getRoomState("r1")!.messages[0]!.status).toBe("sent");

    // Recipient client-2 acks delivered up to seq=1.
    await store.updateRecipientCursor({
      roomId: "r1",
      fromClientId: "client-2",
      seq: 1,
      kind: "delivered",
    });
    expect(store.getRoomState("r1")!.messages[0]!.status).toBe("delivered");
  });

  test("recipient read cursor advances our messages → read", async () => {
    await store.upsertCommittedMessage(
      makeWireMessage({ seq: 1, roomId: "r1", clientMessageId: "cmid-1", authorAgentId: "me" }),
      { fromOwnDispatch: true },
    );
    await store.updateRecipientCursor({
      roomId: "r1",
      fromClientId: "client-2",
      seq: 1,
      kind: "read",
    });
    expect(store.getRoomState("r1")!.messages[0]!.status).toBe("read");
  });

  test("status never downgrades — a stale delivered after a read stays read", async () => {
    await store.upsertCommittedMessage(
      makeWireMessage({ seq: 1, roomId: "r1", clientMessageId: "cmid-1", authorAgentId: "me" }),
      { fromOwnDispatch: true },
    );
    await store.updateRecipientCursor({
      roomId: "r1",
      fromClientId: "client-2",
      seq: 1,
      kind: "read",
    });
    expect(store.getRoomState("r1")!.messages[0]!.status).toBe("read");

    // Stale delivered ack: cursor logic ignores it (lastDeliveredSeq already at 1
    // because read implied delivered), and status doesn't downgrade.
    await store.updateRecipientCursor({
      roomId: "r1",
      fromClientId: "client-2",
      seq: 1,
      kind: "delivered",
    });
    expect(store.getRoomState("r1")!.messages[0]!.status).toBe("read");
  });

  test("setRoomEpoch with a different epoch wipes the room cache", async () => {
    await store.setRoomEpoch("r1", "epoch-A");
    await store.upsertCommittedMessage(makeWireMessage({ seq: 1, roomId: "r1", body: "old" }));
    expect(store.getRoomState("r1")!.messages).toHaveLength(1);

    await store.setRoomEpoch("r1", "epoch-B"); // different epoch
    const after = store.getRoomState("r1")!;
    expect(after.messages).toHaveLength(0);
    expect(after.epoch).toBe("epoch-B");
    expect(after.lastCommittedSeq).toBe(0);
  });

  test("setRoomEpoch with the SAME epoch is a no-op and preserves messages", async () => {
    await store.setRoomEpoch("r1", "epoch-A");
    await store.upsertCommittedMessage(makeWireMessage({ seq: 1, roomId: "r1", body: "kept" }));
    await store.setRoomEpoch("r1", "epoch-A");
    expect(store.getRoomState("r1")!.messages).toHaveLength(1);
  });

  test("dropRoom removes everything for that room (cache + outbox + storage keys)", async () => {
    await store.upsertCommittedMessage(makeWireMessage({ seq: 1, roomId: "r1" }));
    await store.enqueueOutgoing({
      roomId: "r1",
      clientMessageId: "cmid-1",
      authorAgentId: "me",
      body: "pending",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    await store.dropRoom("r1");
    expect(store.getRoomState("r1")).toBeNull();
    expect(store.getOutbox()).toHaveLength(0);
    // Storage keys also gone.
    expect(mockStore.has("ottie-chat:room:r1")).toBe(false);
  });

  test("bulkUpsertCommitted is atomic: all-or-nothing on errors", async () => {
    // Invalid: messages have seq=0
    await expect(
      store.bulkUpsertCommitted("r1", [
        makeWireMessage({ seq: 0, roomId: "r1" }),
      ] as unknown as LocalChatMessage[]),
    ).rejects.toThrow(/positive seq/);
    expect(store.getRoomState("r1")).toBeNull(); // no partial write
  });

  test("bulkUpsertCommitted clears outbox entries that match incoming clientMessageIds", async () => {
    await store.enqueueOutgoing({
      roomId: "r1",
      clientMessageId: "cmid-bulk",
      authorAgentId: "me",
      body: "out",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-04-28T00:00:00.000Z",
    });
    await store.bulkUpsertCommitted("r1", [
      makeWireMessage({
        seq: 1,
        roomId: "r1",
        clientMessageId: "cmid-bulk",
        body: "out",
        authorAgentId: "me",
      }),
    ]);
    expect(store.getOutbox()).toHaveLength(0);
  });

  test("concurrent upserts to the same room don't lose data (writes serialized)", async () => {
    const N = 30;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.upsertCommittedMessage(makeWireMessage({ seq: i + 1, roomId: "r1" })),
      ),
    );
    const state = store.getRoomState("r1")!;
    expect(state.messages).toHaveLength(N);
    // Cold reload preserves all of them.
    const fresh = new AsyncStorageChatStore();
    await fresh.load();
    expect(fresh.getRoomState("r1")!.messages).toHaveLength(N);
  });
});
