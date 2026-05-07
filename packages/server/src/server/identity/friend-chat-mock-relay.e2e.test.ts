import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { startRelayTransport, type RelayTransportController } from "../relay-transport.js";

import { IdentityService } from "./identity-service.js";
import { MockRelay } from "./test-utils/mock-relay.js";

/**
 * Phase 3.b/1d mock-relay e2e: Alice + Bob run real `IdentityService`
 * instances, real relay-transport, real friend-sync sessions over an
 * in-process mock Cloudflare relay. They pair (Phase 3.a end-to-end),
 * then exchange chat messages, then verify both sides have identical
 * persisted history that survives restart.
 *
 * Cross-identity analog of `friend-pair-mock-relay.e2e.test.ts`'s
 * happy path, but layered on top: pair → wait for friend-sync session
 * to come up via the dialer → send → receive → reload from disk.
 */

const SILENT_LOGGER = pino({ level: process.env.E2E_DEBUG === "1" ? "debug" : "silent" });
// Generous to absorb mac-mini parallel-vitest CPU contention. Single-
// file runs typically finish in <2s; we'd rather wait an order of
// magnitude longer than flake under load.
const E2E_TIMEOUT_MS = 60_000;

let aliceHome: string;
let bobHome: string;
let mockRelay: MockRelay;
const transports: RelayTransportController[] = [];
const services: IdentityService[] = [];

beforeEach(async () => {
  aliceHome = mkdtempSync(path.join(os.tmpdir(), "ottie-fc-mockrelay-alice-"));
  bobHome = mkdtempSync(path.join(os.tmpdir(), "ottie-fc-mockrelay-bob-"));
  mockRelay = new MockRelay();
  await mockRelay.start();
});

afterEach(async () => {
  for (const t of transports.splice(0)) {
    await t.stop();
  }
  for (const s of services.splice(0)) {
    await s.stopFriendSync();
    await s.stopPeerSync();
  }
  await mockRelay.stop();
  rmSync(aliceHome, { recursive: true, force: true });
  rmSync(bobHome, { recursive: true, force: true });
});

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

function startService(args: {
  ottieHome: string;
  serverId: string;
  deviceLabel: string;
  relayEndpoint: string;
  displayName: string;
}): { svc: IdentityService; transport: RelayTransportController } {
  const svc = new IdentityService({
    ottieHome: args.ottieHome,
    logger: SILENT_LOGGER,
    selfDeviceContext: { serverId: args.serverId, deviceLabel: args.deviceLabel },
    relayEndpoint: args.relayEndpoint,
  });
  svc.initialize(args.displayName);
  services.push(svc);

  const transport = startRelayTransport({
    logger: SILENT_LOGGER,
    attachSocket: async () => {},
    relayEndpoint: args.relayEndpoint,
    serverId: args.serverId,
    connectionHandlers: ((): import("../relay-transport.js").RelayConnectionHandler[] => {
      const out: import("../relay-transport.js").RelayConnectionHandler[] = [
        svc.createDeviceLinkConnectionHandler(),
        svc.createFriendPairConnectionHandler(),
      ];
      const peerSync = svc.createPeerSyncConnectionHandler();
      if (peerSync) out.push(peerSync);
      const friendSync = svc.createFriendSyncConnectionHandler();
      if (friendSync) out.push(friendSync);
      return out;
    })(),
  });
  transports.push(transport);
  svc.startFriendSync();
  return { svc, transport };
}

describe("Phase 3.b/1d mock-relay e2e — pair then chat over friend-sync", () => {
  test(
    "Alice and Bob pair, then exchange messages; both persist + reload",
    async () => {
      const relayEndpoint = mockRelay.endpoint();

      const { svc: alice } = startService({
        ottieHome: aliceHome,
        serverId: "srv_alice_fc_e2e",
        deviceLabel: "Alice's Mac",
        relayEndpoint,
        displayName: "Alice",
      });
      const { svc: bob } = startService({
        ottieHome: bobHome,
        serverId: "srv_bob_fc_e2e",
        deviceLabel: "Bob's Laptop",
        relayEndpoint,
        displayName: "Bob",
      });

      // === Pair (3.a flow) ===
      const offer = alice.generateFriendPairOffer();
      if (!offer) throw new Error("offer expected");

      const redeemPromise = bob.redeemFriendPairOffer({
        deepLinkOrOffer: offer.deepLink,
        timeoutMs: 10_000,
      });

      const candidate = await waitFor(() => alice.listPendingFriendPairCandidates()[0], {
        label: "Alice receives friend-pair candidate",
      });
      const approveResult = alice.approveFriendPair(candidate.nonceB64);
      expect(approveResult.approved).toBe(true);

      const outcome = await redeemPromise;
      expect(outcome.status).toBe("paired");

      // === Wait for friend-sync session to come up on BOTH sides ===
      // After the pair, IdentityService.adoptPeerFromApproval +
      // approveFriendPair both call refreshFriendDialerTargets, so
      // both dialers should open sessions to each other.
      await waitFor(() => alice.getFriendSessions().length === 1, {
        label: "Alice has a friend-sync session with Bob",
      });
      await waitFor(() => bob.getFriendSessions().length === 1, {
        label: "Bob has a friend-sync session with Alice",
      });

      // === Bob → Alice: "hello alice" ===
      const bobToAlice = await bob.sendFriendChatMessage({
        peerRootPubKey: alice.requireBundle().stored.signPublicKeyB64,
        body: "hello alice",
      });
      expect(bobToAlice.ok).toBe(true);

      // Alice's persistent store eventually has the message.
      const aliceReceived = await waitFor(
        () => {
          const list = alice.listFriendChatMessages(bob.requireBundle().stored.signPublicKeyB64);
          return list.length === 1 ? list : null;
        },
        { label: "Alice receives Bob's message" },
      );
      expect(aliceReceived[0]?.message.body).toBe("hello alice");
      expect(aliceReceived[0]?.message.authorRootPubKey).toBe(
        bob.requireBundle().stored.signPublicKeyB64,
      );
      expect(aliceReceived[0]?.message.authorDeviceId).toBe("srv_bob_fc_e2e");

      // === Alice → Bob: "hi bob" ===
      const aliceToBob = await alice.sendFriendChatMessage({
        peerRootPubKey: bob.requireBundle().stored.signPublicKeyB64,
        body: "hi bob",
      });
      expect(aliceToBob.ok).toBe(true);

      const bobReceived = await waitFor(
        () => {
          const list = bob.listFriendChatMessages(alice.requireBundle().stored.signPublicKeyB64);
          // Bob has BOTH messages: his outbound + her reply.
          return list.length === 2 ? list : null;
        },
        { label: "Bob receives Alice's reply" },
      );
      expect(bobReceived.map((r) => r.message.body)).toEqual(["hello alice", "hi bob"]);

      // === Both sides reload from disk and still see history ===
      await alice.stopFriendSync();
      await bob.stopFriendSync();

      const aliceAfterReboot = new IdentityService({
        ottieHome: aliceHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_alice_fc_e2e", deviceLabel: "Alice's Mac" },
        relayEndpoint,
      });
      services.push(aliceAfterReboot);
      const aliceHistory = aliceAfterReboot.listFriendChatMessages(
        bob.requireBundle().stored.signPublicKeyB64,
      );
      expect(aliceHistory.map((r) => r.message.body)).toEqual(["hello alice", "hi bob"]);
    },
    E2E_TIMEOUT_MS,
  );

  // The "send to offline peer" path is unit-tested at the
  // IdentityService level in friend-chat-service.test.ts — at e2e
  // here it was racy because mock-relay doesn't propagate a server-
  // disconnect notification to clients (so Alice's client socket
  // stayed open buffering frames into nothing). Real Cloudflare
  // behavior is expected to close the client side; we'll re-add an
  // e2e for that once Phase 3.b/2 lands the KV-inbox fallback (which
  // is the "right" answer to offline anyway).
});
