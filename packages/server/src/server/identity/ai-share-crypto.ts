import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";

import {
  AiShareAcceptEnvelopeSchema,
  AiShareDeclineEnvelopeSchema,
  AiShareEndEnvelopeSchema,
  AiShareInviteEnvelopeSchema,
  AiSharePromptEnvelopeSchema,
  AiShareTimelineEnvelopeSchema,
  aiShareAcceptPayload,
  aiShareDeclinePayload,
  aiShareEndPayload,
  aiShareInvitePayload,
  aiSharePromptPayload,
  aiShareTimelinePayload,
  type AiShareAcceptEnvelope,
  type AiShareDeclineEnvelope,
  type AiShareEndEnvelope,
  type AiShareInviteEnvelope,
  type AiSharePromptEnvelope,
  type AiShareTimelineEntry,
  type AiShareTimelineEnvelope,
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

// ----- end (Phase 4 v2/a — either side: sign + verify) ------------------

export interface BuildAiShareEndInput {
  inviteId: string;
  /** Sender's root sign privkey — could be owner OR friend, both can end. */
  senderRootSignPrivateKey: KeyObject;
  senderRootPubKeyB64: string;
  endedAt: string;
  reason?: string;
}

export function buildAiShareEndEnvelope(input: BuildAiShareEndInput): AiShareEndEnvelope {
  const payload = aiShareEndPayload({
    inviteId: input.inviteId,
    senderRootPubKeyB64: input.senderRootPubKeyB64,
    endedAt: input.endedAt,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  });
  const signatureB64 = signEd25519(input.senderRootSignPrivateKey, payload);
  return {
    v: 1,
    kind: "ai-share-end",
    inviteId: input.inviteId,
    senderRootPubKeyB64: input.senderRootPubKeyB64,
    endedAt: input.endedAt,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    signatureB64,
  };
}

export interface VerifyAiShareEndInput {
  envelope: AiShareEndEnvelope;
  /**
   * Either side can end the share, so the caller passes whichever
   * peer pubkey is on the other end of the friend-sync session that
   * delivered this envelope. We cross-check that the envelope's
   * `senderRootPubKeyB64` matches.
   */
  expectedSenderRootSignPublicKeyB64: string;
}

export function verifyAiShareEndEnvelope(
  input: VerifyAiShareEndInput,
): { ok: true } | { ok: false; reason: string } {
  if (input.envelope.senderRootPubKeyB64 !== input.expectedSenderRootSignPublicKeyB64) {
    return {
      ok: false,
      reason: `end sender pubkey ${input.envelope.senderRootPubKeyB64.slice(0, 8)}… does not match peer ${input.expectedSenderRootSignPublicKeyB64.slice(0, 8)}…`,
    };
  }
  const payload = aiShareEndPayload({
    inviteId: input.envelope.inviteId,
    senderRootPubKeyB64: input.envelope.senderRootPubKeyB64,
    endedAt: input.envelope.endedAt,
    ...(input.envelope.reason !== undefined ? { reason: input.envelope.reason } : {}),
  });
  return verifyDetached(
    input.expectedSenderRootSignPublicKeyB64,
    payload,
    input.envelope.signatureB64,
  );
}

// ----- prompt (Phase 4 v2/b — friend side: sign / owner side: verify) ----

export interface BuildAiSharePromptInput {
  inviteId: string;
  promptId: string;
  /** Friend's root sign privkey — signs the prompt. */
  senderRootSignPrivateKey: KeyObject;
  senderRootPubKeyB64: string;
  sentAt: string;
  body: string;
}

export function buildAiSharePromptEnvelope(input: BuildAiSharePromptInput): AiSharePromptEnvelope {
  const payload = aiSharePromptPayload({
    inviteId: input.inviteId,
    promptId: input.promptId,
    senderRootPubKeyB64: input.senderRootPubKeyB64,
    sentAt: input.sentAt,
    body: input.body,
  });
  const signatureB64 = signEd25519(input.senderRootSignPrivateKey, payload);
  return {
    v: 1,
    kind: "ai-share-prompt",
    inviteId: input.inviteId,
    promptId: input.promptId,
    senderRootPubKeyB64: input.senderRootPubKeyB64,
    sentAt: input.sentAt,
    body: input.body,
    signatureB64,
  };
}

export interface VerifyAiSharePromptInput {
  envelope: AiSharePromptEnvelope;
  /** Owner side: the friend's root pubkey from their peer record. */
  expectedSenderRootSignPublicKeyB64: string;
}

export function verifyAiSharePromptEnvelope(
  input: VerifyAiSharePromptInput,
): { ok: true } | { ok: false; reason: string } {
  if (input.envelope.senderRootPubKeyB64 !== input.expectedSenderRootSignPublicKeyB64) {
    return {
      ok: false,
      reason: `prompt sender pubkey ${input.envelope.senderRootPubKeyB64.slice(0, 8)}… does not match peer ${input.expectedSenderRootSignPublicKeyB64.slice(0, 8)}…`,
    };
  }
  const payload = aiSharePromptPayload({
    inviteId: input.envelope.inviteId,
    promptId: input.envelope.promptId,
    senderRootPubKeyB64: input.envelope.senderRootPubKeyB64,
    sentAt: input.envelope.sentAt,
    body: input.envelope.body,
  });
  return verifyDetached(
    input.expectedSenderRootSignPublicKeyB64,
    payload,
    input.envelope.signatureB64,
  );
}

// ----- timeline (Phase 4 v2/d — owner side: sign / friend side: verify) --

export interface BuildAiShareTimelineInput {
  inviteId: string;
  eventId: string;
  /** Owner's root sign privkey — signs each timeline frame. */
  senderRootSignPrivateKey: KeyObject;
  senderRootPubKeyB64: string;
  sentAt: string;
  entry: AiShareTimelineEntry;
}

export function buildAiShareTimelineEnvelope(
  input: BuildAiShareTimelineInput,
): AiShareTimelineEnvelope {
  const payload = aiShareTimelinePayload({
    inviteId: input.inviteId,
    eventId: input.eventId,
    senderRootPubKeyB64: input.senderRootPubKeyB64,
    sentAt: input.sentAt,
    entry: input.entry,
  });
  const signatureB64 = signEd25519(input.senderRootSignPrivateKey, payload);
  return {
    v: 1,
    kind: "ai-share-timeline",
    inviteId: input.inviteId,
    eventId: input.eventId,
    senderRootPubKeyB64: input.senderRootPubKeyB64,
    sentAt: input.sentAt,
    entry: input.entry,
    signatureB64,
  };
}

export interface VerifyAiShareTimelineInput {
  envelope: AiShareTimelineEnvelope;
  /** Friend side: the owner's root pubkey from their peer record. */
  expectedSenderRootSignPublicKeyB64: string;
}

export function verifyAiShareTimelineEnvelope(
  input: VerifyAiShareTimelineInput,
): { ok: true } | { ok: false; reason: string } {
  if (input.envelope.senderRootPubKeyB64 !== input.expectedSenderRootSignPublicKeyB64) {
    return {
      ok: false,
      reason: `timeline sender pubkey ${input.envelope.senderRootPubKeyB64.slice(0, 8)}… does not match peer ${input.expectedSenderRootSignPublicKeyB64.slice(0, 8)}…`,
    };
  }
  const payload = aiShareTimelinePayload({
    inviteId: input.envelope.inviteId,
    eventId: input.envelope.eventId,
    senderRootPubKeyB64: input.envelope.senderRootPubKeyB64,
    sentAt: input.envelope.sentAt,
    entry: input.envelope.entry,
  });
  return verifyDetached(
    input.expectedSenderRootSignPublicKeyB64,
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
  | { kind: "end"; envelope: AiShareEndEnvelope }
  | { kind: "prompt"; envelope: AiSharePromptEnvelope }
  | { kind: "timeline"; envelope: AiShareTimelineEnvelope }
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
  if (k === "ai-share-end") {
    const r = AiShareEndEnvelopeSchema.safeParse(parsed);
    return r.success ? { kind: "end", envelope: r.data } : null;
  }
  if (k === "ai-share-prompt") {
    const r = AiSharePromptEnvelopeSchema.safeParse(parsed);
    return r.success ? { kind: "prompt", envelope: r.data } : null;
  }
  if (k === "ai-share-timeline") {
    const r = AiShareTimelineEnvelopeSchema.safeParse(parsed);
    return r.success ? { kind: "timeline", envelope: r.data } : null;
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
