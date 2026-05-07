import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
    s.stopInboxReceiver();
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
  test("rejects when peer is not in the friend list", async () => {
    const alice = makeAlice();
    const result = await alice.sendFriendChatMessage({
      peerRootPubKey: "x".repeat(43),
      body: "hello",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not in your friend list/i);
  });

  test("rejects empty body", async () => {
    const alice = makeAlice();
    const result = await alice.sendFriendChatMessage({
      peerRootPubKey: "x".repeat(43),
      body: "   ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/empty/i);
  });

  test("rejects when peer was paired pre-3.b/2a (no encryption pubkey on file)", async () => {
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
      // peerEncryptionPublicKeyB64 intentionally omitted — simulates a
      // friend paired before 3.b/2a who hasn't re-paired yet.
    });
    const result = await alice.sendFriendChatMessage({
      peerRootPubKey: "y".repeat(43),
      body: "are you there?",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/re-pair/i);
  });

  test("queues to inbox when peer is offline but has encryption pubkey + relayEndpoint", async () => {
    const alice = makeAlice();
    // Bob: paired post-3.b/2a, so peerEncryptionPublicKeyB64 is set.
    const bobX = generateKeyPairSync("x25519");
    const bobEncPub = (bobX.publicKey.export({ format: "jwk" }) as { x?: string }).x;
    if (!bobEncPub) throw new Error("no x");
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
      peerEncryptionPublicKeyB64: bobEncPub,
    });

    // Stub global fetch — capture the request the daemon makes to relay.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          seq: "0000000000007890-fedcba9876543210",
          deliveredAt: "2026-05-07T03:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      const result = await alice.sendFriendChatMessage({
        peerRootPubKey: "y".repeat(43),
        body: "are you there?",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The persisted local copy is tagged "queued" so the UI can render
      // a distinct status until the recipient picks up + responds.
      expect(result.stored.deliveryStatus).toBe("queued");
      expect(result.stored.message.body).toBe("are you there?");
      // The daemon hit the inbox endpoint (HTTPS, recipient pubkey in URL).
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe(`https://relay.example:443/inbox/${"y".repeat(43)}`);
      expect(init?.method).toBe("POST");
      // Body is the serialized InboxBlob (JSON with v/ephPub/ciphertext).
      const body = JSON.parse(String(init?.body));
      expect(body.v).toBe(1);
      expect(typeof body.ephPublicKeyB64).toBe("string");
      expect(typeof body.ciphertextB64).toBe("string");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("surfaces relay error when inbox POST returns non-2xx", async () => {
    const alice = makeAlice();
    const bobX = generateKeyPairSync("x25519");
    const bobEncPub = (bobX.publicKey.export({ format: "jwk" }) as { x?: string }).x;
    if (!bobEncPub) throw new Error("no x");
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
      peerEncryptionPublicKeyB64: bobEncPub,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "recipient_quota_entries" }), {
        status: 507,
        headers: { "Content-Type": "application/json" },
      }),
    );
    try {
      const result = await alice.sendFriendChatMessage({
        peerRootPubKey: "y".repeat(43),
        body: "no room left",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/inbox post failed.*507/i);
      expect(result.error).toContain("recipient_quota_entries");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("rejects when peer status is blocked", async () => {
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
    const result = await alice.sendFriendChatMessage({
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
