import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import { IdentityService } from "./identity-service.js";
import type { RedeemSocket } from "./device-link-sender.js";

/**
 * Integration test: drives the full Phase 2.d/2.e cycle through two real
 * `IdentityService` instances against fake-but-faithful sockets. This is
 * the closest we can get to a real two-daemon test without booting actual
 * processes + a real Cloudflare relay.
 *
 * What's REAL here:
 *   - Both IdentityServices write to / read from real $OTTIE_HOME tmpdirs.
 *   - Real Ed25519 root keypair (Alice creates her identity normally).
 *   - Real X25519 ECDH + NaCl box for the candidate envelope.
 *   - Real Ed25519 sign of the new device's authorization signature.
 *   - Real X25519 ECDH + NaCl box for the approval reply (same shared key).
 *   - Real adopt-from-link writes root.json + self-device.json + devices.json.
 *
 * What's FAKE:
 *   - Sender ↔ receiver socket pair is in-memory; no Cloudflare relay.
 *   - The receiver handler is wired up directly to the test wire, not to
 *     a real relay-transport dispatcher.
 *
 * Coverage map vs. user's manual test plan:
 *   - 1.1 happy path           → "happy path: two daemons fully linked"
 *   - 1.2 B reboot persistence → "second IdentityService instance picks
 *                                  up adopted identity"
 *   - 2.1 user rejects         → "rejected by Alice"
 *   - 3.1 replay link          → "second redemption against same offer"
 *   - 5.2 B drops mid-handshake → "new device disconnects before approve"
 */

const SILENT_LOGGER = pino({ level: "silent" });

let aliceHome: string;
let bobHome: string;

beforeEach(() => {
  aliceHome = mkdtempSync(path.join(os.tmpdir(), "ottie-e2e-alice-"));
  bobHome = mkdtempSync(path.join(os.tmpdir(), "ottie-e2e-bob-"));
});

afterEach(() => {
  rmSync(aliceHome, { recursive: true, force: true });
  rmSync(bobHome, { recursive: true, force: true });
});

/**
 * In-memory bidirectional wire between sender (Bob's redeem socket) and
 * receiver (Alice's RelayConnectionHandler socket). Whatever sender
 * writes lands on receiver's listener, and vice versa. Closing either
 * end terminates both.
 */
function makeWire() {
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
      // Match real `ws` semantics: send-after-close throws synchronously.
      // Without this, the disconnect test below fails to exercise the
      // "approver tries to write to a dead socket" path.
      if (senderReady === 3) {
        throw new Error("WebSocket is not open");
      }
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
      if (receiverReady === 3) {
        throw new Error("WebSocket is not open");
      }
      const text =
        typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8");
      for (const l of senderMessage) l(text);
    },
    close: (code = 1000, reason = "") => {
      if (receiverReady === 3) return;
      receiverReady = 3;
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
    closeReceiverSocket: () => {
      receiverSocket.close(1000, "test_close");
    },
  };
}

async function attachReceiverHandler(
  handler: RelayConnectionHandler,
  socket: RelayCustomHandlerSocket,
  connectionId: string,
): Promise<void> {
  await handler.handle({ socket, connectionId, logger: SILENT_LOGGER });
}

describe("Phase 2.d/2.e end-to-end — two IdentityService instances", () => {
  test("happy path: two daemons fully linked, Bob persists identity to disk", async () => {
    // === Alice: existing user, has identity, generates an offer ===
    const alice = new IdentityService({
      ottieHome: aliceHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice", deviceLabel: "Alice's Mac" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");

    const offerResult = alice.generateDeviceLinkOffer();
    expect(offerResult).not.toBeNull();
    if (!offerResult) return;
    const deepLink = offerResult.deepLink;

    // === Bob: fresh install, daemon up but no identity ===
    const bob = new IdentityService({
      ottieHome: bobHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_bob", deviceLabel: "Bob's Laptop" },
      relayEndpoint: "test.local:443",
    });
    expect(bob.getState().kind).toBe("uninitialized");

    // === Wire the relay (in-memory pair) ===
    const wire = makeWire();
    const aliceHandler = alice.createDeviceLinkConnectionHandler();
    await attachReceiverHandler(
      aliceHandler,
      wire.receiverSocket,
      `device-link:${offerResult.pending.offer.nonceB64}`,
    );

    // === Bob redeems through the wire ===
    const redeemPromise = bob.redeemDeviceLinkOffer({
      deepLinkOrOffer: deepLink,
      deviceLabel: "Bob's Laptop",
      role: "daemon",
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderOpen();

    // === Yield so Alice's receiver records the candidate ===
    await Promise.resolve();
    const pendings = alice.listPendingDeviceLinkCandidates();
    expect(pendings).toHaveLength(1);
    expect(pendings[0]?.deviceLabel).toBe("Bob's Laptop");

    // === Alice's user taps Approve ===
    const approveResult = alice.approveDeviceLink(pendings[0]!.nonceB64);
    expect(approveResult.approved).toBe(true);
    expect(approveResult.error).toBeNull();
    expect(approveResult.devices).toHaveLength(2); // Alice's Mac + Bob's Laptop

    // === Bob's redeem promise resolves ===
    const outcome = await redeemPromise;
    expect(outcome.status).toBe("linked");
    if (outcome.status !== "linked") return;
    expect(outcome.signedDevice.deviceLabel).toBe("Bob's Laptop");
    expect(outcome.rootIdentity.displayName).toBe("Alice");
    expect(outcome.peerDevices).toHaveLength(2);

    // === Bob's daemon should have written 3 files to disk ===
    expect(existsSync(path.join(bobHome, "identity", "root.json"))).toBe(true);
    expect(existsSync(path.join(bobHome, "identity", "self-device.json"))).toBe(true);
    expect(existsSync(path.join(bobHome, "identity", "devices.json"))).toBe(true);

    // === Bob's in-memory state is now "loaded" ===
    expect(bob.getState().kind).toBe("loaded");
    expect(bob.requireBundle().stored.displayName).toBe("Alice");
    expect(bob.getDeviceList()).toHaveLength(2);
  });

  test("Bob reboot: a fresh IdentityService on the same home picks the adopted identity up", async () => {
    // Run the happy path
    const alice = new IdentityService({
      ottieHome: aliceHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice", deviceLabel: "Alice's Mac" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");
    const offerResult = alice.generateDeviceLinkOffer();
    if (!offerResult) throw new Error("Offer should be created");

    const bob = new IdentityService({
      ottieHome: bobHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_bob", deviceLabel: "Bob's Laptop" },
      relayEndpoint: "test.local:443",
    });

    const wire = makeWire();
    await attachReceiverHandler(
      alice.createDeviceLinkConnectionHandler(),
      wire.receiverSocket,
      `device-link:${offerResult.pending.offer.nonceB64}`,
    );
    const redeemPromise = bob.redeemDeviceLinkOffer({
      deepLinkOrOffer: offerResult.deepLink,
      deviceLabel: "Bob's Laptop",
      role: "daemon",
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderOpen();
    await Promise.resolve();
    alice.approveDeviceLink(alice.listPendingDeviceLinkCandidates()[0]!.nonceB64);
    await redeemPromise;

    // === SIMULATE REBOOT: throw away Bob's IdentityService, load fresh from disk ===
    const bobAfterReboot = new IdentityService({
      ottieHome: bobHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_bob", deviceLabel: "Bob's Laptop" },
      relayEndpoint: "test.local:443",
    });
    expect(bobAfterReboot.getState().kind).toBe("loaded");
    expect(bobAfterReboot.requireBundle().stored.displayName).toBe("Alice");
    expect(bobAfterReboot.getDeviceList()).toHaveLength(2);
  });

  test("Alice rejects: Bob's redeem returns user_rejected, Bob stays uninitialized", async () => {
    const alice = new IdentityService({
      ottieHome: aliceHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice", deviceLabel: "Alice's Mac" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");
    const offer = alice.generateDeviceLinkOffer();
    if (!offer) throw new Error("offer expected");

    const bob = new IdentityService({
      ottieHome: bobHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_bob", deviceLabel: "Bob's Laptop" },
      relayEndpoint: "test.local:443",
    });

    const wire = makeWire();
    await attachReceiverHandler(
      alice.createDeviceLinkConnectionHandler(),
      wire.receiverSocket,
      `device-link:${offer.pending.offer.nonceB64}`,
    );
    const redeemPromise = bob.redeemDeviceLinkOffer({
      deepLinkOrOffer: offer.deepLink,
      deviceLabel: "Bob's Laptop",
      role: "daemon",
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderOpen();
    await Promise.resolve();

    // Alice rejects instead of approving.
    const rejectResult = alice.rejectDeviceLink(
      alice.listPendingDeviceLinkCandidates()[0]!.nonceB64,
      "not the device I expected",
    );
    expect(rejectResult.rejected).toBe(true);

    const outcome = await redeemPromise;
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.errorCode).toBe("user_rejected");
    expect(outcome.errorMessage).toContain("not the device I expected");

    // Bob's home should be untouched.
    expect(existsSync(path.join(bobHome, "identity", "root.json"))).toBe(false);
    expect(bob.getState().kind).toBe("uninitialized");

    // Alice's device list should NOT have grown.
    expect(alice.getDeviceList()).toHaveLength(1);
  });

  test("replay attack: re-using a redeemed offer is rejected with no_offer", async () => {
    const alice = new IdentityService({
      ottieHome: aliceHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice", deviceLabel: "Alice's Mac" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");
    const offer = alice.generateDeviceLinkOffer();
    if (!offer) throw new Error("offer expected");
    const deepLink = offer.deepLink;

    // First redemption succeeds.
    const bob = new IdentityService({
      ottieHome: bobHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_bob", deviceLabel: "Bob's Laptop" },
      relayEndpoint: "test.local:443",
    });
    const wire1 = makeWire();
    await attachReceiverHandler(
      alice.createDeviceLinkConnectionHandler(),
      wire1.receiverSocket,
      `device-link:${offer.pending.offer.nonceB64}`,
    );
    const firstRedeem = bob.redeemDeviceLinkOffer({
      deepLinkOrOffer: deepLink,
      deviceLabel: "Bob's Laptop",
      role: "daemon",
      createSocket: () => wire1.senderSocket,
    });
    wire1.fireSenderOpen();
    await Promise.resolve();
    alice.approveDeviceLink(alice.listPendingDeviceLinkCandidates()[0]!.nonceB64);
    expect((await firstRedeem).status).toBe("linked");

    // Second redemption with the SAME deep-link should be rejected.
    // We need a fresh IdentityService for the second attempt because
    // adoptIdentityFromLink refuses to overwrite an already-loaded
    // identity. Use a fresh tmpdir for "Bob 2".
    const bob2Home = mkdtempSync(path.join(os.tmpdir(), "ottie-e2e-bob2-"));
    try {
      const bob2 = new IdentityService({
        ottieHome: bob2Home,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_bob2", deviceLabel: "Bob's Other Laptop" },
        relayEndpoint: "test.local:443",
      });
      const wire2 = makeWire();
      await attachReceiverHandler(
        alice.createDeviceLinkConnectionHandler(),
        wire2.receiverSocket,
        `device-link:${offer.pending.offer.nonceB64}`,
      );
      const secondRedeem = bob2.redeemDeviceLinkOffer({
        deepLinkOrOffer: deepLink,
        deviceLabel: "Bob's Other Laptop",
        role: "daemon",
        createSocket: () => wire2.senderSocket,
      });
      wire2.fireSenderOpen();
      const outcome = await secondRedeem;

      expect(outcome.status).toBe("rejected");
      if (outcome.status !== "rejected") return;
      expect(outcome.errorCode).toBe("no_offer");
    } finally {
      rmSync(bob2Home, { recursive: true, force: true });
    }
  });

  test("Bob disconnects before Alice approves: Alice's local state is consistent", async () => {
    const alice = new IdentityService({
      ottieHome: aliceHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice", deviceLabel: "Alice's Mac" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");
    const offer = alice.generateDeviceLinkOffer();
    if (!offer) throw new Error("offer expected");

    const bob = new IdentityService({
      ottieHome: bobHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_bob", deviceLabel: "Bob's Laptop" },
      relayEndpoint: "test.local:443",
    });
    const wire = makeWire();
    await attachReceiverHandler(
      alice.createDeviceLinkConnectionHandler(),
      wire.receiverSocket,
      `device-link:${offer.pending.offer.nonceB64}`,
    );
    const redeemPromise = bob.redeemDeviceLinkOffer({
      deepLinkOrOffer: offer.deepLink,
      deviceLabel: "Bob's Laptop",
      role: "daemon",
      createSocket: () => wire.senderSocket,
    });
    wire.fireSenderOpen();
    await Promise.resolve();

    // Bob disconnects before Alice taps approve.
    wire.closeReceiverSocket();
    const outcome = await redeemPromise;
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.errorCode).toBe("connection_closed");

    // Alice still sees the candidate; her local devices.json hasn't grown.
    expect(alice.listPendingDeviceLinkCandidates()).toHaveLength(1);
    expect(alice.getDeviceList()).toHaveLength(1);

    // If Alice now taps approve, the daemon notes the new device offline
    // but still saves the signed record (Phase 2.f peer-sync will reconcile).
    const approveResult = alice.approveDeviceLink(
      alice.listPendingDeviceLinkCandidates()[0]!.nonceB64,
    );
    expect(approveResult.approved).toBe(true);
    expect(approveResult.error).toMatch(/offline|tell them to scan again/i);
    expect(alice.getDeviceList()).toHaveLength(2);
  });
});
