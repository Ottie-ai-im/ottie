import { generateKeyPairSync, type KeyObject } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  buildAiShareAcceptEnvelope,
  buildAiShareDeclineEnvelope,
  buildAiShareInviteEnvelope,
  tryParseAiShareEnvelope,
  verifyAiShareAcceptEnvelope,
  verifyAiShareDeclineEnvelope,
  verifyAiShareInviteEnvelope,
} from "./ai-share-crypto.js";
import { AiShareEnvelopeSchema, AiShareInviteEnvelopeSchema } from "./ai-share-types.js";

interface TestIdentity {
  rootSignPublicKeyB64: string;
  rootSignPrivateKey: KeyObject;
}

function makeIdentity(): TestIdentity {
  const ed = generateKeyPairSync("ed25519");
  const pub = (ed.publicKey.export({ format: "jwk" }) as { x?: string }).x;
  if (!pub) throw new Error("no x");
  return { rootSignPublicKeyB64: pub, rootSignPrivateKey: ed.privateKey };
}

describe("ai-share crypto — Phase 4 v1", () => {
  describe("invite", () => {
    test("build → schema parse → verify roundtrips with correct sender", () => {
      const owner = makeIdentity();
      const envelope = buildAiShareInviteEnvelope({
        inviteId: "ais_test1",
        ownerRootSignPrivateKey: owner.rootSignPrivateKey,
        ownerRootPubKeyB64: owner.rootSignPublicKeyB64,
        ownerDeviceId: "srv_owner",
        agentId: "agent_42",
        agentLabel: "Claude Code",
        agentProvider: "claude",
        generatedAt: "2026-05-07T03:00:00.000Z",
        expiresAt: "2026-05-07T03:05:00.000Z",
      });
      // Wire shape passes its own zod schema.
      expect(AiShareInviteEnvelopeSchema.safeParse(envelope).success).toBe(true);
      // Verifies under the matching pubkey.
      const verifyOk = verifyAiShareInviteEnvelope({
        envelope,
        expectedOwnerRootSignPublicKeyB64: owner.rootSignPublicKeyB64,
      });
      expect(verifyOk.ok).toBe(true);
    });

    test("fails when peer record's pubkey doesn't match envelope's claim", () => {
      const owner = makeIdentity();
      const wrong = makeIdentity();
      const envelope = buildAiShareInviteEnvelope({
        inviteId: "ais_test2",
        ownerRootSignPrivateKey: owner.rootSignPrivateKey,
        ownerRootPubKeyB64: owner.rootSignPublicKeyB64,
        ownerDeviceId: "srv_owner",
        agentId: "agent_42",
        agentLabel: "Codex",
        agentProvider: "codex",
        generatedAt: "2026-05-07T03:00:00.000Z",
        expiresAt: "2026-05-07T03:05:00.000Z",
      });
      const result = verifyAiShareInviteEnvelope({
        envelope,
        expectedOwnerRootSignPublicKeyB64: wrong.rootSignPublicKeyB64,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/owner pubkey/i);
    });

    test("fails when envelope's signature is tampered", () => {
      const owner = makeIdentity();
      const envelope = buildAiShareInviteEnvelope({
        inviteId: "ais_test3",
        ownerRootSignPrivateKey: owner.rootSignPrivateKey,
        ownerRootPubKeyB64: owner.rootSignPublicKeyB64,
        ownerDeviceId: "srv_owner",
        agentId: "agent_42",
        agentLabel: "OpenCode",
        agentProvider: "opencode",
        generatedAt: "2026-05-07T03:00:00.000Z",
        expiresAt: "2026-05-07T03:05:00.000Z",
      });
      const tampered = { ...envelope, agentLabel: "EVIL Agent" };
      const result = verifyAiShareInviteEnvelope({
        envelope: tampered,
        expectedOwnerRootSignPublicKeyB64: owner.rootSignPublicKeyB64,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/signature did not verify/i);
    });
  });

  describe("accept", () => {
    test("build → verify roundtrip", () => {
      const responder = makeIdentity();
      const envelope = buildAiShareAcceptEnvelope({
        inviteId: "ais_test1",
        responderRootSignPrivateKey: responder.rootSignPrivateKey,
        responderRootPubKeyB64: responder.rootSignPublicKeyB64,
        acceptedAt: "2026-05-07T03:01:00.000Z",
      });
      const ok = verifyAiShareAcceptEnvelope({
        envelope,
        expectedResponderRootSignPublicKeyB64: responder.rootSignPublicKeyB64,
      });
      expect(ok.ok).toBe(true);
    });
  });

  describe("decline", () => {
    test("build → verify roundtrip carries optional reason through the signature", () => {
      const responder = makeIdentity();
      const envelope = buildAiShareDeclineEnvelope({
        inviteId: "ais_test1",
        responderRootSignPrivateKey: responder.rootSignPrivateKey,
        responderRootPubKeyB64: responder.rootSignPublicKeyB64,
        declinedAt: "2026-05-07T03:01:00.000Z",
        reason: "Busy right now",
      });
      const ok = verifyAiShareDeclineEnvelope({
        envelope,
        expectedResponderRootSignPublicKeyB64: responder.rootSignPublicKeyB64,
      });
      expect(ok.ok).toBe(true);
      // Reason is part of the canonical signed payload, so swapping it
      // post-sign breaks verification.
      const swapped = { ...envelope, reason: "Different reason" };
      const swappedOk = verifyAiShareDeclineEnvelope({
        envelope: swapped,
        expectedResponderRootSignPublicKeyB64: responder.rootSignPublicKeyB64,
      });
      expect(swappedOk.ok).toBe(false);
    });
  });

  describe("tryParseAiShareEnvelope", () => {
    test("routes all three kinds correctly", () => {
      const owner = makeIdentity();
      const responder = makeIdentity();
      const invite = buildAiShareInviteEnvelope({
        inviteId: "ais_test1",
        ownerRootSignPrivateKey: owner.rootSignPrivateKey,
        ownerRootPubKeyB64: owner.rootSignPublicKeyB64,
        ownerDeviceId: "srv",
        agentId: "a",
        agentLabel: "L",
        agentProvider: "claude",
        generatedAt: "2026-05-07T03:00:00.000Z",
        expiresAt: "2026-05-07T03:05:00.000Z",
      });
      const accept = buildAiShareAcceptEnvelope({
        inviteId: "ais_test1",
        responderRootSignPrivateKey: responder.rootSignPrivateKey,
        responderRootPubKeyB64: responder.rootSignPublicKeyB64,
        acceptedAt: "2026-05-07T03:01:00.000Z",
      });
      const decline = buildAiShareDeclineEnvelope({
        inviteId: "ais_test1",
        responderRootSignPrivateKey: responder.rootSignPrivateKey,
        responderRootPubKeyB64: responder.rootSignPublicKeyB64,
        declinedAt: "2026-05-07T03:01:00.000Z",
      });
      expect(tryParseAiShareEnvelope(invite)?.kind).toBe("invite");
      expect(tryParseAiShareEnvelope(accept)?.kind).toBe("accept");
      expect(tryParseAiShareEnvelope(decline)?.kind).toBe("decline");
    });

    test("returns null for non-ai-share payloads (chat envelopes)", () => {
      expect(
        tryParseAiShareEnvelope({ kind: "friend-chat-message", message: { id: "x" } }),
      ).toBeNull();
      expect(tryParseAiShareEnvelope("not-an-object")).toBeNull();
      expect(tryParseAiShareEnvelope(null)).toBeNull();
    });

    test("returns null for malformed ai-share kinds (missing fields)", () => {
      expect(tryParseAiShareEnvelope({ kind: "ai-share-invite", inviteId: "x" })).toBeNull();
    });
  });

  describe("AiShareEnvelopeSchema discriminated union", () => {
    test("parses all three kinds", () => {
      const owner = makeIdentity();
      const invite = buildAiShareInviteEnvelope({
        inviteId: "ais_test1",
        ownerRootSignPrivateKey: owner.rootSignPrivateKey,
        ownerRootPubKeyB64: owner.rootSignPublicKeyB64,
        ownerDeviceId: "srv",
        agentId: "a",
        agentLabel: "L",
        agentProvider: "claude",
        generatedAt: "2026-05-07T03:00:00.000Z",
        expiresAt: "2026-05-07T03:05:00.000Z",
      });
      expect(AiShareEnvelopeSchema.safeParse(invite).success).toBe(true);
    });
  });
});
