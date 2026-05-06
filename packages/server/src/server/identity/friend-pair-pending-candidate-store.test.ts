import { describe, expect, test } from "vitest";

import { FriendPairPendingCandidateStore } from "./friend-pair-pending-candidate-store.js";
import type { FriendCandidate } from "./friend-pair-redeem-types.js";
import type { FriendPairOffer } from "./friend-pair-types.js";

const OFFER: FriendPairOffer = {
  v: 1,
  kind: "friend-pair",
  serverId: "srv_alice",
  rootSignPublicKeyB64: "x".repeat(43),
  displayName: "Alice",
  ephPublicKeyB64: "y".repeat(43),
  nonceB64: "n".repeat(43),
  exp: new Date(2_000_000_000_000).toISOString(),
  relayEndpoint: "relay.claws.company:443",
};

const CANDIDATE: FriendCandidate = {
  v: 1,
  kind: "friend-candidate",
  rootSignPublicKeyB64: "b".repeat(43),
  displayName: "Bob",
  signatureB64: "sig_".padEnd(86, "z"),
  generatedAt: new Date(1_700_000_000_000).toISOString(),
};

const RECORD_BASE = {
  nonceB64: OFFER.nonceB64,
  candidate: CANDIDATE,
  offer: OFFER,
  ephPrivateKeyB64: "p".repeat(43),
  candidateEphPublicKeyB64: "q".repeat(43),
};

describe("FriendPairPendingCandidateStore.record", () => {
  test("stores a candidate keyed by nonce", () => {
    const store = new FriendPairPendingCandidateStore();
    const nowMs = 1_700_000_000_000;
    const record = store.record({ ...RECORD_BASE, nowMs });
    expect(record.candidate).toEqual(CANDIDATE);
    expect(record.receivedAtMs).toBe(nowMs);
    expect(record.expiresAtMs).toBe(nowMs + 10 * 60 * 1000);
  });

  test("respects ttlMs override", () => {
    const store = new FriendPairPendingCandidateStore();
    const nowMs = 1_700_000_000_000;
    const record = store.record({ ...RECORD_BASE, nowMs, ttlMs: 5_000 });
    expect(record.expiresAtMs).toBe(nowMs + 5_000);
  });

  test("a second record for the same nonce overwrites the first (retry semantics)", () => {
    const store = new FriendPairPendingCandidateStore();
    store.record({ ...RECORD_BASE, candidate: { ...CANDIDATE, displayName: "first try" } });
    store.record({ ...RECORD_BASE, candidate: { ...CANDIDATE, displayName: "second try" } });
    const found = store.get(RECORD_BASE.nonceB64);
    expect(found?.candidate.displayName).toBe("second try");
    expect(store.list()).toHaveLength(1);
  });

  test("caps concurrent candidates at 8 (only when adding a NEW nonce)", () => {
    const store = new FriendPairPendingCandidateStore();
    for (let i = 0; i < 8; i++) {
      store.record({ ...RECORD_BASE, nonceB64: `nonce-${i}`.padEnd(43, "x") });
    }
    expect(() => store.record({ ...RECORD_BASE, nonceB64: "nonce-9".padEnd(43, "x") })).toThrow(
      /Too many/,
    );
    // Overwriting an existing nonce is fine even at the cap.
    expect(() =>
      store.record({ ...RECORD_BASE, nonceB64: "nonce-0".padEnd(43, "x") }),
    ).not.toThrow();
  });
});

describe("FriendPairPendingCandidateStore.get / consume / list", () => {
  test("get returns the record before it expires", () => {
    const store = new FriendPairPendingCandidateStore();
    const nowMs = 1_700_000_000_000;
    store.record({ ...RECORD_BASE, nowMs, ttlMs: 1000 });
    expect(store.get(RECORD_BASE.nonceB64, nowMs + 500)?.candidate).toEqual(CANDIDATE);
  });

  test("get returns null past expiry and evicts the record", () => {
    const store = new FriendPairPendingCandidateStore();
    const nowMs = 1_700_000_000_000;
    store.record({ ...RECORD_BASE, nowMs, ttlMs: 1000 });
    expect(store.get(RECORD_BASE.nonceB64, nowMs + 2000)).toBeNull();
    expect(store.list(nowMs + 2000)).toHaveLength(0);
  });

  test("consume returns the record once and is single-use", () => {
    const store = new FriendPairPendingCandidateStore();
    store.record(RECORD_BASE);
    expect(store.consume(RECORD_BASE.nonceB64)?.candidate).toEqual(CANDIDATE);
    expect(store.consume(RECORD_BASE.nonceB64)).toBeNull();
  });

  test("list garbage-collects expired entries", () => {
    const store = new FriendPairPendingCandidateStore();
    const nowMs = 1_700_000_000_000;
    store.record({ ...RECORD_BASE, nowMs, ttlMs: 100 });
    expect(store.list(nowMs + 1000)).toHaveLength(0);
  });
});
