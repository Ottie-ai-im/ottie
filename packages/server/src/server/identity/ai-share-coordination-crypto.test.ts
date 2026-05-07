import { generateKeyPairSync, type KeyObject } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  buildAiShareIntentBroadcastEvent,
  buildAiShareIntentResolutionEvent,
  tryParseAiShareCoordinationEvent,
  verifyAiShareCoordinationEvent,
} from "./ai-share-coordination-crypto.js";

interface TestDevice {
  signPublicKeyB64: string;
  signPrivateKey: KeyObject;
  deviceId: string;
}

function makeDevice(deviceId: string): TestDevice {
  const ed = generateKeyPairSync("ed25519");
  const x = (ed.publicKey.export({ format: "jwk" }) as { x?: string }).x;
  if (!x) throw new Error("missing jwk x");
  return { deviceId, signPublicKeyB64: x, signPrivateKey: ed.privateKey };
}

describe("ai-share coordination — Phase 4 v3/c §7.5.1", () => {
  describe("intent broadcast", () => {
    test("build → verify roundtrip with the matching source pubkey", () => {
      const sourceDevice = makeDevice("srv_alice_phone");
      const event = buildAiShareIntentBroadcastEvent({
        intentId: "ais_intent_test1",
        peerRootPubKeyB64: "bob_root_pub",
        expiresAt: "2026-05-07T03:05:00.000Z",
        sourceDeviceId: sourceDevice.deviceId,
        signPrivateKey: sourceDevice.signPrivateKey,
        emittedAt: "2026-05-07T03:00:00.000Z",
        seq: 0,
      });
      const ok = verifyAiShareCoordinationEvent({
        event,
        expectedSignPublicKeyB64: sourceDevice.signPublicKeyB64,
      });
      expect(ok.ok).toBe(true);
    });

    test("fails when expected source pubkey doesn't match", () => {
      const sourceDevice = makeDevice("srv_alice_phone");
      const wrong = makeDevice("srv_alice_laptop");
      const event = buildAiShareIntentBroadcastEvent({
        intentId: "ais_intent_test2",
        peerRootPubKeyB64: "bob_root_pub",
        expiresAt: "2026-05-07T03:05:00.000Z",
        sourceDeviceId: sourceDevice.deviceId,
        signPrivateKey: sourceDevice.signPrivateKey,
        emittedAt: "2026-05-07T03:00:00.000Z",
        seq: 1,
      });
      const result = verifyAiShareCoordinationEvent({
        event,
        expectedSignPublicKeyB64: wrong.signPublicKeyB64,
      });
      expect(result.ok).toBe(false);
    });

    test("rejects post-sign tamper of peerRootPubKeyB64", () => {
      const sourceDevice = makeDevice("srv_alice_phone");
      const event = buildAiShareIntentBroadcastEvent({
        intentId: "ais_intent_test3",
        peerRootPubKeyB64: "bob_root_pub",
        expiresAt: "2026-05-07T03:05:00.000Z",
        sourceDeviceId: sourceDevice.deviceId,
        signPrivateKey: sourceDevice.signPrivateKey,
        emittedAt: "2026-05-07T03:00:00.000Z",
        seq: 2,
      });
      const tampered = { ...event, peerRootPubKeyB64: "EVIL_root_pub" };
      const result = verifyAiShareCoordinationEvent({
        event: tampered,
        expectedSignPublicKeyB64: sourceDevice.signPublicKeyB64,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/signature did not verify/i);
    });
  });

  describe("intent resolution", () => {
    test("build → verify roundtrip", () => {
      const sourceDevice = makeDevice("srv_alice_laptop");
      const event = buildAiShareIntentResolutionEvent({
        intentId: "ais_intent_test1",
        claimedByDeviceId: sourceDevice.deviceId,
        resolvedAt: "2026-05-07T03:01:00.000Z",
        sourceDeviceId: sourceDevice.deviceId,
        signPrivateKey: sourceDevice.signPrivateKey,
        emittedAt: "2026-05-07T03:01:00.000Z",
        seq: 0,
      });
      const ok = verifyAiShareCoordinationEvent({
        event,
        expectedSignPublicKeyB64: sourceDevice.signPublicKeyB64,
      });
      expect(ok.ok).toBe(true);
    });

    test("rejects post-sign tamper of claimedByDeviceId", () => {
      const sourceDevice = makeDevice("srv_alice_laptop");
      const event = buildAiShareIntentResolutionEvent({
        intentId: "ais_intent_test1",
        claimedByDeviceId: sourceDevice.deviceId,
        resolvedAt: "2026-05-07T03:01:00.000Z",
        sourceDeviceId: sourceDevice.deviceId,
        signPrivateKey: sourceDevice.signPrivateKey,
        emittedAt: "2026-05-07T03:01:00.000Z",
        seq: 1,
      });
      const tampered = { ...event, claimedByDeviceId: "srv_evil_device" };
      const result = verifyAiShareCoordinationEvent({
        event: tampered,
        expectedSignPublicKeyB64: sourceDevice.signPublicKeyB64,
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("tryParseAiShareCoordinationEvent", () => {
    test("routes both kinds correctly", () => {
      const sourceDevice = makeDevice("srv_alice_phone");
      const broadcast = buildAiShareIntentBroadcastEvent({
        intentId: "ais_intent_p1",
        peerRootPubKeyB64: "bob_pub",
        expiresAt: "2026-05-07T03:05:00.000Z",
        sourceDeviceId: sourceDevice.deviceId,
        signPrivateKey: sourceDevice.signPrivateKey,
        emittedAt: "2026-05-07T03:00:00.000Z",
        seq: 0,
      });
      const resolution = buildAiShareIntentResolutionEvent({
        intentId: "ais_intent_p1",
        claimedByDeviceId: sourceDevice.deviceId,
        resolvedAt: "2026-05-07T03:01:00.000Z",
        sourceDeviceId: sourceDevice.deviceId,
        signPrivateKey: sourceDevice.signPrivateKey,
        emittedAt: "2026-05-07T03:01:00.000Z",
        seq: 1,
      });
      expect(tryParseAiShareCoordinationEvent(broadcast)?.kind).toBe("ai-share-intent-broadcast");
      expect(tryParseAiShareCoordinationEvent(resolution)?.kind).toBe("ai-share-intent-resolution");
    });

    test("returns null for non-coordination payloads", () => {
      expect(tryParseAiShareCoordinationEvent({ kind: "device-added" })).toBeNull();
      expect(tryParseAiShareCoordinationEvent("not-an-object")).toBeNull();
      expect(tryParseAiShareCoordinationEvent(null)).toBeNull();
    });
  });
});
