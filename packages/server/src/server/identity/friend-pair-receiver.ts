import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import type { FriendPairPendingCandidateStore } from "./friend-pair-pending-candidate-store.js";
import type { FriendPairPendingStore } from "./friend-pair-pending-store.js";
import { decryptFriendPairRedemption, verifyFriendCandidate } from "./friend-pair-redeem.js";
import { FriendPairRedemptionSchema } from "./friend-pair-redeem-types.js";

/**
 * Phase 3.a/2 — receiver-side handler for friend-pair redemption +
 * approval-reply traffic. Cross-identity analog of `device-link-receiver.ts`.
 * Plugs into `relay-transport.ts` via the `connectionHandlers` extension
 * point added in Phase 2.d/1.
 *
 * Wire shape on the socket: a single plaintext-JSON frame matching the
 * `FriendPairRedemptionSchema`. The candidate inside is already encrypted
 * with NaCl box at the application layer (see `friend-pair-redeem.ts`)
 * and carries a SIGMA-I-style Ed25519 signature binding the responder's
 * claimed root pubkey to the specific ECDH session.
 *
 * Lifecycle of a friend-pair socket (Phase 3.a/3 keeps the socket open):
 *
 *   1. Responder's daemon (Bob) connects to the relay with connectionId
 *      `"friend-pair:<offerNonceB64>"`. relay-transport's dispatcher
 *      routes it to this handler.
 *   2. Bob sends one JSON frame: `FriendPairRedemption`.
 *   3. Handler validates the schema, looks up + consumes the matching
 *      pending offer, decrypts the candidate, verifies the SIGMA-I
 *      signature, records it as a pending candidate (KEEPING the socket
 *      reference for the Phase 3.a/3 reply).
 *   4. Handler sends `{ type: "candidate-received" }` and KEEPS THE
 *      SOCKET OPEN.
 *   5. Originator's user (Alice) taps "Approve" / "Reject" in
 *      /settings/friends. Phase 3.a/3 consumes the candidate, signs an
 *      approval reply, sends it over the SAME socket, then closes.
 *   6. Bob's sender decrypts the reply and persists a `Peer` entry.
 *
 * If Bob disconnects between step 4 and step 5, the approve flow gets
 * a "socket closed" error; the candidate record still lives until TTL
 * eviction so Alice can see the attempt timed out in the audit log.
 */

const CONNECTION_ID_PREFIX = "friend-pair:";

const MAX_FRAME_BYTES = 64 * 1024;

export interface FriendPairReceiverDeps {
  pendingOffers: FriendPairPendingStore;
  pendingCandidates: FriendPairPendingCandidateStore;
  /** Override clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

export function createFriendPairConnectionHandler(
  deps: FriendPairReceiverDeps,
): RelayConnectionHandler {
  const now = deps.now ?? (() => Date.now());

  return {
    name: "friend-pair",
    matches: (connectionId) => connectionId.startsWith(CONNECTION_ID_PREFIX),
    handle: async ({ socket, connectionId, logger }) => {
      const expectedNonce = connectionId.slice(CONNECTION_ID_PREFIX.length);
      if (!expectedNonce) {
        logger.warn("friend_pair_handler_missing_nonce");
        closeSocket(socket, 1008, "missing_nonce");
        return;
      }

      let done = false;
      const settleError = (closeCode: number, closeReason: string, errorCode: string): void => {
        if (done) return;
        done = true;
        try {
          socket.send(JSON.stringify({ type: "error", code: errorCode }));
        } catch (err) {
          logger.warn({ err }, "friend_pair_handler_ack_send_failed");
        }
        closeSocket(socket, closeCode, closeReason);
      };

      socket.on("message", (raw, isBinary) => {
        if (done) return;

        const text = decodeFrame(raw, isBinary);
        if (text === null) {
          logger.warn("friend_pair_handler_unparseable_frame");
          settleError(1003, "unparseable_frame", "bad_frame");
          return;
        }
        if (text.length > MAX_FRAME_BYTES) {
          logger.warn(
            { sizeBytes: text.length, capBytes: MAX_FRAME_BYTES },
            "friend_pair_handler_oversized_frame",
          );
          settleError(1009, "oversized_frame", "too_large");
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          logger.warn({ err }, "friend_pair_handler_json_parse_failed");
          settleError(1003, "bad_json", "bad_json");
          return;
        }

        const validated = FriendPairRedemptionSchema.safeParse(parsed);
        if (!validated.success) {
          logger.warn({ issues: validated.error.issues }, "friend_pair_handler_schema_rejected");
          settleError(1008, "bad_schema", "bad_schema");
          return;
        }
        const redemption = validated.data;

        if (redemption.offerNonceB64 !== expectedNonce) {
          logger.warn(
            {
              connectionIdNoncePrefix: expectedNonce.slice(0, 8),
              envelopeNoncePrefix: redemption.offerNonceB64.slice(0, 8),
            },
            "friend_pair_handler_nonce_mismatch",
          );
          settleError(1008, "nonce_mismatch", "nonce_mismatch");
          return;
        }

        const pendingOffer = deps.pendingOffers.redeem(redemption.offerNonceB64, now());
        if (!pendingOffer) {
          logger.warn(
            { noncePrefix: expectedNonce.slice(0, 8) },
            "friend_pair_handler_no_matching_offer",
          );
          settleError(1008, "no_offer", "no_offer");
          return;
        }

        let candidate;
        try {
          candidate = decryptFriendPairRedemption({
            redemption,
            ephPrivateKeyB64: pendingOffer.ephPrivateKeyB64,
          });
        } catch (err) {
          logger.warn({ err }, "friend_pair_handler_decrypt_failed");
          settleError(1008, "decrypt_failed", "decrypt_failed");
          return;
        }

        // SIGMA-I check: the candidate must include a signature, made
        // with its claimed root sign private key, over (offer.nonce ||
        // offer.ephPub || candidate.ephPub). A failure here means the
        // candidate doesn't actually control the root key it claims —
        // a relay-side adversary trying to substitute identities.
        const sigOutcome = verifyFriendCandidate({
          candidate,
          offer: pendingOffer.offer,
          redemption,
        });
        if (!sigOutcome.ok) {
          logger.warn(
            { reason: sigOutcome.reason, noncePrefix: expectedNonce.slice(0, 8) },
            "friend_pair_handler_signature_invalid",
          );
          settleError(1008, "bad_signature", "bad_signature");
          return;
        }

        // Reject self-pairing as a friend — pairing your own root with
        // itself is a category error (use device-link instead) and would
        // create a `Peer` record pointing at your own identity, which
        // the rest of the chat code is not built to handle.
        if (candidate.rootSignPublicKeyB64 === pendingOffer.offer.rootSignPublicKeyB64) {
          logger.warn(
            { noncePrefix: expectedNonce.slice(0, 8) },
            "friend_pair_handler_self_pairing_refused",
          );
          settleError(1008, "self_pairing", "self_pairing");
          return;
        }

        deps.pendingCandidates.record({
          nonceB64: redemption.offerNonceB64,
          candidate,
          offer: pendingOffer.offer,
          ephPrivateKeyB64: pendingOffer.ephPrivateKeyB64,
          candidateEphPublicKeyB64: redemption.candidateEphPublicKeyB64,
          replySocket: socket,
          nowMs: now(),
        });

        logger.info(
          {
            displayName: candidate.displayName,
            peerRootPubKeyPrefix: candidate.rootSignPublicKeyB64.slice(0, 8),
          },
          "friend_pair_handler_candidate_recorded",
        );

        done = true;
        try {
          socket.send(JSON.stringify({ type: "candidate-received" }));
        } catch (err) {
          logger.warn({ err }, "friend_pair_handler_ack_send_failed");
        }
      });

      socket.on("close", (code, reason) => {
        if (!done) {
          logger.info(
            { code, reason: reason.toString() },
            "friend_pair_handler_socket_closed_before_message",
          );
        } else {
          logger.debug(
            { code, reason: reason.toString() },
            "friend_pair_handler_socket_closed_after_candidate",
          );
        }
      });

      socket.on("error", (err) => {
        logger.warn({ err }, "friend_pair_handler_socket_error");
      });
    },
  };
}

function decodeFrame(raw: unknown, isBinary: boolean): string | null {
  if (isBinary) {
    return null;
  }
  if (typeof raw === "string") return raw;
  if (raw instanceof Buffer) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  if (Array.isArray(raw)) {
    try {
      return Buffer.concat(raw.filter((b) => Buffer.isBuffer(b))).toString("utf8");
    } catch {
      return null;
    }
  }
  return null;
}

function closeSocket(socket: RelayCustomHandlerSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // ignore
  }
}
