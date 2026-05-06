import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import type { DeviceLinkPendingCandidateStore } from "./device-link-pending-candidate-store.js";
import type { DeviceLinkPendingStore } from "./device-link-pending-store.js";
import { decryptDeviceLinkRedemption } from "./device-link-redeem.js";
import { DeviceLinkRedemptionSchema } from "./device-link-redeem-types.js";

/**
 * Phase 2.d/e — receiver-side handler for device-link redemption +
 * approval-reply traffic. Plugs into `relay-transport.ts` via the
 * `connectionHandlers` extension point.
 *
 * Wire shape on the socket: a single plaintext-JSON frame matching the
 * `DeviceLinkRedemptionSchema`. The candidate inside is already encrypted
 * with NaCl box at the application layer (see `device-link-redeem.ts`),
 * so the relay carries opaque ciphertext under a thin envelope. We do
 * NOT add another `createDaemonChannel` layer on top — that would be
 * double-encryption against the same Curve25519 keypair, paying an extra
 * 24-byte nonce per frame for nothing.
 *
 * Lifecycle of a device-link socket (Phase 2.e: socket stays open):
 *
 *   1. New device's daemon connects to the relay with a connectionId of
 *      "device-link:<offerNonceB64>". relay-transport's dispatcher routes
 *      it to this handler.
 *   2. New device sends one JSON frame: `DeviceLinkRedemption`.
 *   3. Handler validates the schema, looks up + consumes the matching
 *      pending offer, decrypts the candidate, records it as a pending
 *      candidate (KEEPING the socket reference on the record).
 *   4. Handler sends `{ type: "candidate-received" }` so the new device
 *      knows the candidate landed, then KEEPS THE SOCKET OPEN.
 *   5. Old device's user taps "Approve" or "Reject" in the UI.
 *      `IdentityService.approveDeviceLinkCandidate(nonceB64)` consumes
 *      the candidate, signs it, and sends the encrypted approval reply
 *      back over the SAME socket from step 3, then closes the socket.
 *   6. New device's sender (device-link-sender.ts) decrypts the reply
 *      and persists root identity + signed device + peer list.
 *
 * If the new device disconnects between step 4 and step 5, the
 * approve-side just gets a "socket closed" error; the candidate
 * record still lives until TTL eviction so the user can see the
 * attempt in the audit log if we add one later.
 */

const CONNECTION_ID_PREFIX = "device-link:";

const MAX_FRAME_BYTES = 64 * 1024; // 64 KiB cap; a candidate envelope is <2 KiB.

export interface DeviceLinkReceiverDeps {
  pendingOffers: DeviceLinkPendingStore;
  pendingCandidates: DeviceLinkPendingCandidateStore;
  /** Override clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

export function createDeviceLinkConnectionHandler(
  deps: DeviceLinkReceiverDeps,
): RelayConnectionHandler {
  const now = deps.now ?? (() => Date.now());

  return {
    name: "device-link",
    matches: (connectionId) => connectionId.startsWith(CONNECTION_ID_PREFIX),
    handle: async ({ socket, connectionId, logger }) => {
      const expectedNonce = connectionId.slice(CONNECTION_ID_PREFIX.length);
      if (!expectedNonce) {
        logger.warn("device_link_handler_missing_nonce");
        closeSocket(socket, 1008, "missing_nonce");
        return;
      }

      // Two-stage lifecycle:
      //   - `done` flips true after we've processed the (single expected)
      //     redemption frame. It guards against any subsequent stray
      //     messages on the same socket — only the approval flow may
      //     send on it from now on, and that's via the stored socket
      //     reference, not this listener.
      //   - On happy path, `done = true` but the socket stays OPEN so
      //     the approve flow can write to it later.
      //   - On error paths, we close the socket immediately.
      let done = false;
      const settleError = (closeCode: number, closeReason: string, errorCode: string): void => {
        if (done) return;
        done = true;
        try {
          socket.send(JSON.stringify({ type: "error", code: errorCode }));
        } catch (err) {
          logger.warn({ err }, "device_link_handler_ack_send_failed");
        }
        closeSocket(socket, closeCode, closeReason);
      };

      socket.on("message", (raw, isBinary) => {
        if (done) return;

        const text = decodeFrame(raw, isBinary);
        if (text === null) {
          logger.warn("device_link_handler_unparseable_frame");
          settleError(1003, "unparseable_frame", "bad_frame");
          return;
        }
        if (text.length > MAX_FRAME_BYTES) {
          logger.warn(
            { sizeBytes: text.length, capBytes: MAX_FRAME_BYTES },
            "device_link_handler_oversized_frame",
          );
          settleError(1009, "oversized_frame", "too_large");
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          logger.warn({ err }, "device_link_handler_json_parse_failed");
          settleError(1003, "bad_json", "bad_json");
          return;
        }

        const validated = DeviceLinkRedemptionSchema.safeParse(parsed);
        if (!validated.success) {
          logger.warn({ issues: validated.error.issues }, "device_link_handler_schema_rejected");
          settleError(1008, "bad_schema", "bad_schema");
          return;
        }
        const redemption = validated.data;

        if (redemption.offerNonceB64 !== expectedNonce) {
          // The connectionId nonce and the envelope nonce must agree. A
          // mismatch means either a confused client or someone trying to
          // reuse a redemption envelope on a different connection.
          logger.warn(
            {
              connectionIdNoncePrefix: expectedNonce.slice(0, 8),
              envelopeNoncePrefix: redemption.offerNonceB64.slice(0, 8),
            },
            "device_link_handler_nonce_mismatch",
          );
          settleError(1008, "nonce_mismatch", "nonce_mismatch");
          return;
        }

        const pendingOffer = deps.pendingOffers.redeem(redemption.offerNonceB64, now());
        if (!pendingOffer) {
          // Either the offer never existed, was already consumed, or
          // expired between QR generation and now. Single-use semantics.
          logger.warn(
            { noncePrefix: expectedNonce.slice(0, 8) },
            "device_link_handler_no_matching_offer",
          );
          settleError(1008, "no_offer", "no_offer");
          return;
        }

        let candidate;
        try {
          candidate = decryptDeviceLinkRedemption({
            redemption,
            ephPrivateKeyB64: pendingOffer.ephPrivateKeyB64,
          });
        } catch (err) {
          logger.warn({ err }, "device_link_handler_decrypt_failed");
          settleError(1008, "decrypt_failed", "decrypt_failed");
          return;
        }

        // Happy path: park the candidate AND the still-open socket so
        // the approve flow can write the encrypted reply back later.
        deps.pendingCandidates.record({
          nonceB64: redemption.offerNonceB64,
          candidate,
          offer: pendingOffer.offer,
          ephPrivateKeyB64: pendingOffer.ephPrivateKeyB64,
          newDeviceEphPublicKeyB64: redemption.newDeviceEphPublicKeyB64,
          replySocket: socket,
          nowMs: now(),
        });

        logger.info(
          { deviceLabel: candidate.deviceLabel, role: candidate.role },
          "device_link_handler_candidate_recorded",
        );

        // Mark this listener finished BUT keep the socket open. The
        // approve/reject flow takes ownership from here.
        done = true;
        try {
          socket.send(JSON.stringify({ type: "candidate-received" }));
        } catch (err) {
          logger.warn({ err }, "device_link_handler_ack_send_failed");
        }
      });

      socket.on("close", (code, reason) => {
        if (!done) {
          logger.info(
            { code, reason: reason.toString() },
            "device_link_handler_socket_closed_before_message",
          );
        } else {
          logger.debug(
            { code, reason: reason.toString() },
            "device_link_handler_socket_closed_after_candidate",
          );
        }
      });

      socket.on("error", (err) => {
        logger.warn({ err }, "device_link_handler_socket_error");
      });
    },
  };
}

function decodeFrame(raw: unknown, isBinary: boolean): string | null {
  if (isBinary) {
    // We never send the candidate envelope as binary — reject it loudly
    // so we don't accidentally interpret stray noise as JSON.
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
    // ignore — caller has already done its job
  }
}
