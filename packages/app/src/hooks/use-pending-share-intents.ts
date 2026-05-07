import { useQuery } from "@tanstack/react-query";

import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { AiShareIntentOnWire } from "@server/server/identity/identity-rpc-schemas";

/**
 * Phase 4 v3/c §7.5.1 — read pending ai-share intents this daemon
 * has heard about (either originated locally or received from a
 * sibling owner-daemon over peer-sync). Polled at 3s; the bell
 * notification center surfaces these as "pick this device" actions
 * the user can tap to claim the intent on the daemon they're
 * currently looking at.
 */

const POLL_MS = 3_000;

export interface UsePendingShareIntentsResult {
  intents: ReadonlyArray<AiShareIntentOnWire>;
  isLoading: boolean;
  hasError: boolean;
}

export function usePendingShareIntents(serverId: string | null): UsePendingShareIntentsResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const query = useQuery<readonly AiShareIntentOnWire[], Error>({
    queryKey: ["ai-share-pending-intents", serverId],
    queryFn: async () => {
      if (!client) return [];
      const response = await client.chatP2pAiShareListPendingIntents();
      if (response.error) throw new Error(response.error);
      return response.intents ?? [];
    },
    enabled: !!client,
    refetchInterval: POLL_MS,
    staleTime: 0,
  });
  return {
    intents: query.data ?? [],
    isLoading: query.isLoading,
    hasError: !!query.error,
  };
}
