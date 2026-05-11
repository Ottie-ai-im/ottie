import { useQuery } from "@tanstack/react-query";

import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { WechatSetupStatus } from "@server/server/wechat/wechat-rpc-schemas";

export interface UseWechatSetupStateResult {
  status: WechatSetupStatus | "loading";
  detail: string | null;
  daemonPid: number | null;
  /** When false the wizard should render. True only when status === "ready". */
  isReady: boolean;
  isFetching: boolean;
  refetch: () => void;
}

/**
 * Polls `wechat/state` so the Setup Wizard can react to the user
 * completing the Terminal steps without a manual refresh. When ready,
 * the cadence drops to once a minute (just to catch a wx-cli update or
 * a missing-binary regression). Otherwise we poll every 10s so the
 * wizard flips to "Connected" within 10s of the user finishing
 * `sudo wx init`.
 */
export function useWechatSetupState(serverId: string | null): UseWechatSetupStateResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const query = useQuery({
    queryKey: ["wechat-setup-state", serverId] as const,
    enabled: Boolean(serverId && client && isConnected),
    refetchInterval: (q) => {
      const data = q.state.data;
      return data?.status === "ready" ? 60_000 : 10_000;
    },
    staleTime: 5_000,
    queryFn: async () => {
      if (!client) {
        return {
          status: "binary_not_found" as WechatSetupStatus,
          detail: null as string | null,
          daemonPid: null as number | null,
        };
      }
      const res = await client.wechatState();
      return {
        status: (res.status ?? "unknown") as WechatSetupStatus,
        detail: res.detail ?? null,
        daemonPid: res.daemonPid ?? null,
      };
    },
  });

  if (query.data) {
    return {
      status: query.data.status,
      detail: query.data.detail,
      daemonPid: query.data.daemonPid,
      isReady: query.data.status === "ready",
      isFetching: query.isFetching,
      refetch: query.refetch,
    };
  }
  return {
    status: "loading",
    detail: null,
    daemonPid: null,
    isReady: false,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
