import { WebSocket } from "ws";
import type { KeyObject } from "node:crypto";
import type pino from "pino";

import { buildRelayWebSocketUrl } from "../../shared/daemon-endpoints.js";

import {
  decryptFriendPairApprovalEnvelope,
  verifyFriendPairApproval,
} from "./friend-pair-approve.js";
import {
  FriendPairApprovalEnvelopeSchema,
  type FriendPairApprovalReply,
} from "./friend-pair-approve-types.js";
import { buildFriendPairRedemption } from "./friend-pair-redeem.js";
import type { FriendCandidate, FriendPairRedemption } from "./friend-pair-redeem-types.js";
import { decodeFriendPairOffer, type FriendPairOffer } from "./friend-pair-types.js";
import type { StoredPeer } from "./peer-types.js";

/**
 * Phase 3.a/2 + 3.a/3 — sender side of the friend-pair handshake. Runs
 * on the responder's daemon (Bob). Cross-identity analog of
 * `device-link-sender.ts`. The flow:
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
 *   4. Bob's daemon sends one JSON frame and awaits a 2-stage reply:
 *      - Stage 1: `{type:"candidate-received"}` ack — Alice's UI now
 *        shows "Bob wants to pair with you. Approve / Reject?"
 *      - Stage 2: `FriendPairApprovalEnvelope` — encrypted under the
 *        same shared key. Decrypted into a `FriendPairApprovalReply`
 *        with status="approved" or status="rejected".
 *
 *   On approved: caller gets the resolved `Peer` record describing
 *   Alice (signed by her root over the canonical authorization payload),
 *   ready to upsert into the local peers.json.
 *
 *   On rejected (by user): status="rejected" with errorCode="user_rejected"
 *   and an optional human-readable rejectionReason.
 *
 *   Any error short-circuits: receiver-side errors during stage 1
 *   (`no_offer`, `decrypt_failed`, `nonce_mismatch`, `bad_schema`, …),
 *   or local-sender errors at any point (`offer_expired`, `send_failed`,
 *   `timeout`, `connection_closed`, `socket_error`,
 *   `approval_decrypt_failed`, `approval_schema_invalid`,
 *   `approval_signature_invalid`).
 *
 * Pure, no I/O outside the WebSocket itself. The socket is created
 * through a factory parameter so tests can drive the handshake
 * without a real relay.
 */

const REDEEM_TIMEOUT_MS = 5 * 60_000;

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
       * Alice's daemon approved the pairing. Bob's caller now has a
       * complete `Peer` record (signed by Alice's root over the
       * canonical authorization payload) ready to persist into his
       * own peers.json. The candidate echo + offer are returned for
       * caller logging / UI ("paired with <displayName>").
       */
      readonly status: "paired";
      readonly candidate: FriendCandidate;
      readonly offer: FriendPairOffer;
      readonly peer: StoredPeer;
    }
  | {
      readonly status: "rejected";
      /**
       * Coded reason. Receiver-side codes
       * (`no_offer`, `decrypt_failed`, `nonce_mismatch`, `bad_schema`,
       * `bad_json`, `bad_frame`, `too_large`, `bad_signature`,
       * `self_pairing`), local-sender codes (`offer_expired`,
       * `build_failed`, `send_failed`, `timeout`, `connection_closed`,
       * `socket_error`, `bad_response_frame`, `bad_response_json`,
       * `unexpected_response`), approval-stage codes
       * (`approval_decrypt_failed`, `approval_schema_invalid`,
       * `approval_signature_invalid`), or `user_rejected`.
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
    let ackReceived = false;

    const settle = (outcome: RedeemFriendPairOfferOutcome): void => {
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
      log?.warn({ timeoutMs }, "friend_pair_sender_timeout");
      settle({
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
        settle({
          status: "rejected",
          errorCode: "send_failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Two-stage protocol from the receiver:
    //   Stage 1: {type:"candidate-received"} ack — flips ackReceived = true,
    //            we keep listening on the same socket.
    //   Stage 2: FriendPairApprovalEnvelope (kind:"friend-pair-approval-
    //            envelope") — decrypted into the final approved/rejected reply.
    //   At either stage, an {type:"error", code:"..."} frame short-circuits
    //   the flow with a rejected outcome.
    socket.on("message", (raw) => {
      const parseOutcome = parseIncomingFrame(raw);
      if (parseOutcome.kind === "error") {
        cleanup();
        settle(parseOutcome.outcome);
        return;
      }
      const reply = parseOutcome.reply;

      if (!ackReceived && reply.type === "candidate-received") {
        ackReceived = true;
        log?.info("friend_pair_sender_ack_received");
        return;
      }

      if (reply.type === "error") {
        cleanup();
        const code = typeof reply.code === "string" ? reply.code : "unknown";
        log?.warn({ code }, "friend_pair_sender_rejected_by_receiver");
        settle({
          status: "rejected",
          errorCode: code,
          errorMessage: humanizeReceiverError(code),
        });
        return;
      }

      if (reply.kind === "friend-pair-approval-envelope") {
        cleanup();
        settle(
          handleApprovalEnvelope({
            parsed: parseOutcome.parsed,
            built,
            log,
          }),
        );
        return;
      }

      cleanup();
      settle({
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
      settle({
        status: "rejected",
        errorCode: "connection_closed",
        errorMessage: reasonText.length > 0 ? reasonText : `WebSocket closed with code ${code}`,
      });
    });

    socket.on("error", (err) => {
      if (settled) return;
      cleanup();
      log?.warn({ err }, "friend_pair_sender_socket_error");
      settle({
        status: "rejected",
        errorCode: "socket_error",
        errorMessage: err.message,
      });
    });
  });
}

interface ParsedReply {
  type?: unknown;
  code?: unknown;
  kind?: unknown;
}

type ParseFrameOutcome =
  | { kind: "ok"; parsed: unknown; reply: ParsedReply }
  | { kind: "error"; outcome: RedeemFriendPairOfferOutcome };

function parseIncomingFrame(raw: unknown): ParseFrameOutcome {
  const text = decodeMessage(raw);
  if (text === null) {
    return {
      kind: "error",
      outcome: {
        status: "rejected",
        errorCode: "bad_response_frame",
        errorMessage: "Receiver sent a non-text response frame",
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      kind: "error",
      outcome: {
        status: "rejected",
        errorCode: "bad_response_json",
        errorMessage: "Receiver sent malformed JSON",
      },
    };
  }
  return { kind: "ok", parsed, reply: parsed as ParsedReply };
}

interface BuiltRedemptionLike {
  candidate: FriendCandidate;
  offer: FriendPairOffer;
  localSecrets: { ephPrivateKeyB64: string };
}

function handleApprovalEnvelope(args: {
  parsed: unknown;
  built: BuiltRedemptionLike;
  log: pino.Logger | undefined;
}): RedeemFriendPairOfferOutcome {
  const { parsed, built, log } = args;
  const validated = FriendPairApprovalEnvelopeSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      status: "rejected",
      errorCode: "approval_schema_invalid",
      errorMessage: "Approval envelope failed schema validation",
    };
  }

  let approvalReply: FriendPairApprovalReply;
  try {
    approvalReply = decryptFriendPairApprovalEnvelope({
      envelope: validated.data,
      candidateEphPrivateKeyB64: built.localSecrets.ephPrivateKeyB64,
      offerEphPublicKeyB64: built.offer.ephPublicKeyB64,
    });
  } catch (err) {
    log?.warn({ err }, "friend_pair_sender_approval_decrypt_failed");
    return {
      status: "rejected",
      errorCode: "approval_decrypt_failed",
      errorMessage: err instanceof Error ? err.message : "Failed to decrypt approval envelope",
    };
  }

  if (approvalReply.status !== "approved") {
    log?.info({ reason: approvalReply.rejectionReason }, "friend_pair_sender_user_rejected");
    return {
      status: "rejected",
      errorCode: "user_rejected",
      errorMessage:
        approvalReply.rejectionReason && approvalReply.rejectionReason.length > 0
          ? approvalReply.rejectionReason
          : "The other side declined the pair",
    };
  }

  // Verify Alice's signature against the offer Bob originally scanned.
  // A failure here means either a serious bug or an active attacker
  // somewhere — the relay can't see plaintext, but verifying defensively
  // costs nothing.
  const sigOutcome = verifyFriendPairApproval({
    reply: approvalReply,
    expectedOriginatorRootSignPublicKeyB64: built.offer.rootSignPublicKeyB64,
    responderRootSignPublicKeyB64: built.candidate.rootSignPublicKeyB64,
    pairingNonceB64: built.offer.nonceB64,
  });
  if (!sigOutcome.ok) {
    log?.warn({ reason: sigOutcome.reason }, "friend_pair_sender_approval_sig_invalid");
    return {
      status: "rejected",
      errorCode: "approval_signature_invalid",
      errorMessage: sigOutcome.reason,
    };
  }

  const peer: StoredPeer = {
    v: 1,
    peerRootSignPublicKeyB64: approvalReply.originatorRootSignPublicKeyB64,
    peerDisplayName: approvalReply.originatorDisplayName,
    pairedAt: approvalReply.approvedAt,
    status: "active",
    pairingNonceB64: built.offer.nonceB64,
    authorizationSignatureB64: approvalReply.authorizationSignatureB64,
  };
  log?.info(
    {
      peerDisplayName: peer.peerDisplayName,
      peerRootPubKeyPrefix: peer.peerRootSignPublicKeyB64.slice(0, 8),
    },
    "friend_pair_sender_paired",
  );
  return {
    status: "paired",
    candidate: built.candidate,
    offer: built.offer,
    peer,
  };
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
