import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  approveFriendPairCandidate,
  decryptFriendPairApprovalEnvelope,
  rejectFriendPairCandidate,
  verifyFriendPairApproval,
} from "./friend-pair-approve.js";
import { buildFriendPairRedemption } from "./friend-pair-redeem.js";
import { FriendPairPendingStore } from "./friend-pair-pending-store.js";
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
      createdAt: "2026-05-05T12:00:00.000Z",
    },
    signPublicKey: publicKey,
    signPrivateKey: privateKey,
  };
}

interface BobKeys {
  signPublicKeyB64: string;
  signPrivateKey: KeyObject;
}

function makeBob(): BobKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  return { signPublicKeyB64: jwkPub.x, signPrivateKey: privateKey };
}

/**
 * End-to-end fixture: build an offer + redemption (3.a/2), simulating the
 * point in time when Alice's daemon is about to call approve. Returns
 * everything the approve helper needs.
 */
function setupApprovalContext() {
  const alice = makeRootIdentity("Alice");
  const bob = makeBob();
  const pendingOffers = new FriendPairPendingStore();
  const { pending } = pendingOffers.create({
    serverId: "srv_alice",
    rootSignPublicKeyB64: alice.stored.signPublicKeyB64,
    displayName: alice.stored.displayName,
    relayEndpoint: "relay.claws.company:443",
  });
  const built = buildFriendPairRedemption({
    offer: pending.offer,
    selfRootSignPublicKeyB64: bob.signPublicKeyB64,
    selfRootSignPrivateKey: bob.signPrivateKey,
    selfDisplayName: "Bob",
  });
  return {
    alice,
    bob,
    offer: pending.offer,
    aliceEphPrivateKeyB64: pending.ephPrivateKeyB64,
    candidate: built.candidate,
    candidateEphPublicKeyB64: built.redemption.candidateEphPublicKeyB64,
    bobEphPrivateKeyB64: built.localSecrets.ephPrivateKeyB64,
  };
}

describe("approveFriendPairCandidate + decryptFriendPairApprovalEnvelope + verifyFriendPairApproval", () => {
  test("happy path: approve roundtrips through encrypt+decrypt and signature verifies", () => {
    const ctx = setupApprovalContext();
    const result = approveFriendPairCandidate({
      candidate: ctx.candidate,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });

    expect(result.envelope.kind).toBe("friend-pair-approval-envelope");
    expect(result.reply.status).toBe("approved");
    if (result.reply.status !== "approved") return;
    expect(result.reply.originatorRootSignPublicKeyB64).toBe(ctx.alice.stored.signPublicKeyB64);
    expect(result.reply.originatorDisplayName).toBe("Alice");
    expect(result.reply.authorizationSignatureB64).toMatch(/^[A-Za-z0-9_-]+$/);

    const decrypted = decryptFriendPairApprovalEnvelope({
      envelope: result.envelope,
      candidateEphPrivateKeyB64: ctx.bobEphPrivateKeyB64,
      offerEphPublicKeyB64: ctx.offer.ephPublicKeyB64,
    });
    expect(decrypted).toEqual(result.reply);
    if (decrypted.status !== "approved") return;

    const sigOutcome = verifyFriendPairApproval({
      reply: decrypted,
      expectedOriginatorRootSignPublicKeyB64: ctx.offer.rootSignPublicKeyB64,
      responderRootSignPublicKeyB64: ctx.bob.signPublicKeyB64,
      pairingNonceB64: ctx.offer.nonceB64,
    });
    expect(sigOutcome.ok).toBe(true);
  });

  test("approve produces Alice's local Peer record for Bob", () => {
    const ctx = setupApprovalContext();
    const result = approveFriendPairCandidate({
      candidate: ctx.candidate,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });
    expect(result.selfPeer.peerRootSignPublicKeyB64).toBe(ctx.bob.signPublicKeyB64);
    expect(result.selfPeer.peerDisplayName).toBe("Bob");
    expect(result.selfPeer.status).toBe("active");
    expect(result.selfPeer.pairingNonceB64).toBe(ctx.offer.nonceB64);
    // Alice's Peer entry uses Bob's SIGMA-I sig from 3.a/2 as the auth proof.
    expect(result.selfPeer.authorizationSignatureB64).toBe(ctx.candidate.signatureB64);
  });

  test("3.b/1a: Alice's Peer captures Bob's serverId + relayEndpoint from the candidate", () => {
    const ctx = setupApprovalContext();
    // Inject routing fields into the candidate (same shape buildFriend
    // PairRedemption produces when called with selfServerId).
    const candidateWithRouting = {
      ...ctx.candidate,
      serverId: "srv_bob_routing",
      relayEndpoint: "relay.claws.company:443",
    };
    const result = approveFriendPairCandidate({
      candidate: candidateWithRouting,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });
    expect(result.selfPeer.peerServerId).toBe("srv_bob_routing");
    expect(result.selfPeer.peerRelayEndpoint).toBe("relay.claws.company:443");
  });

  test("3.b/1a: Peer record omits routing fields when candidate doesn't supply them", () => {
    const ctx = setupApprovalContext();
    const result = approveFriendPairCandidate({
      candidate: ctx.candidate,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });
    expect(result.selfPeer.peerServerId).toBeUndefined();
    expect(result.selfPeer.peerRelayEndpoint).toBeUndefined();
  });

  test("reject roundtrips with an optional reason", () => {
    const ctx = setupApprovalContext();
    const { envelope, reply } = rejectFriendPairCandidate({
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rejectionReason: "I don't recognize this person",
    });
    expect(reply.status).toBe("rejected");

    const decrypted = decryptFriendPairApprovalEnvelope({
      envelope,
      candidateEphPrivateKeyB64: ctx.bobEphPrivateKeyB64,
      offerEphPublicKeyB64: ctx.offer.ephPublicKeyB64,
    });
    if (decrypted.status !== "rejected") {
      throw new Error("expected rejected reply");
    }
    expect(decrypted.rejectionReason).toBe("I don't recognize this person");
  });

  test("reject without reason omits the field cleanly", () => {
    const ctx = setupApprovalContext();
    const { reply } = rejectFriendPairCandidate({
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
    });
    if (reply.status !== "rejected") {
      throw new Error("expected rejected reply");
    }
    expect("rejectionReason" in reply).toBe(false);
  });

  test("decrypt fails when ciphertext has been tampered with", () => {
    const ctx = setupApprovalContext();
    const { envelope } = approveFriendPairCandidate({
      candidate: ctx.candidate,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });
    const original = envelope.ciphertextB64;
    const tampered = `${original.slice(0, -5)}AAAAA`;
    expect(() =>
      decryptFriendPairApprovalEnvelope({
        envelope: { ...envelope, ciphertextB64: tampered },
        candidateEphPrivateKeyB64: ctx.bobEphPrivateKeyB64,
        offerEphPublicKeyB64: ctx.offer.ephPublicKeyB64,
      }),
    ).toThrow();
  });

  test("decrypt fails when Bob uses the wrong ephemeral private key", () => {
    const ctx = setupApprovalContext();
    const { envelope } = approveFriendPairCandidate({
      candidate: ctx.candidate,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });

    // Build a fresh redemption (different keys) and try to decrypt
    // Alice's reply with the wrong ephemeral private key.
    const otherStore = new FriendPairPendingStore();
    const otherPending = otherStore.create({
      serverId: "srv_other",
      rootSignPublicKeyB64: ctx.alice.stored.signPublicKeyB64,
      displayName: "Alice",
      relayEndpoint: "relay.claws.company:443",
    });
    const otherBuilt = buildFriendPairRedemption({
      offer: otherPending.pending.offer,
      selfRootSignPublicKeyB64: ctx.bob.signPublicKeyB64,
      selfRootSignPrivateKey: ctx.bob.signPrivateKey,
      selfDisplayName: "Bob",
    });

    expect(() =>
      decryptFriendPairApprovalEnvelope({
        envelope,
        candidateEphPrivateKeyB64: otherBuilt.localSecrets.ephPrivateKeyB64,
        offerEphPublicKeyB64: ctx.offer.ephPublicKeyB64,
      }),
    ).toThrow();
  });
});

describe("verifyFriendPairApproval — signature edge cases", () => {
  test("rejects a reply whose claimed originator pubkey doesn't match the offer", () => {
    const ctx = setupApprovalContext();
    const { reply } = approveFriendPairCandidate({
      candidate: ctx.candidate,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });
    if (reply.status !== "approved") return;

    const eve = makeRootIdentity("Eve");
    const outcome = verifyFriendPairApproval({
      reply,
      expectedOriginatorRootSignPublicKeyB64: eve.stored.signPublicKeyB64,
      responderRootSignPublicKeyB64: ctx.bob.signPublicKeyB64,
      pairingNonceB64: ctx.offer.nonceB64,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/originator pubkey/i);
  });

  test("rejects when the wrong responder pubkey is used in the verification call (replay)", () => {
    const ctx = setupApprovalContext();
    const { reply } = approveFriendPairCandidate({
      candidate: ctx.candidate,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });
    if (reply.status !== "approved") return;

    const someoneElse = makeBob();
    const outcome = verifyFriendPairApproval({
      reply,
      expectedOriginatorRootSignPublicKeyB64: ctx.offer.rootSignPublicKeyB64,
      responderRootSignPublicKeyB64: someoneElse.signPublicKeyB64,
      pairingNonceB64: ctx.offer.nonceB64,
    });
    expect(outcome.ok).toBe(false);
  });

  test("rejects when the pairing nonce doesn't match (replay across different offer)", () => {
    const ctx = setupApprovalContext();
    const { reply } = approveFriendPairCandidate({
      candidate: ctx.candidate,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });
    if (reply.status !== "approved") return;

    const outcome = verifyFriendPairApproval({
      reply,
      expectedOriginatorRootSignPublicKeyB64: ctx.offer.rootSignPublicKeyB64,
      responderRootSignPublicKeyB64: ctx.bob.signPublicKeyB64,
      pairingNonceB64: "different-nonce".padEnd(43, "x"),
    });
    expect(outcome.ok).toBe(false);
  });

  test("rejects a reply whose authorization signature was tampered with", () => {
    const ctx = setupApprovalContext();
    const { reply } = approveFriendPairCandidate({
      candidate: ctx.candidate,
      offer: ctx.offer,
      ephPrivateKeyB64: ctx.aliceEphPrivateKeyB64,
      candidateEphPublicKeyB64: ctx.candidateEphPublicKeyB64,
      rootIdentity: ctx.alice,
    });
    if (reply.status !== "approved") return;
    const tamperedReply = {
      ...reply,
      authorizationSignatureB64: "A".repeat(reply.authorizationSignatureB64.length),
    };
    const outcome = verifyFriendPairApproval({
      reply: tamperedReply,
      expectedOriginatorRootSignPublicKeyB64: ctx.offer.rootSignPublicKeyB64,
      responderRootSignPublicKeyB64: ctx.bob.signPublicKeyB64,
      pairingNonceB64: ctx.offer.nonceB64,
    });
    expect(outcome.ok).toBe(false);
  });
});
