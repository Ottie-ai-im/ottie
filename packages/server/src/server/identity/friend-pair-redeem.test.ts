import { generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  buildFriendPairRedemption,
  decryptFriendPairRedemption,
  verifyFriendCandidate,
} from "./friend-pair-redeem.js";
import type { FriendPairRedemption } from "./friend-pair-redeem-types.js";
import {
  encodeFriendPairOffer,
  type FriendPairOffer,
  type PendingFriendPairOffer,
} from "./friend-pair-types.js";

interface RootKeys {
  signPublicKeyB64: string;
  signPrivateKey: KeyObject;
}

function mintRootKeys(): RootKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  return { signPublicKeyB64: jwkPub.x, signPrivateKey: privateKey };
}

function mintPendingOffer(args: {
  alice: RootKeys;
  ttlMs?: number;
  nowMs?: number;
}): PendingFriendPairOffer {
  const { publicKey: ephPub, privateKey: ephPriv } = generateKeyPairSync("x25519");
  const ephPublicKeyB64 = (ephPub.export({ format: "jwk" }) as { x: string }).x;
  const ephPrivateKeyB64 = (ephPriv.export({ format: "jwk" }) as { d: string }).d;
  const nonceB64 = randomBytes(32).toString("base64url").replace(/=+$/, "");
  const nowMs = args.nowMs ?? Date.now();
  const ttlMs = args.ttlMs ?? 10 * 60 * 1000;
  const expiresAtMs = nowMs + ttlMs;
  const offer: FriendPairOffer = {
    v: 1,
    kind: "friend-pair",
    serverId: "srv_alice",
    rootSignPublicKeyB64: args.alice.signPublicKeyB64,
    displayName: "Alice",
    ephPublicKeyB64,
    nonceB64,
    exp: new Date(expiresAtMs).toISOString(),
    relayEndpoint: "relay.claws.company:443",
  };
  return { offer, ephPrivateKeyB64, expiresAtMs };
}

describe("buildFriendPairRedemption + decryptFriendPairRedemption + verifyFriendCandidate", () => {
  test("roundtrips a FriendCandidate and the signature verifies", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending = mintPendingOffer({ alice });

    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });

    expect(built.candidate.kind).toBe("friend-candidate");
    expect(built.candidate.displayName).toBe("Bob");
    expect(built.candidate.rootSignPublicKeyB64).toBe(bob.signPublicKeyB64);
    expect(built.candidate.signatureB64).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(built.redemption.offerNonceB64).toBe(pending.offer.nonceB64);
    expect(built.localSecrets.ephPrivateKeyB64).toHaveLength(43);

    const recovered = decryptFriendPairRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending.ephPrivateKeyB64,
    });
    expect(recovered).toEqual(built.candidate);

    const outcome = verifyFriendCandidate({
      candidate: recovered,
      offer: pending.offer,
      redemption: built.redemption,
    });
    expect(outcome.ok).toBe(true);
  });

  test("accepts a deep-link string in place of a decoded offer", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending = mintPendingOffer({ alice });
    const deepLink = encodeFriendPairOffer(pending.offer);

    const built = buildFriendPairRedemption({
      offer: deepLink,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });
    expect(built.offer).toEqual(pending.offer);

    const recovered = decryptFriendPairRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending.ephPrivateKeyB64,
    });
    expect(recovered.displayName).toBe("Bob");
  });

  test("3.b/1a: includes selfServerId + selfRelayEndpoint when caller passes them", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending = mintPendingOffer({ alice });

    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
      selfServerId: "srv_bob_e2e",
      selfRelayEndpoint: "relay.claws.company:443",
    });
    expect(built.candidate.serverId).toBe("srv_bob_e2e");
    expect(built.candidate.relayEndpoint).toBe("relay.claws.company:443");

    const recovered = decryptFriendPairRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending.ephPrivateKeyB64,
    });
    expect(recovered.serverId).toBe("srv_bob_e2e");
    expect(recovered.relayEndpoint).toBe("relay.claws.company:443");
  });

  test("3.b/1a: omits routing fields when caller doesn't pass them (back-compat)", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending = mintPendingOffer({ alice });

    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });
    expect(built.candidate.serverId).toBeUndefined();
    expect(built.candidate.relayEndpoint).toBeUndefined();
  });

  test("two redemptions for the same offer use distinct ephemeral keys + signatures", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending = mintPendingOffer({ alice });

    const a = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });
    const b = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });
    expect(a.localSecrets.ephPrivateKeyB64).not.toBe(b.localSecrets.ephPrivateKeyB64);
    expect(a.redemption.candidateEphPublicKeyB64).not.toBe(b.redemption.candidateEphPublicKeyB64);
    // Signature is bound to the eph keys, so it must differ across attempts.
    expect(a.candidate.signatureB64).not.toBe(b.candidate.signatureB64);
  });

  test("rejects a stale offer past its expiry", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const t0 = 1_700_000_000_000;
    const pending = mintPendingOffer({ alice, nowMs: t0, ttlMs: 1000 });

    expect(() =>
      buildFriendPairRedemption({
        offer: pending.offer,
        selfRootSignPublicKeyB64: bob.signPublicKeyB64,
        selfRootSignPrivateKey: bob.signPrivateKey,
        selfDisplayName: "Bob",
        nowMs: t0 + 2000,
      }),
    ).toThrow(/expired/i);
  });

  test("rejects empty / overlong display names", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending = mintPendingOffer({ alice });
    for (const bad of ["", "   ", "x".repeat(65)]) {
      expect(() =>
        buildFriendPairRedemption({
          offer: pending.offer,
          selfRootSignPublicKeyB64: bob.signPublicKeyB64,
          selfRootSignPrivateKey: bob.signPrivateKey,
          selfDisplayName: bad,
        }),
      ).toThrow(/displayName/i);
    }
  });

  test("decrypt fails when Alice uses the wrong ephemeral private key", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pendingA = mintPendingOffer({ alice });
    const pendingB = mintPendingOffer({ alice });

    const built = buildFriendPairRedemption({
      offer: pendingA.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });

    expect(() =>
      decryptFriendPairRedemption({
        redemption: built.redemption,
        ephPrivateKeyB64: pendingB.ephPrivateKeyB64,
      }),
    ).toThrow();
  });

  test("decrypt fails when ciphertext has been tampered with", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending = mintPendingOffer({ alice });
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });

    const original = built.redemption.ciphertextB64;
    // Flip one base64 character somewhere past the 24-byte nonce header.
    const tamperIndex = original.length - 5;
    const flipped =
      original.slice(0, tamperIndex) +
      (original[tamperIndex] === "A" ? "B" : "A") +
      original.slice(tamperIndex + 1);

    expect(() =>
      decryptFriendPairRedemption({
        redemption: { ...built.redemption, ciphertextB64: flipped },
        ephPrivateKeyB64: pending.ephPrivateKeyB64,
      }),
    ).toThrow();
  });
});

describe("verifyFriendCandidate — signature edge cases", () => {
  test("rejects a candidate whose claimed root pubkey doesn't match the signer", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const eve = mintRootKeys();
    const pending = mintPendingOffer({ alice });

    // Bob signs but the candidate is forged to claim Eve's pubkey.
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });
    const decrypted = decryptFriendPairRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending.ephPrivateKeyB64,
    });
    const tampered = { ...decrypted, rootSignPublicKeyB64: eve.signPublicKeyB64 };

    const outcome = verifyFriendCandidate({
      candidate: tampered,
      offer: pending.offer,
      redemption: built.redemption,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/signature/i);
  });

  test("rejects a candidate whose signature was forged by the wrong root key", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const eve = mintRootKeys();
    const pending = mintPendingOffer({ alice });

    // Eve tries to send a redemption claiming Bob's identity. She doesn't
    // have Bob's private key, so she signs with her own — verifyFriendCandidate
    // should reject because the sig won't verify under bob.signPublicKeyB64.
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: eve.signPrivateKey,
      selfDisplayName: "Eve-pretending-to-be-Bob",
    });

    const decrypted = decryptFriendPairRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending.ephPrivateKeyB64,
    });
    const outcome = verifyFriendCandidate({
      candidate: decrypted,
      offer: pending.offer,
      redemption: built.redemption,
    });
    expect(outcome.ok).toBe(false);
  });

  test("rejects a candidate replayed against a different offer (different nonce)", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending1 = mintPendingOffer({ alice });
    const pending2 = mintPendingOffer({ alice });

    const built = buildFriendPairRedemption({
      offer: pending1.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });
    const decrypted = decryptFriendPairRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending1.ephPrivateKeyB64,
    });

    // Pretend Alice tried to verify the redemption against a different
    // outstanding offer she had open. The signature is bound to pending1's
    // nonce + ephPub, so verification must fail under pending2.
    const outcome = verifyFriendCandidate({
      candidate: decrypted,
      offer: pending2.offer,
      redemption: built.redemption,
    });
    expect(outcome.ok).toBe(false);
  });

  test("rejects a candidate when the envelope's eph pubkey is swapped", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending = mintPendingOffer({ alice });
    const decoyKeyPair = generateKeyPairSync("x25519");
    const decoyEphPubKeyB64 = (decoyKeyPair.publicKey.export({ format: "jwk" }) as { x: string }).x;

    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });
    const decrypted = decryptFriendPairRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending.ephPrivateKeyB64,
    });

    const swappedRedemption: FriendPairRedemption = {
      ...built.redemption,
      candidateEphPublicKeyB64: decoyEphPubKeyB64,
    };
    const outcome = verifyFriendCandidate({
      candidate: decrypted,
      offer: pending.offer,
      redemption: swappedRedemption,
    });
    expect(outcome.ok).toBe(false);
  });

  test("returns a structured reason on unparseable claimed root pubkey", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const pending = mintPendingOffer({ alice });
    const built = buildFriendPairRedemption({
      offer: pending.offer,
      selfRootSignPublicKeyB64: bob.signPublicKeyB64,
      selfRootSignPrivateKey: bob.signPrivateKey,
      selfDisplayName: "Bob",
    });
    const decrypted = decryptFriendPairRedemption({
      redemption: built.redemption,
      ephPrivateKeyB64: pending.ephPrivateKeyB64,
    });
    const tampered = { ...decrypted, rootSignPublicKeyB64: "@@@not-base64@@@" };

    const outcome = verifyFriendCandidate({
      candidate: tampered,
      offer: pending.offer,
      redemption: built.redemption,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/unparseable|signature/i);
  });
});
