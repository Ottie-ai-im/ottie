import { useQuery } from "@tanstack/react-query";

import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { WechatMessage } from "@server/server/wechat/wechat-types";

const DEFAULT_LIMIT = 20;
const REFETCH_INTERVAL_MS = 30_000;

export interface UseWechatHistoryResult {
  messages: readonly WechatMessage[];
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Read the most recent N messages of a WeChat chat. Refreshes on the same
 * 30s cadence as the sidebar unread poll so a freshly arrived message
 * shows up in the detail page without a manual reload. Caches by
 * (serverId, chatId, limit); switching chats is cheap because each chat
 * has its own query.
 */
export function useWechatHistory(
  serverId: string | null,
  chatId: string | null,
  limit: number = DEFAULT_LIMIT,
): UseWechatHistoryResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const query = useQuery({
    queryKey: ["wechat-history", serverId, chatId, limit] as const,
    enabled: Boolean(serverId && chatId && client && isConnected),
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: 10_000,
    queryFn: async () => {
      if (!client || !chatId) return [] as readonly WechatMessage[];
      const res = await client.wechatReadHistory({ chat: chatId, limit });
      if (res.error) throw new Error(res.error);
      return res.messages ?? [];
    },
  });
  return {
    messages: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
