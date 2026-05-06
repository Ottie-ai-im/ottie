import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, test } from "vitest";

import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import { FriendPairPendingCandidateStore } from "./friend-pair-pending-candidate-store.js";
import { FriendPairPendingStore } from "./friend-pair-pending-store.js";
import { createFriendPairConnectionHandler } from "./friend-pair-receiver.js";
import { buildFriendPairRedemption } from "./friend-pair-redeem.js";

interface RootKeys {
  signPublicKeyB64: string;
  signPrivateKey: KeyObject;
}

function mintRootKeys(): RootKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  return { signPublicKeyB64: jwkPub.x, signPrivateKey: privateKey };
}

function makeFakeSocket() {
  const messageListeners: Array<(data: unknown, isBinary: boolean) => void> = [];
  const closeListeners: Array<(code: number, reason: Buffer) => void> = [];
  const errorListeners: Array<(err: Error) => void> = [];
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  let readyState = 1;

  const socket: RelayCustomHandlerSocket = {
    get readyState() {
      return readyState;
    },
    send(data) {
      sent.push(
        typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8"),
      );
    },
    close(code, reason) {
      closes.push({ code, reason });
      readyState = 3;
    },
    on(event: "message" | "close" | "error", listener: never) {
      if (event === "message") messageListeners.push(listener as never);
      if (event === "close") closeListeners.push(listener as never);
      if (event === "error") errorListeners.push(listener as never);
    },
  };

  return {
    socket,
    sent,
    closes,
    deliverMessage(data: unknown, isBinary = false) {
      for (const l of messageListeners) l(data, isBinary);
    },
  };
}

const SILENT_LOGGER = (() => {
  const noop = () => {
    /* no-op */
  };
  const logger: Record<string, unknown> = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
  };
  logger.child = () => logger;
  return logger as never;
})();

function makeOfferFixture(alice: RootKeys) {
  return {
    serverId: "srv_alice",
    rootSignPublicKeyB64: alice.signPublicKeyB64,
    displayName: "Alice",
    relayEndpoint: "relay.claws.company:443",
  };
}

async function runHandler(
  handler: RelayConnectionHandler,
  connectionId: string,
  fakeSocket: ReturnType<typeof makeFakeSocket>,
): Promise<void> {
  await handler.handle({
    socket: fakeSocket.socket,
    connectionId,
    logger: SILENT_LOGGER,
  });
}

describe("createFriendPairConnectionHandler", () => {
  test("matches connectionIds with the friend-pair: prefix only", () => {
    const handler = createFriendPairConnectionHandler({
      pendingOffers: new FriendPairPendingStore(),
      pendingCandidates: new FriendPairPendingCandidateStore(),
    });
    expect(handler.matches("friend-pair:abc")).toBe(true);
    expect(handler.matches("device-link:abc")).toBe(false);
    expect(handler.matches("clt_normal")).toBe(false);
  });

  test("happy path: real redemption is decrypted, signature-verified, and parked", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(makeOfferFixture(alice));
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });

    const fake = makeFakeSocket();
    const connectionId = `friend-pair:${pending.offer.nonceB64}`;
    await runHandler(handler, connectionId, fake);
    fake.deliverMessage(JSON.stringify(built.redemption));

    const stored = pendingCandidates.get(pending.offer.nonceB64);
    expect(stored).not.toBeNull();
    expect(stored?.candidate.displayName).toBe("Bob");
    expect(stored?.candidate.rootSignPublicKeyB64).toBe(bob.signPublicKeyB64);
    expect(stored?.candidateEphPublicKeyB64).toBe(built.redemption.candidateEphPublicKeyB64);
    expect(stored?.ephPrivateKeyB64).toBe(pending.ephPrivateKeyB64);
    // Phase 3.a/3: receiver KEEPS the socket open and parks the
    // reference for the eventual approve reply.
    expect(stored?.replySocket).toBe(fake.socket);

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "candidate-received" });
    expect(fake.closes).toHaveLength(0);
    // Single-use: pending offer is consumed.
    expect(pendingOffers.redeem(pending.offer.nonceB64)).toBeNull();
  });

  test("rejects an empty connectionId nonce", async () => {
    const handler = createFriendPairConnectionHandler({
      pendingOffers: new FriendPairPendingStore(),
      pendingCandidates: new FriendPairPendingCandidateStore(),
    });
    const fake = makeFakeSocket();
    await runHandler(handler, "friend-pair:", fake);
    expect(fake.closes[0]).toEqual({ code: 1008, reason: "missing_nonce" });
  });

  test("rejects an envelope whose nonce doesn't match the connectionId", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(makeOfferFixture(alice));
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "friend-pair:wrong-nonce", fake);
    fake.deliverMessage(JSON.stringify(built.redemption));

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "nonce_mismatch" });
    expect(fake.closes[0]?.code).toBe(1008);
    expect(pendingCandidates.list()).toHaveLength(0);
    // Original offer NOT consumed — we rejected before redeeming it.
    expect(pendingOffers.redeem(pending.offer.nonceB64)).not.toBeNull();
  });

  test("rejects a redemption whose offer doesn't exist (replay / stale)", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    // Build a redemption for a DIFFERENT pending store so the offer
    // never landed on the receiver — same effect as a replayed envelope
    // after an offer was canceled.
    const otherStore = new FriendPairPendingStore();
    const { pending } = otherStore.create(makeOfferFixture(alice));
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });

    const fake = makeFakeSocket();
    await runHandler(handler, `friend-pair:${pending.offer.nonceB64}`, fake);
    fake.deliverMessage(JSON.stringify(built.redemption));

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "no_offer" });
    expect(fake.closes[0]?.code).toBe(1008);
    expect(pendingCandidates.list()).toHaveLength(0);
  });

  test("rejects unparseable JSON without consuming the offer", async () => {
    const alice = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(makeOfferFixture(alice));
    const fake = makeFakeSocket();
    await runHandler(handler, `friend-pair:${pending.offer.nonceB64}`, fake);
    fake.deliverMessage("not valid json {{{{{");

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "bad_json" });
    expect(fake.closes[0]?.code).toBe(1003);
    expect(pendingOffers.redeem(pending.offer.nonceB64)).not.toBeNull();
  });

  test("rejects oversized frames to defend against memory abuse", async () => {
    const alice = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(makeOfferFixture(alice));
    const fake = makeFakeSocket();
    await runHandler(handler, `friend-pair:${pending.offer.nonceB64}`, fake);

    const huge = "x".repeat(64 * 1024 + 1);
    fake.deliverMessage(huge);

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "too_large" });
    expect(fake.closes[0]?.code).toBe(1009);
  });

  test("rejects tampered ciphertext (decryption fails)", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(makeOfferFixture(alice));
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });

    const original = built.redemption.ciphertextB64;
    const tampered = `${original.slice(0, -5)}AAAAA`;
    const tamperedRedemption = { ...built.redemption, ciphertextB64: tampered };

    const fake = makeFakeSocket();
    await runHandler(handler, `friend-pair:${pending.offer.nonceB64}`, fake);
    fake.deliverMessage(JSON.stringify(tamperedRedemption));

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "decrypt_failed" });
    expect(fake.closes[0]?.code).toBe(1008);
    expect(pendingCandidates.list()).toHaveLength(0);
    // Offer was already redeemed before the decrypt step — single-use.
    expect(pendingOffers.redeem(pending.offer.nonceB64)).toBeNull();
  });

  test("rejects a forged candidate whose claimed root pubkey doesn't match the signer", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const eve = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(makeOfferFixture(alice));
    // Bob signs but claims to be Eve. Verify must fail.
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: eve.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob-pretending-to-be-Eve",
    });

    const fake = makeFakeSocket();
    await runHandler(handler, `friend-pair:${pending.offer.nonceB64}`, fake);
    fake.deliverMessage(JSON.stringify(built.redemption));

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "bad_signature" });
    expect(fake.closes[0]?.code).toBe(1008);
    expect(pendingCandidates.list()).toHaveLength(0);
  });

  test("refuses self-pairing (responder claims same root pubkey as the offer)", async () => {
    const alice = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(makeOfferFixture(alice));
    // Alice signs a redemption claiming her own identity.
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: alice.signPublicKeyB64,
      selfRootSignPrivateKey: alice.signPrivateKey,
      selfDisplayName: "Alice (self)",
    });

    const fake = makeFakeSocket();
    await runHandler(handler, `friend-pair:${pending.offer.nonceB64}`, fake);
    fake.deliverMessage(JSON.stringify(built.redemption));

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "self_pairing" });
    expect(fake.closes[0]?.code).toBe(1008);
    expect(pendingCandidates.list()).toHaveLength(0);
  });
});
