// Push-notification payloads for non-agent events: a friend trying to add
// you, or an inbound chat message from a paired friend. Mirrors the
// shape of `agent-attention-notification.ts` so the wire format is
// uniform.
//
// Daemon copy is intentionally English. Notifications run on the daemon
// (no react-i18next there); the OS locale + per-device preference would
// need a separate i18n channel to localize. Matches the pre-existing
// agent-finished / agent-error notifications, which are also English.

const NOTIFICATION_BODY_LIMIT = 220;

export type FriendAttentionReason = "friend_pair_request" | "friend_chat_message";

export interface FriendAttentionNotificationData {
  [key: string]: unknown;
  serverId: string;
  reason: FriendAttentionReason;
  /** Peer's root sign pubkey (always present so the app can deep-link). */
  peerRootPubKeyB64: string;
  /** Friend-pair candidate nonce (only for `friend_pair_request`). */
  pairNonceB64?: string;
  /** Chat message id (only for `friend_chat_message`). */
  messageId?: string;
}

export interface FriendAttentionNotificationPayload {
  title: string;
  body: string;
  data: FriendAttentionNotificationData;
}

export interface BuildFriendPairNotificationInput {
  serverId: string;
  peerDisplayName: string;
  peerRootPubKeyB64: string;
  pairNonceB64: string;
}

export function buildFriendPairNotificationPayload(
  input: BuildFriendPairNotificationInput,
): FriendAttentionNotificationPayload {
  const name = clampName(input.peerDisplayName);
  return {
    title: "Friend request",
    body: `${name} wants to add you as a friend.`,
    data: {
      serverId: input.serverId,
      reason: "friend_pair_request",
      peerRootPubKeyB64: input.peerRootPubKeyB64,
      pairNonceB64: input.pairNonceB64,
    },
  };
}

export interface BuildFriendChatNotificationInput {
  serverId: string;
  peerDisplayName: string;
  peerRootPubKeyB64: string;
  messageBody: string;
  messageId: string;
}

export function buildFriendChatNotificationPayload(
  input: BuildFriendChatNotificationInput,
): FriendAttentionNotificationPayload {
  const name = clampName(input.peerDisplayName);
  const preview = previewBody(input.messageBody);
  return {
    title: name,
    body: preview,
    data: {
      serverId: input.serverId,
      reason: "friend_chat_message",
      peerRootPubKeyB64: input.peerRootPubKeyB64,
      messageId: input.messageId,
    },
  };
}

function clampName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Friend";
  if (trimmed.length <= 64) return trimmed;
  return `${trimmed.slice(0, 61)}...`;
}

function previewBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= NOTIFICATION_BODY_LIMIT) return normalized || "(empty message)";
  return `${normalized.slice(0, NOTIFICATION_BODY_LIMIT - 3).trimEnd()}...`;
}
