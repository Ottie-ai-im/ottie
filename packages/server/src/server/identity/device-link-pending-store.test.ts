import { describe, expect, test } from "vitest";

import { DeviceLinkPendingStore } from "./device-link-pending-store.js";
import { decodeDeviceLinkOffer } from "./device-link-types.js";

const FIXTURE = {
  serverId: "srv_test",
  rootSignPublicKeyB64: "x".repeat(43),
  displayName: "Wendell",
  relayEndpoint: "relay.claws.company:443",
};

describe("DeviceLinkPendingStore.create", () => {
  test("returns a deep link and ephemeral keypair", () => {
    const store = new DeviceLinkPendingStore();
    const { pending, deepLink } = store.create(FIXTURE);
    expect(deepLink).toMatch(/^ottie:\/\/device-link#payload=/);
    expect(pending.ephPrivateKeyB64).toHaveLength(43);
    expect(pending.offer.ephPublicKeyB64).toHaveLength(43);
    expect(pending.offer.nonceB64.length).toBeGreaterThan(0);
    expect(pending.offer.serverId).toBe("srv_test");
    expect(pending.offer.displayName).toBe("Wendell");
  });

  test("the encoded deep-link roundtrips back to the wire offer", () => {
    const store = new DeviceLinkPendingStore();
    const { pending, deepLink } = store.create(FIXTURE);
    const decoded = decodeDeviceLinkOffer(deepLink);
    expect(decoded).toEqual(pending.offer);
  });

  test("each create() produces a different ephemeral keypair and nonce", () => {
    const store = new DeviceLinkPendingStore();
    const a = store.create(FIXTURE);
    const b = store.create(FIXTURE);
    expect(a.pending.ephPrivateKeyB64).not.toBe(b.pending.ephPrivateKeyB64);
    expect(a.pending.offer.nonceB64).not.toBe(b.pending.offer.nonceB64);
  });

  test("uses default 10-minute TTL when not overridden", () => {
    const store = new DeviceLinkPendingStore();
    const nowMs = 1_700_000_000_000;
    const { pending } = store.create({ ...FIXTURE, nowMs });
    expect(pending.expiresAtMs).toBe(nowMs + 10 * 60 * 1000);
  });

  test("respects ttlMs override", () => {
    const store = new DeviceLinkPendingStore();
    const nowMs = 1_700_000_000_000;
    const { pending } = store.create({ ...FIXTURE, nowMs, ttlMs: 1234 });
    expect(pending.expiresAtMs).toBe(nowMs + 1234);
  });

  test("caps concurrent offers at 8", () => {
    const store = new DeviceLinkPendingStore();
    for (let i = 0; i < 8; i++) {
      store.create(FIXTURE);
    }
    expect(() => store.create(FIXTURE)).toThrow(/Too many/);
  });
});

describe("DeviceLinkPendingStore.redeem", () => {
  test("returns the pending offer once and removes it", () => {
    const store = new DeviceLinkPendingStore();
    const { pending } = store.create(FIXTURE);
    const first = store.redeem(pending.offer.nonceB64);
    expect(first).toEqual(pending);
    const second = store.redeem(pending.offer.nonceB64);
    expect(second).toBeNull();
  });

  test("returns null for unknown nonce", () => {
    const store = new DeviceLinkPendingStore();
    expect(store.redeem("not-a-real-nonce")).toBeNull();
  });

  test("expired offers redeem as null and are evicted", () => {
    const store = new DeviceLinkPendingStore();
    const t0 = 1_700_000_000_000;
    const { pending } = store.create({ ...FIXTURE, nowMs: t0, ttlMs: 1000 });
    const past = t0 + 1001;
    expect(store.redeem(pending.offer.nonceB64, past)).toBeNull();
    // Re-redeem after eviction also returns null.
    expect(store.redeem(pending.offer.nonceB64, past)).toBeNull();
  });
});

describe("DeviceLinkPendingStore.cancel", () => {
  test("removes a pending offer and returns true", () => {
    const store = new DeviceLinkPendingStore();
    const { pending } = store.create(FIXTURE);
    expect(store.cancel(pending.offer.nonceB64)).toBe(true);
    expect(store.redeem(pending.offer.nonceB64)).toBeNull();
  });

  test("returns false for unknown nonce", () => {
    const store = new DeviceLinkPendingStore();
    expect(store.cancel("not-a-real-nonce")).toBe(false);
  });
});

describe("DeviceLinkPendingStore.list", () => {
  test("returns current outstanding offers", () => {
    const store = new DeviceLinkPendingStore();
    const a = store.create(FIXTURE);
    const b = store.create(FIXTURE);
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list).toContainEqual(a.pending);
    expect(list).toContainEqual(b.pending);
  });

  test("garbage-collects expired offers", () => {
    const store = new DeviceLinkPendingStore();
    const t0 = 1_700_000_000_000;
    store.create({ ...FIXTURE, nowMs: t0, ttlMs: 100 });
    expect(store.list(t0 + 1000)).toHaveLength(0);
  });
});
