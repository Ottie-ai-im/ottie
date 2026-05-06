import { describe, expect, test } from "vitest";

import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import { DeviceLinkPendingCandidateStore } from "./device-link-pending-candidate-store.js";
import { DeviceLinkPendingStore } from "./device-link-pending-store.js";
import { createDeviceLinkConnectionHandler } from "./device-link-receiver.js";
import { buildDeviceLinkRedemption } from "./device-link-redeem.js";

/**
 * Drives the receiver handler end-to-end with a real candidate built by
 * `buildDeviceLinkRedemption`. The fake socket below is the smallest
 * interface the handler touches — same shape as the `ws` WebSocket that
 * relay-transport hands in at runtime.
 */
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

const OFFER_FIXTURE = {
  serverId: "srv_alice",
  rootSignPublicKeyB64: "x".repeat(43),
  displayName: "Alice",
  relayEndpoint: "relay.claws.company:443",
};

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

describe("createDeviceLinkConnectionHandler", () => {
  test("matches connectionIds with the device-link: prefix only", () => {
    const handler = createDeviceLinkConnectionHandler({
      pendingOffers: new DeviceLinkPendingStore(),
      pendingCandidates: new DeviceLinkPendingCandidateStore(),
    });
    expect(handler.matches("device-link:abc")).toBe(true);
    expect(handler.matches("clt_normal")).toBe(false);
    expect(handler.matches("device-something-else")).toBe(false);
  });

  test("happy path: real redemption is decrypted and parked as a pending candidate", async () => {
    const pendingOffers = new DeviceLinkPendingStore();
    const pendingCandidates = new DeviceLinkPendingCandidateStore();
    const handler = createDeviceLinkConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(OFFER_FIXTURE);
    const built = buildDeviceLinkRedemption({
      offer: pending.offer,
      deviceLabel: "Alice's Laptop B",
      role: "daemon",
    });

    const fake = makeFakeSocket();
    const connectionId = `device-link:${pending.offer.nonceB64}`;
    await runHandler(handler, connectionId, fake);

    fake.deliverMessage(JSON.stringify(built.redemption));

    const stored = pendingCandidates.get(pending.offer.nonceB64);
    expect(stored).not.toBeNull();
    expect(stored?.candidate.deviceLabel).toBe("Alice's Laptop B");
    expect(stored?.candidate.role).toBe("daemon");
    expect(stored?.newDeviceEphPublicKeyB64).toBe(built.redemption.newDeviceEphPublicKeyB64);
    expect(stored?.ephPrivateKeyB64).toBe(pending.ephPrivateKeyB64);

    // Sender gets an ack and the socket is closed cleanly.
    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "candidate-received" });
    expect(fake.closes[0]?.code).toBe(1000);

    // Single-use: the original pending offer is consumed.
    expect(pendingOffers.redeem(pending.offer.nonceB64)).toBeNull();
  });

  test("rejects an empty connectionId nonce", async () => {
    const handler = createDeviceLinkConnectionHandler({
      pendingOffers: new DeviceLinkPendingStore(),
      pendingCandidates: new DeviceLinkPendingCandidateStore(),
    });
    const fake = makeFakeSocket();
    await runHandler(handler, "device-link:", fake);
    expect(fake.closes[0]).toEqual({ code: 1008, reason: "missing_nonce" });
  });

  test("rejects an envelope whose nonce doesn't match the connectionId", async () => {
    const pendingOffers = new DeviceLinkPendingStore();
    const pendingCandidates = new DeviceLinkPendingCandidateStore();
    const handler = createDeviceLinkConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(OFFER_FIXTURE);
    const built = buildDeviceLinkRedemption({
      offer: pending.offer,
      deviceLabel: "Bob's Laptop",
      role: "daemon",
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "device-link:wrong-nonce", fake);
    fake.deliverMessage(JSON.stringify(built.redemption));

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "nonce_mismatch" });
    expect(fake.closes[0]?.code).toBe(1008);
    expect(pendingCandidates.list()).toHaveLength(0);
    // Original offer is NOT consumed because we rejected before redeeming.
    expect(pendingOffers.redeem(pending.offer.nonceB64)).not.toBeNull();
  });

  test("rejects a redemption whose offer doesn't exist (replay / stale offer)", async () => {
    const pendingOffers = new DeviceLinkPendingStore();
    const pendingCandidates = new DeviceLinkPendingCandidateStore();
    const handler = createDeviceLinkConnectionHandler({ pendingOffers, pendingCandidates });

    // Build a redemption for a DIFFERENT pending store so the offer never
    // landed on the receiving side — same effect as a replayed envelope
    // after an offer was canceled.
    const otherStore = new DeviceLinkPendingStore();
    const { pending } = otherStore.create(OFFER_FIXTURE);
    const built = buildDeviceLinkRedemption({
      offer: pending.offer,
      deviceLabel: "Whatever",
      role: "daemon",
    });

    const fake = makeFakeSocket();
    await runHandler(handler, `device-link:${pending.offer.nonceB64}`, fake);
    fake.deliverMessage(JSON.stringify(built.redemption));

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "no_offer" });
    expect(fake.closes[0]?.code).toBe(1008);
    expect(pendingCandidates.list()).toHaveLength(0);
  });

  test("rejects an unparseable JSON frame", async () => {
    const pendingOffers = new DeviceLinkPendingStore();
    const pendingCandidates = new DeviceLinkPendingCandidateStore();
    const handler = createDeviceLinkConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(OFFER_FIXTURE);
    const fake = makeFakeSocket();
    await runHandler(handler, `device-link:${pending.offer.nonceB64}`, fake);
    fake.deliverMessage("not valid json {{{{{");

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "bad_json" });
    expect(fake.closes[0]?.code).toBe(1003);
    // Offer still intact for a retry.
    expect(pendingOffers.redeem(pending.offer.nonceB64)).not.toBeNull();
  });

  test("rejects an oversized frame to defend against memory abuse", async () => {
    const pendingOffers = new DeviceLinkPendingStore();
    const pendingCandidates = new DeviceLinkPendingCandidateStore();
    const handler = createDeviceLinkConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(OFFER_FIXTURE);
    const fake = makeFakeSocket();
    await runHandler(handler, `device-link:${pending.offer.nonceB64}`, fake);

    const huge = "x".repeat(64 * 1024 + 1);
    fake.deliverMessage(huge);

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({ type: "error", code: "too_large" });
    expect(fake.closes[0]?.code).toBe(1009);
  });

  test("rejects a tampered ciphertext (decryption fails)", async () => {
    const pendingOffers = new DeviceLinkPendingStore();
    const pendingCandidates = new DeviceLinkPendingCandidateStore();
    const handler = createDeviceLinkConnectionHandler({ pendingOffers, pendingCandidates });

    const { pending } = pendingOffers.create(OFFER_FIXTURE);
    const built = buildDeviceLinkRedemption({
      offer: pending.offer,
      deviceLabel: "Tampered",
      role: "daemon",
    });

    const original = built.redemption.ciphertextB64;
    const tampered = `${original.slice(0, -5)}AAAAA`;
    const tamperedRedemption = { ...built.redemption, ciphertextB64: tampered };

    const fake = makeFakeSocket();
    await runHandler(handler, `device-link:${pending.offer.nonceB64}`, fake);
    fake.deliverMessage(JSON.stringify(tamperedRedemption));

    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({
      type: "error",
      code: "decrypt_failed",
    });
    expect(fake.closes[0]?.code).toBe(1008);
    expect(pendingCandidates.list()).toHaveLength(0);
    // Offer was already redeemed and consumed before the decrypt step,
    // so a second attempt would fail on "no_offer". This is the
    // intentional single-use semantics.
    expect(pendingOffers.redeem(pending.offer.nonceB64)).toBeNull();
  });
});
