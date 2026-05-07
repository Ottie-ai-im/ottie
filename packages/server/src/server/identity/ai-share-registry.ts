import type pino from "pino";

import type {
  AiShareAcceptEnvelope,
  AiShareDeclineEnvelope,
  AiShareInviteEnvelope,
} from "./ai-share-types.js";

/**
 * Phase 4 v1 — in-memory registry of in-flight ai-share invitations,
 * one per daemon. Holds BOTH sides of the handshake:
 *
 * - Outbound: invitations this daemon sent. Tracks {invite, peerPubKey,
 *   state} so when an `ai-share-accept` / `decline` lands, we can find
 *   the matching outbound record + emit a state-change to the UI.
 * - Inbound: invitations this daemon received. Tracks the un-acted
 *   ones so the UI's notification center + accept/decline modal can
 *   read them, plus a small terminal-state cache so re-deliveries
 *   from a flaky session don't bounce twice.
 *
 * Persistence layer: none (in-memory). v1 invitations have a 5-minute
 * TTL — restart-resilience would buy nothing here. v2's active-share
 * state DOES need persistence (transcript log per §7); add it
 * alongside that work.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export type AiShareInviteState =
  | { kind: "pending" }
  | {
      kind: "active";
      acceptedAt: string;
      acceptSignatureB64: string;
    }
  | { kind: "declined"; declinedAt: string; reason?: string; signatureB64: string }
  | {
      kind: "ended";
      endedAt: string;
      /** Who emitted the end? "self" if this daemon, "peer" if other side. */
      endedBy: "self" | "peer";
      reason?: string;
      signatureB64: string;
    }
  | { kind: "expired" };

interface OutboundEntry {
  invite: AiShareInviteEnvelope;
  /** Peer this invite was sent to (their root pubkey). */
  peerRootPubKeyB64: string;
  state: AiShareInviteState;
  /** Wall-clock ms when the invite was minted. Used for TTL prune. */
  generatedAtMs: number;
  expiresAtMs: number;
  /**
   * Phase 4 v2/d — handle returned by the AgentManager subscription
   * the broadcaster opens when this share goes active. Cleared in the
   * `applyOutboundEnd` transition so we tear down the subscription
   * exactly once. Null when no broadcaster is wired (tests).
   */
  unsubscribeBroadcaster: (() => void) | null;
  /** Monotonic per-share counter for outbound timeline `eventId`s. */
  nextTimelineSeq: number;
  /**
   * Latest wire `promptId` the friend sent — stamped onto the next
   * `user_message` timeline forward so the friend's UI can correlate
   * the "you sent" row with "agent run started".
   */
  lastInboundPromptId: string | null;
}

interface InboundEntry {
  invite: AiShareInviteEnvelope;
  /** Sender (the owner) — same as `invite.ownerRootPubKeyB64`, hoisted for filter ergonomics. */
  ownerRootPubKeyB64: string;
  /** Wall-clock ms this daemon received the invite. */
  receivedAtMs: number;
  expiresAtMs: number;
  /** Tracks acted-on state so a duplicate inbound is a no-op. */
  state: AiShareInviteState;
}

export class AiShareInviteRegistry {
  private readonly outbound = new Map<string, OutboundEntry>();
  private readonly inbound = new Map<string, InboundEntry>();
  private readonly logger: pino.Logger | undefined;
  private readonly ttlMs: number;
  private readonly nowMs: () => number;

  constructor(options?: {
    logger?: pino.Logger;
    /** Override TTL (tests). Default 5 minutes. */
    ttlMs?: number;
    /** Override clock (tests). */
    nowMs?: () => number;
  }) {
    this.logger = options?.logger?.child({ module: "ai-share-registry" });
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    this.nowMs = options?.nowMs ?? Date.now;
  }

  // ----- outbound (owner side) -------------------------------------------

  recordOutbound(input: { invite: AiShareInviteEnvelope; peerRootPubKeyB64: string }): void {
    this.evictExpired();
    const now = this.nowMs();
    this.outbound.set(input.invite.inviteId, {
      invite: input.invite,
      peerRootPubKeyB64: input.peerRootPubKeyB64,
      state: { kind: "pending" },
      generatedAtMs: now,
      expiresAtMs: now + this.ttlMs,
      unsubscribeBroadcaster: null,
      nextTimelineSeq: 0,
      lastInboundPromptId: null,
    });
    this.logger?.info(
      {
        inviteId: input.invite.inviteId,
        peerPrefix: input.peerRootPubKeyB64.slice(0, 8),
        agentLabel: input.invite.agentLabel,
      },
      "ai_share_invite_recorded_outbound",
    );
  }

  /**
   * Phase 4 v2/d — store the broadcaster's unsubscribe handle on the
   * outbound entry so `applyOutboundEnd` can tear it down. Replaces
   * any prior handle (e.g., if a previous active state's broadcaster
   * was torn down without going through the registry).
   */
  attachOutboundBroadcaster(inviteId: string, unsubscribe: () => void): void {
    const entry = this.outbound.get(inviteId);
    if (!entry) return;
    if (entry.unsubscribeBroadcaster) {
      try {
        entry.unsubscribeBroadcaster();
      } catch (err) {
        this.logger?.warn({ err, inviteId }, "ai_share_broadcaster_unsubscribe_threw");
      }
    }
    entry.unsubscribeBroadcaster = unsubscribe;
  }

  /** Read the next monotonic seq for an outbound timeline event. */
  takeNextTimelineSeq(inviteId: string): number {
    const entry = this.outbound.get(inviteId);
    if (!entry) return 0;
    const seq = entry.nextTimelineSeq;
    entry.nextTimelineSeq = seq + 1;
    return seq;
  }

  /**
   * Stamp the most recent wire `promptId` from an inbound
   * `ai-share-prompt` so the broadcaster can attach it to the next
   * user_message timeline forward.
   */
  setLastInboundPromptId(inviteId: string, promptId: string): void {
    const entry = this.outbound.get(inviteId);
    if (!entry) return;
    entry.lastInboundPromptId = promptId;
  }

  consumeLastInboundPromptId(inviteId: string): string | null {
    const entry = this.outbound.get(inviteId);
    if (!entry) return null;
    const id = entry.lastInboundPromptId;
    entry.lastInboundPromptId = null;
    return id;
  }

  applyOutboundAccept(envelope: AiShareAcceptEnvelope): OutboundEntry | null {
    const entry = this.outbound.get(envelope.inviteId);
    if (!entry) return null;
    entry.state = {
      kind: "active",
      acceptedAt: envelope.acceptedAt,
      acceptSignatureB64: envelope.signatureB64,
    };
    this.logger?.info({ inviteId: envelope.inviteId }, "ai_share_invite_active_outbound");
    return entry;
  }

  applyOutboundDecline(envelope: AiShareDeclineEnvelope): OutboundEntry | null {
    const entry = this.outbound.get(envelope.inviteId);
    if (!entry) return null;
    entry.state = {
      kind: "declined",
      declinedAt: envelope.declinedAt,
      ...(envelope.reason !== undefined ? { reason: envelope.reason } : {}),
      signatureB64: envelope.signatureB64,
    };
    this.logger?.info({ inviteId: envelope.inviteId }, "ai_share_invite_declined_outbound");
    return entry;
  }

  /** Snapshot of all outbound invites (any state). */
  listOutbound(): readonly OutboundEntry[] {
    this.evictExpired();
    return [...this.outbound.values()];
  }

  /**
   * Phase 4 v2/a — find an active outbound or inbound entry by id.
   * Returns null if not found or not currently active. Used by the
   * end-share flow to resolve the peer pubkey + bail if nothing's
   * running.
   */
  getActive(inviteId: string): {
    side: "outbound" | "inbound";
    peerRootPubKeyB64: string;
    invite: AiShareInviteEnvelope;
  } | null {
    const o = this.outbound.get(inviteId);
    if (o && o.state.kind === "active") {
      return { side: "outbound", peerRootPubKeyB64: o.peerRootPubKeyB64, invite: o.invite };
    }
    const i = this.inbound.get(inviteId);
    if (i && i.state.kind === "active") {
      return { side: "inbound", peerRootPubKeyB64: i.ownerRootPubKeyB64, invite: i.invite };
    }
    return null;
  }

  applyOutboundEnd(args: {
    inviteId: string;
    endedBy: "self" | "peer";
    endedAt: string;
    signatureB64: string;
    reason?: string;
  }): OutboundEntry | null {
    const entry = this.outbound.get(args.inviteId);
    if (!entry) return null;
    entry.state = {
      kind: "ended",
      endedBy: args.endedBy,
      endedAt: args.endedAt,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      signatureB64: args.signatureB64,
    };
    // Phase 4 v2/d: tear down the broadcaster subscription so further
    // agent events for this share go nowhere. Idempotent: clearing the
    // handle prevents a duplicate teardown from a paired
    // applyInboundEnd call on the same invite.
    if (entry.unsubscribeBroadcaster) {
      try {
        entry.unsubscribeBroadcaster();
      } catch (err) {
        this.logger?.warn(
          { err, inviteId: args.inviteId },
          "ai_share_broadcaster_unsubscribe_threw",
        );
      }
      entry.unsubscribeBroadcaster = null;
    }
    this.logger?.info(
      { inviteId: args.inviteId, endedBy: args.endedBy },
      "ai_share_invite_ended_outbound",
    );
    return entry;
  }

  applyInboundEnd(args: {
    inviteId: string;
    endedBy: "self" | "peer";
    endedAt: string;
    signatureB64: string;
    reason?: string;
  }): void {
    const entry = this.inbound.get(args.inviteId);
    if (!entry) return;
    entry.state = {
      kind: "ended",
      endedBy: args.endedBy,
      endedAt: args.endedAt,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      signatureB64: args.signatureB64,
    };
    this.logger?.info(
      { inviteId: args.inviteId, endedBy: args.endedBy },
      "ai_share_invite_ended_inbound",
    );
  }

  /**
   * All ai-share invites currently in `active` state — both outbound
   * (we sent + friend accepted) and inbound (friend invited + we
   * accepted). Drives the active-share banner UI.
   */
  listActive(): ReadonlyArray<{
    inviteId: string;
    side: "outbound" | "inbound";
    peerRootPubKeyB64: string;
    agentLabel: string;
    agentProvider: string;
    acceptedAt: string;
  }> {
    this.evictExpired();
    const out: Array<{
      inviteId: string;
      side: "outbound" | "inbound";
      peerRootPubKeyB64: string;
      agentLabel: string;
      agentProvider: string;
      acceptedAt: string;
    }> = [];
    for (const entry of this.outbound.values()) {
      if (entry.state.kind === "active") {
        out.push({
          inviteId: entry.invite.inviteId,
          side: "outbound",
          peerRootPubKeyB64: entry.peerRootPubKeyB64,
          agentLabel: entry.invite.agentLabel,
          agentProvider: entry.invite.agentProvider,
          acceptedAt: entry.state.acceptedAt,
        });
      }
    }
    for (const entry of this.inbound.values()) {
      if (entry.state.kind === "active") {
        out.push({
          inviteId: entry.invite.inviteId,
          side: "inbound",
          peerRootPubKeyB64: entry.ownerRootPubKeyB64,
          agentLabel: entry.invite.agentLabel,
          agentProvider: entry.invite.agentProvider,
          acceptedAt: entry.state.acceptedAt,
        });
      }
    }
    return out;
  }

  // ----- inbound (friend side) -------------------------------------------

  recordInbound(input: { invite: AiShareInviteEnvelope }): void {
    this.evictExpired();
    const now = this.nowMs();
    const expiresFromInvite = Date.parse(input.invite.expiresAt);
    const expiresAtMs = Number.isFinite(expiresFromInvite) ? expiresFromInvite : now + this.ttlMs;
    this.inbound.set(input.invite.inviteId, {
      invite: input.invite,
      ownerRootPubKeyB64: input.invite.ownerRootPubKeyB64,
      receivedAtMs: now,
      expiresAtMs,
      state: { kind: "pending" },
    });
    this.logger?.info(
      {
        inviteId: input.invite.inviteId,
        ownerPrefix: input.invite.ownerRootPubKeyB64.slice(0, 8),
        agentLabel: input.invite.agentLabel,
      },
      "ai_share_invite_recorded_inbound",
    );
  }

  /** Find a pending inbound invite by id. Null if missing or already terminal. */
  getInboundPending(inviteId: string): InboundEntry | null {
    const entry = this.inbound.get(inviteId);
    if (!entry || entry.state.kind !== "pending") return null;
    if (entry.expiresAtMs <= this.nowMs()) return null;
    return entry;
  }

  applyInboundAccept(inviteId: string, sig: { acceptedAt: string; signatureB64: string }): void {
    const entry = this.inbound.get(inviteId);
    if (!entry) return;
    entry.state = {
      kind: "active",
      acceptedAt: sig.acceptedAt,
      acceptSignatureB64: sig.signatureB64,
    };
  }

  applyInboundDecline(
    inviteId: string,
    sig: { declinedAt: string; signatureB64: string; reason?: string },
  ): void {
    const entry = this.inbound.get(inviteId);
    if (!entry) return;
    entry.state = {
      kind: "declined",
      declinedAt: sig.declinedAt,
      ...(sig.reason !== undefined ? { reason: sig.reason } : {}),
      signatureB64: sig.signatureB64,
    };
  }

  /** All pending inbound invites — drives the friend's notification center. */
  listInboundPending(): readonly InboundEntry[] {
    this.evictExpired();
    return [...this.inbound.values()].filter((e) => e.state.kind === "pending");
  }

  // ----- TTL prune --------------------------------------------------------

  private evictExpired(): void {
    const now = this.nowMs();
    for (const [id, entry] of this.outbound.entries()) {
      if (entry.expiresAtMs <= now && entry.state.kind === "pending") {
        entry.state = { kind: "expired" };
        this.logger?.info({ inviteId: id }, "ai_share_invite_expired_outbound");
      }
    }
    for (const [id, entry] of this.inbound.entries()) {
      if (entry.expiresAtMs <= now && entry.state.kind === "pending") {
        entry.state = { kind: "expired" };
        this.logger?.info({ inviteId: id }, "ai_share_invite_expired_inbound");
      }
    }
  }
}
