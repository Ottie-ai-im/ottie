import type pino from "pino";

import type { CandidateDevice } from "./device-link-redeem-types.js";
import type { DeviceLinkOffer } from "./device-link-types.js";

/**
 * Phase 2.d — in-memory store of decrypted device-link candidates that
 * have arrived from a new device and are *waiting for the user's approval*.
 *
 * Why not collapse into DeviceLinkPendingStore? They have different
 * lifecycles:
 *
 *   - Pending OFFER (DeviceLinkPendingStore): "I generated a QR; nothing
 *     has happened yet. The new device might never scan it."
 *   - Pending CANDIDATE (this store): "The new device DID scan, sent its
 *     candidate, the user just hasn't tapped Approve/Reject yet."
 *
 * Splitting them keeps each responsibility narrow and lets Phase 2.e's
 * approval flow have a clean, audited input shape.
 *
 * Like DeviceLinkPendingStore, this is intentionally NOT persisted to disk:
 * if the daemon restarts mid-handshake, the user just regenerates the QR
 * — no zombie "approve this device from 3 days ago" prompts.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes — same as offer TTL
const MAX_CONCURRENT_CANDIDATES = 8;

export interface PendingCandidateRecord {
  /** Mirrors offer.nonceB64. Used as the lookup key end-to-end. */
  readonly nonceB64: string;
  /** The decrypted candidate the user will approve or reject. */
  readonly candidate: CandidateDevice;
  /** The original offer — the UI shows offer.displayName + offer.exp. */
  readonly offer: DeviceLinkOffer;
  /**
   * Existing device's retained X25519 secret. Needed in Phase 2.e to
   * encrypt the approval reply (signed Device record) back to the new
   * device using the SAME shared key the candidate was decrypted with.
   */
  readonly ephPrivateKeyB64: string;
  /** New device's ephemeral X25519 public, for the Phase 2.e reply ECDH. */
  readonly newDeviceEphPublicKeyB64: string;
  /** Wall-clock ms when the candidate landed. */
  readonly receivedAtMs: number;
  /** Wall-clock ms after which the record is treated as stale. */
  readonly expiresAtMs: number;
}

export interface RecordPendingCandidateInput {
  nonceB64: string;
  candidate: CandidateDevice;
  offer: DeviceLinkOffer;
  ephPrivateKeyB64: string;
  newDeviceEphPublicKeyB64: string;
  /** Override clock for tests. */
  nowMs?: number;
  /** Override TTL for tests. */
  ttlMs?: number;
}

export class DeviceLinkPendingCandidateStore {
  private candidates: Map<string, PendingCandidateRecord> = new Map();
  private readonly logger: pino.Logger | undefined;

  constructor(logger?: pino.Logger) {
    this.logger = logger?.child({ module: "device-link-candidates" });
  }

  /**
   * Persist a freshly-decrypted candidate. Last-writer-wins by nonce: a
   * second valid candidate for the same offer overwrites the first
   * (intentional — handles the new device retrying after a flaky network).
   * Caps the map at MAX_CONCURRENT_CANDIDATES and runs a GC pass on every
   * write so an attacker can't grow it without bound.
   */
  record(input: RecordPendingCandidateInput): PendingCandidateRecord {
    const nowMs = input.nowMs ?? Date.now();
    this.gc(nowMs);

    if (this.candidates.size >= MAX_CONCURRENT_CANDIDATES && !this.candidates.has(input.nonceB64)) {
      throw new Error(
        `Too many pending device-link candidates (cap: ${MAX_CONCURRENT_CANDIDATES}).`,
      );
    }

    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const record: PendingCandidateRecord = {
      nonceB64: input.nonceB64,
      candidate: input.candidate,
      offer: input.offer,
      ephPrivateKeyB64: input.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: input.newDeviceEphPublicKeyB64,
      receivedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
    };
    this.candidates.set(input.nonceB64, record);
    this.logger?.info(
      {
        nonceB64Prefix: input.nonceB64.slice(0, 8),
        deviceLabel: input.candidate.deviceLabel,
        role: input.candidate.role,
      },
      "Recorded pending device-link candidate",
    );
    return record;
  }

  /**
   * Look up a candidate by nonce. Returns null if not found OR expired.
   * Expired records are evicted as a side effect.
   */
  get(nonceB64: string, nowMs: number = Date.now()): PendingCandidateRecord | null {
    const record = this.candidates.get(nonceB64);
    if (!record) return null;
    if (record.expiresAtMs <= nowMs) {
      this.candidates.delete(nonceB64);
      return null;
    }
    return record;
  }

  /**
   * Consume a candidate by nonce. Used by Phase 2.e once the user has
   * approved/rejected — single-use, returns the record on the first call
   * and null on every subsequent one. Expired records consume as null.
   */
  consume(nonceB64: string, nowMs: number = Date.now()): PendingCandidateRecord | null {
    const record = this.get(nonceB64, nowMs);
    if (record) {
      this.candidates.delete(nonceB64);
    }
    return record;
  }

  /**
   * Snapshot of all currently-pending candidates for the UI's "approve
   * device" dialog. Runs GC so callers see only fresh records.
   */
  list(nowMs: number = Date.now()): readonly PendingCandidateRecord[] {
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
