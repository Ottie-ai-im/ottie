import { generateKeyPairSync } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  buildAiShareAcceptEnvelope,
  buildAiShareDeclineEnvelope,
  buildAiShareInviteEnvelope,
} from "./ai-share-crypto.js";
import { AiShareInviteRegistry } from "./ai-share-registry.js";

function makeIdentity(): {
  pubB64: string;
  privKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
} {
  const ed = generateKeyPairSync("ed25519");
  const x = (ed.publicKey.export({ format: "jwk" }) as { x?: string }).x;
  if (!x) throw new Error("missing jwk x");
  return { pubB64: x, privKey: ed.privateKey };
}

function makeInvite(
  ownerPriv: ReturnType<typeof makeIdentity>["privKey"],
  ownerPub: string,
  inviteId = "ais_test1",
) {
  return buildAiShareInviteEnvelope({
    inviteId,
    ownerRootSignPrivateKey: ownerPriv,
    ownerRootPubKeyB64: ownerPub,
    ownerDeviceId: "srv_owner",
    agentId: "agent_42",
    agentLabel: "Claude Code",
    agentProvider: "claude",
    generatedAt: "2026-05-07T03:00:00.000Z",
    expiresAt: "2026-05-07T03:05:00.000Z",
  });
}

describe("AiShareInviteRegistry — Phase 4 v2/a active-state lifecycle", () => {
  test("outbound: pending → active on accept → ended on self end", () => {
    const owner = makeIdentity();
    const responder = makeIdentity();
    const reg = new AiShareInviteRegistry();
    const invite = makeInvite(owner.privKey, owner.pubB64);

    reg.recordOutbound({ invite, peerRootPubKeyB64: responder.pubB64 });
    expect(reg.listActive()).toHaveLength(0);
    expect(reg.getActive(invite.inviteId)).toBeNull();

    const accept = buildAiShareAcceptEnvelope({
      inviteId: invite.inviteId,
      responderRootSignPrivateKey: responder.privKey,
      responderRootPubKeyB64: responder.pubB64,
      acceptedAt: "2026-05-07T03:01:00.000Z",
    });
    reg.applyOutboundAccept(accept);

    const active = reg.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]?.side).toBe("outbound");
    expect(active[0]?.peerRootPubKeyB64).toBe(responder.pubB64);
    expect(active[0]?.agentLabel).toBe("Claude Code");
    expect(reg.getActive(invite.inviteId)).not.toBeNull();

    reg.applyOutboundEnd({
      inviteId: invite.inviteId,
      endedBy: "self",
      endedAt: "2026-05-07T03:02:00.000Z",
      signatureB64: "sig_self",
      reason: "owner closed",
    });

    expect(reg.listActive()).toHaveLength(0);
    expect(reg.getActive(invite.inviteId)).toBeNull();
  });

  test("inbound: pending → active on accept → ended on peer end", () => {
    const owner = makeIdentity();
    const responder = makeIdentity();
    const reg = new AiShareInviteRegistry();
    const invite = makeInvite(owner.privKey, owner.pubB64);

    reg.recordInbound({ invite });
    expect(reg.listActive()).toHaveLength(0);

    reg.applyInboundAccept(invite.inviteId, {
      acceptedAt: "2026-05-07T03:01:00.000Z",
      signatureB64: "sig_accept_inbound",
    });

    const active = reg.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]?.side).toBe("inbound");
    expect(active[0]?.peerRootPubKeyB64).toBe(owner.pubB64);

    reg.applyInboundEnd({
      inviteId: invite.inviteId,
      endedBy: "peer",
      endedAt: "2026-05-07T03:02:00.000Z",
      signatureB64: "sig_end_peer",
    });

    expect(reg.listActive()).toHaveLength(0);
  });

  test("listActive does NOT return declined invites", () => {
    const owner = makeIdentity();
    const responder = makeIdentity();
    const reg = new AiShareInviteRegistry();
    const invite = makeInvite(owner.privKey, owner.pubB64);

    reg.recordOutbound({ invite, peerRootPubKeyB64: responder.pubB64 });
    const decline = buildAiShareDeclineEnvelope({
      inviteId: invite.inviteId,
      responderRootSignPrivateKey: responder.privKey,
      responderRootPubKeyB64: responder.pubB64,
      declinedAt: "2026-05-07T03:01:00.000Z",
    });
    reg.applyOutboundDecline(decline);

    expect(reg.listActive()).toHaveLength(0);
    expect(reg.getActive(invite.inviteId)).toBeNull();
  });

  test("end on a non-existent invite is a no-op (returns null / undefined)", () => {
    const reg = new AiShareInviteRegistry();
    const out = reg.applyOutboundEnd({
      inviteId: "ais_missing",
      endedBy: "self",
      endedAt: "2026-05-07T03:02:00.000Z",
      signatureB64: "x",
    });
    expect(out).toBeNull();
    reg.applyInboundEnd({
      inviteId: "ais_missing",
      endedBy: "peer",
      endedAt: "2026-05-07T03:02:00.000Z",
      signatureB64: "x",
    });
    expect(reg.listActive()).toHaveLength(0);
  });
});
