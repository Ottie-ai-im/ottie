import { describe, expect, test } from "vitest";

import { DeviceLinkPendingStore } from "./device-link-pending-store.js";
import { buildDeviceLinkRedemption, decryptDeviceLinkRedemption } from "./device-link-redeem.js";
import { encodeDeviceLinkOffer } from "./device-link-types.js";

const OFFER_FIXTURE = {
  serverId: "srv_alice",
  rootSignPublicKeyB64: "x".repeat(43),
  displayName: "Alice",
  relayEndpoint: "relay.claws.company:443",
};

describe("buildDeviceLinkRedemption + decryptDeviceLinkRedemption", () => {
  test("roundtrips a CandidateDevice through ECDH+box encryption", () => {
    const pending = new DeviceLinkPendingStore().create(OFFER_FIXTURE).pending;

    const built = buildDeviceLinkRedemption({
      offer: pending.offer,
      deviceLabel: "Alice's Phone",
      role: "client",
    });

    expect(built.candidate.deviceLabel).toBe("Alice's Phone");
    expect(built.candidate.role).toBe("client");
    expect(built.candidate.signPublicKeyB64).toHaveLength(43);
    expect(built.localSecrets.deviceId).toBe(built.candidate.deviceId);
    expect(built.redemption.offerNonceB64).toBe(pending.offer.nonceB64);

    const recovered = decryptDeviceLinkRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending.ephPrivateKeyB64,
    });
    expect(recovered).toEqual(built.candidate);
  });

  test("accepts a deep-link string in place of a decoded offer", () => {
    const pending = new DeviceLinkPendingStore().create(OFFER_FIXTURE).pending;
    const deepLink = encodeDeviceLinkOffer(pending.offer);

    const built = buildDeviceLinkRedemption({
      offer: deepLink,
      deviceLabel: "Laptop B",
      role: "daemon",
    });
    expect(built.offer).toEqual(pending.offer);

    const recovered = decryptDeviceLinkRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending.ephPrivateKeyB64,
    });
    expect(recovered.deviceLabel).toBe("Laptop B");
    expect(recovered.role).toBe("daemon");
  });

  test("two redemptions for the same offer use distinct ephemeral keys", () => {
    const pending = new DeviceLinkPendingStore().create(OFFER_FIXTURE).pending;
    const a = buildDeviceLinkRedemption({
      offer: pending.offer,
      deviceLabel: "first attempt",
      role: "daemon",
    });
    const b = buildDeviceLinkRedemption({
      offer: pending.offer,
      deviceLabel: "second attempt",
      role: "daemon",
    });
    expect(a.localSecrets.ephPrivateKeyB64).not.toBe(b.localSecrets.ephPrivateKeyB64);
    expect(a.redemption.newDeviceEphPublicKeyB64).not.toBe(b.redemption.newDeviceEphPublicKeyB64);
    expect(a.localSecrets.signPublicKeyB64).not.toBe(b.localSecrets.signPublicKeyB64);
  });

  test("rejects a stale offer past its expiry", () => {
    const t0 = 1_700_000_000_000;
    const pending = new DeviceLinkPendingStore().create({
      ...OFFER_FIXTURE,
      nowMs: t0,
      ttlMs: 1000,
    }).pending;

    expect(() =>
      buildDeviceLinkRedemption({
        offer: pending.offer,
        deviceLabel: "any",
        role: "daemon",
        nowMs: t0 + 2000,
      }),
    ).toThrow(/expired/i);
  });

  test("decrypt fails when the existing device uses the wrong ephemeral private key", () => {
    const store = new DeviceLinkPendingStore();
    const a = store.create(OFFER_FIXTURE);
    const b = store.create(OFFER_FIXTURE);

    const built = buildDeviceLinkRedemption({
      offer: a.pending.offer,
      deviceLabel: "Alice's Phone",
      role: "client",
    });

    // Use the wrong pending's ephPrivateKey to decrypt — should fail hard.
    expect(() =>
      decryptDeviceLinkRedemption({
        redemption: built.redemption,
        ephPrivateKeyB64: b.pending.ephPrivateKeyB64,
      }),
    ).toThrow();
  });

  test("decrypt fails when ciphertext has been tampered with", () => {
    const pending = new DeviceLinkPendingStore().create(OFFER_FIXTURE).pending;
    const built = buildDeviceLinkRedemption({
      offer: pending.offer,
      deviceLabel: "Alice's Phone",
      role: "client",
    });

    const original = built.redemption.ciphertextB64;
    // Flip one base64 character somewhere past the 24-byte nonce header.
    const tamperIndex = original.length - 5;
    const flipped =
      original.slice(0, tamperIndex) +
      (original[tamperIndex] === "A" ? "B" : "A") +
      original.slice(tamperIndex + 1);

    expect(() =>
      decryptDeviceLinkRedemption({
        redemption: { ...built.redemption, ciphertextB64: flipped },
        ephPrivateKeyB64: pending.ephPrivateKeyB64,
      }),
    ).toThrow();
  });
});
