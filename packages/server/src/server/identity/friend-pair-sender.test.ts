import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, test } from "vitest";

import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import { approveFriendPairCandidate, rejectFriendPairCandidate } from "./friend-pair-approve.js";
import { FriendPairPendingCandidateStore } from "./friend-pair-pending-candidate-store.js";
import { FriendPairPendingStore } from "./friend-pair-pending-store.js";
import { createFriendPairConnectionHandler } from "./friend-pair-receiver.js";
import { redeemFriendPairOffer, type FriendPairRedeemSocket } from "./friend-pair-sender.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

interface RootKeys {
  signPublicKeyB64: string;
  signPrivateKey: KeyObject;
}

function mintRootKeys(): RootKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  return { signPublicKeyB64: jwkPub.x, signPrivateKey: privateKey };
}

function makeRootIdentity(displayName: string): RootIdentityBundle {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  const jwkPriv = privateKey.export({ format: "jwk" }) as { d: string };
  return {
    stored: {
      v: 1,
      signPublicKeyB64: jwkPub.x,
      signPrivateKeyB64: jwkPriv.d,
      displayName,
      createdAt: "2026-05-05T12:00:00.000Z",
    },
    signPublicKey: publicKey,
    signPrivateKey: privateKey,
  };
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

function makeOfferFixture(alice: RootIdentityBundle | RootKeys) {
  const pubKey = "stored" in alice ? alice.stored.signPublicKeyB64 : alice.signPublicKeyB64;
  const displayName = "stored" in alice ? alice.stored.displayName : "Alice";
  return {
    serverId: "srv_alice",
    rootSignPublicKeyB64: pubKey,
    displayName,
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

describe("redeemFriendPairOffer end-to-end through the approve flow", () => {
  test("happy path: paired with Alice, peer record carries her signed authorization", async () => {
    const alice = makeRootIdentity("Alice");
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

    // Simulate Alice tapping Approve. We pull the parked candidate
    // record, sign+encrypt the approval reply, and write it back over
    // the same socket — the same path IdentityService.approveFriendPair
    // will follow once it's wired up in 3.a/3b.
    await new Promise((r) => setImmediate(r));
    const parked = pendingCandidates.consume(pending.offer.nonceB64);
    if (!parked) throw new Error("expected candidate to be parked after ack");
    const approval = approveFriendPairCandidate({
      candidate: parked.candidate,
      offer: parked.offer,
      ephPrivateKeyB64: parked.ephPrivateKeyB64,
      candidateEphPublicKeyB64: parked.candidateEphPublicKeyB64,
      rootIdentity: alice,
    });
    receiverSocket.send(JSON.stringify(approval.envelope));

    const outcome = await promise;
    expect(outcome.status).toBe("paired");
    if (outcome.status !== "paired") return;
    expect(outcome.peer.peerRootSignPublicKeyB64).toBe(alice.stored.signPublicKeyB64);
    expect(outcome.peer.peerDisplayName).toBe("Alice");
    expect(outcome.peer.status).toBe("active");
    expect(outcome.peer.pairingNonceB64).toBe(pending.offer.nonceB64);
    expect(outcome.peer.authorizationSignatureB64).toBe(
      approval.reply.status === "approved" ? approval.reply.authorizationSignatureB64 : "",
    );
  });

  test("user_rejected: Alice declines, Bob settles with errorCode=user_rejected", async () => {
    const alice = makeRootIdentity("Alice");
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

    await new Promise((r) => setImmediate(r));
    const parked = pendingCandidates.consume(pending.offer.nonceB64);
    if (!parked) throw new Error("expected candidate to be parked after ack");
    const rejection = rejectFriendPairCandidate({
      ephPrivateKeyB64: parked.ephPrivateKeyB64,
      candidateEphPublicKeyB64: parked.candidateEphPublicKeyB64,
      rejectionReason: "I don't recognize this person",
    });
    receiverSocket.send(JSON.stringify(rejection.envelope));

    const outcome = await promise;
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.errorCode).toBe("user_rejected");
    expect(outcome.errorMessage).toBe("I don't recognize this person");
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
