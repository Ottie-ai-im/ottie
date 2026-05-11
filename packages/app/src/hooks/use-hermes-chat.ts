import { useQuery } from "@tanstack/react-query";
import type { HermesModel } from "@server/server/hermes/rpc-schemas";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function hermesModelsQueryKey(serverId: string | null) {
  return ["hermesModels", serverId] as const;
}

export interface UseHermesModelsResult {
  models: HermesModel[];
  isLoading: boolean;
  error: string | null;
}

export function useHermesModels(serverId: string | null, enabled: boolean): UseHermesModelsResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const query = useQuery({
    queryKey: hermesModelsQueryKey(serverId),
    enabled: Boolean(enabled && serverId && client && isConnected),
    staleTime: 60_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      return client.listHermesModels();
    },
  });
  return {
    models: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
