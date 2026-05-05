import { useQuery } from "@tanstack/react-query";
import type { UsageSummary } from "@server/server/usage/rpc-schemas";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function usageSummaryQueryKey(serverId: string | null) {
  return ["usageSummary", serverId] as const;
}

export interface UseUsageSummaryResult {
  data: UsageSummary | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUsageSummary(serverId: string | null): UseUsageSummaryResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const query = useQuery({
    queryKey: usageSummaryQueryKey(serverId),
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 30_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      return client.getUsage();
    },
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
