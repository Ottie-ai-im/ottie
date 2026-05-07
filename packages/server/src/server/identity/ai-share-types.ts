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

// ----- limits (Phase 4 v3/a — owner-set caps, daemon-enforced) -----------

/**
 * Phase 4 v3/a — per-share resource caps the owner's daemon enforces.
 * Default values come from §7's UI mitigations list ("max prompts 50,
 * max tokens 100k, session timeout 1 h"). Caps are advisory to the
 * friend (so their UI can display "Wendell allows up to N prompts")
 * and authoritative on the owner side — exhausting any cap triggers
 * an automatic `ai-share-end` with the reason set to one of
 * "prompt-limit", "token-limit", or "session-timeout".
 *
 * Wire-shape note: the field is `.optional()` on the invite envelope
 * so v1/v2 daemons that don't know about limits can still parse new
 * invites. Owner daemons that don't include limits are treated as
 * "no caps" by the friend's UI and as the hardcoded defaults by the
 * owner's enforcer (so a v3 owner-daemon always enforces, even when
 * sharing with a v1 friend).
 */
export const AiShareLimitsSchema = z.object({
  /** Max prompts the friend can send across this session. */
  maxPrompts: z.number().int().min(1).max(10_000),
  /**
   * Max total tokens the agent can consume across this session
   * (sum of input + output tokens reported by the provider).
   */
  maxTokens: z.number().int().min(1_000).max(10_000_000),
  /** Session-timeout window measured from acceptedAt, in milliseconds. */
  sessionTimeoutMs: z
    .number()
    .int()
    .min(60_000)
    .max(24 * 60 * 60 * 1000),
});
export type AiShareLimits = z.infer<typeof AiShareLimitsSchema>;

export const DEFAULT_AI_SHARE_LIMITS: AiShareLimits = {
  maxPrompts: 50,
  maxTokens: 100_000,
  sessionTimeoutMs: 60 * 60 * 1000,
};

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
   * Phase 4 v3/a — per-share caps the owner's daemon will enforce.
   * Optional on the wire so v1/v2 invites still parse; v3+ invites
   * always include them (defaulted in `sendAiShareInvite`). Friend's
   * accept screen surfaces them so the friend knows the cap before
   * tapping Accept.
   */
  limits: AiShareLimitsSchema.optional(),
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

// ----- prompt (friend → owner) -------------------------------------------

/**
 * Phase 4 v2/b — friend's compose box ships its prompt to the owner
 * across the active share. The owner's daemon verifies the signature,
 * looks up the active outbound entry by inviteId, and injects the
 * prompt into the chosen agent's input via `AgentManager.runAgent`.
 *
 * Trust model is the friend-side analogue of the invite: the prompt is
 * signed by the FRIEND's root sign privkey (the responder of the
 * handshake), and the owner verifies against the same peer pubkey it
 * already uses for accept/decline. Riding inside FriendSyncFrame keeps
 * the relay zero-knowledge.
 *
 * `body` is hard-capped at 16 KiB. v2 doesn't try to be a generic
 * file-attachment channel; long context goes through the agent's own
 * tool-call surface, not this envelope.
 */
export const AiSharePromptEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("ai-share-prompt"),
  inviteId: z.string().min(1),
  /** Stable per-prompt id minted by the friend's daemon. */
  promptId: z.string().min(1),
  /** Sender (friend) — same field name pattern as `ai-share-end`. */
  senderRootPubKeyB64: z.string().min(1),
  /** ISO timestamp when the friend's daemon sent the prompt. */
  sentAt: z.string(),
  /** The user-typed prompt body. Capped at 16 KiB (UTF-8 bytes-ish). */
  body: z.string().min(1).max(16384),
  signatureB64: z.string().min(1),
});
export type AiSharePromptEnvelope = z.infer<typeof AiSharePromptEnvelopeSchema>;

// ----- timeline (owner → friend) -----------------------------------------

/**
 * Phase 4 v2/d — owner streams a redacted projection of the shared
 * agent's timeline back to the friend. Only entries that survive the
 * owner-side redactor land here; the doc's §7 promise ("Bob sees prompt
 * + response only; Alice keeps tool-call details to herself") is
 * enforced by *what we serialize* on the owner side, not by trust on
 * the friend side.
 *
 * Wire payload kinds (subset of the local `AgentTimelineItem`):
 *
 *   - `assistant_message` — the agent's text reply
 *   - `reasoning` — planning / scratchpad text (still safe; no tool I/O)
 *   - `user_message` — echoes the friend's own prompt back so their
 *     UI can correlate `promptId` → "delivered + run started"
 *   - `error` — run failure surface
 *   - `turn_started` / `turn_completed` — status pills (no usage
 *     details forwarded; v3 may add a redacted token-count)
 *
 * `eventId` is monotonic per inviteId; the friend uses it to dedupe
 * re-deliveries from a flaky friend-sync session.
 */
export const AiShareTimelineEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("assistant_message"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("reasoning"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("user_message"),
    text: z.string(),
    /**
     * Echoes the friend's wire promptId so their UI can flip the
     * "you sent" row from "sent" to "running".
     */
    promptId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("turn_started"),
  }),
  z.object({
    kind: z.literal("turn_completed"),
  }),
]);
export type AiShareTimelineEntry = z.infer<typeof AiShareTimelineEntrySchema>;

export const AiShareTimelineEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("ai-share-timeline"),
  inviteId: z.string().min(1),
  /** Stable per-event id minted by the owner's daemon. */
  eventId: z.string().min(1),
  /** Owner — same field name pattern as `ai-share-end`. */
  senderRootPubKeyB64: z.string().min(1),
  sentAt: z.string(),
  entry: AiShareTimelineEntrySchema,
  signatureB64: z.string().min(1),
});
export type AiShareTimelineEnvelope = z.infer<typeof AiShareTimelineEnvelopeSchema>;

// ----- discriminated union ------------------------------------------------

/**
 * Discriminated union of every ai-share envelope kind v1 through
 * v2/d ships. Used by the friend-sync inbound dispatcher to route
 * each frame's decrypted payload to the right handler.
 */
export const AiShareEnvelopeSchema = z.discriminatedUnion("kind", [
  AiShareInviteEnvelopeSchema,
  AiShareAcceptEnvelopeSchema,
  AiShareDeclineEnvelopeSchema,
  AiShareEndEnvelopeSchema,
  AiSharePromptEnvelopeSchema,
  AiShareTimelineEnvelopeSchema,
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
 *   {limitsLine}                ← Phase 4 v3/a: present when limits set,
 *                                 absent line when not. Old invites
 *                                 (v1/v2) had no trailing line at all,
 *                                 so the back-compat rule is: if limits
 *                                 is undefined, the trailing line is
 *                                 omitted (matches v1/v2 verification).
 *
 * `limitsLine` shape: `limits=<maxPrompts>,<maxTokens>,<sessionTimeoutMs>`.
 * Serializing as numbers in fixed positions (rather than JSON) keeps the
 * canonical format human-readable + bit-stable across runtimes.
 */
export function aiShareInvitePayload(args: {
  inviteId: string;
  ownerRootPubKeyB64: string;
  ownerDeviceId: string;
  agentProvider: string;
  agentLabel: string;
  expiresAt: string;
  limits?: AiShareLimits;
}): string {
  const lines = [
    "ottie-ai-share-invite-v1",
    args.inviteId,
    args.ownerRootPubKeyB64,
    args.ownerDeviceId,
    args.agentProvider,
    args.agentLabel,
    args.expiresAt,
  ];
  if (args.limits) {
    lines.push(
      `limits=${args.limits.maxPrompts},${args.limits.maxTokens},${args.limits.sessionTimeoutMs}`,
    );
  }
  return lines.join("\n");
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

/**
 *   ottie-ai-share-prompt-v1
 *   {inviteId}
 *   {promptId}
 *   {senderRootPubKeyB64}
 *   {sentAt}
 *   {body}
 *
 * `body` is the last line, raw — no length prefix, no escaping. We
 * include it inside the signed payload so a relay-side adversary can't
 * tamper the prompt the owner injects into the agent.
 */
export function aiSharePromptPayload(args: {
  inviteId: string;
  promptId: string;
  senderRootPubKeyB64: string;
  sentAt: string;
  body: string;
}): string {
  return [
    "ottie-ai-share-prompt-v1",
    args.inviteId,
    args.promptId,
    args.senderRootPubKeyB64,
    args.sentAt,
    args.body,
  ].join("\n");
}

/**
 *   ottie-ai-share-timeline-v1
 *   {inviteId}
 *   {eventId}
 *   {senderRootPubKeyB64}
 *   {sentAt}
 *   {entryJson}
 *
 * `entryJson` is the JSON-stringified `AiShareTimelineEntry`, last
 * line, raw. Including the full payload in the signed bytes means a
 * relay-side adversary can't tamper with the redacted body before the
 * friend renders it.
 */
export function aiShareTimelinePayload(args: {
  inviteId: string;
  eventId: string;
  senderRootPubKeyB64: string;
  sentAt: string;
  entry: AiShareTimelineEntry;
}): string {
  return [
    "ottie-ai-share-timeline-v1",
    args.inviteId,
    args.eventId,
    args.senderRootPubKeyB64,
    args.sentAt,
    JSON.stringify(args.entry),
  ].join("\n");
}
