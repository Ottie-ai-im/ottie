import { useEffect, useState } from "react";

import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { WechatSession } from "@server/server/wechat/wechat-types";

export interface SidebarWechatSummary {
  sessions: readonly WechatSession[];
  /**
   * `loading` — initial subscribe is in flight; `ready` — we have a snapshot
   * (possibly empty); `unavailable` — daemon returned an error and the
   * sidebar should hide content while the wizard handles setup. Mirrors
   * the chat-room loading pattern but flatter — no per-room state.
   */
  status: "loading" | "ready" | "unavailable";
  error: string | null;
}

const EMPTY_SUMMARY: SidebarWechatSummary = {
  sessions: [],
  status: "loading",
  error: null,
};

/**
 * Subscribe the active session to live `wechat/unread_update` push events
 * and surface the latest snapshot. Daemon-side filter defaults to
 * `["private","group"]` so only real human chats show up — public
 * accounts and the folded inbox stay out of the sidebar by design.
 *
 * The daemon already does the "I replied → drop the chat" work for us:
 * `wx unread` only returns sessions whose unread count is non-zero. The
 * moment the user reads or replies in WeChat, the chat falls out of the
 * snapshot on the next 30s poll and the push event removes it from the
 * sidebar — no client-side reconciliation needed.
 */
export function useSidebarWechatSessions(serverId: string | null): SidebarWechatSummary {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const [summary, setSummary] = useState<SidebarWechatSummary>(EMPTY_SUMMARY);

  useEffect(() => {
    if (!serverId || !client || !isConnected) {
      setSummary(EMPTY_SUMMARY);
      return;
    }

    let cancelled = false;
    setSummary({ sessions: [], status: "loading", error: null });

    const offUpdate = client.on("wechat/unread_update", (msg) => {
      if (cancelled) return;
      setSummary({
        sessions: msg.payload.sessions ?? [],
        status: "ready",
        error: null,
      });
    });

    async function loadInitial(): Promise<void> {
      try {
        const res = await client!.wechatSubscribe();
        if (cancelled) return;
        if (res.error) {
          setSummary({ sessions: [], status: "unavailable", error: res.error });
          return;
        }
        setSummary({
          sessions: res.sessions ?? [],
          status: "ready",
          error: null,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setSummary({ sessions: [], status: "unavailable", error: message });
      }
    }
    void loadInitial();

    return () => {
      cancelled = true;
      offUpdate();
      // Best-effort unsubscribe; if the WS already closed the daemon
      // tears down on disconnect anyway. Promise rejection here is benign.
      void client.wechatUnsubscribe().catch(() => undefined);
    };
  }, [client, isConnected, serverId]);

  return summary;
}
