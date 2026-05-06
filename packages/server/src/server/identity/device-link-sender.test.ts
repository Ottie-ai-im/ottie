import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";

import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import { approveDeviceLinkCandidate, rejectDeviceLinkCandidate } from "./device-link-approve.js";
import { DeviceLinkPendingCandidateStore } from "./device-link-pending-candidate-store.js";
import { DeviceLinkPendingStore } from "./device-link-pending-store.js";
import { createDeviceLinkConnectionHandler } from "./device-link-receiver.js";
import { redeemDeviceLinkOffer, type RedeemSocket } from "./device-link-sender.js";
import { encodeDeviceLinkOffer } from "./device-link-types.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

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
      createdAt: new Date(1_700_000_000_000).toISOString(),
    },
    signPublicKey: publicKey,
    signPrivateKey: privateKey,
  };
}

/**
 * Builds a sender ↔ receiver in-memory pair. The sender's `RedeemSocket`
 * (outbound) and the receiver's `RelayCustomHandlerSocket` (inbound) are
 * the two ends of the same fake "wire" — what the sender sends, the
 * receiver gets, and vice versa. Real crypto runs on both sides.
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

  const senderSocket: RedeemSocket = {
    send: (data) => {
      // Sender → receiver
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
      // Receiver → sender
      const text =
        typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8");
      for (const l of senderMessage) l(text);
    },
    close: (code = 1000, reason = "") => {
      if (receiverReady === 3) return;
      receiverReady = 3;
      // Closing the receiver also closes the sender's view of the socket.
      const reasonBuf = Buffer.from(reason);
      for (const l of receiverClose) l(code, reasonBuf);
      for (const l of senderClose) l(code, reasonBuf);
      senderReady = 3;
    },
    on(event: "message" | "close" | "error", listener: never) {
      if (event === "message") receiverMessage.push(listener as never);
      if (event === "close") receiverClose.push(listener as never);
      if (event === "error") receiverError.push(listener as never);
    },
  };

  return {
    senderSocket,
    receiverSocket,
    fireSenderOpen: () => {
      for (const l of senderOpen) l();
    },
    fireSenderError: (err: Error) => {
      for (const l of senderError) l(err);
    },
    closeFromReceiver: (code = 1000, reason = "") => {
      receiverSocket.close(code, reason);
    },
    senderClosedCode: () => (senderReady === 3 ? 3 : senderReady),
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

const OFFER_FIXTURE = {
  serverId: "srv_alice",
  rootSignPublicKeyB64: "x".repeat(43),
  displayName: "Alice",
  relayEndpoint: "relay.claws.company:443",
};

/**
 * Glue helper: bind a real receiver handler to the receiver end of the
 * fake wire so its `socket.on('message', …)` listener is registered
 * before the sender sends.
 */
async function attachReceiver(
  handler: RelayConnectionHandler,
  receiverSocket: RelayCustomHandlerSocket,
  connectionId: string,
): Promise<void> {
  await handler.handle({
    socket: receiverSocket,
    connectionId,
    logger: SILENT_LOGGER,
  });
}

describe("redeemDeviceLinkOffer (sender) — Phase 2.d/e end-to-end", () => {
  test("happy path: candidate sent → ack → user approves → sender returns linked", async () => {
    const aliceRoot = makeRootIdentity("Alice");
    const pendingOffers = new DeviceLinkPendingStore();
    const pendingCandidates = new DeviceLinkPendingCandidateStore();
    const handler = createDeviceLinkConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create({
      ...OFFER_FIXTURE,
      rootSignPublicKeyB64: aliceRoot.stored.signPublicKeyB64,
    });
    const deepLink = encodeDeviceLinkOffer(pending.offer);

    const wire = pairFakeSockets();
    await attachReceiver(handler, wire.receiverSocket, `device-link:${pending.offer.nonceB64}`);

    const promise = redeemDeviceLinkOffer({
      deepLinkOrOffer: deepLink,
      deviceLabel: "Bob's Phone",
      role: "client",
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderOpen();

    // Yield so the receiver can process the candidate frame and park it.
    await Promise.resolve();

    // Simulate the OLD device's user tapping "Approve":
    const stored = pendingCandidates.consume(pending.offer.nonceB64);
    expect(stored).not.toBeNull();
    if (!stored) return;
    const approval = approveDeviceLinkCandidate({
      candidate: stored.candidate,
      ephPrivateKeyB64: stored.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: stored.newDeviceEphPublicKeyB64,
      rootIdentity: aliceRoot,
      existingDevices: [],
    });
    // Use the parked socket (same as the wire's receiver end) to deliver
    // the encrypted reply — exactly what IdentityService.approveDeviceLink
    // does at runtime.
    stored.replySocket?.send(JSON.stringify(approval.envelope));
    stored.replySocket?.close(1000, "approved");

    const result = await promise;
    expect(result.status).toBe("linked");
    if (result.status !== "linked") return;

    expect(result.candidate.deviceLabel).toBe("Bob's Phone");
    expect(result.signedDevice.deviceId).toBe(result.candidate.deviceId);
    expect(result.signedDevice.signPublicKeyB64).toBe(result.localSecrets.signPublicKeyB64);
    expect(result.signedDevice.authorizationSignatureB64).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.rootIdentity.signPublicKeyB64).toBe(aliceRoot.stored.signPublicKeyB64);
    expect(result.rootIdentity.displayName).toBe("Alice");
    expect(result.peerDevices).toHaveLength(1);
    expect(result.peerDevices[0]?.deviceId).toBe(result.candidate.deviceId);
  });

  test("user rejects the candidate → sender returns rejected with user_rejected code", async () => {
    const pendingOffers = new DeviceLinkPendingStore();
    const pendingCandidates = new DeviceLinkPendingCandidateStore();
    const handler = createDeviceLinkConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(OFFER_FIXTURE);

    const wire = pairFakeSockets();
    await attachReceiver(handler, wire.receiverSocket, `device-link:${pending.offer.nonceB64}`);

    const promise = redeemDeviceLinkOffer({
      deepLinkOrOffer: pending.offer,
      deviceLabel: "Bob's Phone",
      role: "client",
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderOpen();
    await Promise.resolve();

    const stored = pendingCandidates.consume(pending.offer.nonceB64);
    if (!stored) throw new Error("expected candidate to be parked");
    const { envelope } = rejectDeviceLinkCandidate({
      ephPrivateKeyB64: stored.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: stored.newDeviceEphPublicKeyB64,
      rejectionReason: "not my device",
    });
    stored.replySocket?.send(JSON.stringify(envelope));
    stored.replySocket?.close(1000, "rejected");

    const result = await promise;
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errorCode).toBe("user_rejected");
    expect(result.errorMessage).toContain("not my device");
  });

  test("rejected by receiver: sender surfaces the error code with a friendly message", async () => {
    const pendingOffers = new DeviceLinkPendingStore();
    const pendingCandidates = new DeviceLinkPendingCandidateStore();
    const handler = createDeviceLinkConnectionHandler({ pendingOffers, pendingCandidates });

    // Build a sender redemption against an offer the receiver doesn't
    // know about — the receiver will respond with `no_offer`.
    const orphanOffer = new DeviceLinkPendingStore().create(OFFER_FIXTURE).pending.offer;

    const wire = pairFakeSockets();
    await attachReceiver(handler, wire.receiverSocket, `device-link:${orphanOffer.nonceB64}`);

    const promise = redeemDeviceLinkOffer({
      deepLinkOrOffer: orphanOffer,
      deviceLabel: "Bob's Phone",
      role: "client",
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderOpen();
    const result = await promise;

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errorCode).toBe("no_offer");
    expect(result.errorMessage).toMatch(/expired|already been used/i);
  });

  test("rejects an expired offer locally without opening a socket", async () => {
    const t0 = 1_700_000_000_000;
    const expiredOffer = new DeviceLinkPendingStore().create({
      ...OFFER_FIXTURE,
      nowMs: t0,
      ttlMs: 1000,
    }).pending.offer;

    let socketFactoryCalls = 0;
    const result = await redeemDeviceLinkOffer({
      deepLinkOrOffer: expiredOffer,
      deviceLabel: "doomed",
      role: "client",
      nowMs: t0 + 5000,
      createSocket: () => {
        socketFactoryCalls += 1;
        throw new Error("socket factory should not be called for expired offers");
      },
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errorCode).toBe("offer_expired");
    expect(socketFactoryCalls).toBe(0);
  });

  test("times out cleanly when the receiver never responds", async () => {
    const wire = pairFakeSockets();
    const offer = new DeviceLinkPendingStore().create(OFFER_FIXTURE).pending.offer;

    const promise = redeemDeviceLinkOffer({
      deepLinkOrOffer: offer,
      deviceLabel: "Bob's Phone",
      role: "client",
      timeoutMs: 50,
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderOpen();
    // Receiver never replies — let the sender timeout handler fire.
    const result = await promise;

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errorCode).toBe("timeout");
  });

  test("treats a socket-error before any response as 'socket_error'", async () => {
    const wire = pairFakeSockets();
    const offer = new DeviceLinkPendingStore().create(OFFER_FIXTURE).pending.offer;

    const promise = redeemDeviceLinkOffer({
      deepLinkOrOffer: offer,
      deviceLabel: "Bob's Phone",
      role: "client",
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderError(new Error("ECONNRESET"));
    const result = await promise;

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errorCode).toBe("socket_error");
    expect(result.errorMessage).toContain("ECONNRESET");
  });

  test("treats an early socket close as 'connection_closed'", async () => {
    const wire = pairFakeSockets();
    const offer = new DeviceLinkPendingStore().create(OFFER_FIXTURE).pending.offer;

    const promise = redeemDeviceLinkOffer({
      deepLinkOrOffer: offer,
      deviceLabel: "Bob's Phone",
      role: "client",
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderOpen();
    wire.closeFromReceiver(1011, "server gone");
    const result = await promise;

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errorCode).toBe("connection_closed");
    expect(result.errorMessage).toContain("server gone");
  });
});
