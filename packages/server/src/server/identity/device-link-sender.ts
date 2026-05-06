import { WebSocket } from "ws";
import type { KeyObject } from "node:crypto";
import type pino from "pino";

import { buildRelayWebSocketUrl } from "../../shared/daemon-endpoints.js";

import { decryptDeviceLinkApprovalEnvelope } from "./device-link-approve.js";
import {
  DeviceLinkApprovalEnvelopeSchema,
  type DeviceLinkApprovalReply,
} from "./device-link-approve-types.js";
import { buildDeviceLinkRedemption } from "./device-link-redeem.js";
import type { CandidateDevice, DeviceLinkRedemption } from "./device-link-redeem-types.js";
import type { StoredDevice } from "./device-types.js";
import type { StoredRootIdentity } from "./identity-types.js";
import { decodeDeviceLinkOffer, type DeviceLinkOffer } from "./device-link-types.js";

/**
 * Phase 2.d — sender side of the device-link handshake. Runs on the NEW
 * device's daemon. The flow:
 *
 *   1. User pastes the deep-link string (or scans the QR — same thing).
 *   2. New daemon decodes the offer, generates fresh keypairs, builds a
 *      `DeviceLinkRedemption` envelope (see `device-link-redeem.ts`).
 *   3. New daemon opens a relay WebSocket to the OLD daemon's relay
 *      endpoint with `connectionId="device-link:<nonceB64>"` so the old
 *      daemon's `connectionHandlers` dispatcher routes it to the
 *      device-link receiver from step 2 of Phase 2.d.
 *   4. New daemon sends one JSON frame, awaits one ack-or-error frame,
 *      closes the socket.
 *   5. On `{type:"candidate-received"}`: success — caller now holds
 *      `localSecrets` and waits for the Phase 2.e approval reply.
 *   6. On `{type:"error", code:"..."}`: caller surfaces the error string
 *      to the UI ("offer expired", "decryption failed", "no offer", …).
 *
 * Pure, no I/O outside the WebSocket itself. The socket is created
 * through a factory parameter so tests can drive the handshake without
 * a real relay.
 */

const REDEEM_TIMEOUT_MS = 5 * 60_000; // 5 minutes — Phase 2.e waits for user-tap approval

export interface RedeemSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export type RedeemSocketFactory = (url: string) => RedeemSocket;

export interface NewDeviceLocalSecretsForSender {
  deviceId: string;
  signPrivateKey: KeyObject;
  signPublicKeyB64: string;
  ephPrivateKeyB64: string;
}

export type RedeemDeviceLinkOfferOutcome =
  | {
      /**
       * The OLD device approved the link end-to-end. Caller now has
       * everything needed to bootstrap the new device's identity:
       * root keypair, signed self-device record, and the OLD device's
       * device-list snapshot at the time of approval.
       */
      readonly status: "linked";
      readonly candidate: CandidateDevice;
      readonly offer: DeviceLinkOffer;
      readonly localSecrets: NewDeviceLocalSecretsForSender;
      readonly rootIdentity: StoredRootIdentity;
      readonly signedDevice: StoredDevice;
      readonly peerDevices: readonly StoredDevice[];
    }
  | {
      readonly status: "rejected";
      /**
       * Coded reason. Receiver-side codes from Phase 2.d
       * (`no_offer`, `decrypt_failed`, `nonce_mismatch`, `bad_schema`,
       * `bad_json`, `bad_frame`, `too_large`), Phase 2.e codes
       * (`user_rejected`, `approval_decrypt_failed`,
       * `approval_schema_invalid`, `approval_unexpected`), or local-
       * sender codes (`offer_expired`, `build_failed`, `send_failed`,
       * `timeout`, `connection_closed`, `socket_error`,
       * `bad_response_frame`, `bad_response_json`).
       */
      readonly errorCode: string;
      readonly errorMessage: string;
    };

export interface RedeemDeviceLinkOfferInput {
  /** Either the wire offer (already decoded) or a deep-link string to decode. */
  deepLinkOrOffer: string | DeviceLinkOffer;
  /** Human-readable label the new device wants ("Wendell's Phone"). */
  deviceLabel: string;
  /** Whether the new device is a daemon-host or client-only. */
  role: "daemon" | "client";
  /** Override clock (tests). */
  nowMs?: number;
  /** Override timeout in ms. Defaults to 30 seconds. */
  timeoutMs?: number;
  /**
   * Override the WebSocket factory (tests). Default uses the `ws` package
   * with the same per-message-deflate / handshake-timeout settings as
   * relay-transport.ts.
   */
  createSocket?: RedeemSocketFactory;
  /** Optional logger; falls back to no-op. */
  logger?: pino.Logger;
}

export async function redeemDeviceLinkOffer(
  input: RedeemDeviceLinkOfferInput,
): Promise<RedeemDeviceLinkOfferOutcome> {
  const log = input.logger?.child({ module: "device-link-sender" });
  const offer =
    typeof input.deepLinkOrOffer === "string"
      ? decodeDeviceLinkOffer(input.deepLinkOrOffer)
      : input.deepLinkOrOffer;

  let built;
  try {
    built = buildDeviceLinkRedemption({
      offer,
      deviceLabel: input.deviceLabel,
      role: input.role,
      nowMs: input.nowMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.warn({ err }, "device_link_sender_build_failed");
    return {
      status: "rejected",
      errorCode: /expired/i.test(message) ? "offer_expired" : "build_failed",
      errorMessage: message,
    };
  }

  const url = buildRelayWebSocketUrl({
    endpoint: built.offer.relayEndpoint,
    serverId: built.offer.serverId,
    role: "client",
    connectionId: `device-link:${built.offer.nonceB64}`,
    version: 2,
  });

  const factory = input.createSocket ?? defaultSocketFactory;
  const timeoutMs = input.timeoutMs ?? REDEEM_TIMEOUT_MS;

  log?.info(
    {
      relayEndpoint: built.offer.relayEndpoint,
      serverId: built.offer.serverId,
      noncePrefix: built.offer.nonceB64.slice(0, 8),
    },
    "device_link_sender_connecting",
  );

  return new Promise<RedeemDeviceLinkOfferOutcome>((resolve) => {
    const socket = factory(url);
    let settled = false;

    const settle = (outcome: RedeemDeviceLinkOfferOutcome): void => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve(outcome);
    };

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      log?.warn({ timeoutMs }, "device_link_sender_timeout");
      settle({
        status: "rejected",
        errorCode: "timeout",
        errorMessage: `Device-link redemption timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    (timeoutHandle as unknown as { unref?: () => void }).unref?.();

    const cleanup = () => {
      clearTimeout(timeoutHandle);
    };

    socket.on("open", () => {
      try {
        socket.send(JSON.stringify(built.redemption satisfies DeviceLinkRedemption));
        log?.info("device_link_sender_redemption_sent");
      } catch (err) {
        cleanup();
        log?.warn({ err }, "device_link_sender_send_failed");
        settle({
          status: "rejected",
          errorCode: "send_failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Two-stage protocol from the receiver:
    //   1. `{type:"candidate-received"}` ack — flips ackReceived = true
    //      and we keep listening for the approval envelope.
    //   2. `DeviceLinkApprovalEnvelope` (kind: "device-link-approval-
    //      envelope") — decrypted into the final approved/rejected reply.
    //   At either stage, an `{type:"error", code:"..."}` short-circuits
    //   to a rejected outcome.
    let ackReceived = false;

    socket.on("message", (raw) => {
      const text = decodeMessage(raw);
      if (text === null) {
        cleanup();
        settle({
          status: "rejected",
          errorCode: "bad_response_frame",
          errorMessage: "Receiver sent a non-text response frame",
        });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        cleanup();
        settle({
          status: "rejected",
          errorCode: "bad_response_json",
          errorMessage: "Receiver sent malformed JSON",
        });
        return;
      }

      const reply = parsed as { type?: unknown; code?: unknown; kind?: unknown };

      // Stage 1: receiver acked the candidate. Stay open.
      if (!ackReceived && reply.type === "candidate-received") {
        ackReceived = true;
        log?.info("device_link_sender_ack_received");
        return;
      }

      // Either stage: receiver-side error short-circuits.
      if (reply.type === "error") {
        cleanup();
        const code = typeof reply.code === "string" ? reply.code : "unknown";
        log?.warn({ code }, "device_link_sender_rejected_by_receiver");
        settle({
          status: "rejected",
          errorCode: code,
          errorMessage: humanizeReceiverError(code),
        });
        return;
      }

      // Stage 2: approval envelope. Schema-validate, decrypt, classify.
      if (reply.kind === "device-link-approval-envelope") {
        const validated = DeviceLinkApprovalEnvelopeSchema.safeParse(parsed);
        if (!validated.success) {
          cleanup();
          settle({
            status: "rejected",
            errorCode: "approval_schema_invalid",
            errorMessage: "Approval envelope failed schema validation",
          });
          return;
        }

        let approvalReply: DeviceLinkApprovalReply;
        try {
          approvalReply = decryptDeviceLinkApprovalEnvelope({
            envelope: validated.data,
            newDeviceEphPrivateKeyB64: built.localSecrets.ephPrivateKeyB64,
            offerEphPublicKeyB64: built.offer.ephPublicKeyB64,
          });
        } catch (err) {
          cleanup();
          log?.warn({ err }, "device_link_sender_approval_decrypt_failed");
          settle({
            status: "rejected",
            errorCode: "approval_decrypt_failed",
            errorMessage:
              err instanceof Error ? err.message : "Failed to decrypt approval envelope",
          });
          return;
        }

        cleanup();
        if (approvalReply.status === "approved") {
          log?.info({ deviceId: approvalReply.signedDevice.deviceId }, "device_link_sender_linked");
          settle({
            status: "linked",
            candidate: built.candidate,
            offer: built.offer,
            localSecrets: built.localSecrets,
            rootIdentity: approvalReply.rootIdentity,
            signedDevice: approvalReply.signedDevice,
            peerDevices: approvalReply.peerDevices,
          });
        } else {
          log?.info({ reason: approvalReply.rejectionReason }, "device_link_sender_user_rejected");
          settle({
            status: "rejected",
            errorCode: "user_rejected",
            errorMessage:
              approvalReply.rejectionReason && approvalReply.rejectionReason.length > 0
                ? approvalReply.rejectionReason
                : "The other device declined the link",
          });
        }
        return;
      }

      cleanup();
      settle({
        status: "rejected",
        errorCode: "approval_unexpected",
        errorMessage: `Receiver sent an unexpected message type: ${String(
          reply.type ?? reply.kind,
        )}`,
      });
    });

    socket.on("close", (code, reason) => {
      if (settled) return;
      cleanup();
      const reasonText = reason?.toString?.() ?? "";
      log?.warn({ code, reason: reasonText }, "device_link_sender_socket_closed_early");
      settle({
        status: "rejected",
        errorCode: "connection_closed",
        errorMessage: reasonText.length > 0 ? reasonText : `WebSocket closed with code ${code}`,
      });
    });

    socket.on("error", (err) => {
      if (settled) return;
      cleanup();
      log?.warn({ err }, "device_link_sender_socket_error");
      settle({
        status: "rejected",
        errorCode: "socket_error",
        errorMessage: err.message,
      });
    });
  });
}

function decodeMessage(raw: unknown): string | null {
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

function humanizeReceiverError(code: string): string {
  switch (code) {
    case "no_offer":
      return "The link has expired or already been used";
    case "decrypt_failed":
      return "The link is invalid or the QR was tampered with";
    case "nonce_mismatch":
      return "The link's identifier didn't match the connection";
    case "bad_schema":
    case "bad_json":
    case "bad_frame":
      return "The new device sent a malformed payload";
    case "too_large":
      return "The redemption payload was too large";
    default:
      return `Receiver rejected the redemption (${code})`;
  }
}

function defaultSocketFactory(url: string): RedeemSocket {
  const ws = new WebSocket(url, {
    handshakeTimeout: 10_000,
    perMessageDeflate: false,
  });

  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    on: (event, listener) => {
      // The runtime listener tuple varies per event; the public type
      // overloads on RedeemSocket already constrain callers, so we
      // forward through `as never` rather than fight the variance.
      ws.on(event, listener as never);
    },
  };
}
