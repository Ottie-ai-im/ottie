import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";

import {
  AiShareAcceptEnvelopeSchema,
  AiShareDeclineEnvelopeSchema,
  AiShareInviteEnvelopeSchema,
  aiShareAcceptPayload,
  aiShareDeclinePayload,
  aiShareInvitePayload,
  type AiShareAcceptEnvelope,
  type AiShareDeclineEnvelope,
  type AiShareInviteEnvelope,
} from "./ai-share-types.js";

/**
 * Phase 4 v1 — sign + verify helpers for the ai-share invitation
 * envelopes. I/O-free, mirrors the friend-chat-crypto pattern.
 *
 * Trust model: each envelope is signed by the SENDER's root sign
 * privkey. The receiver looks up the sender's root pubkey from their
 * existing peer record (Phase 3.a/3) and verifies. A decrypt
 * roundtrip alone (which works on the friend-sync session key) is
 * NOT sufficient — the signature here proves the sender owns the
 * claimed identity.
 */

// ----- invite (owner side: sign / friend side: verify) -------------------

export interface BuildAiShareInviteInput {
  inviteId: string;
  /** Owner's root sign privkey — signs the invite. */
  ownerRootSignPrivateKey: KeyObject;
  ownerRootPubKeyB64: string;
  ownerDeviceId: string;
  agentId: string;
  agentLabel: string;
  agentProvider: string;
  generatedAt: string;
  expiresAt: string;
}

export function buildAiShareInviteEnvelope(input: BuildAiShareInviteInput): AiShareInviteEnvelope {
  const payload = aiShareInvitePayload({
    inviteId: input.inviteId,
    ownerRootPubKeyB64: input.ownerRootPubKeyB64,
    ownerDeviceId: input.ownerDeviceId,
    agentProvider: input.agentProvider,
    agentLabel: input.agentLabel,
    expiresAt: input.expiresAt,
  });
  const signatureB64 = signEd25519(input.ownerRootSignPrivateKey, payload);
  return {
    v: 1,
    kind: "ai-share-invite",
    inviteId: input.inviteId,
    ownerRootPubKeyB64: input.ownerRootPubKeyB64,
    ownerDeviceId: input.ownerDeviceId,
    agentId: input.agentId,
    agentLabel: input.agentLabel,
    agentProvider: input.agentProvider,
    generatedAt: input.generatedAt,
    expiresAt: input.expiresAt,
    signatureB64,
  };
}

export type VerifyAiShareInviteOutcome = { ok: true } | { ok: false; reason: string };

export interface VerifyAiShareInviteInput {
  envelope: AiShareInviteEnvelope;
  /** Expected sender root pubkey from the friend's peer record. */
  expectedOwnerRootSignPublicKeyB64: string;
}

export function verifyAiShareInviteEnvelope(
  input: VerifyAiShareInviteInput,
): VerifyAiShareInviteOutcome {
  if (input.envelope.ownerRootPubKeyB64 !== input.expectedOwnerRootSignPublicKeyB64) {
    return {
      ok: false,
      reason: `invite owner pubkey ${input.envelope.ownerRootPubKeyB64.slice(0, 8)}… does not match peer ${input.expectedOwnerRootSignPublicKeyB64.slice(0, 8)}…`,
    };
  }
  const payload = aiShareInvitePayload({
    inviteId: input.envelope.inviteId,
    ownerRootPubKeyB64: input.envelope.ownerRootPubKeyB64,
    ownerDeviceId: input.envelope.ownerDeviceId,
    agentProvider: input.envelope.agentProvider,
    agentLabel: input.envelope.agentLabel,
    expiresAt: input.envelope.expiresAt,
  });
  return verifyDetached(
    input.expectedOwnerRootSignPublicKeyB64,
    payload,
    input.envelope.signatureB64,
  );
}

// ----- accept (friend side: sign / owner side: verify) -------------------

export interface BuildAiShareAcceptInput {
  inviteId: string;
  /** Friend's root sign privkey. */
  responderRootSignPrivateKey: KeyObject;
  responderRootPubKeyB64: string;
  acceptedAt: string;
}

export function buildAiShareAcceptEnvelope(input: BuildAiShareAcceptInput): AiShareAcceptEnvelope {
  const payload = aiShareAcceptPayload({
    inviteId: input.inviteId,
    responderRootPubKeyB64: input.responderRootPubKeyB64,
    acceptedAt: input.acceptedAt,
  });
  const signatureB64 = signEd25519(input.responderRootSignPrivateKey, payload);
  return {
    v: 1,
    kind: "ai-share-accept",
    inviteId: input.inviteId,
    responderRootPubKeyB64: input.responderRootPubKeyB64,
    acceptedAt: input.acceptedAt,
    signatureB64,
  };
}

export type VerifyAiShareAcceptOutcome = { ok: true } | { ok: false; reason: string };

export interface VerifyAiShareAcceptInput {
  envelope: AiShareAcceptEnvelope;
  /** Expected responder root pubkey from owner's peer record. */
  expectedResponderRootSignPublicKeyB64: string;
}

export function verifyAiShareAcceptEnvelope(
  input: VerifyAiShareAcceptInput,
): VerifyAiShareAcceptOutcome {
  if (input.envelope.responderRootPubKeyB64 !== input.expectedResponderRootSignPublicKeyB64) {
    return {
      ok: false,
      reason: `accept responder pubkey ${input.envelope.responderRootPubKeyB64.slice(0, 8)}… does not match peer ${input.expectedResponderRootSignPublicKeyB64.slice(0, 8)}…`,
    };
  }
  const payload = aiShareAcceptPayload({
    inviteId: input.envelope.inviteId,
    responderRootPubKeyB64: input.envelope.responderRootPubKeyB64,
    acceptedAt: input.envelope.acceptedAt,
  });
  return verifyDetached(
    input.expectedResponderRootSignPublicKeyB64,
    payload,
    input.envelope.signatureB64,
  );
}

// ----- decline (friend side: sign / owner side: verify) ------------------

export interface BuildAiShareDeclineInput {
  inviteId: string;
  responderRootSignPrivateKey: KeyObject;
  responderRootPubKeyB64: string;
  declinedAt: string;
  reason?: string;
}

export function buildAiShareDeclineEnvelope(
  input: BuildAiShareDeclineInput,
): AiShareDeclineEnvelope {
  const payload = aiShareDeclinePayload({
    inviteId: input.inviteId,
    responderRootPubKeyB64: input.responderRootPubKeyB64,
    declinedAt: input.declinedAt,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  });
  const signatureB64 = signEd25519(input.responderRootSignPrivateKey, payload);
  return {
    v: 1,
    kind: "ai-share-decline",
    inviteId: input.inviteId,
    responderRootPubKeyB64: input.responderRootPubKeyB64,
    declinedAt: input.declinedAt,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    signatureB64,
  };
}

export interface VerifyAiShareDeclineInput {
  envelope: AiShareDeclineEnvelope;
  expectedResponderRootSignPublicKeyB64: string;
}

export function verifyAiShareDeclineEnvelope(
  input: VerifyAiShareDeclineInput,
): VerifyAiShareAcceptOutcome {
  if (input.envelope.responderRootPubKeyB64 !== input.expectedResponderRootSignPublicKeyB64) {
    return {
      ok: false,
      reason: `decline responder pubkey ${input.envelope.responderRootPubKeyB64.slice(0, 8)}… does not match peer ${input.expectedResponderRootSignPublicKeyB64.slice(0, 8)}…`,
    };
  }
  const payload = aiShareDeclinePayload({
    inviteId: input.envelope.inviteId,
    responderRootPubKeyB64: input.envelope.responderRootPubKeyB64,
    declinedAt: input.envelope.declinedAt,
    ...(input.envelope.reason !== undefined ? { reason: input.envelope.reason } : {}),
  });
  return verifyDetached(
    input.expectedResponderRootSignPublicKeyB64,
    payload,
    input.envelope.signatureB64,
  );
}

// ----- shared parse-and-route helper -------------------------------------

/**
 * Parse a friend-sync inbound payload as one of the ai-share kinds.
 * Returns null if the payload isn't ai-share-shaped (caller falls
 * back to chat-message routing). Used by the friend-sync receiver
 * dispatcher.
 */
export function tryParseAiShareEnvelope(
  parsed: unknown,
):
  | { kind: "invite"; envelope: AiShareInviteEnvelope }
  | { kind: "accept"; envelope: AiShareAcceptEnvelope }
  | { kind: "decline"; envelope: AiShareDeclineEnvelope }
  | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const k = (parsed as { kind?: unknown }).kind;
  if (k === "ai-share-invite") {
    const r = AiShareInviteEnvelopeSchema.safeParse(parsed);
    return r.success ? { kind: "invite", envelope: r.data } : null;
  }
  if (k === "ai-share-accept") {
    const r = AiShareAcceptEnvelopeSchema.safeParse(parsed);
    return r.success ? { kind: "accept", envelope: r.data } : null;
  }
  if (k === "ai-share-decline") {
    const r = AiShareDeclineEnvelopeSchema.safeParse(parsed);
    return r.success ? { kind: "decline", envelope: r.data } : null;
  }
  return null;
}

// ----- internal: signing + verifying -------------------------------------

function signEd25519(privateKey: KeyObject, payload: string): string {
  const sig = sign(null, Buffer.from(payload, "utf8"), privateKey);
  return sig.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function verifyDetached(
  pubKeyB64Url: string,
  payload: string,
  signatureB64Url: string,
): { ok: true } | { ok: false; reason: string } {
  let pubKey: KeyObject;
  try {
    pubKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: pubKeyB64Url },
      format: "jwk",
    });
  } catch (err) {
    return {
      ok: false,
      reason: `pubkey unparseable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let sigBytes: Buffer;
  try {
    sigBytes = base64UrlDecode(signatureB64Url);
  } catch (err) {
    return {
      ok: false,
      reason: `signature unparseable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const ok = verify(null, Buffer.from(payload, "utf8"), pubKey, sigBytes);
  if (!ok) return { ok: false, reason: "signature did not verify" };
  return { ok: true };
}

function base64UrlDecode(b64url: string): Buffer {
  const standard = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (standard.length % 4)) % 4;
  return Buffer.from(standard + "=".repeat(padLen), "base64");
}
