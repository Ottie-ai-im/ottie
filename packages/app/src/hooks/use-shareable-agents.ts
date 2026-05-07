import { useQuery } from "@tanstack/react-query";

import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { ShareableAgentOnWire } from "@server/server/identity/identity-rpc-schemas";

/**
 * Phase 4 v2/b — fetch the local agent list for the friend-share
 * invite picker. Replaces v1's hardcoded placeholder. Refetched on
 * mount + on every modal open (no polling — the list is small and
 * staleness while the modal is open is acceptable; v3's two-step
 * picker will reuse this hook).
 */

export interface UseShareableAgentsResult {
  agents: ReadonlyArray<ShareableAgentOnWire>;
  isLoading: boolean;
  hasError: boolean;
  refetch: () => void;
}

export function useShareableAgents(serverId: string | null): UseShareableAgentsResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const query = useQuery<readonly ShareableAgentOnWire[], Error>({
    queryKey: ["ai-share-shareable-agents", serverId],
    queryFn: async () => {
      if (!client) return [];
      const response = await client.chatP2pAiShareListShareableAgents();
      if (response.error) throw new Error(response.error);
      return response.agents ?? [];
    },
    enabled: !!client,
    staleTime: 0,
  });

  return {
    agents: query.data ?? [],
    isLoading: query.isLoading,
    hasError: !!query.error,
    refetch: () => void query.refetch(),
  };
}
