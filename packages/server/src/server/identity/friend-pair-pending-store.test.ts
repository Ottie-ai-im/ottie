import { describe, expect, test } from "vitest";

import { FriendPairPendingStore } from "./friend-pair-pending-store.js";
import { decodeFriendPairOffer } from "./friend-pair-types.js";

const FIXTURE = {
  serverId: "srv_alice",
  rootSignPublicKeyB64: "x".repeat(43),
  displayName: "Alice",
  relayEndpoint: "relay.claws.company:443",
};

describe("FriendPairPendingStore.create", () => {
  test("returns a deep link and ephemeral keypair", () => {
    const store = new FriendPairPendingStore();
    const { pending, deepLink } = store.create(FIXTURE);
    expect(deepLink).toMatch(/^ottie:\/\/friend-pair#payload=/);
    expect(pending.ephPrivateKeyB64).toHaveLength(43);
    expect(pending.offer.ephPublicKeyB64).toHaveLength(43);
    expect(pending.offer.nonceB64.length).toBeGreaterThan(0);
    expect(pending.offer.serverId).toBe("srv_alice");
    expect(pending.offer.displayName).toBe("Alice");
    expect(pending.offer.kind).toBe("friend-pair");
  });

  test("the encoded deep-link roundtrips back to the wire offer", () => {
    const store = new FriendPairPendingStore();
    const { pending, deepLink } = store.create(FIXTURE);
    const decoded = decodeFriendPairOffer(deepLink);
    expect(decoded).toEqual(pending.offer);
  });

  test("each create() produces a different ephemeral keypair and nonce", () => {
    const store = new FriendPairPendingStore();
    const a = store.create(FIXTURE);
    const b = store.create(FIXTURE);
    expect(a.pending.ephPrivateKeyB64).not.toBe(b.pending.ephPrivateKeyB64);
    expect(a.pending.offer.nonceB64).not.toBe(b.pending.offer.nonceB64);
  });

  test("uses default 10-minute TTL when not overridden", () => {
    const store = new FriendPairPendingStore();
    const nowMs = 1_700_000_000_000;
    const { pending } = store.create({ ...FIXTURE, nowMs });
    expect(pending.expiresAtMs).toBe(nowMs + 10 * 60 * 1000);
  });

  test("respects ttlMs override", () => {
    const store = new FriendPairPendingStore();
    const nowMs = 1_700_000_000_000;
    const { pending } = store.create({ ...FIXTURE, nowMs, ttlMs: 1234 });
    expect(pending.expiresAtMs).toBe(nowMs + 1234);
  });

  test("caps concurrent offers at 8", () => {
    const store = new FriendPairPendingStore();
    for (let i = 0; i < 8; i++) {
      store.create(FIXTURE);
    }
    expect(() => store.create(FIXTURE)).toThrow(/Too many/);
  });

  test("garbage-collects expired offers before enforcing the cap", () => {
    const store = new FriendPairPendingStore();
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 8; i++) {
      store.create({ ...FIXTURE, nowMs: t0, ttlMs: 1000 });
    }
    // Far enough past TTL that all offers are stale; create() must succeed.
    const fresh = store.create({ ...FIXTURE, nowMs: t0 + 5000 });
    expect(fresh.pending.expiresAtMs).toBe(t0 + 5000 + 10 * 60 * 1000);
  });
});

describe("FriendPairPendingStore.redeem", () => {
  test("returns the pending offer once and removes it", () => {
    const store = new FriendPairPendingStore();
    const { pending } = store.create(FIXTURE);
    const first = store.redeem(pending.offer.nonceB64);
    expect(first).toEqual(pending);
    const second = store.redeem(pending.offer.nonceB64);
    expect(second).toBeNull();
  });

  test("returns null for unknown nonce", () => {
    const store = new FriendPairPendingStore();
    expect(store.redeem("not-a-real-nonce")).toBeNull();
  });

  test("expired offers redeem as null and are evicted", () => {
    const store = new FriendPairPendingStore();
    const t0 = 1_700_000_000_000;
    const { pending } = store.create({ ...FIXTURE, nowMs: t0, ttlMs: 1000 });
    const past = t0 + 1001;
    expect(store.redeem(pending.offer.nonceB64, past)).toBeNull();
    // Re-redeem after eviction also returns null.
    expect(store.redeem(pending.offer.nonceB64, past)).toBeNull();
  });
});

describe("FriendPairPendingStore.cancel", () => {
  test("removes a pending offer and returns true", () => {
    const store = new FriendPairPendingStore();
    const { pending } = store.create(FIXTURE);
    expect(store.cancel(pending.offer.nonceB64)).toBe(true);
    expect(store.redeem(pending.offer.nonceB64)).toBeNull();
  });

  test("returns false for unknown nonce", () => {
    const store = new FriendPairPendingStore();
    expect(store.cancel("not-a-real-nonce")).toBe(false);
  });
});

describe("FriendPairPendingStore.list", () => {
  test("returns current outstanding offers", () => {
    const store = new FriendPairPendingStore();
    const a = store.create(FIXTURE);
    const b = store.create(FIXTURE);
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list).toContainEqual(a.pending);
    expect(list).toContainEqual(b.pending);
  });

  test("garbage-collects expired offers", () => {
    const store = new FriendPairPendingStore();
    const t0 = 1_700_000_000_000;
    store.create({ ...FIXTURE, nowMs: t0, ttlMs: 100 });
    expect(store.list(t0 + 1000)).toHaveLength(0);
  });
});
