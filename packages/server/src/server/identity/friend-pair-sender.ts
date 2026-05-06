import { WebSocket } from "ws";
import type { KeyObject } from "node:crypto";
import type pino from "pino";

import { buildRelayWebSocketUrl } from "../../shared/daemon-endpoints.js";

import { buildFriendPairRedemption } from "./friend-pair-redeem.js";
import type { FriendCandidate, FriendPairRedemption } from "./friend-pair-redeem-types.js";
import { decodeFriendPairOffer, type FriendPairOffer } from "./friend-pair-types.js";

/**
 * Phase 3.a/2 — sender side of the friend-pair handshake. Runs on the
 * responder's daemon (Bob). Cross-identity analog of `device-link-
 * sender.ts`. The flow:
 *
 *   1. User pastes the deep-link string (or scans the QR — same thing).
 *   2. Bob's daemon decodes the offer, generates a fresh ephemeral
 *      X25519 keypair, signs the canonical session payload with Bob's
 *      root sign private key, and builds a `FriendPairRedemption`
 *      envelope (see `friend-pair-redeem.ts`).
 *   3. Bob's daemon opens a relay WebSocket to Alice's daemon with
 *      `connectionId="friend-pair:<nonceB64>"` so Alice's
 *      `connectionHandlers` dispatcher routes it to the friend-pair
 *      receiver.
 *   4. Bob's daemon sends one JSON frame and awaits an ack-or-error.
 *   5. On `{type:"candidate-received"}`: success — caller now waits
 *      for Phase 3.a/3's approval reply on the SAME socket.
 *   6. On `{type:"error", code:"..."}`: caller surfaces the error
 *      string to the UI ("offer expired", "self-pairing", "decrypt
 *      failed", "no offer", "bad signature", …).
 *
 * Phase 3.a/2 settles after the ack — the approval-reply path is
 * built in Phase 3.a/3. Until then the socket stays open per the
 * receiver-side contract (Alice's UI must show "Pending friend
 * request" and let her tap Approve/Reject).
 *
 * Pure, no I/O outside the WebSocket itself. The socket is created
 * through a factory parameter so tests can drive the handshake
 * without a real relay.
 */

const REDEEM_TIMEOUT_MS = 5 * 60_000; // 5 minutes — Phase 3.a/3 waits for user-tap approval

export interface FriendPairRedeemSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export type FriendPairRedeemSocketFactory = (url: string) => FriendPairRedeemSocket;

export type RedeemFriendPairOfferOutcome =
  | {
      /**
       * Alice's daemon parked the candidate. The user-tap approval is
       * Phase 3.a/3 — Phase 3.a/2 stops here. The socket is still open
       * on both sides (mirroring device-link's two-stage protocol);
       * callers may keep the returned `pendingApprovalSocket` reference
       * to read the approval envelope when 3.a/3 lands.
       */
      readonly status: "candidate-received";
      readonly candidate: FriendCandidate;
      readonly offer: FriendPairOffer;
      readonly redemption: FriendPairRedemption;
      readonly localEphPrivateKeyB64: string;
      readonly pendingApprovalSocket: FriendPairRedeemSocket;
    }
  | {
      readonly status: "rejected";
      /**
       * Coded reason. Receiver-side codes
       * (`no_offer`, `decrypt_failed`, `nonce_mismatch`, `bad_schema`,
       * `bad_json`, `bad_frame`, `too_large`, `bad_signature`,
       * `self_pairing`), or local-sender codes (`offer_expired`,
       * `build_failed`, `send_failed`, `timeout`, `connection_closed`,
       * `socket_error`, `bad_response_frame`, `bad_response_json`,
       * `unexpected_response`).
       */
      readonly errorCode: string;
      readonly errorMessage: string;
    };

export interface RedeemFriendPairOfferInput {
  /** Either the wire offer (already decoded) or a deep-link string to decode. */
  deepLinkOrOffer: string | FriendPairOffer;
  /** Bob's root sign public key — goes into the candidate. */
  selfRootSignPublicKeyB64: string;
  /** Bob's root sign private key — used to sign the candidate; never sent. */
  selfRootSignPrivateKey: KeyObject;
  /** Bob's display name, shown to Alice in her approve dialog. */
  selfDisplayName: string;
  /** Override clock (tests). */
  nowMs?: number;
  /** Override timeout in ms. Defaults to 5 minutes. */
  timeoutMs?: number;
  /**
   * Override the WebSocket factory (tests). Default uses the `ws`
   * package with the same handshake-timeout / no-deflate settings as
   * relay-transport.ts.
   */
  createSocket?: FriendPairRedeemSocketFactory;
  /** Optional logger; falls back to no-op. */
  logger?: pino.Logger;
}

export async function redeemFriendPairOffer(
  input: RedeemFriendPairOfferInput,
): Promise<RedeemFriendPairOfferOutcome> {
  const log = input.logger?.child({ module: "friend-pair-sender" });
  const offer =
    typeof input.deepLinkOrOffer === "string"
      ? decodeFriendPairOffer(input.deepLinkOrOffer)
      : input.deepLinkOrOffer;

  let built;
  try {
    built = buildFriendPairRedemption({
      offer,
      selfRootSignPublicKeyB64: input.selfRootSignPublicKeyB64,
      selfRootSignPrivateKey: input.selfRootSignPrivateKey,
      selfDisplayName: input.selfDisplayName,
      ...(input.nowMs !== undefined ? { nowMs: input.nowMs } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.warn({ err }, "friend_pair_sender_build_failed");
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
    connectionId: `friend-pair:${built.offer.nonceB64}`,
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
    "friend_pair_sender_connecting",
  );

  return new Promise<RedeemFriendPairOfferOutcome>((resolve) => {
    const socket = factory(url);
    let settled = false;

    const settleAndClose = (outcome: RedeemFriendPairOfferOutcome): void => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve(outcome);
    };

    const settleKeepingSocketOpen = (outcome: RedeemFriendPairOfferOutcome): void => {
      if (settled) return;
      settled = true;
      // Don't close — Phase 3.a/3 reads the approval envelope on this
      // same socket.
      resolve(outcome);
    };

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      log?.warn({ timeoutMs }, "friend_pair_sender_timeout");
      settleAndClose({
        status: "rejected",
        errorCode: "timeout",
        errorMessage: `Friend-pair redemption timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    (timeoutHandle as unknown as { unref?: () => void }).unref?.();

    const cleanup = () => {
      clearTimeout(timeoutHandle);
    };

    socket.on("open", () => {
      try {
        socket.send(JSON.stringify(built.redemption satisfies FriendPairRedemption));
        log?.info("friend_pair_sender_redemption_sent");
      } catch (err) {
        cleanup();
        log?.warn({ err }, "friend_pair_sender_send_failed");
        settleAndClose({
          status: "rejected",
          errorCode: "send_failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.on("message", (raw) => {
      const text = decodeMessage(raw);
      if (text === null) {
        cleanup();
        settleAndClose({
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
        settleAndClose({
          status: "rejected",
          errorCode: "bad_response_json",
          errorMessage: "Receiver sent malformed JSON",
        });
        return;
      }

      const reply = parsed as { type?: unknown; code?: unknown; kind?: unknown };

      if (reply.type === "candidate-received") {
        cleanup();
        log?.info("friend_pair_sender_ack_received");
        // Settle WITHOUT closing — the socket continues to receive the
        // approval envelope when Phase 3.a/3 lands. Caller is expected
        // to either wire up its own approval-envelope listener, or just
        // close it themselves if they're a one-shot test.
        settleKeepingSocketOpen({
          status: "candidate-received",
          candidate: built.candidate,
          offer: built.offer,
          redemption: built.redemption,
          localEphPrivateKeyB64: built.localSecrets.ephPrivateKeyB64,
          pendingApprovalSocket: socket,
        });
        return;
      }

      if (reply.type === "error") {
        cleanup();
        const code = typeof reply.code === "string" ? reply.code : "unknown";
        log?.warn({ code }, "friend_pair_sender_rejected_by_receiver");
        settleAndClose({
          status: "rejected",
          errorCode: code,
          errorMessage: humanizeReceiverError(code),
        });
        return;
      }

      cleanup();
      settleAndClose({
        status: "rejected",
        errorCode: "unexpected_response",
        errorMessage: `Receiver sent an unexpected message type: ${String(
          reply.type ?? reply.kind,
        )}`,
      });
    });

    socket.on("close", (code, reason) => {
      if (settled) return;
      cleanup();
      const reasonText = reason?.toString?.() ?? "";
      log?.warn({ code, reason: reasonText }, "friend_pair_sender_socket_closed_early");
      settleAndClose({
        status: "rejected",
        errorCode: "connection_closed",
        errorMessage: reasonText.length > 0 ? reasonText : `WebSocket closed with code ${code}`,
      });
    });

    socket.on("error", (err) => {
      if (settled) return;
      cleanup();
      log?.warn({ err }, "friend_pair_sender_socket_error");
      settleAndClose({
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
      return "The friend-pair link has expired or already been used";
    case "decrypt_failed":
      return "The link is invalid or the QR was tampered with";
    case "bad_signature":
      return "The pairing payload's signature did not verify";
    case "self_pairing":
      return "Cannot pair with your own identity — use 'Add device' instead";
    case "nonce_mismatch":
      return "The link's identifier didn't match the connection";
    case "bad_schema":
    case "bad_json":
    case "bad_frame":
      return "The responder sent a malformed payload";
    case "too_large":
      return "The redemption payload was too large";
    default:
      return `Receiver rejected the redemption (${code})`;
  }
}

function defaultSocketFactory(url: string): FriendPairRedeemSocket {
  const ws = new WebSocket(url, {
    handshakeTimeout: 10_000,
    perMessageDeflate: false,
  });

  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    on: (event, listener) => {
      ws.on(event, listener as never);
    },
  };
}
