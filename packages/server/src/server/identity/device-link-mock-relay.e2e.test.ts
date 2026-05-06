import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { startRelayTransport, type RelayTransportController } from "../relay-transport.js";
import { IdentityService } from "./identity-service.js";
import { MockRelay } from "./test-utils/mock-relay.js";

/**
 * Mock-relay end-to-end: drives the full Phase 2.d/2.e cycle through
 * REAL WebSockets bridged by an in-process mock Cloudflare relay
 * (test-utils/mock-relay.ts). Compared to device-link-end-to-end.test.ts
 * (which short-circuits the wire to a fake socket), this test exercises:
 *
 *   - Real `ws` library send/recv (text + binary frame timing)
 *   - relay-transport.ts control-socket lifecycle ('connected' →
 *     ensureClientDataSocket → custom handler dispatch)
 *   - The actual default `WebSocket` factory inside device-link-sender.ts
 *   - End-to-end timing: Bob's first frame arrives BEFORE Alice's data
 *     socket opens (mock relay buffers + replays)
 *
 * What's still NOT real: the relay itself (mock instead of Cloudflare
 * Workers). That layer is exercised by the existing wrangler-based
 * relay-transport.e2e.test.ts and isn't needed to validate the Phase 2
 * device-link routing on top.
 */

const SILENT_LOGGER = pino({ level: process.env.E2E_DEBUG === "1" ? "debug" : "silent" });
const E2E_TIMEOUT_MS = 20_000;

let aliceHome: string;
let bobHome: string;
let mockRelay: MockRelay;
let aliceTransport: RelayTransportController | null = null;

beforeEach(async () => {
  aliceHome = mkdtempSync(path.join(os.tmpdir(), "ottie-mockrelay-alice-"));
  bobHome = mkdtempSync(path.join(os.tmpdir(), "ottie-mockrelay-bob-"));
  mockRelay = new MockRelay();
  await mockRelay.start();
});

afterEach(async () => {
  if (aliceTransport) {
    await aliceTransport.stop();
    aliceTransport = null;
  }
  await mockRelay.stop();
  rmSync(aliceHome, { recursive: true, force: true });
  rmSync(bobHome, { recursive: true, force: true });
});

/** Wait until cb returns truthy or the deadline expires. */
async function waitFor<T>(
  cb: () => T | undefined | null | false,
  args: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const deadline = Date.now() + (args.timeoutMs ?? E2E_TIMEOUT_MS);
  const interval = args.intervalMs ?? 30;
  while (Date.now() < deadline) {
    const result = cb();
    if (result) return result as T;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for: ${args.label ?? "condition"}`);
}

describe("Phase 2.d/2.e mock-relay e2e (real WebSockets)", () => {
  test(
    "happy path: Bob → mock relay → Alice → user approves → Bob persists identity",
    async () => {
      const relayEndpoint = mockRelay.endpoint();

      // === Alice (existing user) ===
      const alice = new IdentityService({
        ottieHome: aliceHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_alice_e2e", deviceLabel: "Alice's Mac" },
        relayEndpoint,
      });
      alice.initialize("Alice");

      // Start a real relay-transport against the mock relay. This is
      // the same code that runs in the daemon at boot.
      aliceTransport = startRelayTransport({
        logger: SILENT_LOGGER,
        attachSocket: async () => {
          // No agent traffic in this test. The default attach won't fire
          // because all incoming connectionIds are device-link prefixed.
        },
        relayEndpoint,
        serverId: "srv_alice_e2e",
        connectionHandlers: [alice.createDeviceLinkConnectionHandler()],
      });

      // === Generate offer (deep-link gets relayEndpoint baked in) ===
      const offer = alice.generateDeviceLinkOffer();
      expect(offer).not.toBeNull();
      if (!offer) return;

      // === Bob (fresh install) ===
      const bob = new IdentityService({
        ottieHome: bobHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_bob_e2e", deviceLabel: "Bob's Laptop" },
        relayEndpoint,
      });
      expect(bob.getState().kind).toBe("uninitialized");

      // === Bob redeems — uses the DEFAULT ws WebSocket factory, dialing
      //     the mock relay over a real loopback TCP socket. ===
      const redeemPromise = bob.redeemDeviceLinkOffer({
        deepLinkOrOffer: offer.deepLink,
        deviceLabel: "Bob's Laptop",
        role: "daemon",
        timeoutMs: 10_000,
      });

      // === Wait for Alice's receiver to record the candidate ===
      const candidate = await waitFor(() => alice.listPendingDeviceLinkCandidates()[0], {
        label: "Alice receives candidate",
      });
      expect(candidate.deviceLabel).toBe("Bob's Laptop");
      expect(candidate.role).toBe("daemon");

      // === Alice approves ===
      const approveResult = alice.approveDeviceLink(candidate.nonceB64);
      expect(approveResult.approved).toBe(true);
      expect(approveResult.error).toBeNull();
      expect(approveResult.devices).toHaveLength(2);

      // === Bob's redeem promise resolves with linked outcome ===
      const outcome = await redeemPromise;
      expect(outcome.status).toBe("linked");
      if (outcome.status !== "linked") return;
      expect(outcome.signedDevice.deviceLabel).toBe("Bob's Laptop");
      expect(outcome.rootIdentity.displayName).toBe("Alice");

      // === Bob's daemon persisted everything to disk ===
      expect(existsSync(path.join(bobHome, "identity", "root.json"))).toBe(true);
      expect(existsSync(path.join(bobHome, "identity", "self-device.json"))).toBe(true);
      expect(existsSync(path.join(bobHome, "identity", "devices.json"))).toBe(true);
      expect(bob.getState().kind).toBe("loaded");
      expect(bob.requireBundle().stored.displayName).toBe("Alice");
      expect(bob.getDeviceList()).toHaveLength(2);

      // === A fresh IdentityService on Bob's home reloads the identity ===
      const bobAfterReboot = new IdentityService({
        ottieHome: bobHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_bob_e2e", deviceLabel: "Bob's Laptop" },
        relayEndpoint,
      });
      expect(bobAfterReboot.getState().kind).toBe("loaded");
      expect(bobAfterReboot.getDeviceList()).toHaveLength(2);
    },
    E2E_TIMEOUT_MS,
  );

  test(
    "Alice rejects: Bob receives user_rejected over real wire",
    async () => {
      const relayEndpoint = mockRelay.endpoint();

      const alice = new IdentityService({
        ottieHome: aliceHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_alice_e2e_reject", deviceLabel: "Alice's Mac" },
        relayEndpoint,
      });
      alice.initialize("Alice");

      aliceTransport = startRelayTransport({
        logger: SILENT_LOGGER,
        attachSocket: async () => {},
        relayEndpoint,
        serverId: "srv_alice_e2e_reject",
        connectionHandlers: [alice.createDeviceLinkConnectionHandler()],
      });

      const offer = alice.generateDeviceLinkOffer();
      if (!offer) throw new Error("offer expected");

      const bob = new IdentityService({
        ottieHome: bobHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_bob_e2e_reject", deviceLabel: "Bob's Laptop" },
        relayEndpoint,
      });

      const redeemPromise = bob.redeemDeviceLinkOffer({
        deepLinkOrOffer: offer.deepLink,
        deviceLabel: "Bob's Laptop",
        role: "daemon",
        timeoutMs: 10_000,
      });

      const candidate = await waitFor(() => alice.listPendingDeviceLinkCandidates()[0], {
        label: "Alice receives candidate",
      });
      const result = alice.rejectDeviceLink(candidate.nonceB64, "wrong device");
      expect(result.rejected).toBe(true);

      const outcome = await redeemPromise;
      expect(outcome.status).toBe("rejected");
      if (outcome.status !== "rejected") return;
      expect(outcome.errorCode).toBe("user_rejected");
      expect(outcome.errorMessage).toContain("wrong device");

      // Bob's home should be untouched, Alice's device count unchanged.
      expect(existsSync(path.join(bobHome, "identity", "root.json"))).toBe(false);
      expect(alice.getDeviceList()).toHaveLength(1);
    },
    E2E_TIMEOUT_MS,
  );

  test(
    "replay: re-using a redeemed deep-link is rejected with no_offer",
    async () => {
      const relayEndpoint = mockRelay.endpoint();

      const alice = new IdentityService({
        ottieHome: aliceHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_alice_e2e_replay", deviceLabel: "Alice's Mac" },
        relayEndpoint,
      });
      alice.initialize("Alice");

      aliceTransport = startRelayTransport({
        logger: SILENT_LOGGER,
        attachSocket: async () => {},
        relayEndpoint,
        serverId: "srv_alice_e2e_replay",
        connectionHandlers: [alice.createDeviceLinkConnectionHandler()],
      });

      const offer = alice.generateDeviceLinkOffer();
      if (!offer) throw new Error("offer expected");
      const deepLink = offer.deepLink;

      // First redemption succeeds.
      const bob1 = new IdentityService({
        ottieHome: bobHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_bob1_replay", deviceLabel: "Bob's Laptop" },
        relayEndpoint,
      });
      const firstRedeem = bob1.redeemDeviceLinkOffer({
        deepLinkOrOffer: deepLink,
        deviceLabel: "Bob's Laptop",
        role: "daemon",
        timeoutMs: 10_000,
      });
      const cand = await waitFor(() => alice.listPendingDeviceLinkCandidates()[0], {
        label: "first candidate",
      });
      alice.approveDeviceLink(cand.nonceB64);
      expect((await firstRedeem).status).toBe("linked");

      // Let Alice's relay-transport finish cleaning up the just-closed
      // data socket before the replay attempt — `dataSockets` map only
      // drops the entry on the WebSocket 'close' event, which fires on
      // the next tick. In production this latency is invisible because
      // a real attacker replaying a redeemed link would be milliseconds
      // to seconds later, not microseconds.
      await new Promise((r) => setTimeout(r, 100));

      // Second redemption with the same deep-link, fresh Bob.
      const bob2Home = mkdtempSync(path.join(os.tmpdir(), "ottie-mockrelay-bob2-"));
      try {
        const bob2 = new IdentityService({
          ottieHome: bob2Home,
          logger: SILENT_LOGGER,
          selfDeviceContext: { serverId: "srv_bob2_replay", deviceLabel: "Bob's Other" },
          relayEndpoint,
        });
        const outcome = await bob2.redeemDeviceLinkOffer({
          deepLinkOrOffer: deepLink,
          deviceLabel: "Bob's Other",
          role: "daemon",
          timeoutMs: 10_000,
        });
        expect(outcome.status).toBe("rejected");
        if (outcome.status !== "rejected") return;
        expect(outcome.errorCode).toBe("no_offer");
      } finally {
        rmSync(bob2Home, { recursive: true, force: true });
      }
    },
    E2E_TIMEOUT_MS,
  );
});
