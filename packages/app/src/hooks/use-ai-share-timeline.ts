import { useQuery } from "@tanstack/react-query";

import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { AiShareTimelineRecordOnWire } from "@server/server/identity/identity-rpc-schemas";

/**
 * Phase 4 v2/d — read the redacted timeline records the owner has
 * streamed back for one of our active shares. Polled at 2s; v2/e or
 * later swaps in a push subscription.
 */

const POLL_MS = 2_000;

export interface UseAiShareTimelineResult {
  records: ReadonlyArray<AiShareTimelineRecordOnWire>;
  isLoading: boolean;
  hasError: boolean;
}

export function useAiShareTimeline(
  serverId: string | null,
  inviteId: string | null,
): UseAiShareTimelineResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const query = useQuery<readonly AiShareTimelineRecordOnWire[], Error>({
    queryKey: ["ai-share-timeline", serverId, inviteId],
    queryFn: async () => {
      if (!client || !inviteId) return [];
      const response = await client.chatP2pAiShareListTimeline({ inviteId });
      if (response.error) throw new Error(response.error);
      return response.entries ?? [];
    },
    enabled: !!client && !!inviteId,
    refetchInterval: POLL_MS,
    staleTime: 0,
  });

  return {
    records: query.data ?? [],
    isLoading: query.isLoading,
    hasError: !!query.error,
  };
}
