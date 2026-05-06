import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, test } from "vitest";

import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import { FriendPairPendingCandidateStore } from "./friend-pair-pending-candidate-store.js";
import { FriendPairPendingStore } from "./friend-pair-pending-store.js";
import { createFriendPairConnectionHandler } from "./friend-pair-receiver.js";
import { redeemFriendPairOffer, type FriendPairRedeemSocket } from "./friend-pair-sender.js";

interface RootKeys {
  signPublicKeyB64: string;
  signPrivateKey: KeyObject;
}

function mintRootKeys(): RootKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  return { signPublicKeyB64: jwkPub.x, signPrivateKey: privateKey };
}

/**
 * Builds a sender ↔ receiver in-memory pair. Same shape as the
 * device-link-sender test pair: real crypto runs on both sides, only
 * the network layer is faked.
 */
function pairFakeSockets() {
  type Listener<T extends unknown[]> = (...args: T) => void;
  const senderOpen: Array<Listener<[]>> = [];
  const senderMessage: Array<Listener<[unknown]>> = [];
  const senderClose: Array<Listener<[number, Buffer]>> = [];
  const senderError: Array<Listener<[Error]>> = [];

  const receiverMessage: Array<Listener<[unknown, boolean]>> = [];
  const receiverClose: Array<Listener<[number, Buffer]>> = [];
  const receiverError: Array<Listener<[Error]>> = [];

  let senderReady = 1;
  let receiverReady = 1;

  const senderSocket: FriendPairRedeemSocket = {
    send: (data) => {
      for (const l of receiverMessage) l(data, false);
    },
    close: (code = 1000, reason = "") => {
      if (senderReady === 3) return;
      senderReady = 3;
      const reasonBuf = Buffer.from(reason);
      for (const l of senderClose) l(code, reasonBuf);
    },
    on: (event, listener) => {
      if (event === "open") senderOpen.push(listener as Listener<[]>);
      if (event === "message") senderMessage.push(listener as Listener<[unknown]>);
      if (event === "close") senderClose.push(listener as Listener<[number, Buffer]>);
      if (event === "error") senderError.push(listener as Listener<[Error]>);
    },
  };

  const receiverSocket: RelayCustomHandlerSocket = {
    get readyState() {
      return receiverReady;
    },
    send: (data) => {
      const text =
        typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8");
      for (const l of senderMessage) l(text);
    },
    close: (code = 1000, reason = "") => {
      if (receiverReady === 3) return;
      receiverReady = 3;
      const reasonBuf = Buffer.from(reason);
      for (const l of receiverClose) l(code, reasonBuf);
      // Also propagate close to sender side (network layer mirror).
      for (const l of senderClose) l(code, reasonBuf);
    },
    on: (event: "message" | "close" | "error", listener: never) => {
      if (event === "message") receiverMessage.push(listener as Listener<[unknown, boolean]>);
      if (event === "close") receiverClose.push(listener as Listener<[number, Buffer]>);
      if (event === "error") receiverError.push(listener as Listener<[Error]>);
    },
  };

  return {
    senderSocket,
    receiverSocket,
    fireSenderOpen: () => {
      for (const l of senderOpen) l();
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

async function runReceiver(
  handler: RelayConnectionHandler,
  connectionId: string,
  socket: RelayCustomHandlerSocket,
): Promise<void> {
  await handler.handle({ socket, connectionId, logger: SILENT_LOGGER });
}

describe("redeemFriendPairOffer end-to-end through createFriendPairConnectionHandler", () => {
  test("happy path: candidate is parked on Alice's side and Bob gets candidate-received", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(makeOfferFixture(alice));

    const { senderSocket, receiverSocket, fireSenderOpen } = pairFakeSockets();
    await runReceiver(handler, `friend-pair:${pending.offer.nonceB64}`, receiverSocket);

    const promise = redeemFriendPairOffer({
      deepLinkOrOffer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
      createSocket: () => senderSocket,
    });
    fireSenderOpen();
    const outcome = await promise;

    expect(outcome.status).toBe("candidate-received");
    if (outcome.status !== "candidate-received") return;
    expect(outcome.candidate.displayName).toBe("Bob");
    expect(outcome.candidate.rootSignPublicKeyB64).toBe(bob.signPublicKeyB64);
    expect(outcome.localEphPrivateKeyB64).toHaveLength(43);
    expect(outcome.pendingApprovalSocket).toBe(senderSocket);

    const stored = pendingCandidates.get(pending.offer.nonceB64);
    expect(stored?.candidate.displayName).toBe("Bob");
  });

  test("offer-side: an expired offer fails with offer_expired before opening a socket", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const t0 = 1_700_000_000_000;
    const { pending } = pendingOffers.create({
      ...makeOfferFixture(alice),
      nowMs: t0,
      ttlMs: 1000,
    });

    const outcome = await redeemFriendPairOffer({
      deepLinkOrOffer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
      nowMs: t0 + 5000,
      // Should not reach socket factory; surface failure if it does.
      createSocket: () => {
        throw new Error("socket factory should not be called for an expired offer");
      },
    });

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.errorCode).toBe("offer_expired");
  });

  test("receiver-side rejection (replay against unknown offer) surfaces as no_offer", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    // Build offer in a different store so the receiver hasn't seen it.
    const otherStore = new FriendPairPendingStore();
    const { pending } = otherStore.create(makeOfferFixture(alice));

    const { senderSocket, receiverSocket, fireSenderOpen } = pairFakeSockets();
    await runReceiver(handler, `friend-pair:${pending.offer.nonceB64}`, receiverSocket);

    const promise = redeemFriendPairOffer({
      deepLinkOrOffer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
      createSocket: () => senderSocket,
    });
    fireSenderOpen();
    const outcome = await promise;

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.errorCode).toBe("no_offer");
    expect(outcome.errorMessage).toMatch(/expired|already been used/i);
  });

  test("self-pairing surfaces as self_pairing on the responder side too", async () => {
    const alice = mintRootKeys();
    const pendingOffers = new FriendPairPendingStore();
    const pendingCandidates = new FriendPairPendingCandidateStore();
    const handler = createFriendPairConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(makeOfferFixture(alice));

    const { senderSocket, receiverSocket, fireSenderOpen } = pairFakeSockets();
    await runReceiver(handler, `friend-pair:${pending.offer.nonceB64}`, receiverSocket);

    const promise = redeemFriendPairOffer({
      deepLinkOrOffer: pending.offer,
      selfRootSignPublicKeyB64: alice.signPublicKeyB64,
      selfRootSignPrivateKey: alice.signPrivateKey,
      selfDisplayName: "Alice",
      createSocket: () => senderSocket,
    });
    fireSenderOpen();
    const outcome = await promise;

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.errorCode).toBe("self_pairing");
  });
});
