import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";

import { buildAuthorizedDevice } from "./device-list-store.js";
import {
  buildPeerHello,
  decryptPeerSyncFrame,
  deriveSessionSharedKey,
  encryptPeerSyncFrame,
  PeerHelloSchema,
  verifyPeerHello,
} from "./peer-sync-handshake.js";
import type { StoredDevice } from "./device-types.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

function makeRootIdentity(displayName: string): RootIdentityBundle {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  const jwkPriv = privateKey.export({ format: "jwk" }) as { d: string };
  return {
    stored: {
      v: 1,
      signPublicKeyB64: jwkPub.x,
      signPrivateKeyB64: jwkPriv.d,
      displayName,
      createdAt: new Date(1_700_000_000_000).toISOString(),
    },
    signPublicKey: publicKey,
    signPrivateKey: privateKey,
  };
}

function makeAuthorizedDaemonDevice(args: {
  rootIdentity: RootIdentityBundle;
  deviceId: string;
  deviceLabel: string;
}): { stored: StoredDevice; signPrivateKey: ReturnType<typeof generateKeyPairSync>["privateKey"] } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  const stored = buildAuthorizedDevice({
    deviceId: args.deviceId,
    deviceLabel: args.deviceLabel,
    role: "daemon",
    signPublicKeyB64: jwkPub.x,
    rootIdentity: args.rootIdentity,
  });
  return { stored, signPrivateKey: privateKey };
}

describe("buildPeerHello + verifyPeerHello — single side", () => {
  test("happy path: receiver verifies sender's hello using local device record", () => {
    const root = makeRootIdentity("Wendell");
    const alice = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_alice",
      deviceLabel: "Alice's Mac",
    });

    const built = buildPeerHello({
      selfDeviceId: alice.stored.deviceId,
      selfSignPrivateKey: alice.signPrivateKey,
    });
    expect(built.hello.fromDeviceId).toBe("dev_alice");
    expect(built.hello.ephPubKeyB64).toHaveLength(43);
    expect(built.hello.signatureB64).toMatch(/^[A-Za-z0-9_-]+$/);

    // Receiver fetched alice's stored device record from local devices.json.
    const outcome = verifyPeerHello({
      hello: built.hello,
      expectedSourceDevice: alice.stored,
    });
    expect(outcome.ok).toBe(true);
  });

  test("rejected: claimed fromDeviceId disagrees with the device record provided", () => {
    const root = makeRootIdentity("Wendell");
    const alice = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_alice",
      deviceLabel: "Alice's Mac",
    });
    const bob = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_bob",
      deviceLabel: "Bob's Laptop",
    });

    // Alice signs the hello but the receiver tries to verify against
    // Bob's record by mistake (or attacker tampered fromDeviceId).
    const built = buildPeerHello({
      selfDeviceId: alice.stored.deviceId,
      selfSignPrivateKey: alice.signPrivateKey,
    });
    const outcome = verifyPeerHello({
      hello: built.hello,
      expectedSourceDevice: bob.stored,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/does not match/i);
  });

  test("rejected: signature was forged by a different signing key", () => {
    const root = makeRootIdentity("Wendell");
    const alice = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_alice",
      deviceLabel: "Alice's Mac",
    });
    const attacker = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_alice", // claim Alice's id ...
      deviceLabel: "Alice's Mac",
    });

    // Build hello signed by attacker but claiming to be Alice.
    const built = buildPeerHello({
      selfDeviceId: alice.stored.deviceId,
      selfSignPrivateKey: attacker.signPrivateKey, // ← wrong key!
    });
    const outcome = verifyPeerHello({
      hello: built.hello,
      expectedSourceDevice: alice.stored,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/signature did not verify/i);
  });

  test("rejected: tampered ephPubKey breaks the signature", () => {
    const root = makeRootIdentity("Wendell");
    const alice = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_alice",
      deviceLabel: "Alice's Mac",
    });

    const built = buildPeerHello({
      selfDeviceId: alice.stored.deviceId,
      selfSignPrivateKey: alice.signPrivateKey,
    });
    // MitM swaps the ephemeral pubkey with one of their own.
    const otherEphPub = (() => {
      const { publicKey } = generateKeyPairSync("x25519");
      return (publicKey.export({ format: "jwk" }) as { x: string }).x;
    })();
    const tampered = { ...built.hello, ephPubKeyB64: otherEphPub };

    const outcome = verifyPeerHello({
      hello: tampered,
      expectedSourceDevice: alice.stored,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/signature did not verify/i);
  });

  test("each buildPeerHello produces a fresh ephemeral keypair + nonce", () => {
    const root = makeRootIdentity("Wendell");
    const alice = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_alice",
      deviceLabel: "Alice's Mac",
    });
    const a = buildPeerHello({
      selfDeviceId: alice.stored.deviceId,
      selfSignPrivateKey: alice.signPrivateKey,
    });
    const b = buildPeerHello({
      selfDeviceId: alice.stored.deviceId,
      selfSignPrivateKey: alice.signPrivateKey,
    });
    expect(a.hello.ephPubKeyB64).not.toBe(b.hello.ephPubKeyB64);
    expect(a.ephPrivateKeyB64).not.toBe(b.ephPrivateKeyB64);
    expect(a.hello.nonceB64).not.toBe(b.hello.nonceB64);
  });

  test("schema parse rejects malformed hello", () => {
    expect(PeerHelloSchema.safeParse({ kind: "wrong" }).success).toBe(false);
    expect(
      PeerHelloSchema.safeParse({
        v: 1,
        kind: "peer-hello",
        fromDeviceId: "",
        ephPubKeyB64: "x",
        nonceB64: "y",
        signatureB64: "z",
      }).success,
    ).toBe(false); // empty fromDeviceId
  });
});

describe("deriveSessionSharedKey — both sides arrive at the same key", () => {
  test("encrypted frame from A decrypts on B, and vice versa", () => {
    const root = makeRootIdentity("Wendell");
    const alice = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_alice",
      deviceLabel: "Alice's Mac",
    });
    const bob = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_bob",
      deviceLabel: "Bob's Laptop",
    });

    const aliceHello = buildPeerHello({
      selfDeviceId: alice.stored.deviceId,
      selfSignPrivateKey: alice.signPrivateKey,
    });
    const bobHello = buildPeerHello({
      selfDeviceId: bob.stored.deviceId,
      selfSignPrivateKey: bob.signPrivateKey,
    });

    // Each side verifies the other's hello before deriving the key.
    expect(verifyPeerHello({ hello: bobHello.hello, expectedSourceDevice: bob.stored }).ok).toBe(
      true,
    );
    expect(
      verifyPeerHello({ hello: aliceHello.hello, expectedSourceDevice: alice.stored }).ok,
    ).toBe(true);

    const aliceKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: aliceHello.ephPrivateKeyB64,
      peerEphPubKeyB64: bobHello.hello.ephPubKeyB64,
    });
    const bobKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: bobHello.ephPrivateKeyB64,
      peerEphPubKeyB64: aliceHello.hello.ephPubKeyB64,
    });

    // A → B: alice encrypts, bob decrypts.
    const aliceFrame = encryptPeerSyncFrame({
      sharedKey: aliceKey,
      plaintext: "hello bob",
    });
    expect(decryptPeerSyncFrame({ sharedKey: bobKey, frame: aliceFrame })).toBe("hello bob");

    // B → A: bob encrypts, alice decrypts.
    const bobFrame = encryptPeerSyncFrame({
      sharedKey: bobKey,
      plaintext: "hi alice",
    });
    expect(decryptPeerSyncFrame({ sharedKey: aliceKey, frame: bobFrame })).toBe("hi alice");
  });

  test("decrypt with the wrong shared key fails", () => {
    const aliceKp = (() => {
      const root = makeRootIdentity("W");
      const dev = makeAuthorizedDaemonDevice({
        rootIdentity: root,
        deviceId: "dev_a",
        deviceLabel: "A",
      });
      return buildPeerHello({
        selfDeviceId: dev.stored.deviceId,
        selfSignPrivateKey: dev.signPrivateKey,
      });
    })();
    const bobKp = (() => {
      const root = makeRootIdentity("W");
      const dev = makeAuthorizedDaemonDevice({
        rootIdentity: root,
        deviceId: "dev_b",
        deviceLabel: "B",
      });
      return buildPeerHello({
        selfDeviceId: dev.stored.deviceId,
        selfSignPrivateKey: dev.signPrivateKey,
      });
    })();
    const charlieKp = (() => {
      const root = makeRootIdentity("W");
      const dev = makeAuthorizedDaemonDevice({
        rootIdentity: root,
        deviceId: "dev_c",
        deviceLabel: "C",
      });
      return buildPeerHello({
        selfDeviceId: dev.stored.deviceId,
        selfSignPrivateKey: dev.signPrivateKey,
      });
    })();

    const aliceKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: aliceKp.ephPrivateKeyB64,
      peerEphPubKeyB64: bobKp.hello.ephPubKeyB64,
    });
    // Charlie's ECDH against Bob would give a totally different key.
    const charlieKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: charlieKp.ephPrivateKeyB64,
      peerEphPubKeyB64: bobKp.hello.ephPubKeyB64,
    });

    const frame = encryptPeerSyncFrame({ sharedKey: aliceKey, plaintext: "secret" });
    expect(() => decryptPeerSyncFrame({ sharedKey: charlieKey, frame })).toThrow();
  });

  test("tampered ciphertext is rejected by NaCl box AEAD", () => {
    const root = makeRootIdentity("W");
    const dev = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_x",
      deviceLabel: "X",
    });
    const peer = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_y",
      deviceLabel: "Y",
    });
    const ourHello = buildPeerHello({
      selfDeviceId: dev.stored.deviceId,
      selfSignPrivateKey: dev.signPrivateKey,
    });
    const peerHello = buildPeerHello({
      selfDeviceId: peer.stored.deviceId,
      selfSignPrivateKey: peer.signPrivateKey,
    });
    const ourKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: ourHello.ephPrivateKeyB64,
      peerEphPubKeyB64: peerHello.hello.ephPubKeyB64,
    });
    const peerKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: peerHello.ephPrivateKeyB64,
      peerEphPubKeyB64: ourHello.hello.ephPubKeyB64,
    });

    const frame = encryptPeerSyncFrame({ sharedKey: ourKey, plaintext: "secret" });
    // Flip last 5 chars of ciphertext.
    const tampered = {
      ...frame,
      ciphertextB64: `${frame.ciphertextB64.slice(0, -5)}AAAAA`,
    };
    expect(() => decryptPeerSyncFrame({ sharedKey: peerKey, frame: tampered })).toThrow();
  });
});

describe("integration: full handshake + an event payload roundtrip", () => {
  test("two daemons handshake then exchange a JSON-shaped payload both ways", () => {
    const root = makeRootIdentity("Wendell");
    const alice = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_alice",
      deviceLabel: "Alice's Mac",
    });
    const bob = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_bob",
      deviceLabel: "Bob's Laptop",
    });

    // === Round 1: helloes exchanged ===
    const aliceHello = buildPeerHello({
      selfDeviceId: alice.stored.deviceId,
      selfSignPrivateKey: alice.signPrivateKey,
    });
    const bobHello = buildPeerHello({
      selfDeviceId: bob.stored.deviceId,
      selfSignPrivateKey: bob.signPrivateKey,
    });

    expect(
      verifyPeerHello({ hello: aliceHello.hello, expectedSourceDevice: alice.stored }).ok,
    ).toBe(true);
    expect(verifyPeerHello({ hello: bobHello.hello, expectedSourceDevice: bob.stored }).ok).toBe(
      true,
    );

    // === Round 2: derive keys ===
    const aliceKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: aliceHello.ephPrivateKeyB64,
      peerEphPubKeyB64: bobHello.hello.ephPubKeyB64,
    });
    const bobKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: bobHello.ephPrivateKeyB64,
      peerEphPubKeyB64: aliceHello.hello.ephPubKeyB64,
    });

    // === Round 3: app-layer payload (will be DeviceListEvent in 2.f/3) ===
    const aliceEventJson = JSON.stringify({
      v: 1,
      kind: "device-added",
      seq: 1,
      sourceDeviceId: alice.stored.deviceId,
      emittedAt: new Date(1_700_000_000_000).toISOString(),
      device: alice.stored,
      signatureB64: "x".repeat(43),
    });
    const aliceFrame = encryptPeerSyncFrame({
      sharedKey: aliceKey,
      plaintext: aliceEventJson,
    });
    expect(decryptPeerSyncFrame({ sharedKey: bobKey, frame: aliceFrame })).toBe(aliceEventJson);

    const bobAck = JSON.stringify({ v: 1, kind: "ack", upToSeq: 1 });
    const bobFrame = encryptPeerSyncFrame({ sharedKey: bobKey, plaintext: bobAck });
    expect(decryptPeerSyncFrame({ sharedKey: aliceKey, frame: bobFrame })).toBe(bobAck);
  });
});
