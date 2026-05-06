import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { startRelayTransport, type RelayTransportController } from "../relay-transport.js";
import { IdentityService } from "./identity-service.js";
import { peerListFilePath } from "./peer-store.js";
import { MockRelay } from "./test-utils/mock-relay.js";

/**
 * Phase 3.a/3 mock-relay end-to-end: drives the full friend-pair flow
 * through REAL WebSockets bridged by an in-process mock Cloudflare relay.
 * Cross-identity analog of `device-link-mock-relay.e2e.test.ts`.
 *
 * Verifies:
 *   - Alice generates a friend-pair offer (real X25519 keypair).
 *   - Bob redeems it through the relay; default `WebSocket` factory
 *     dials a real loopback TCP socket.
 *   - Alice's receiver decrypts + signature-checks + parks the candidate.
 *   - Alice taps Approve; her daemon signs an approval reply, sends it
 *     back over the still-open socket, persists Bob in peers.json.
 *   - Bob's sender decrypts + signature-checks the approval, persists
 *     Alice in his own peers.json.
 *   - Both daemons reload from disk and still see each other as friends.
 */

const SILENT_LOGGER = pino({ level: process.env.E2E_DEBUG === "1" ? "debug" : "silent" });
const E2E_TIMEOUT_MS = 20_000;

let aliceHome: string;
let bobHome: string;
let mockRelay: MockRelay;
let aliceTransport: RelayTransportController | null = null;

beforeEach(async () => {
  aliceHome = mkdtempSync(path.join(os.tmpdir(), "ottie-fp-mockrelay-alice-"));
  bobHome = mkdtempSync(path.join(os.tmpdir(), "ottie-fp-mockrelay-bob-"));
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

describe("Phase 3.a/3 mock-relay e2e (real WebSockets, two separate identities)", () => {
  test(
    "happy path: Bob → mock relay → Alice → approve → both sides persist Peer entries",
    async () => {
      const relayEndpoint = mockRelay.endpoint();

      // === Alice (existing user, originator) ===
      const alice = new IdentityService({
        ottieHome: aliceHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_alice_fp_e2e", deviceLabel: "Alice's Mac" },
        relayEndpoint,
      });
      alice.initialize("Alice");

      // Real relay-transport with both device-link AND friend-pair handlers
      // (just like bootstrap.ts wires it).
      aliceTransport = startRelayTransport({
        logger: SILENT_LOGGER,
        attachSocket: async () => {},
        relayEndpoint,
        serverId: "srv_alice_fp_e2e",
        connectionHandlers: [
          alice.createDeviceLinkConnectionHandler(),
          alice.createFriendPairConnectionHandler(),
        ],
      });

      // === Generate friend-pair offer ===
      const offer = alice.generateFriendPairOffer();
      expect(offer).not.toBeNull();
      if (!offer) return;

      // === Bob (DIFFERENT identity, fresh install + initialize) ===
      const bob = new IdentityService({
        ottieHome: bobHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_bob_fp_e2e", deviceLabel: "Bob's Laptop" },
        relayEndpoint,
      });
      bob.initialize("Bob");

      // === Bob redeems through the real wire ===
      const redeemPromise = bob.redeemFriendPairOffer({
        deepLinkOrOffer: offer.deepLink,
        timeoutMs: 10_000,
      });

      // === Wait for Alice's receiver to record the candidate ===
      const candidate = await waitFor(() => alice.listPendingFriendPairCandidates()[0], {
        label: "Alice receives friend-pair candidate",
      });
      expect(candidate.peerDisplayName).toBe("Bob");
      expect(candidate.peerRootSignPublicKeyB64).toBe(bob.requireBundle().stored.signPublicKeyB64);

      // === Alice approves ===
      const approveResult = alice.approveFriendPair(candidate.nonceB64);
      expect(approveResult.approved).toBe(true);
      expect(approveResult.error).toBeNull();
      expect(approveResult.peers).toHaveLength(1);
      expect(approveResult.peers?.[0]?.peerDisplayName).toBe("Bob");

      // === Bob's redeem promise resolves with paired outcome ===
      const outcome = await redeemPromise;
      expect(outcome.status).toBe("paired");
      if (outcome.status !== "paired") return;
      expect(outcome.peer.peerDisplayName).toBe("Alice");
      expect(outcome.peer.peerRootSignPublicKeyB64).toBe(
        alice.requireBundle().stored.signPublicKeyB64,
      );
      expect(outcome.peer.status).toBe("active");

      // === Both sides persisted to peers.json ===
      expect(existsSync(peerListFilePath(aliceHome))).toBe(true);
      expect(existsSync(peerListFilePath(bobHome))).toBe(true);
      const aliceFile = JSON.parse(readFileSync(peerListFilePath(aliceHome), "utf8"));
      expect(aliceFile.peers[0].peerDisplayName).toBe("Bob");
      const bobFile = JSON.parse(readFileSync(peerListFilePath(bobHome), "utf8"));
      expect(bobFile.peers[0].peerDisplayName).toBe("Alice");

      // === Fresh IdentityService instances reload the friend list ===
      const aliceAfterReboot = new IdentityService({
        ottieHome: aliceHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_alice_fp_e2e", deviceLabel: "Alice's Mac" },
        relayEndpoint,
      });
      expect(aliceAfterReboot.getPeerList()).toHaveLength(1);
      expect(aliceAfterReboot.getPeerList()[0]?.peerDisplayName).toBe("Bob");

      const bobAfterReboot = new IdentityService({
        ottieHome: bobHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_bob_fp_e2e", deviceLabel: "Bob's Laptop" },
        relayEndpoint,
      });
      expect(bobAfterReboot.getPeerList()).toHaveLength(1);
      expect(bobAfterReboot.getPeerList()[0]?.peerDisplayName).toBe("Alice");
    },
    E2E_TIMEOUT_MS,
  );

  test(
    "Alice rejects: Bob receives user_rejected; neither side has a Peer record",
    async () => {
      const relayEndpoint = mockRelay.endpoint();

      const alice = new IdentityService({
        ottieHome: aliceHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_alice_fp_rej", deviceLabel: "Alice's Mac" },
        relayEndpoint,
      });
      alice.initialize("Alice");

      aliceTransport = startRelayTransport({
        logger: SILENT_LOGGER,
        attachSocket: async () => {},
        relayEndpoint,
        serverId: "srv_alice_fp_rej",
        connectionHandlers: [
          alice.createDeviceLinkConnectionHandler(),
          alice.createFriendPairConnectionHandler(),
        ],
      });

      const offer = alice.generateFriendPairOffer();
      if (!offer) throw new Error("offer expected");

      const bob = new IdentityService({
        ottieHome: bobHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv_bob_fp_rej", deviceLabel: "Bob's Laptop" },
        relayEndpoint,
      });
      bob.initialize("Bob");

      const redeemPromise = bob.redeemFriendPairOffer({
        deepLinkOrOffer: offer.deepLink,
        timeoutMs: 10_000,
      });

      const candidate = await waitFor(() => alice.listPendingFriendPairCandidates()[0], {
        label: "Alice receives friend-pair candidate",
      });
      const result = alice.rejectFriendPair(candidate.nonceB64, "wrong person");
      expect(result.rejected).toBe(true);

      const outcome = await redeemPromise;
      expect(outcome.status).toBe("rejected");
      if (outcome.status !== "rejected") return;
      expect(outcome.errorCode).toBe("user_rejected");
      expect(outcome.errorMessage).toContain("wrong person");

      expect(alice.getPeerList()).toHaveLength(0);
      expect(bob.getPeerList()).toHaveLength(0);
    },
    E2E_TIMEOUT_MS,
  );
});
