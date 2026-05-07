import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";

import {
  AiShareCoordinationEventSchema,
  aiShareCoordinationPayload,
  type AiShareCoordinationEvent,
  type AiShareIntentBroadcastEvent,
  type AiShareIntentResolutionEvent,
} from "./ai-share-coordination-types.js";

/**
 * Phase 4 v3/c §7.5.1 — sign + verify helpers for cross-daemon
 * coordination events. I/O-free, mirrors `device-list-event-crypto`'s
 * shape: caller passes the unsigned event body, we attach a signature
 * over the canonical payload.
 */

export interface BuildAiShareIntentBroadcastInput {
  intentId: string;
  peerRootPubKeyB64: string;
  expiresAt: string;
  sourceDeviceId: string;
  /** Source device's self-device Ed25519 PRIVATE key. */
  signPrivateKey: KeyObject;
  emittedAt: string;
  seq: number;
}

export function buildAiShareIntentBroadcastEvent(
  input: BuildAiShareIntentBroadcastInput,
): AiShareIntentBroadcastEvent {
  const eventBody = {
    kind: "ai-share-intent-broadcast" as const,
    intentId: input.intentId,
    peerRootPubKeyB64: input.peerRootPubKeyB64,
    expiresAt: input.expiresAt,
    sourceDeviceId: input.sourceDeviceId,
    emittedAt: input.emittedAt,
    seq: input.seq,
  };
  const signatureB64 = signEd25519(input.signPrivateKey, aiShareCoordinationPayload(eventBody));
  return { v: 1, ...eventBody, signatureB64 };
}

export interface BuildAiShareIntentResolutionInput {
  intentId: string;
  claimedByDeviceId: string;
  resolvedAt: string;
  sourceDeviceId: string;
  signPrivateKey: KeyObject;
  emittedAt: string;
  seq: number;
}

export function buildAiShareIntentResolutionEvent(
  input: BuildAiShareIntentResolutionInput,
): AiShareIntentResolutionEvent {
  const eventBody = {
    kind: "ai-share-intent-resolution" as const,
    intentId: input.intentId,
    claimedByDeviceId: input.claimedByDeviceId,
    resolvedAt: input.resolvedAt,
    sourceDeviceId: input.sourceDeviceId,
    emittedAt: input.emittedAt,
    seq: input.seq,
  };
  const signatureB64 = signEd25519(input.signPrivateKey, aiShareCoordinationPayload(eventBody));
  return { v: 1, ...eventBody, signatureB64 };
}

export type VerifyOutcome = { ok: true } | { ok: false; reason: string };

export function verifyAiShareCoordinationEvent(input: {
  event: AiShareCoordinationEvent;
  expectedSignPublicKeyB64: string;
}): VerifyOutcome {
  return verifyDetached(
    input.expectedSignPublicKeyB64,
    aiShareCoordinationPayload(input.event),
    input.event.signatureB64,
  );
}

export function tryParseAiShareCoordinationEvent(parsed: unknown): AiShareCoordinationEvent | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const k = (parsed as { kind?: unknown }).kind;
  if (k !== "ai-share-intent-broadcast" && k !== "ai-share-intent-resolution") {
    return null;
  }
  const r = AiShareCoordinationEventSchema.safeParse(parsed);
  return r.success ? r.data : null;
}

// ----- internal -----------------------------------------------------------

function signEd25519(privateKey: KeyObject, payload: string): string {
  const sig = sign(null, Buffer.from(payload, "utf8"), privateKey);
  return sig.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function verifyDetached(
  pubKeyB64Url: string,
  payload: string,
  signatureB64Url: string,
): VerifyOutcome {
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
