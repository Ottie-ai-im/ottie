import { useQuery } from "@tanstack/react-query";
import type { LocalServiceStatusPayload } from "@server/server/local-services/rpc-schemas";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function localServicesQueryKey(serverId: string | null) {
  return ["localServices", serverId] as const;
}

export interface UseLocalServicesResult {
  services: LocalServiceStatusPayload[];
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLocalServices(serverId: string | null): UseLocalServicesResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const query = useQuery({
    queryKey: localServicesQueryKey(serverId),
    enabled: Boolean(serverId && client && isConnected),
    refetchInterval: 30_000,
    staleTime: 10_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      return client.listLocalServices();
    },
  });
  return {
    services: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
