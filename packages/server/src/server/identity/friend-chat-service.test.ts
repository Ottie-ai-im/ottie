import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { IdentityService } from "./identity-service.js";

/**
 * Phase 3.b/1d unit tests for `IdentityService.sendFriendChatMessage` /
 * `listFriendChatMessages` covering the failure paths that don't need
 * a real friend-sync session.
 *
 * Happy-path delivery (which DOES need a session) is exercised by
 * `friend-chat-mock-relay.e2e.test.ts`.
 */

const SILENT_LOGGER = pino({ level: "silent" });

let aliceHome: string;
const services: IdentityService[] = [];

beforeEach(() => {
  aliceHome = mkdtempSync(path.join(tmpdir(), "ottie-fc-svc-alice-"));
});

afterEach(async () => {
  for (const s of services.splice(0)) {
    await s.stopFriendSync();
    await s.stopPeerSync();
  }
  rmSync(aliceHome, { recursive: true, force: true });
});

function makeAlice(): IdentityService {
  const svc = new IdentityService({
    ottieHome: aliceHome,
    logger: SILENT_LOGGER,
    selfDeviceContext: { serverId: "srv_alice_unit", deviceLabel: "Alice's Mac" },
    relayEndpoint: "relay.example:443",
  });
  svc.initialize("Alice");
  services.push(svc);
  return svc;
}

describe("IdentityService.sendFriendChatMessage failure paths", () => {
  test("rejects when peer is not in the friend list", () => {
    const alice = makeAlice();
    const result = alice.sendFriendChatMessage({
      peerRootPubKey: "x".repeat(43),
      body: "hello",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not in your friend list/i);
  });

  test("rejects empty body", () => {
    const alice = makeAlice();
    const result = alice.sendFriendChatMessage({
      peerRootPubKey: "x".repeat(43),
      body: "   ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/empty/i);
  });

  test("rejects when no friend-sync session is live (paired but offline)", () => {
    const alice = makeAlice();
    // Inject a Peer record manually so the friend-list check passes
    // without needing the full pair flow. This isolates the no-session
    // branch — the real production path would have the session opened
    // by the dialer.
    alice.adoptPeerFromApproval({
      v: 1,
      peerRootSignPublicKeyB64: "y".repeat(43),
      peerDisplayName: "Bob",
      pairedAt: "2026-05-06T12:00:00.000Z",
      status: "active",
      pairingNonceB64: "n".repeat(43),
      authorizationSignatureB64: "sig_".padEnd(86, "z"),
      peerServerId: "srv_bob_unit",
      peerRelayEndpoint: "relay.example:443",
    });
    const result = alice.sendFriendChatMessage({
      peerRootPubKey: "y".repeat(43),
      body: "are you there?",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/offline/i);
  });

  test("rejects when peer status is blocked", () => {
    const alice = makeAlice();
    alice.adoptPeerFromApproval({
      v: 1,
      peerRootSignPublicKeyB64: "y".repeat(43),
      peerDisplayName: "Bob",
      pairedAt: "2026-05-06T12:00:00.000Z",
      status: "blocked",
      pairingNonceB64: "n".repeat(43),
      authorizationSignatureB64: "sig_".padEnd(86, "z"),
    });
    const result = alice.sendFriendChatMessage({
      peerRootPubKey: "y".repeat(43),
      body: "anyone?",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/blocked/i);
  });
});

describe("IdentityService.listFriendChatMessages", () => {
  test("returns empty when no history exists", () => {
    const alice = makeAlice();
    expect(alice.listFriendChatMessages("y".repeat(43))).toEqual([]);
  });
});
