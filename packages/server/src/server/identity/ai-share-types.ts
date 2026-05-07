import { z } from "zod";

/**
 * Phase 4 v1 — wire schemas for AI-share invitations across the
 * existing friend-sync session. All three envelopes ride inside the
 * same `FriendSyncFrame` (Phase 3.b/1b NaCl-box) the chat uses, so the
 * relay never sees them in plaintext. Each envelope carries an Ed25519
 * signature by the sender's root sign privkey so authorship is
 * verifiable independently of the session keys.
 *
 * v1 ships only the handshake (invite / accept / decline). v2 adds
 * `ai-share-prompt` + `ai-share-timeline` envelopes for the live
 * channel, and v3 wires §7.5's multi-daemon picker. See
 * docs/MULTI-USER-COLLABORATION-DESIGN.md §11.5 for the split
 * rationale.
 */

// ----- invite (owner → friend) -------------------------------------------

export const AiShareInviteEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("ai-share-invite"),
  /**
   * Stable opaque id minted by the owner's daemon. Friend echoes it
   * back in accept/decline so the owner can match the response.
   */
  inviteId: z.string().min(1),
  /**
   * Owner's root sign pubkey. Mirrored from the envelope so the
   * receiver can verify the signature without consulting the friend-
   * sync session metadata.
   */
  ownerRootPubKeyB64: z.string().min(1),
  /** Which of the owner's daemons holds the agent — used by v3. */
  ownerDeviceId: z.string().min(1),
  /** Local agent id on the owner side. Friend treats as opaque. */
  agentId: z.string().min(1),
  /** Display label shown in the friend's accept-modal + banner. */
  agentLabel: z.string().min(1).max(64),
  /** Provider key — `claude` / `codex` / `opencode` etc. */
  agentProvider: z.string().min(1).max(32),
  /** ISO timestamp when this invite was minted. */
  generatedAt: z.string(),
  /** ISO timestamp after which the friend's daemon auto-declines. */
  expiresAt: z.string(),
  /**
   * Ed25519 signature, base64url, by the owner's root sign privkey
   * over `aiShareInvitePayload(...)`. Verifier resolves the owner's
   * root pubkey from the friend's existing peer record and checks the
   * signature here.
   */
  signatureB64: z.string().min(1),
});
export type AiShareInviteEnvelope = z.infer<typeof AiShareInviteEnvelopeSchema>;

// ----- accept (friend → owner) -------------------------------------------

export const AiShareAcceptEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("ai-share-accept"),
  inviteId: z.string().min(1),
  /**
   * Friend's root sign pubkey, mirrored for self-contained
   * verification (same pattern as the invite).
   */
  responderRootPubKeyB64: z.string().min(1),
  acceptedAt: z.string(),
  signatureB64: z.string().min(1),
});
export type AiShareAcceptEnvelope = z.infer<typeof AiShareAcceptEnvelopeSchema>;

// ----- decline (friend → owner) ------------------------------------------

export const AiShareDeclineEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("ai-share-decline"),
  inviteId: z.string().min(1),
  responderRootPubKeyB64: z.string().min(1),
  declinedAt: z.string(),
  /**
   * Optional human-readable reason. UI shows verbatim if present.
   * Auto-decline at expiry sets this to "expired" so the owner can
   * tell why the friend bailed.
   */
  reason: z.string().max(200).optional(),
  signatureB64: z.string().min(1),
});
export type AiShareDeclineEnvelope = z.infer<typeof AiShareDeclineEnvelopeSchema>;

// ----- end (either side → other) -----------------------------------------

/**
 * Phase 4 v2/a — terminate an active ai-share session. Emitted by
 * either side: the owner clicks "End session" on the banner, OR the
 * friend clicks "End" on their shared-agent view. The other side
 * transitions the registry entry to "ended" and renders the banner
 * dismissed. Carrying `senderRootPubKeyB64` lets the receiver verify
 * authorship the same way invite/accept/decline do, against the
 * friend-sync session's known peer pubkey.
 */
export const AiShareEndEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("ai-share-end"),
  inviteId: z.string().min(1),
  senderRootPubKeyB64: z.string().min(1),
  endedAt: z.string(),
  /** Optional human-readable reason; UI shows verbatim if present. */
  reason: z.string().max(200).optional(),
  signatureB64: z.string().min(1),
});
export type AiShareEndEnvelope = z.infer<typeof AiShareEndEnvelopeSchema>;

// ----- discriminated union ------------------------------------------------

/**
 * Discriminated union of every ai-share envelope kind v1 + v2/a ships.
 * Used by the friend-sync inbound dispatcher to route each frame's
 * decrypted payload to the right handler. Future kinds (v2/b's
 * `ai-share-prompt`, v2/d's `ai-share-timeline`) extend this union.
 */
export const AiShareEnvelopeSchema = z.discriminatedUnion("kind", [
  AiShareInviteEnvelopeSchema,
  AiShareAcceptEnvelopeSchema,
  AiShareDeclineEnvelopeSchema,
  AiShareEndEnvelopeSchema,
]);
export type AiShareEnvelope = z.infer<typeof AiShareEnvelopeSchema>;

// ----- canonical signed payloads -----------------------------------------

/**
 * What the owner's root sign privkey signs to produce
 * `AiShareInviteEnvelope.signatureB64`. Pinned format — every field
 * the friend uses to trust + render the invite is included so a
 * relay-side adversary can't swap, e.g., `agentLabel` to mislead.
 *
 *   ottie-ai-share-invite-v1
 *   {inviteId}
 *   {ownerRootPubKeyB64}
 *   {ownerDeviceId}
 *   {agentProvider}
 *   {agentLabel}
 *   {expiresAt}
 */
export function aiShareInvitePayload(args: {
  inviteId: string;
  ownerRootPubKeyB64: string;
  ownerDeviceId: string;
  agentProvider: string;
  agentLabel: string;
  expiresAt: string;
}): string {
  return [
    "ottie-ai-share-invite-v1",
    args.inviteId,
    args.ownerRootPubKeyB64,
    args.ownerDeviceId,
    args.agentProvider,
    args.agentLabel,
    args.expiresAt,
  ].join("\n");
}

/**
 *   ottie-ai-share-accept-v1
 *   {inviteId}
 *   {responderRootPubKeyB64}
 *   {acceptedAt}
 */
export function aiShareAcceptPayload(args: {
  inviteId: string;
  responderRootPubKeyB64: string;
  acceptedAt: string;
}): string {
  return [
    "ottie-ai-share-accept-v1",
    args.inviteId,
    args.responderRootPubKeyB64,
    args.acceptedAt,
  ].join("\n");
}

/**
 *   ottie-ai-share-decline-v1
 *   {inviteId}
 *   {responderRootPubKeyB64}
 *   {declinedAt}
 *   {reason | ""}
 */
export function aiShareDeclinePayload(args: {
  inviteId: string;
  responderRootPubKeyB64: string;
  declinedAt: string;
  reason?: string;
}): string {
  return [
    "ottie-ai-share-decline-v1",
    args.inviteId,
    args.responderRootPubKeyB64,
    args.declinedAt,
    args.reason ?? "",
  ].join("\n");
}

/**
 *   ottie-ai-share-end-v1
 *   {inviteId}
 *   {senderRootPubKeyB64}
 *   {endedAt}
 *   {reason | ""}
 */
export function aiShareEndPayload(args: {
  inviteId: string;
  senderRootPubKeyB64: string;
  endedAt: string;
  reason?: string;
}): string {
  return [
    "ottie-ai-share-end-v1",
    args.inviteId,
    args.senderRootPubKeyB64,
    args.endedAt,
    args.reason ?? "",
  ].join("\n");
}
