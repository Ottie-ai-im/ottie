import { z } from "zod";

import { DeviceLinkOfferSchema } from "./device-link-types.js";
import { DeviceSchema } from "./device-types.js";
import { FriendPairOfferSchema } from "./friend-pair-types.js";
import { type StoredRootIdentity } from "./identity-types.js";
import { PeerSchema } from "./peer-types.js";

// Pure-zod schemas (no node:fs / node:crypto imports) so this module — and the
// shared messages.ts that re-exports it — can be bundled by Metro for the
// React Native client. Mirrors the chat-rpc-schemas / chat-cursor-schemas
// split: anything used on the wire stays Metro-friendly.

/**
 * Public-facing identity payload returned to clients. The private signing key
 * is never sent over the wire — only the public key, display name, and
 * timestamps are exposed. Storage version `v` is included so old clients can
 * gate features on schema evolution if it ever happens.
 */
export const PublicRootIdentitySchema = z.object({
  v: z.literal(1),
  rootSignPublicKeyB64: z.string().min(1),
  displayName: z.string().min(1),
  createdAt: z.string(),
});

export type PublicRootIdentity = z.infer<typeof PublicRootIdentitySchema>;

/**
 * Wire shape of `IdentityService.getState()`. Mirrors the daemon-side
 * discriminated union but replaces the in-memory `bundle` with the
 * public-only `PublicRootIdentity` (no private key) and the `Error` instance
 * with a string error message.
 */
export const IdentityStateOnWireSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("uninitialized") }),
  z.object({ kind: z.literal("loaded"), identity: PublicRootIdentitySchema }),
  z.object({ kind: z.literal("load-failed"), error: z.string() }),
]);

export type IdentityStateOnWire = z.infer<typeof IdentityStateOnWireSchema>;

// ----- identity/get -------------------------------------------------------

export const IdentityGetRequestSchema = z.object({
  type: z.literal("identity/get"),
  requestId: z.string(),
});

export const IdentityGetResponseSchema = z.object({
  type: z.literal("identity/get/response"),
  payload: z.object({
    requestId: z.string(),
    state: IdentityStateOnWireSchema.nullable(),
    error: z.string().nullable(),
  }),
});

// ----- identity/initialize ------------------------------------------------

export const IdentityInitializeRequestSchema = z.object({
  type: z.literal("identity/initialize"),
  requestId: z.string(),
  displayName: z.string().min(1).max(64),
});

export const IdentityInitializeResponseSchema = z.object({
  type: z.literal("identity/initialize/response"),
  payload: z.object({
    requestId: z.string(),
    identity: PublicRootIdentitySchema.nullable(),
    error: z.string().nullable(),
  }),
});

/**
 * Convert the on-disk shape (`StoredRootIdentity` — which contains the private
 * key) into the wire shape (`PublicRootIdentity` — public-only fields). The
 * private signing key is intentionally *never* included.
 */
export function toPublicRootIdentity(stored: StoredRootIdentity): PublicRootIdentity {
  return {
    v: stored.v,
    rootSignPublicKeyB64: stored.signPublicKeyB64,
    displayName: stored.displayName,
    createdAt: stored.createdAt,
  };
}

// ----- device/list (Phase 2.b) -------------------------------------------
// Wire shape reuses DeviceSchema directly — the on-disk record is already
// public-only (no private key), so no projection layer is needed.
// device-types.ts is itself pure-zod and Metro-bundleable.

export { DeviceSchema };
export type { StoredDevice as PublicDevice } from "./device-types.js";

export const DevicesListRequestSchema = z.object({
  type: z.literal("device/list"),
  requestId: z.string(),
});

export const DevicesListResponseSchema = z.object({
  type: z.literal("device/list/response"),
  payload: z.object({
    requestId: z.string(),
    devices: z.array(DeviceSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/generate (Phase 2.c) ----------------------------------
// Existing device asks the daemon to create a one-time device-link offer
// the user will display (as a QR or copy-link) for the new device to scan.

export const DeviceLinkGenerateRequestSchema = z.object({
  type: z.literal("device/link/generate"),
  requestId: z.string(),
  /**
   * Optional TTL override in milliseconds. Defaults to 10 minutes server-
   * side. Bounded by the daemon to keep offers short-lived; a UI shouldn't
   * normally pass anything here.
   */
  ttlMs: z.number().int().positive().optional(),
});

export const DeviceLinkGenerateResponseSchema = z.object({
  type: z.literal("device/link/generate/response"),
  payload: z.object({
    requestId: z.string(),
    /** The wire-shape offer; null when the daemon refused to create one. */
    offer: DeviceLinkOfferSchema.nullable(),
    /** Encoded `ottie://device-link#payload=…` deep link for QR / clipboard. */
    deepLink: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/cancel (Phase 2.c) ------------------------------------
// User backs out of "Add device". Drops the pending offer so its nonce
// can't be redeemed even if the QR was photographed.

export const DeviceLinkCancelRequestSchema = z.object({
  type: z.literal("device/link/cancel"),
  requestId: z.string(),
  nonceB64: z.string().min(1),
});

export const DeviceLinkCancelResponseSchema = z.object({
  type: z.literal("device/link/cancel/response"),
  payload: z.object({
    requestId: z.string(),
    cancelled: z.boolean(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/redeem (Phase 2.d) ------------------------------------
// New device's daemon redeems a deep-link / QR offer:
//   - decodes the offer
//   - generates a fresh device keypair + ephemeral X25519 keypair
//   - encrypts a candidate-Device payload with NaCl box
//   - opens a one-shot relay WebSocket to the OLD device
//   - sends the envelope, awaits an ack-or-error reply
// On accepted: caller gets the candidate echo (deviceLabel/role/etc.) and
// continues to the Phase 2.e approval-wait flow on the new device.

export const DeviceLinkRedeemRequestSchema = z.object({
  type: z.literal("device/link/redeem"),
  requestId: z.string(),
  /** Either a full deep-link string or just the base64url payload portion. */
  deepLink: z.string().min(1),
  /** Human-readable label the new device wants to register itself under. */
  deviceLabel: z.string().min(1).max(64),
  /** Whether the new device runs a daemon or is client-only. */
  role: z.enum(["daemon", "client"]),
});

/**
 * Wire-friendly summary of the candidate that was sent. Mirrors the
 * minimum the new device's UI needs to show "Sent → waiting for approval"
 * — the long-lived signing private key is intentionally NOT included on
 * the wire.
 */
export const DeviceLinkRedeemAcceptedSchema = z.object({
  status: z.literal("accepted"),
  /** UUID for the new device, the same one the candidate carried. */
  deviceId: z.string().min(1),
  /** Echo of the deviceLabel from the request, for confirmation UI. */
  deviceLabel: z.string().min(1),
  /** Echo of role. */
  role: z.enum(["daemon", "client"]),
  /** Display name of the OLD device's identity, for the "linking to <name>" UI. */
  remoteDisplayName: z.string().min(1),
  /** Old device's root signing public key — anchor of trust for Phase 2.e. */
  remoteRootSignPublicKeyB64: z.string().min(1),
});

export const DeviceLinkRedeemRejectedSchema = z.object({
  status: z.literal("rejected"),
  /**
   * Coded error: "no_offer" / "decrypt_failed" / "nonce_mismatch" /
   * "bad_schema" / "bad_json" / "bad_frame" / "too_large" / "timeout" /
   * "connection_closed" / "socket_error" / "offer_expired" /
   * "build_failed" / "send_failed" / "unexpected_response".
   */
  errorCode: z.string().min(1),
  errorMessage: z.string(),
});

export const DeviceLinkRedeemOutcomeSchema = z.discriminatedUnion("status", [
  DeviceLinkRedeemAcceptedSchema,
  DeviceLinkRedeemRejectedSchema,
]);

export const DeviceLinkRedeemResponseSchema = z.object({
  type: z.literal("device/link/redeem/response"),
  payload: z.object({
    requestId: z.string(),
    outcome: DeviceLinkRedeemOutcomeSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type DeviceLinkRedeemOutcome = z.infer<typeof DeviceLinkRedeemOutcomeSchema>;

// ----- device/link/candidates (Phase 2.e) --------------------------------
// OLD device's UI lists currently-pending candidates so the user can pick
// one to approve or reject. The wire shape is intentionally MINIMAL — the
// ephPrivateKey + ephPublicKey lives daemon-side only and never leaves.

export const PendingDeviceLinkCandidateOnWireSchema = z.object({
  /** offer.nonceB64; the lookup key for approve/reject. */
  nonceB64: z.string().min(1),
  /** What the new device wants to be called. */
  deviceLabel: z.string().min(1),
  /** daemon | client. */
  role: z.enum(["daemon", "client"]),
  /** ISO timestamp when the new device generated the candidate. */
  generatedAt: z.string(),
  /** ISO timestamp when the daemon received the candidate. */
  receivedAt: z.string(),
  /** Wall-clock ms when this candidate stops being approvable. */
  expiresAtMs: z.number(),
});

export type PendingDeviceLinkCandidateOnWire = z.infer<
  typeof PendingDeviceLinkCandidateOnWireSchema
>;

export const DeviceLinkCandidatesRequestSchema = z.object({
  type: z.literal("device/link/candidates"),
  requestId: z.string(),
});

export const DeviceLinkCandidatesResponseSchema = z.object({
  type: z.literal("device/link/candidates/response"),
  payload: z.object({
    requestId: z.string(),
    candidates: z.array(PendingDeviceLinkCandidateOnWireSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/approve (Phase 2.e) -----------------------------------

export const DeviceLinkApproveRequestSchema = z.object({
  type: z.literal("device/link/approve"),
  requestId: z.string(),
  nonceB64: z.string().min(1),
});

export const DeviceLinkApproveResponseSchema = z.object({
  type: z.literal("device/link/approve/response"),
  payload: z.object({
    requestId: z.string(),
    /** True if the encrypted reply was sent and the new device's record landed in devices.json. */
    approved: z.boolean(),
    /** Resulting devices.json snapshot, after appending the freshly-signed device. */
    devices: z.array(DeviceSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- device/link/reject (Phase 2.e) ------------------------------------

export const DeviceLinkRejectRequestSchema = z.object({
  type: z.literal("device/link/reject"),
  requestId: z.string(),
  nonceB64: z.string().min(1),
  /** Optional reason shown on the new device's screen. */
  reason: z.string().max(200).optional(),
});

export const DeviceLinkRejectResponseSchema = z.object({
  type: z.literal("device/link/reject/response"),
  payload: z.object({
    requestId: z.string(),
    rejected: z.boolean(),
    error: z.string().nullable(),
  }),
});

// ----- friend/pair/generate (Phase 3.a/1) --------------------------------
// Cross-identity analog of device/link/generate. Originating user (Alice)
// asks the daemon to create a one-time friend-pair offer she'll display
// (as a QR or copy-link) for a friend (Bob) to scan in person.

export const FriendPairGenerateRequestSchema = z.object({
  type: z.literal("friend/pair/generate"),
  requestId: z.string(),
  /**
   * Optional TTL override in milliseconds. Defaults to 10 minutes server-
   * side. Bounded by the daemon to keep offers short-lived; a UI shouldn't
   * normally pass anything here.
   */
  ttlMs: z.number().int().positive().optional(),
});

export const FriendPairGenerateResponseSchema = z.object({
  type: z.literal("friend/pair/generate/response"),
  payload: z.object({
    requestId: z.string(),
    /** The wire-shape offer; null when the daemon refused to create one. */
    offer: FriendPairOfferSchema.nullable(),
    /** Encoded `ottie://friend-pair#payload=…` deep link for QR / clipboard. */
    deepLink: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

// ----- friend/pair/cancel (Phase 3.a/1) ----------------------------------
// User backs out of "Add friend". Drops the pending offer so its nonce
// can't be redeemed even if the QR was photographed.

export const FriendPairCancelRequestSchema = z.object({
  type: z.literal("friend/pair/cancel"),
  requestId: z.string(),
  nonceB64: z.string().min(1),
});

export const FriendPairCancelResponseSchema = z.object({
  type: z.literal("friend/pair/cancel/response"),
  payload: z.object({
    requestId: z.string(),
    cancelled: z.boolean(),
    error: z.string().nullable(),
  }),
});

// ----- friend/pair/redeem (Phase 3.a/2) ----------------------------------
// Responder's daemon redeems a deep-link / QR offer:
//   - decodes the offer
//   - generates an ephemeral X25519 keypair
//   - signs the canonical session payload with its root sign private key
//   - encrypts a candidate-Friend payload with NaCl box
//   - opens a one-shot relay WebSocket to the originating daemon
//   - sends the envelope, awaits an ack-or-error reply
// On accepted: caller gets candidate-received, continues to wait for the
// Phase 3.a/3 approval reply on the same socket.

export const FriendPairRedeemRequestSchema = z.object({
  type: z.literal("friend/pair/redeem"),
  requestId: z.string(),
  /** Either a full deep-link string or just the base64url payload portion. */
  deepLink: z.string().min(1),
});

export const FriendPairRedeemPairedSchema = z.object({
  status: z.literal("paired"),
  /** The freshly-paired Peer record, public-only (no secrets). */
  peer: PeerSchema,
});

export const FriendPairRedeemRejectedSchema = z.object({
  status: z.literal("rejected"),
  /**
   * Coded error: see RedeemFriendPairOfferOutcome.errorCode in
   * friend-pair-sender.ts.
   */
  errorCode: z.string().min(1),
  errorMessage: z.string(),
});

export const FriendPairRedeemOutcomeSchema = z.discriminatedUnion("status", [
  FriendPairRedeemPairedSchema,
  FriendPairRedeemRejectedSchema,
]);

export const FriendPairRedeemResponseSchema = z.object({
  type: z.literal("friend/pair/redeem/response"),
  payload: z.object({
    requestId: z.string(),
    outcome: FriendPairRedeemOutcomeSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type FriendPairRedeemOutcome = z.infer<typeof FriendPairRedeemOutcomeSchema>;

// ----- friend/pair/candidates (Phase 3.a/3) ------------------------------
// Originator's UI lists currently-pending friend-pair candidates so the
// user can pick one to approve or reject. Wire shape is intentionally
// MINIMAL — the ephPrivateKey + candidate signature live daemon-side only.

export const PendingFriendPairCandidateOnWireSchema = z.object({
  /** offer.nonceB64; lookup key for approve/reject. */
  nonceB64: z.string().min(1),
  /** What the responder calls themselves. */
  peerDisplayName: z.string().min(1),
  /**
   * Responder's claimed root sign public key. UI shows the first 4 hex
   * chars after the displayName per design doc Q4 ("名字 (a3f9)").
   */
  peerRootSignPublicKeyB64: z.string().min(1),
  /** ISO timestamp when the responder generated the candidate. */
  generatedAt: z.string(),
  /** ISO timestamp when this daemon received the candidate. */
  receivedAt: z.string(),
  /** Wall-clock ms when this candidate stops being approvable. */
  expiresAtMs: z.number(),
});

export type PendingFriendPairCandidateOnWire = z.infer<
  typeof PendingFriendPairCandidateOnWireSchema
>;

export const FriendPairCandidatesRequestSchema = z.object({
  type: z.literal("friend/pair/candidates"),
  requestId: z.string(),
});

export const FriendPairCandidatesResponseSchema = z.object({
  type: z.literal("friend/pair/candidates/response"),
  payload: z.object({
    requestId: z.string(),
    candidates: z.array(PendingFriendPairCandidateOnWireSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- friend/pair/approve (Phase 3.a/3) ---------------------------------

export const FriendPairApproveRequestSchema = z.object({
  type: z.literal("friend/pair/approve"),
  requestId: z.string(),
  nonceB64: z.string().min(1),
});

export const FriendPairApproveResponseSchema = z.object({
  type: z.literal("friend/pair/approve/response"),
  payload: z.object({
    requestId: z.string(),
    /** True if the encrypted reply was sent and the peer landed in peers.json. */
    approved: z.boolean(),
    /** Resulting peers.json snapshot. */
    peers: z.array(PeerSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- friend/pair/reject (Phase 3.a/3) ----------------------------------

export const FriendPairRejectRequestSchema = z.object({
  type: z.literal("friend/pair/reject"),
  requestId: z.string(),
  nonceB64: z.string().min(1),
  /** Optional reason shown on the responder's screen. */
  reason: z.string().max(200).optional(),
});

export const FriendPairRejectResponseSchema = z.object({
  type: z.literal("friend/pair/reject/response"),
  payload: z.object({
    requestId: z.string(),
    rejected: z.boolean(),
    error: z.string().nullable(),
  }),
});

// ----- friend/list (Phase 3.a/3) -----------------------------------------
// Read-only: surface the persisted peer list in the user's UI.

export const FriendListRequestSchema = z.object({
  type: z.literal("friend/list"),
  requestId: z.string(),
});

export const FriendListResponseSchema = z.object({
  type: z.literal("friend/list/response"),
  payload: z.object({
    requestId: z.string(),
    peers: z.array(PeerSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- chat/p2p/send (Phase 3.b/1d) --------------------------------------
// Send a chat message to a paired friend over their live friend-sync
// session. Refuses if the friend isn't online (Phase 3.b/2 adds an
// offline KV inbox).

const StoredFriendChatMessageOnWireSchema = z.object({
  message: z.object({
    id: z.string(),
    roomId: z.string(),
    authorAgentId: z.string(),
    body: z.string(),
    replyToMessageId: z.string().nullable(),
    mentionAgentIds: z.array(z.string()),
    createdAt: z.string(),
    seq: z.number().int().nonnegative().optional(),
    clientMessageId: z.string().optional(),
    authorRootPubKey: z.string().optional(),
    authorDeviceId: z.string().optional(),
    kind: z.string().optional(),
    payload: z.unknown().optional(),
  }),
  authorSignatureB64: z.string(),
  persistedAt: z.string(),
  storedSeq: z.number().int().positive(),
  /**
   * Phase 3.b/2e: how the sending daemon delivered this message. Optional
   * + .catch(undefined) so old daemons (3.b/1d-era) continue parsing
   * cleanly and a future enum value doesn't poison the wire — the UI
   * renders no badge when undefined, matching existing behavior.
   */
  deliveryStatus: z
    .union([z.literal("delivered"), z.literal("queued")])
    .optional()
    .catch(undefined),
});

export type StoredFriendChatMessageOnWire = z.infer<typeof StoredFriendChatMessageOnWireSchema>;

export const ChatP2pSendRequestSchema = z.object({
  type: z.literal("chat/p2p/send"),
  requestId: z.string(),
  /** Recipient's root sign pubkey (must already be paired). */
  peerRootPubKey: z.string().min(1),
  body: z.string().min(1),
  /** Optional client-supplied message id for dedupe / send-status. */
  clientMessageId: z.string().min(1).optional(),
  /** Optional reply-to message id within the same p2p room. */
  replyToMessageId: z.string().min(1).optional(),
});

export const ChatP2pSendResponseSchema = z.object({
  type: z.literal("chat/p2p/send/response"),
  payload: z.object({
    requestId: z.string(),
    /** The freshly-stored message; null on failure. */
    stored: StoredFriendChatMessageOnWireSchema.nullable(),
    error: z.string().nullable(),
  }),
});

// ----- chat/p2p/list (Phase 3.b/1d) --------------------------------------
// Snapshot of all stored chat messages with a peer. Phase 3.b/3 will add
// cursor + subscription so the UI streams updates instead of polling.

export const ChatP2pListRequestSchema = z.object({
  type: z.literal("chat/p2p/list"),
  requestId: z.string(),
  peerRootPubKey: z.string().min(1),
});

export const ChatP2pListResponseSchema = z.object({
  type: z.literal("chat/p2p/list/response"),
  payload: z.object({
    requestId: z.string(),
    messages: z.array(StoredFriendChatMessageOnWireSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- chat/p2p/ai-share (Phase 4 v1) ------------------------------------
// Owner sends an invitation, friend lists pending + accepts/declines.
// All four ride the same WS message family for symmetry with chat/p2p/*.
// Wire shapes mirror the canonical envelopes in `ai-share-types.ts`
// (see docs/MULTI-USER-COLLABORATION-DESIGN.md §11.5).

export const AiShareInviteOnWireSchema = z.object({
  inviteId: z.string().min(1),
  ownerRootPubKeyB64: z.string().min(1),
  ownerDeviceId: z.string().min(1),
  agentId: z.string().min(1),
  agentLabel: z.string().min(1),
  agentProvider: z.string().min(1),
  generatedAt: z.string(),
  expiresAt: z.string(),
  /** Daemon-side state: only populated on owner-side list responses. */
  state: z.enum(["pending", "accepted", "active", "declined", "ended", "expired"]).optional(),
  /** Peer pubkey the invite was sent to (owner-side list responses). */
  peerRootPubKeyB64: z.string().optional(),
});
export type AiShareInviteOnWire = z.infer<typeof AiShareInviteOnWireSchema>;

export const ChatP2pAiShareInviteRequestSchema = z.object({
  type: z.literal("chat/p2p/ai-share/invite"),
  requestId: z.string(),
  peerRootPubKey: z.string().min(1),
  agentId: z.string().min(1),
  agentLabel: z.string().min(1).max(64),
  agentProvider: z.string().min(1).max(32),
});

export const ChatP2pAiShareInviteResponseSchema = z.object({
  type: z.literal("chat/p2p/ai-share/invite/response"),
  payload: z.object({
    requestId: z.string(),
    invite: AiShareInviteOnWireSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatP2pAiShareListInboundRequestSchema = z.object({
  type: z.literal("chat/p2p/ai-share/list-inbound"),
  requestId: z.string(),
});

export const ChatP2pAiShareListInboundResponseSchema = z.object({
  type: z.literal("chat/p2p/ai-share/list-inbound/response"),
  payload: z.object({
    requestId: z.string(),
    invites: z.array(AiShareInviteOnWireSchema).nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatP2pAiShareAcceptRequestSchema = z.object({
  type: z.literal("chat/p2p/ai-share/accept"),
  requestId: z.string(),
  inviteId: z.string().min(1),
});

export const ChatP2pAiShareAcceptResponseSchema = z.object({
  type: z.literal("chat/p2p/ai-share/accept/response"),
  payload: z.object({
    requestId: z.string(),
    accepted: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const ChatP2pAiShareDeclineRequestSchema = z.object({
  type: z.literal("chat/p2p/ai-share/decline"),
  requestId: z.string(),
  inviteId: z.string().min(1),
  reason: z.string().max(200).optional(),
});

export const ChatP2pAiShareDeclineResponseSchema = z.object({
  type: z.literal("chat/p2p/ai-share/decline/response"),
  payload: z.object({
    requestId: z.string(),
    declined: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const ChatP2pAiShareListOutboundRequestSchema = z.object({
  type: z.literal("chat/p2p/ai-share/list-outbound"),
  requestId: z.string(),
});

export const ChatP2pAiShareListOutboundResponseSchema = z.object({
  type: z.literal("chat/p2p/ai-share/list-outbound/response"),
  payload: z.object({
    requestId: z.string(),
    invites: z.array(AiShareInviteOnWireSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// Phase 4 v2/a — end an active session + list active sessions.

export const ChatP2pAiShareEndRequestSchema = z.object({
  type: z.literal("chat/p2p/ai-share/end"),
  requestId: z.string(),
  inviteId: z.string().min(1),
  reason: z.string().max(200).optional(),
});

export const ChatP2pAiShareEndResponseSchema = z.object({
  type: z.literal("chat/p2p/ai-share/end/response"),
  payload: z.object({
    requestId: z.string(),
    ended: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const AiShareActiveOnWireSchema = z.object({
  inviteId: z.string().min(1),
  side: z.enum(["outbound", "inbound"]),
  peerRootPubKeyB64: z.string().min(1),
  agentLabel: z.string().min(1),
  agentProvider: z.string().min(1),
  acceptedAt: z.string(),
});
export type AiShareActiveOnWire = z.infer<typeof AiShareActiveOnWireSchema>;

export const ChatP2pAiShareListActiveRequestSchema = z.object({
  type: z.literal("chat/p2p/ai-share/list-active"),
  requestId: z.string(),
});

export const ChatP2pAiShareListActiveResponseSchema = z.object({
  type: z.literal("chat/p2p/ai-share/list-active/response"),
  payload: z.object({
    requestId: z.string(),
    sessions: z.array(AiShareActiveOnWireSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// Phase 4 v2/b — friend-side: send a prompt over an active share.
// Owner-side: list shareable agents for the invite picker.

export const ChatP2pAiShareSendPromptRequestSchema = z.object({
  type: z.literal("chat/p2p/ai-share/send-prompt"),
  requestId: z.string(),
  inviteId: z.string().min(1),
  body: z.string().min(1).max(16384),
});

export const ChatP2pAiShareSendPromptResponseSchema = z.object({
  type: z.literal("chat/p2p/ai-share/send-prompt/response"),
  payload: z.object({
    requestId: z.string(),
    /** Echoed back so the caller can correlate UI bubbles with the wire prompt. */
    promptId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const ShareableAgentOnWireSchema = z.object({
  agentId: z.string().min(1),
  agentLabel: z.string().min(1),
  agentProvider: z.string().min(1),
  lifecycle: z.enum(["initializing", "idle", "running", "error", "closed"]),
  cwd: z.string(),
});
export type ShareableAgentOnWire = z.infer<typeof ShareableAgentOnWireSchema>;

export const ChatP2pAiShareListShareableAgentsRequestSchema = z.object({
  type: z.literal("chat/p2p/ai-share/list-shareable-agents"),
  requestId: z.string(),
});

export const ChatP2pAiShareListShareableAgentsResponseSchema = z.object({
  type: z.literal("chat/p2p/ai-share/list-shareable-agents/response"),
  payload: z.object({
    requestId: z.string(),
    agents: z.array(ShareableAgentOnWireSchema).nullable(),
    error: z.string().nullable(),
  }),
});

// ----- device/remove (Phase 2.g) -----------------------------------------
// Remove a peer device from THIS user's device list. Refused for self
// (a daemon can't sign its own revocation — use another device).

export const DeviceRemoveRequestSchema = z.object({
  type: z.literal("device/remove"),
  requestId: z.string(),
  deviceId: z.string().min(1),
});

export const DeviceRemoveResponseSchema = z.object({
  type: z.literal("device/remove/response"),
  payload: z.object({
    requestId: z.string(),
    /** True if the local device list lost the entry. */
    removed: z.boolean(),
    /** New device list snapshot, or null on error. */
    devices: z.array(DeviceSchema).nullable(),
    error: z.string().nullable(),
  }),
});
