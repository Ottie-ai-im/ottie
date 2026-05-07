import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type {
  AiShareIntentOnWire,
  AiShareInviteOnWire,
  PendingFriendPairCandidateOnWire,
} from "@server/server/identity/identity-rpc-schemas";

/**
 * Phase 3.b/3 (notification center) — aggregates inbox-of-actions
 * across the user's notification surfaces. Today the only source is
 * pending friend-pair candidates (Phase 3.a/3 — peers waiting for the
 * user to approve). Future sources to fold in here without rewriting
 * callers:
 *
 *   - Phase 3.b/2 inbox-arrival hints (when a queued message lands
 *     while the chat screen isn't open).
 *   - Phase 4 AI-share invitations ("Bob wants to share Wendell's
 *     Claude Code with you — Accept?"). Will need a separate WS RPC
 *     to query; merge into `items` here.
 *
 * Currently single-host. Multi-host roll-up (across every server in
 * the user's host registry) is a follow-up — easy enough to layer in
 * once a UX decision is made about how to render the host context on
 * each row.
 */

/** Discriminated-union per source so future kinds are additive. */
export type NotificationItem =
  | {
      id: string;
      kind: "friend-pair-candidate";
      receivedAt: string;
      payload: { candidate: PendingFriendPairCandidateOnWire };
    }
  | {
      id: string;
      kind: "ai-share-invite";
      receivedAt: string;
      payload: { invite: AiShareInviteOnWire };
    }
  | {
      id: string;
      kind: "ai-share-pending-intent";
      receivedAt: string;
      payload: { intent: AiShareIntentOnWire };
    };

const PENDING_POLL_MS = 5_000;

export interface UseNotificationsResult {
  items: ReadonlyArray<NotificationItem>;
  /** Total unread count — drives the bell's red-dot indicator. */
  count: number;
  /** True while the first fetch is in flight; UI shows nothing rather than a spinner. */
  isLoading: boolean;
  /** True if any of the underlying queries failed. UI logs but doesn't surface. */
  hasError: boolean;
}

export function useNotifications(serverId: string | null): UseNotificationsResult {
  const client = useHostRuntimeClient(serverId ?? "");

  const candidatesQuery = useQuery<readonly PendingFriendPairCandidateOnWire[], Error>({
    queryKey: ["notifications-friend-pair-candidates", serverId],
    queryFn: async () => {
      if (!client) return [];
      const response = await client.friendPairCandidates();
      if (response.error) throw new Error(response.error);
      return response.candidates ?? [];
    },
    enabled: !!client,
    refetchInterval: PENDING_POLL_MS,
    // Stale immediately so the list updates as soon as a new candidate
    // lands. The 5s poll dominates anyway.
    staleTime: 0,
  });

  const aiShareInvitesQuery = useQuery<readonly AiShareInviteOnWire[], Error>({
    queryKey: ["notifications-ai-share-invites-inbound", serverId],
    queryFn: async () => {
      if (!client) return [];
      const response = await client.chatP2pAiShareListInbound();
      if (response.error) throw new Error(response.error);
      return response.invites ?? [];
    },
    enabled: !!client,
    refetchInterval: PENDING_POLL_MS,
    staleTime: 0,
  });

  // Phase 4 v3/c §7.5.1 — pending share-intents broadcast from sibling
  // owner-daemons. Each row offers "use this device" to claim.
  const aiShareIntentsQuery = useQuery<readonly AiShareIntentOnWire[], Error>({
    queryKey: ["notifications-ai-share-pending-intents", serverId],
    queryFn: async () => {
      if (!client) return [];
      const response = await client.chatP2pAiShareListPendingIntents();
      if (response.error) throw new Error(response.error);
      return response.intents ?? [];
    },
    enabled: !!client,
    refetchInterval: PENDING_POLL_MS,
    staleTime: 0,
  });

  const items = useMemo<ReadonlyArray<NotificationItem>>(() => {
    const out: NotificationItem[] = [];
    for (const candidate of candidatesQuery.data ?? []) {
      out.push({
        id: `friend-pair:${candidate.nonceB64}`,
        kind: "friend-pair-candidate",
        receivedAt: candidate.receivedAt,
        payload: { candidate },
      });
    }
    for (const invite of aiShareInvitesQuery.data ?? []) {
      out.push({
        id: `ai-share-invite:${invite.inviteId}`,
        kind: "ai-share-invite",
        // The wire shape's `generatedAt` doubles as the receive timestamp
        // for ordering purposes — daemon sets it when the inbound
        // record is created (see session.handleChatP2pAiShareListInbound).
        receivedAt: invite.generatedAt,
        payload: { invite },
      });
    }
    for (const intent of aiShareIntentsQuery.data ?? []) {
      out.push({
        id: `ai-share-intent:${intent.intentId}`,
        kind: "ai-share-pending-intent",
        receivedAt: intent.generatedAt,
        payload: { intent },
      });
    }
    // Newest first.
    out.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return out;
  }, [candidatesQuery.data, aiShareInvitesQuery.data, aiShareIntentsQuery.data]);

  return {
    items,
    count: items.length,
    isLoading:
      candidatesQuery.isLoading || aiShareInvitesQuery.isLoading || aiShareIntentsQuery.isLoading,
    hasError: !!candidatesQuery.error || !!aiShareInvitesQuery.error || !!aiShareIntentsQuery.error,
  };
}
