// Behavioral tests for the client-only ChatRowStateStore.
// Mirrors the in-memory AsyncStorage mock used by `onboarding-state-store.test.ts`
// so persistence and rehydration can be exercised without a real React Native
// environment.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAsyncStorage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => mockAsyncStorage.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mockAsyncStorage.set(k, v);
    },
    removeItem: async (k: string) => {
      mockAsyncStorage.delete(k);
    },
    multiGet: async (keys: string[]) =>
      keys.map((k) => [k, mockAsyncStorage.get(k) ?? null] as [string, string | null]),
    getAllKeys: async () => Array.from(mockAsyncStorage.keys()),
    clear: async () => {
      mockAsyncStorage.clear();
    },
  },
}));

import {
  CHAT_ROW_STATE_STORAGE_KEY,
  makeRowKey,
  useChatRowStateStore,
} from "./chat-row-state-store";

beforeEach(() => {
  mockAsyncStorage.clear();
  // Reset in-memory state. Wipe to avoid bleed from previous tests.
  useChatRowStateStore.setState({ rows: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useChatRowStateStore", () => {
  it("returns the default row state for an unknown key (Test 1)", () => {
    const state = useChatRowStateStore.getState().getRowState("server-1:agent-1");
    expect(state).toEqual({
      pinned: false,
      pinnedAt: null,
      muted: false,
      unread: 0,
      archived: false,
    });
  });

  it("setPinned(rowKey, true) records pinnedAt as a number (Test 2)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));

    const key = makeRowKey("server-1", "agent-1");
    useChatRowStateStore.getState().setPinned(key, true);

    const row = useChatRowStateStore.getState().getRowState(key);
    expect(row.pinned).toBe(true);
    expect(row.pinnedAt).toBe(new Date("2026-05-01T12:00:00Z").getTime());
  });

  it("setPinned(rowKey, false) clears pinnedAt back to null", () => {
    const key = makeRowKey("server-1", "agent-1");
    useChatRowStateStore.getState().setPinned(key, true);
    useChatRowStateStore.getState().setPinned(key, false);

    const row = useChatRowStateStore.getState().getRowState(key);
    expect(row.pinned).toBe(false);
    expect(row.pinnedAt).toBeNull();
  });

  it("incrementUnread() adds 1; markRead() clears to 0 (Test 3)", () => {
    const key = makeRowKey("server-1", "agent-1");
    useChatRowStateStore.getState().incrementUnread(key);
    useChatRowStateStore.getState().incrementUnread(key);
    useChatRowStateStore.getState().incrementUnread(key);
    expect(useChatRowStateStore.getState().getRowState(key).unread).toBe(3);

    useChatRowStateStore.getState().markRead(key);
    expect(useChatRowStateStore.getState().getRowState(key).unread).toBe(0);
  });

  it("setUnread() clamps negatives to 0 (Test 3 follow-up)", () => {
    const key = makeRowKey("server-1", "agent-1");
    useChatRowStateStore.getState().setUnread(key, -5);
    expect(useChatRowStateStore.getState().getRowState(key).unread).toBe(0);
  });

  it("uses '@ottie:chat-row-state' as the persistence key (Test 4)", async () => {
    const key = makeRowKey("server-1", "agent-1");
    useChatRowStateStore.getState().setPinned(key, true);

    // The persist middleware writes asynchronously — flush microtasks once.
    await Promise.resolve();
    await Promise.resolve();

    expect(CHAT_ROW_STATE_STORAGE_KEY).toBe("@ottie:chat-row-state");
    const persistedRaw = mockAsyncStorage.get(CHAT_ROW_STATE_STORAGE_KEY);
    expect(persistedRaw).toBeDefined();

    const persisted = JSON.parse(persistedRaw ?? "{}") as {
      state: { rows: Record<string, { pinned: boolean }> };
      version: number;
    };
    expect(persisted.state.rows[key]?.pinned).toBe(true);
    expect(persisted.version).toBe(1);
  });

  it("getPinnedRowKeys() returns ids sorted by pinnedAt desc (Test 5)", () => {
    const a = makeRowKey("server-1", "agent-a");
    const b = makeRowKey("server-1", "agent-b");
    const c = makeRowKey("server-1", "agent-c");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));
    useChatRowStateStore.getState().setPinned(a, true);

    vi.setSystemTime(new Date("2026-05-01T12:00:01Z"));
    useChatRowStateStore.getState().setPinned(b, true);

    vi.setSystemTime(new Date("2026-05-01T12:00:02Z"));
    useChatRowStateStore.getState().setPinned(c, true);

    expect(useChatRowStateStore.getState().getPinnedRowKeys()).toEqual([c, b, a]);
  });

  it("remove() deletes the row entry entirely", () => {
    const key = makeRowKey("server-1", "agent-1");
    useChatRowStateStore.getState().setPinned(key, true);
    useChatRowStateStore.getState().remove(key);
    // After remove the row reverts to the default (so getRowState returns DEFAULT).
    expect(useChatRowStateStore.getState().rows[key]).toBeUndefined();
    expect(useChatRowStateStore.getState().getRowState(key).pinned).toBe(false);
  });
});
