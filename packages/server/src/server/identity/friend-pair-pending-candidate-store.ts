import type pino from "pino";

import type { FriendCandidate } from "./friend-pair-redeem-types.js";
import type { FriendPairOffer } from "./friend-pair-types.js";

/**
 * Phase 3.a/2 — in-memory store of decrypted friend-pair candidates that
 * have arrived from a peer (Bob's daemon) and are *waiting for the user's
 * approval*. Cross-identity analog of `DeviceLinkPendingCandidateStore`.
 *
 * Why a separate type vs reusing the device-link store? They carry
 * different candidate shapes (`FriendCandidate` vs `CandidateDevice`)
 * and conceptually live on different lifecycle paths — a parked friend
 * candidate becomes a `Peer` entry on approval; a parked device
 * candidate becomes a signed `Device` under the user's own root.
 *
 * Like the device-link variants this is intentionally NOT persisted to
 * disk: a daemon restart mid-handshake means the user re-scans, no
 * zombie "approve this friend from 3 days ago" prompts.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_CANDIDATES = 8;

/**
 * Minimal subset of the relay-transport socket the approval flow needs.
 * Same shape as `device-link-pending-candidate-store.CandidateReplySocket`;
 * defined here too to keep this store a leaf module.
 */
export interface FriendCandidateReplySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface PendingFriendCandidateRecord {
  /** Mirrors offer.nonceB64. End-to-end lookup key. */
  readonly nonceB64: string;
  /** The decrypted candidate the user will approve or reject. */
  readonly candidate: FriendCandidate;
  /** The original offer — UI shows offer.displayName + own offer.exp. */
  readonly offer: FriendPairOffer;
  /**
   * Originating user's retained X25519 secret. Needed in Phase 3.a/3 to
   * encrypt the approval reply back to the responder using the SAME
   * shared key the candidate was decrypted with.
   */
  readonly ephPrivateKeyB64: string;
  /** Responder's ephemeral X25519 public, for the Phase 3.a/3 reply ECDH. */
  readonly candidateEphPublicKeyB64: string;
  /** Wall-clock ms when the candidate landed. */
  readonly receivedAtMs: number;
  /** Wall-clock ms after which the record is treated as stale. */
  readonly expiresAtMs: number;
  /**
   * The still-open relay socket the receiver was talking to when this
   * candidate landed. Approval/rejection sends the encrypted reply over
   * this socket and then closes it. Optional — see device-link variant
   * for the same rationale.
   */
  readonly replySocket?: FriendCandidateReplySocket;
}

export interface RecordPendingFriendCandidateInput {
  nonceB64: string;
  candidate: FriendCandidate;
  offer: FriendPairOffer;
  ephPrivateKeyB64: string;
  candidateEphPublicKeyB64: string;
  /** See PendingFriendCandidateRecord.replySocket. */
  replySocket?: FriendCandidateReplySocket;
  /** Override clock for tests. */
  nowMs?: number;
  /** Override TTL for tests. */
  ttlMs?: number;
}

export class FriendPairPendingCandidateStore {
  private candidates: Map<string, PendingFriendCandidateRecord> = new Map();
  private readonly logger: pino.Logger | undefined;

  constructor(logger?: pino.Logger) {
    this.logger = logger?.child({ module: "friend-pair-candidates" });
  }

  /**
   * Persist a freshly-decrypted candidate. Last-writer-wins by nonce — a
   * second valid candidate for the same offer overwrites the first
   * (handles the responder retrying after a flaky network). Caps the
   * map at MAX_CONCURRENT_CANDIDATES with a GC pass on every write.
   */
  record(input: RecordPendingFriendCandidateInput): PendingFriendCandidateRecord {
    const nowMs = input.nowMs ?? Date.now();
    this.gc(nowMs);

    if (this.candidates.size >= MAX_CONCURRENT_CANDIDATES && !this.candidates.has(input.nonceB64)) {
      throw new Error(
        `Too many pending friend-pair candidates (cap: ${MAX_CONCURRENT_CANDIDATES}).`,
      );
    }

    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const record: PendingFriendCandidateRecord = {
      nonceB64: input.nonceB64,
      candidate: input.candidate,
      offer: input.offer,
      ephPrivateKeyB64: input.ephPrivateKeyB64,
      candidateEphPublicKeyB64: input.candidateEphPublicKeyB64,
      receivedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
      ...(input.replySocket ? { replySocket: input.replySocket } : {}),
    };
    this.candidates.set(input.nonceB64, record);
    this.logger?.info(
      {
        nonceB64Prefix: input.nonceB64.slice(0, 8),
        peerDisplayName: input.candidate.displayName,
        peerRootPubKeyPrefix: input.candidate.rootSignPublicKeyB64.slice(0, 8),
      },
      "Recorded pending friend-pair candidate",
    );
    return record;
  }

  /**
   * Look up a candidate by nonce. Returns null if not found OR expired.
   * Expired records are evicted as a side effect.
   */
  get(nonceB64: string, nowMs: number = Date.now()): PendingFriendCandidateRecord | null {
    const record = this.candidates.get(nonceB64);
    if (!record) return null;
    if (record.expiresAtMs <= nowMs) {
      this.candidates.delete(nonceB64);
      return null;
    }
    return record;
  }

  /**
   * Single-use consume by nonce. Used by Phase 3.a/3 once the user has
   * approved/rejected. Returns the record on the first call and null on
   * every subsequent one. Expired records consume as null.
   */
  consume(nonceB64: string, nowMs: number = Date.now()): PendingFriendCandidateRecord | null {
    const record = this.get(nonceB64, nowMs);
    if (record) {
      this.candidates.delete(nonceB64);
    }
    return record;
  }

  /**
   * Snapshot for the UI's "Pending friend requests" section. GC's stale
   * entries before returning so callers see only fresh records.
   */
  list(nowMs: number = Date.now()): readonly PendingFriendCandidateRecord[] {
    this.gc(nowMs);
    return Array.from(this.candidates.values());
  }

  private gc(nowMs: number): void {
    for (const [nonce, record] of this.candidates) {
      if (record.expiresAtMs <= nowMs) {
        this.candidates.delete(nonce);
      }
    }
  }
}
