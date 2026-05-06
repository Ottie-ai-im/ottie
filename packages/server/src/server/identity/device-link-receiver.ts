import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import type { DeviceLinkPendingCandidateStore } from "./device-link-pending-candidate-store.js";
import type { DeviceLinkPendingStore } from "./device-link-pending-store.js";
import { decryptDeviceLinkRedemption } from "./device-link-redeem.js";
import { DeviceLinkRedemptionSchema } from "./device-link-redeem-types.js";

/**
 * Phase 2.d — receiver-side handler for device-link redemption traffic.
 * Plugs into `relay-transport.ts` via the `connectionHandlers` extension
 * point added in step 1 of this phase.
 *
 * Wire shape on the socket: a SINGLE plaintext-JSON frame matching the
 * `DeviceLinkRedemptionSchema`. The candidate inside is already encrypted
 * with NaCl box at the application layer (see `device-link-redeem.ts`),
 * so the relay carries opaque ciphertext under a thin envelope. We do
 * NOT add another `createDaemonChannel` layer on top — that would be
 * double-encryption against the same Curve25519 keypair, paying an extra
 * 24-byte nonce per frame for nothing.
 *
 * Lifecycle of a device-link socket:
 *
 *   1. New device's daemon connects to the relay with a connectionId of
 *      "device-link:<offerNonceB64>". relay-transport's dispatcher routes
 *      it to this handler.
 *   2. New device sends one JSON frame: `DeviceLinkRedemption`.
 *   3. Handler validates the schema, looks up + consumes the matching
 *      pending offer, decrypts the candidate, records it as a pending
 *      candidate awaiting user approval (Phase 2.e).
 *   4. Handler sends a small ack `{ type: "candidate-received" }` so the
 *      new device knows the candidate landed, then closes the socket.
 *      The actual approval reply (signed Device record) goes through a
 *      different relay round-trip in Phase 2.e — keeping Phase 2.d a
 *      single-direction "offer accepted" milestone.
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

      let resolved = false;
      const settle = (closeCode: number, closeReason: string, ack?: unknown): void => {
        if (resolved) return;
        resolved = true;
        if (ack !== undefined) {
          try {
            socket.send(JSON.stringify(ack));
          } catch (err) {
            logger.warn({ err }, "device_link_handler_ack_send_failed");
          }
        }
        closeSocket(socket, closeCode, closeReason);
      };

      socket.on("message", (raw, isBinary) => {
        if (resolved) return;

        const text = decodeFrame(raw, isBinary);
        if (text === null) {
          logger.warn("device_link_handler_unparseable_frame");
          settle(1003, "unparseable_frame", { type: "error", code: "bad_frame" });
          return;
        }
        if (text.length > MAX_FRAME_BYTES) {
          logger.warn(
            { sizeBytes: text.length, capBytes: MAX_FRAME_BYTES },
            "device_link_handler_oversized_frame",
          );
          settle(1009, "oversized_frame", { type: "error", code: "too_large" });
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          logger.warn({ err }, "device_link_handler_json_parse_failed");
          settle(1003, "bad_json", { type: "error", code: "bad_json" });
          return;
        }

        const validated = DeviceLinkRedemptionSchema.safeParse(parsed);
        if (!validated.success) {
          logger.warn({ issues: validated.error.issues }, "device_link_handler_schema_rejected");
          settle(1008, "bad_schema", { type: "error", code: "bad_schema" });
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
          settle(1008, "nonce_mismatch", { type: "error", code: "nonce_mismatch" });
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
          settle(1008, "no_offer", { type: "error", code: "no_offer" });
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
          settle(1008, "decrypt_failed", { type: "error", code: "decrypt_failed" });
          return;
        }

        deps.pendingCandidates.record({
          nonceB64: redemption.offerNonceB64,
          candidate,
          offer: pendingOffer.offer,
          ephPrivateKeyB64: pendingOffer.ephPrivateKeyB64,
          newDeviceEphPublicKeyB64: redemption.newDeviceEphPublicKeyB64,
          nowMs: now(),
        });

        logger.info(
          {
            deviceLabel: candidate.deviceLabel,
            role: candidate.role,
          },
          "device_link_handler_candidate_recorded",
        );

        settle(1000, "candidate_received", { type: "candidate-received" });
      });

      socket.on("close", (code, reason) => {
        if (resolved) return;
        resolved = true;
        logger.info(
          { code, reason: reason.toString() },
          "device_link_handler_socket_closed_before_message",
        );
      });

      socket.on("error", (err) => {
        if (resolved) return;
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
