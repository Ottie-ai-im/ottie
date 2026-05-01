// Behavioral tests for the persisted onboarding state store.
// AsyncStorage is mocked with an in-memory map so persistence and rehydration
// can be exercised without a real React Native environment (matches the
// pattern used in `chat/async-storage-chat-store.test.ts`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory AsyncStorage mock — module-level so the persist middleware sees
// the same store across calls. Cleared per-test in beforeEach.
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

import { ONBOARDING_STATE_STORAGE_KEY, useOnboardingStateStore } from "./onboarding-state-store";

beforeEach(() => {
  mockAsyncStorage.clear();
  useOnboardingStateStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOnboardingStateStore", () => {
  it("starts with welcomeShown=false and every delight/empty flag false (Test 1)", () => {
    const state = useOnboardingStateStore.getState();
    expect(state.welcomeShown).toBe(false);
    expect(state.welcomeShownAt).toBeNull();
    expect(state.delightFiredFirstAgent).toBe(false);
    expect(state.delightFiredFirstPermission).toBe(false);
    expect(state.delightFiredFirstVoice).toBe(false);
    expect(state.emptyOttiePlayedFirstWorkspace).toBe(false);
    expect(state.emptyOttiePlayedFirstChats).toBe(false);
  });

  it("setWelcomeShown(true) sets the flag and records welcomeShownAt as a number (Test 2)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));

    useOnboardingStateStore.getState().setWelcomeShown(true);

    const state = useOnboardingStateStore.getState();
    expect(state.welcomeShown).toBe(true);
    expect(typeof state.welcomeShownAt).toBe("number");
    expect(state.welcomeShownAt).toBe(new Date("2026-05-01T12:00:00Z").getTime());
  });

  it("setWelcomeShown(false) clears welcomeShownAt back to null", () => {
    useOnboardingStateStore.getState().setWelcomeShown(true);
    useOnboardingStateStore.getState().setWelcomeShown(false);

    const state = useOnboardingStateStore.getState();
    expect(state.welcomeShown).toBe(false);
    expect(state.welcomeShownAt).toBeNull();
  });

  it("setDelightFiredFirstAgent(true) is idempotent across repeated calls (Test 3)", () => {
    useOnboardingStateStore.getState().setDelightFiredFirstAgent(true);
    expect(useOnboardingStateStore.getState().delightFiredFirstAgent).toBe(true);

    // Second invocation must not throw and must keep the value at true.
    expect(() => useOnboardingStateStore.getState().setDelightFiredFirstAgent(true)).not.toThrow();
    expect(useOnboardingStateStore.getState().delightFiredFirstAgent).toBe(true);
  });

  it("rehydrates welcomeShown from AsyncStorage when the store is rebuilt (Test 4)", async () => {
    // Pre-seed AsyncStorage with a previously-persisted store snapshot.
    const persistedSnapshot = {
      state: {
        welcomeShown: true,
        welcomeShownAt: 1_777_000_000_000,
        delightFiredFirstAgent: true,
        delightFiredFirstPermission: false,
        delightFiredFirstVoice: false,
        emptyOttiePlayedFirstWorkspace: false,
        emptyOttiePlayedFirstChats: false,
      },
      version: 1,
    };
    mockAsyncStorage.set(ONBOARDING_STATE_STORAGE_KEY, JSON.stringify(persistedSnapshot));

    // Re-import after seeding so `persist` reads the seeded value during init.
    vi.resetModules();
    const reimported = await import("./onboarding-state-store");

    // Wait one microtask so the async rehydration finishes.
    await Promise.resolve();
    await Promise.resolve();

    const state = reimported.useOnboardingStateStore.getState();
    expect(state.welcomeShown).toBe(true);
    expect(state.welcomeShownAt).toBe(1_777_000_000_000);
    expect(state.delightFiredFirstAgent).toBe(true);
  });

  it("uses '@ottie:onboarding-state' as the persistence key (Test 5)", async () => {
    useOnboardingStateStore.getState().setWelcomeShown(true);

    // The persist middleware writes asynchronously — flush microtasks once.
    await Promise.resolve();
    await Promise.resolve();

    const persistedRaw = mockAsyncStorage.get(ONBOARDING_STATE_STORAGE_KEY);
    expect(ONBOARDING_STATE_STORAGE_KEY).toBe("@ottie:onboarding-state");
    expect(persistedRaw).toBeDefined();

    const persisted = JSON.parse(persistedRaw ?? "{}") as {
      state: { welcomeShown: boolean };
      version: number;
    };
    expect(persisted.state.welcomeShown).toBe(true);
    expect(persisted.version).toBe(1);
  });
});
