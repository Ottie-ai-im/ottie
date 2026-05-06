import { generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import type pino from "pino";

import { encodeFriendPairOffer, type PendingFriendPairOffer } from "./friend-pair-types.js";

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const NONCE_BYTES = 32;

export interface CreatePendingFriendPairOfferInput {
  serverId: string;
  rootSignPublicKeyB64: string;
  displayName: string;
  relayEndpoint: string;
  /** Override TTL for tests. Defaults to 10 minutes. */
  ttlMs?: number;
  /** Override clock for tests. Defaults to Date.now(). */
  nowMs?: number;
}

export interface CreatePendingFriendPairOfferResult {
  pending: PendingFriendPairOffer;
  /** ottie://friend-pair#payload=… deep link the originating user shows in QR / "copy link" UI. */
  deepLink: string;
}

/**
 * Phase 3.a/1 — in-memory store of currently-outstanding friend-pair offers
 * issued by this daemon. Cross-identity analog of `DeviceLinkPendingStore`.
 * Same disposable-state contract:
 *
 *   - The ephemeral private key is the secret that gates the redemption
 *     handshake. Persisting it across daemon restarts widens the attack
 *     window without UX gain (the user just regenerates the link).
 *
 *   - Any offer generated but not redeemed becomes implicitly stale once
 *     the daemon restarts; the user retriggers "Add friend" if needed.
 *
 *   - We cap concurrent offers at 8. A user shouldn't have more than a
 *     handful of "Add friend" QRs in flight simultaneously, and an
 *     unbounded list could be abused for memory exhaustion if the
 *     `friend/pair/generate` RPC is ever exposed past the loopback-
 *     trust mode.
 *
 * Note on naming: friends are *external* to the user's identity (peers
 * under a different root). The deep-link prefix is `ottie://friend-pair#`
 * (vs `ottie://device-link#`) to make accidental cross-flow scanning
 * fail loudly at the schema layer rather than silently wrong-route.
 */
const MAX_CONCURRENT_OFFERS = 8;

export class FriendPairPendingStore {
  private offers: Map<string, PendingFriendPairOffer> = new Map();
  private readonly logger: pino.Logger | undefined;

  constructor(logger?: pino.Logger) {
    this.logger = logger?.child({ module: "friend-pair-pending" });
  }

  /**
   * Generate a fresh ephemeral X25519 keypair, build the offer payload,
   * persist it in memory, and return both the wire-shape offer and the
   * encoded deep-link string. The caller is expected to render the deep-
   * link as a QR plus "copy link" affordance.
   */
  create(input: CreatePendingFriendPairOfferInput): CreatePendingFriendPairOfferResult {
    this.gc(input.nowMs);

    if (this.offers.size >= MAX_CONCURRENT_OFFERS) {
      throw new Error(
        `Too many concurrent friend-pair offers (cap: ${MAX_CONCURRENT_OFFERS}). ` +
          "Cancel an existing offer or wait for one to expire.",
      );
    }

    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const nowMs = input.nowMs ?? Date.now();
    const expiresAtMs = nowMs + ttlMs;

    const { publicKey, privateKey } = generateKeyPairSync("x25519");
    const ephPublicKeyB64 = exportX25519PublicKey(publicKey);
    const ephPrivateKeyB64 = exportX25519PrivateKey(privateKey);
    const nonceB64 = randomBytes(NONCE_BYTES).toString("base64url").replace(/=+$/, "");

    const pending: PendingFriendPairOffer = {
      offer: {
        v: 1,
        kind: "friend-pair",
        serverId: input.serverId,
        rootSignPublicKeyB64: input.rootSignPublicKeyB64,
        displayName: input.displayName,
        ephPublicKeyB64,
        nonceB64,
        exp: new Date(expiresAtMs).toISOString(),
        relayEndpoint: input.relayEndpoint,
      },
      ephPrivateKeyB64,
      expiresAtMs,
    };

    this.offers.set(nonceB64, pending);
    this.logger?.info(
      {
        nonceB64Prefix: nonceB64.slice(0, 8),
        ephPubKeyPrefix: ephPublicKeyB64.slice(0, 8),
        expiresAt: pending.offer.exp,
      },
      "Created pending friend-pair offer",
    );

    return {
      pending,
      deepLink: encodeFriendPairOffer(pending.offer),
    };
  }

  /**
   * Look up and consume a pending offer by its nonce. Returns the offer if
   * it exists and hasn't expired; returns null otherwise. Consumed offers
   * are removed from the store — a nonce is single-use.
   */
  redeem(nonceB64: string, nowMs: number = Date.now()): PendingFriendPairOffer | null {
    const pending = this.offers.get(nonceB64);
    if (!pending) return null;
    if (pending.expiresAtMs <= nowMs) {
      this.offers.delete(nonceB64);
      return null;
    }
    this.offers.delete(nonceB64);
    return pending;
  }

  /**
   * Cancel an outstanding offer (user backs out of "Add friend" flow).
   * Returns true if there was something to cancel.
   */
  cancel(nonceB64: string): boolean {
    return this.offers.delete(nonceB64);
  }

  /**
   * Visibility for tests and for the UI's optional "still waiting"
   * indicator. Returns the public-only offer wire shape; never exposes
   * the private key.
   */
  list(nowMs: number = Date.now()): PendingFriendPairOffer[] {
    this.gc(nowMs);
    return Array.from(this.offers.values());
  }

  /** Drop expired entries. Called on every create/list to keep the map small. */
  private gc(nowMs?: number): void {
    const cutoff = nowMs ?? Date.now();
    for (const [nonce, pending] of this.offers) {
      if (pending.expiresAtMs <= cutoff) {
        this.offers.delete(nonce);
      }
    }
  }
}

// ----- X25519 raw-byte (JWK base64url) serialization ---------------------

function exportX25519PublicKey(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) {
    throw new Error("X25519 public key JWK missing 'x' field");
  }
  return jwk.x;
}

function exportX25519PrivateKey(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { d?: string };
  if (!jwk.d) {
    throw new Error("X25519 private key JWK missing 'd' field");
  }
  return jwk.d;
}
