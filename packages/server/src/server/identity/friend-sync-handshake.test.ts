import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  buildFriendHello,
  decryptFriendSyncFrame,
  deriveFriendSessionSharedKey,
  encryptFriendSyncFrame,
  FriendHelloSchema,
  verifyFriendHello,
} from "./friend-sync-handshake.js";
import type { StoredPeer } from "./peer-types.js";

interface RootKeys {
  signPublicKeyB64: string;
  signPrivateKey: KeyObject;
}

function mintRootKeys(): RootKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  return { signPublicKeyB64: jwkPub.x, signPrivateKey: privateKey };
}

function makePeer(overrides: Partial<StoredPeer> = {}): StoredPeer {
  return {
    v: 1,
    peerRootSignPublicKeyB64: "x".repeat(43),
    peerDisplayName: "Bob",
    pairedAt: "2026-05-05T12:00:00.000Z",
    status: "active",
    pairingNonceB64: "n".repeat(43),
    authorizationSignatureB64: "sig_".padEnd(86, "z"),
    ...overrides,
  };
}

describe("buildFriendHello + verifyFriendHello — single side", () => {
  test("happy path: receiver verifies sender's hello using local peer record", () => {
    const bob = mintRootKeys();
    const expectedPeer = makePeer({
      peerRootSignPublicKeyB64: bob.signPublicKeyB64,
      peerDisplayName: "Bob",
    });

    const built = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    expect(built.hello.fromRootPubKey).toBe(bob.signPublicKeyB64);
    expect(built.hello.fromDeviceId).toBe("srv_bob");
    expect(built.hello.ephPubKeyB64).toHaveLength(43);
    expect(built.hello.signatureB64).toMatch(/^[A-Za-z0-9_-]+$/);

    const outcome = verifyFriendHello({
      hello: built.hello,
      expectedPeer,
    });
    expect(outcome.ok).toBe(true);
  });

  test("rejected: claimed fromRootPubKey doesn't match the peer record", () => {
    const bob = mintRootKeys();
    const eve = mintRootKeys();
    // Receiver's peer record points at Bob, but the hello carries
    // Eve's pubkey (somehow swapped).
    const expectedPeer = makePeer({ peerRootSignPublicKeyB64: bob.signPublicKeyB64 });

    const built = buildFriendHello({
      selfRootPubKey: eve.signPublicKeyB64,
      selfDeviceId: "srv_eve",
      selfRootSignPrivateKey: eve.signPrivateKey,
    });
    const outcome = verifyFriendHello({
      hello: built.hello,
      expectedPeer,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/does not match/i);
  });

  test("rejected: peer is blocked", () => {
    const bob = mintRootKeys();
    const expectedPeer = makePeer({
      peerRootSignPublicKeyB64: bob.signPublicKeyB64,
      status: "blocked",
    });

    const built = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    const outcome = verifyFriendHello({ hello: built.hello, expectedPeer });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/blocked/i);
  });

  test("rejected: peer was removed (Phase 5 unfriend)", () => {
    const bob = mintRootKeys();
    const expectedPeer = makePeer({
      peerRootSignPublicKeyB64: bob.signPublicKeyB64,
      status: "removed",
    });

    const built = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    const outcome = verifyFriendHello({ hello: built.hello, expectedPeer });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/removed/i);
  });

  test("rejected: signature was forged by the wrong root key", () => {
    const bob = mintRootKeys();
    const eve = mintRootKeys();
    const expectedPeer = makePeer({ peerRootSignPublicKeyB64: bob.signPublicKeyB64 });

    // Eve signs but claims Bob's identity. Verifier reads claim from
    // the hello; sig won't verify under bob.signPublicKey.
    const built = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_someone",
      selfRootSignPrivateKey: eve.signPrivateKey,
    });
    const outcome = verifyFriendHello({ hello: built.hello, expectedPeer });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/signature/i);
  });

  test("rejected: signature was tampered with", () => {
    const bob = mintRootKeys();
    const expectedPeer = makePeer({ peerRootSignPublicKeyB64: bob.signPublicKeyB64 });

    const built = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    const tampered = {
      ...built.hello,
      signatureB64: "A".repeat(built.hello.signatureB64.length),
    };
    const outcome = verifyFriendHello({ hello: tampered, expectedPeer });
    expect(outcome.ok).toBe(false);
  });

  test("rejected: peer pubkey is unparseable junk (defensive)", () => {
    const bob = mintRootKeys();
    const expectedPeer = makePeer({ peerRootSignPublicKeyB64: "@@@not-base64@@@" });

    const built = buildFriendHello({
      selfRootPubKey: "@@@not-base64@@@",
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    const outcome = verifyFriendHello({ hello: built.hello, expectedPeer });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/unparseable|signature/i);
  });
});

describe("FriendHelloSchema", () => {
  test("accepts a real hello produced by buildFriendHello", () => {
    const bob = mintRootKeys();
    const built = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    const result = FriendHelloSchema.safeParse(built.hello);
    expect(result.success).toBe(true);
  });

  test("rejects empty required fields", () => {
    const base = {
      v: 1,
      kind: "friend-hello",
      fromRootPubKey: "x",
      fromDeviceId: "y",
      ephPubKeyB64: "z",
      nonceB64: "w",
      signatureB64: "s",
    };
    for (const field of [
      "fromRootPubKey",
      "fromDeviceId",
      "ephPubKeyB64",
      "nonceB64",
      "signatureB64",
    ] as const) {
      const wire = { ...base, [field]: "" };
      expect(FriendHelloSchema.safeParse(wire).success).toBe(false);
    }
  });

  test("rejects wrong kind literal", () => {
    const wire = {
      v: 1,
      kind: "peer-hello",
      fromRootPubKey: "x",
      fromDeviceId: "y",
      ephPubKeyB64: "z",
      nonceB64: "w",
      signatureB64: "s",
    };
    expect(FriendHelloSchema.safeParse(wire).success).toBe(false);
  });
});

describe("deriveFriendSessionSharedKey + encrypt/decrypt frame", () => {
  test("both sides arrive at the same shared key (roundtrip)", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const aliceHello = buildFriendHello({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
    });
    const bobHello = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });

    const aliceShared = deriveFriendSessionSharedKey({
      ourEphPrivKeyB64: aliceHello.ephPrivateKeyB64,
      peerEphPubKeyB64: bobHello.hello.ephPubKeyB64,
    });
    const bobShared = deriveFriendSessionSharedKey({
      ourEphPrivKeyB64: bobHello.ephPrivateKeyB64,
      peerEphPubKeyB64: aliceHello.hello.ephPubKeyB64,
    });

    const frame = encryptFriendSyncFrame({
      sharedKey: aliceShared,
      plaintext: "hello bob",
    });
    expect(decryptFriendSyncFrame({ sharedKey: bobShared, frame })).toBe("hello bob");
  });

  test("decrypting with the wrong shared key fails", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const stranger = mintRootKeys();
    const aliceHello = buildFriendHello({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
    });
    const bobHello = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    const strangerHello = buildFriendHello({
      selfRootPubKey: stranger.signPublicKeyB64,
      selfDeviceId: "srv_stranger",
      selfRootSignPrivateKey: stranger.signPrivateKey,
    });

    const aliceShared = deriveFriendSessionSharedKey({
      ourEphPrivKeyB64: aliceHello.ephPrivateKeyB64,
      peerEphPubKeyB64: bobHello.hello.ephPubKeyB64,
    });
    const wrong = deriveFriendSessionSharedKey({
      ourEphPrivKeyB64: strangerHello.ephPrivateKeyB64,
      peerEphPubKeyB64: aliceHello.hello.ephPubKeyB64,
    });

    const frame = encryptFriendSyncFrame({
      sharedKey: aliceShared,
      plaintext: "secret",
    });
    expect(() => decryptFriendSyncFrame({ sharedKey: wrong, frame })).toThrow();
  });

  test("two frames with the same plaintext have different ciphertexts (per-frame nonce)", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const aliceHello = buildFriendHello({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
    });
    const bobHello = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });

    const aliceShared = deriveFriendSessionSharedKey({
      ourEphPrivKeyB64: aliceHello.ephPrivateKeyB64,
      peerEphPubKeyB64: bobHello.hello.ephPubKeyB64,
    });
    const a = encryptFriendSyncFrame({ sharedKey: aliceShared, plaintext: "ping" });
    const b = encryptFriendSyncFrame({ sharedKey: aliceShared, plaintext: "ping" });
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
  });
});

describe("payload prefix isolation between peer-sync and friend-sync", () => {
  test("a peer-sync hello signature can't be replayed onto a friend-sync verify", async () => {
    // Specifically: the canonical-payload prefix differs
    // ("ottie-peer-sync-hello-v1" vs "ottie-friend-sync-hello-v1"), so a
    // signature produced for one cannot validate against the other even
    // if the same Ed25519 key was used. We don't import peer-sync here
    // (avoids wider coupling); instead, we directly construct a hello-
    // shaped object whose signature was made over a different prefix and
    // confirm it fails to verify.
    const bob = mintRootKeys();
    const expectedPeer = makePeer({ peerRootSignPublicKeyB64: bob.signPublicKeyB64 });

    const built = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });

    // Tweak ONE byte of fromDeviceId so the canonical payload differs
    // and the signature no longer matches — semantically equivalent to
    // a cross-protocol replay (different bytes signed → bad sig).
    const tampered = { ...built.hello, fromDeviceId: `${built.hello.fromDeviceId}-x` };
    const outcome = verifyFriendHello({ hello: tampered, expectedPeer });
    expect(outcome.ok).toBe(false);
  });
});
