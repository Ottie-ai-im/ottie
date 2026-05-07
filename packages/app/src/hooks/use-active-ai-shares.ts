import { useQuery } from "@tanstack/react-query";

import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { AiShareActiveOnWire } from "@server/server/identity/identity-rpc-schemas";

/**
 * Phase 4 v2/a — read this daemon's active ai-share sessions
 * (either side — outbound or inbound). Drives the active-share
 * banner in friend chats. Polled at 5s; future v2/d swaps in a
 * push-based subscription so the banner appears the moment the
 * peer accepts.
 */

const POLL_MS = 5_000;

export interface UseActiveAiSharesResult {
  sessions: ReadonlyArray<AiShareActiveOnWire>;
  isLoading: boolean;
  hasError: boolean;
}

/**
 * If `peerRootPubKey` is provided, results are pre-filtered to that
 * peer (the friend chat screen needs only its own peer's shares,
 * not every friend's).
 */
export function useActiveAiShares(
  serverId: string | null,
  peerRootPubKey?: string,
): UseActiveAiSharesResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const query = useQuery<readonly AiShareActiveOnWire[], Error>({
    queryKey: ["ai-share-active", serverId],
    queryFn: async () => {
      if (!client) return [];
      const response = await client.chatP2pAiShareListActive();
      if (response.error) throw new Error(response.error);
      return response.sessions ?? [];
    },
    enabled: !!client,
    refetchInterval: POLL_MS,
    staleTime: 0,
  });

  const all = query.data ?? [];
  const sessions = peerRootPubKey ? all.filter((s) => s.peerRootPubKeyB64 === peerRootPubKey) : all;

  return {
    sessions,
    isLoading: query.isLoading,
    hasError: !!query.error,
  };
}
