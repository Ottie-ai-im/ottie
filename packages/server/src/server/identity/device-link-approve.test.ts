import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  approveDeviceLinkCandidate,
  decryptDeviceLinkApprovalEnvelope,
  rejectDeviceLinkCandidate,
} from "./device-link-approve.js";
import { DeviceLinkPendingStore } from "./device-link-pending-store.js";
import { buildDeviceLinkRedemption } from "./device-link-redeem.js";
import { deviceAuthorizationPayload } from "./device-types.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

/**
 * In-memory RootIdentityBundle for tests — avoids the disk-roundtrip
 * `createRootIdentity` would do. Generates a real Ed25519 keypair so the
 * signed-device authorization signatures still verify cryptographically.
 */
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

const OFFER_FIXTURE = {
  serverId: "srv_alice",
  rootSignPublicKeyB64: "x".repeat(43), // overwritten below by the real pubkey
  displayName: "Alice",
  relayEndpoint: "relay.claws.company:443",
};

/**
 * Sets up a realistic Phase 2.d → 2.e world:
 *   - Alice (OLD) has a root identity and a pending offer
 *   - Bob (NEW) builds a redemption against that offer
 *
 * Returns everything subsequent tests need to drive approve/reject.
 */
function setupApprovalWorld() {
  const aliceRoot = makeRootIdentity("Alice");
  const offerStore = new DeviceLinkPendingStore();
  const { pending } = offerStore.create({
    ...OFFER_FIXTURE,
    rootSignPublicKeyB64: aliceRoot.stored.signPublicKeyB64,
  });

  const built = buildDeviceLinkRedemption({
    offer: pending.offer,
    deviceLabel: "Bob's Phone",
    role: "client",
  });

  return {
    aliceRoot,
    pending,
    candidate: built.candidate,
    newDeviceEphPublicKeyB64: built.redemption.newDeviceEphPublicKeyB64,
    newDeviceEphPrivateKeyB64: built.localSecrets.ephPrivateKeyB64,
  };
}

function ed25519VerifyAuthorization(args: {
  signedDevice: ReturnType<typeof approveDeviceLinkCandidate>["signedDevice"];
  rootSignPublicKey: KeyObject;
}): boolean {
  const payload = deviceAuthorizationPayload({
    deviceId: args.signedDevice.deviceId,
    signPublicKeyB64: args.signedDevice.signPublicKeyB64,
    role: args.signedDevice.role,
    authorizedAt: args.signedDevice.authorizedAt,
  });
  const sigBytes = Buffer.from(
    args.signedDevice.authorizationSignatureB64.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (args.signedDevice.authorizationSignatureB64.length % 4)) % 4),
    "base64",
  );
  return verify(null, Buffer.from(payload, "utf8"), args.rootSignPublicKey, sigBytes);
}

describe("approveDeviceLinkCandidate + decryptDeviceLinkApprovalEnvelope", () => {
  test("happy path: roundtrips an approved reply and signs the candidate", () => {
    const w = setupApprovalWorld();

    const result = approveDeviceLinkCandidate({
      candidate: w.candidate,
      ephPrivateKeyB64: w.pending.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: w.newDeviceEphPublicKeyB64,
      rootIdentity: w.aliceRoot,
      existingDevices: [],
    });

    expect(result.signedDevice.deviceId).toBe(w.candidate.deviceId);
    expect(result.signedDevice.deviceLabel).toBe("Bob's Phone");
    expect(result.signedDevice.role).toBe("client");
    expect(result.signedDevice.signPublicKeyB64).toBe(w.candidate.signPublicKeyB64);
    expect(result.signedDevice.authorizationSignatureB64).toMatch(/^[A-Za-z0-9_-]+$/);

    // The signature actually verifies under Alice's root pubkey.
    expect(
      ed25519VerifyAuthorization({
        signedDevice: result.signedDevice,
        rootSignPublicKey: w.aliceRoot.signPublicKey,
      }),
    ).toBe(true);

    // New device decrypts the envelope and recovers the full reply.
    const recovered = decryptDeviceLinkApprovalEnvelope({
      envelope: result.envelope,
      newDeviceEphPrivateKeyB64: w.newDeviceEphPrivateKeyB64,
      offerEphPublicKeyB64: w.pending.offer.ephPublicKeyB64,
    });

    expect(recovered.status).toBe("approved");
    if (recovered.status !== "approved") return;
    expect(recovered.signedDevice).toEqual(result.signedDevice);
    expect(recovered.rootIdentity).toEqual(w.aliceRoot.stored);
    expect(recovered.peerDevices).toEqual([result.signedDevice]);
  });

  test("includes existing devices in the peer-list snapshot", () => {
    const w = setupApprovalWorld();
    const existingPeer = {
      v: 1 as const,
      deviceId: "dev_alice_laptop",
      deviceLabel: "Alice's Laptop",
      role: "daemon" as const,
      signPublicKeyB64: "y".repeat(43),
      authorizedAt: new Date(1_700_000_000_000).toISOString(),
      authorizationSignatureB64: "z".repeat(43),
    };

    const result = approveDeviceLinkCandidate({
      candidate: w.candidate,
      ephPrivateKeyB64: w.pending.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: w.newDeviceEphPublicKeyB64,
      rootIdentity: w.aliceRoot,
      existingDevices: [existingPeer],
    });

    const recovered = decryptDeviceLinkApprovalEnvelope({
      envelope: result.envelope,
      newDeviceEphPrivateKeyB64: w.newDeviceEphPrivateKeyB64,
      offerEphPublicKeyB64: w.pending.offer.ephPublicKeyB64,
    });

    expect(recovered.status).toBe("approved");
    if (recovered.status !== "approved") return;
    expect(recovered.peerDevices).toHaveLength(2);
    expect(recovered.peerDevices[0]).toEqual(existingPeer);
    expect(recovered.peerDevices[1]).toEqual(result.signedDevice);
  });

  test("ships the root private key inside the envelope (deliberate, see header doc)", () => {
    const w = setupApprovalWorld();
    const result = approveDeviceLinkCandidate({
      candidate: w.candidate,
      ephPrivateKeyB64: w.pending.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: w.newDeviceEphPublicKeyB64,
      rootIdentity: w.aliceRoot,
      existingDevices: [],
    });
    const recovered = decryptDeviceLinkApprovalEnvelope({
      envelope: result.envelope,
      newDeviceEphPrivateKeyB64: w.newDeviceEphPrivateKeyB64,
      offerEphPublicKeyB64: w.pending.offer.ephPublicKeyB64,
    });
    expect(recovered.status).toBe("approved");
    if (recovered.status !== "approved") return;
    // The new device gets a working signing keypair so it can sign
    // future devices itself. This is a deliberate trust replication —
    // documented in device-link-approve-types.ts header comment.
    expect(recovered.rootIdentity.signPrivateKeyB64).toBe(w.aliceRoot.stored.signPrivateKeyB64);
    expect(recovered.rootIdentity.signPublicKeyB64).toBe(w.aliceRoot.stored.signPublicKeyB64);
  });

  test("envelope ciphertext is opaque to anyone without the right keys", () => {
    const w = setupApprovalWorld();
    const result = approveDeviceLinkCandidate({
      candidate: w.candidate,
      ephPrivateKeyB64: w.pending.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: w.newDeviceEphPublicKeyB64,
      rootIdentity: w.aliceRoot,
      existingDevices: [],
    });

    // Wrong ephemeral private (eg. a relay attacker who forged a key)
    // cannot decrypt the reply.
    const otherStore = new DeviceLinkPendingStore();
    const otherPending = otherStore.create(OFFER_FIXTURE).pending;
    expect(() =>
      decryptDeviceLinkApprovalEnvelope({
        envelope: result.envelope,
        newDeviceEphPrivateKeyB64: otherPending.ephPrivateKeyB64,
        offerEphPublicKeyB64: w.pending.offer.ephPublicKeyB64,
      }),
    ).toThrow();
  });

  test("tampered ciphertext is rejected", () => {
    const w = setupApprovalWorld();
    const result = approveDeviceLinkCandidate({
      candidate: w.candidate,
      ephPrivateKeyB64: w.pending.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: w.newDeviceEphPublicKeyB64,
      rootIdentity: w.aliceRoot,
      existingDevices: [],
    });

    const original = result.envelope.ciphertextB64;
    const tampered = `${original.slice(0, -5)}AAAAA`;

    expect(() =>
      decryptDeviceLinkApprovalEnvelope({
        envelope: { ...result.envelope, ciphertextB64: tampered },
        newDeviceEphPrivateKeyB64: w.newDeviceEphPrivateKeyB64,
        offerEphPublicKeyB64: w.pending.offer.ephPublicKeyB64,
      }),
    ).toThrow();
  });
});

describe("rejectDeviceLinkCandidate", () => {
  test("encrypts a rejection reply that the new device decrypts back to status:rejected", () => {
    const w = setupApprovalWorld();
    const result = rejectDeviceLinkCandidate({
      ephPrivateKeyB64: w.pending.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: w.newDeviceEphPublicKeyB64,
      rejectionReason: "not the device I expected",
    });

    const recovered = decryptDeviceLinkApprovalEnvelope({
      envelope: result.envelope,
      newDeviceEphPrivateKeyB64: w.newDeviceEphPrivateKeyB64,
      offerEphPublicKeyB64: w.pending.offer.ephPublicKeyB64,
    });

    expect(recovered.status).toBe("rejected");
    if (recovered.status !== "rejected") return;
    expect(recovered.rejectionReason).toBe("not the device I expected");
  });

  test("rejection without a reason is fine — the field is optional on the wire", () => {
    const w = setupApprovalWorld();
    const result = rejectDeviceLinkCandidate({
      ephPrivateKeyB64: w.pending.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: w.newDeviceEphPublicKeyB64,
    });

    const recovered = decryptDeviceLinkApprovalEnvelope({
      envelope: result.envelope,
      newDeviceEphPrivateKeyB64: w.newDeviceEphPrivateKeyB64,
      offerEphPublicKeyB64: w.pending.offer.ephPublicKeyB64,
    });

    expect(recovered.status).toBe("rejected");
    if (recovered.status !== "rejected") return;
    expect(recovered.rejectionReason).toBeUndefined();
  });
});
