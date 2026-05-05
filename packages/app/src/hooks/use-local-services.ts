import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InstallerAvailability,
  LocalServiceStatusPayload,
} from "@server/server/local-services/rpc-schemas";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function localServicesQueryKey(serverId: string | null) {
  return ["localServices", serverId] as const;
}

export interface UseLocalServicesResult {
  services: LocalServiceStatusPayload[];
  installers: InstallerAvailability | undefined;
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
    services: query.data?.services ?? [],
    installers: query.data?.installers,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

export interface UseInstallLocalServiceResult {
  install: (args: { serviceId: "open-webui"; method: "docker" | "pipx" }) => Promise<{
    success: boolean;
    message: string;
    output: string;
    port: number | null;
  }>;
  isInstalling: boolean;
  lastResult: {
    success: boolean;
    message: string;
    output: string;
    port: number | null;
  } | null;
}

export function useInstallLocalService(serverId: string | null): UseInstallLocalServiceResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (args: { serviceId: "open-webui"; method: "docker" | "pipx" }) => {
      if (!client) throw new Error("Host is not connected");
      return client.installLocalService(args);
    },
    onSettled: () => {
      // Refetch services so status flips to running once the container boots.
      // Open WebUI takes ~10-30s to be HTTP-ready after `docker run` returns,
      // so we'll do a delayed second refetch too.
      void queryClient.invalidateQueries({ queryKey: localServicesQueryKey(serverId) });
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: localServicesQueryKey(serverId) });
      }, 15_000);
    },
  });
  return {
    install: mutation.mutateAsync,
    isInstalling: mutation.isPending,
    lastResult: mutation.data ?? null,
  };
}
