import { PRESENCE_THRESHOLD_MS, type ClientPresenceState } from "./agent-attention-policy.js";

// Policy for friend-related events (friend-pair candidate / inbound friend
// chat). Mirrors `agent-attention-policy` minus the per-agent focus check
// — friend events don't have an `agentId` to compare against. v1 rule:
//
//   1. Pick the most-recently-active client to receive the in-app banner.
//   2. Push iff no client was active within PRESENCE_THRESHOLD_MS — same
//      "user is away from the app" gate as agents use.
//
// v2 (out of scope for this slice) could refine `friend_chat_message` to
// suppress push when the user is actively viewing the corresponding
// peer's chat. That requires extending `ClientPresenceState` with
// `focusedPeerRootPubKeyB64`, which doesn't exist today.

export interface FriendNotificationPlan {
  inAppRecipientIndex: number | null;
  shouldPush: boolean;
}

interface ComputeFriendNotificationPlanInput {
  allStates: ClientPresenceState[];
  nowMs: number;
}

export function computeFriendNotificationPlan({
  allStates,
  nowMs,
}: ComputeFriendNotificationPlanInput): FriendNotificationPlan {
  let mostRecentPresentIndex: number | null = null;
  let mostRecentPresentAtMs = Number.NEGATIVE_INFINITY;

  for (const [clientIndex, state] of allStates.entries()) {
    const clampedActivityAtMs =
      state.lastActivityAtMs === null ? null : Math.min(state.lastActivityAtMs, nowMs);
    const isPresent =
      clampedActivityAtMs !== null && nowMs - clampedActivityAtMs <= PRESENCE_THRESHOLD_MS;
    if (!isPresent) continue;
    if (clampedActivityAtMs > mostRecentPresentAtMs) {
      mostRecentPresentIndex = clientIndex;
      mostRecentPresentAtMs = clampedActivityAtMs;
    }
  }

  if (mostRecentPresentIndex !== null) {
    return { inAppRecipientIndex: mostRecentPresentIndex, shouldPush: false };
  }
  return { inAppRecipientIndex: null, shouldPush: true };
}
