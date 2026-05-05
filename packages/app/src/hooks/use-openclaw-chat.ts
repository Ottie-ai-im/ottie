import { useMutation, useQuery } from "@tanstack/react-query";
import type { OpenclawAgent } from "@server/server/openclaw/rpc-schemas";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function openclawAgentsQueryKey(serverId: string | null) {
  return ["openclawAgents", serverId] as const;
}

export interface UseOpenclawAgentsResult {
  agents: OpenclawAgent[];
  isLoading: boolean;
  error: string | null;
}

export function useOpenclawAgents(
  serverId: string | null,
  enabled: boolean,
): UseOpenclawAgentsResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const query = useQuery({
    queryKey: openclawAgentsQueryKey(serverId),
    enabled: Boolean(enabled && serverId && client && isConnected),
    staleTime: 60_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      return client.listOpenclawAgents();
    },
  });
  return {
    agents: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

export interface UseOpenclawSendResult {
  send: (args: { text: string; agentId?: string | null }) => Promise<{ reply: string }>;
  isPending: boolean;
  lastError: string | null;
}

export function useOpenclawSend(serverId: string | null): UseOpenclawSendResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const mutation = useMutation({
    mutationFn: async (args: { text: string; agentId?: string | null }) => {
      if (!client) throw new Error("Host is not connected");
      return client.sendOpenclawMessage({ text: args.text, agentId: args.agentId ?? null });
    },
  });
  return {
    send: mutation.mutateAsync,
    isPending: mutation.isPending,
    lastError: mutation.error instanceof Error ? mutation.error.message : null,
  };
}
