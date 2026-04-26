// Live-derives the latest activityAt across the workspaces of a single
// project, so sidebar rows can show "5m" / "Tue" subtitles like a chat
// list. Reads directly from session store so updates push as workspaces
// refresh — no extra round trips.

import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceReadStore } from "@/stores/workspace-read-store";

export function useProjectLastActivityAt(
  serverId: string | null,
  workspaceIds: readonly string[],
): string | null {
  return useSessionStore((state) => {
    if (!serverId) return null;
    const session = state.sessions[serverId];
    if (!session) return null;
    let max: string | null = null;
    for (const id of workspaceIds) {
      const w = session.workspaces.get(id);
      const at = w?.activityAt;
      if (!at) continue;
      if (max === null || at > max) max = at;
    }
    return max;
  });
}

export function useWorkspaceActivityAt(
  serverId: string | null,
  workspaceId: string | null,
): string | null {
  return useSessionStore((state) => {
    if (!serverId || !workspaceId) return null;
    return state.sessions[serverId]?.workspaces.get(workspaceId)?.activityAt ?? null;
  });
}

/**
 * Counts how many workspaces in this project have activity newer than the
 * user's last-read timestamp. Reactively recomputes when either store changes.
 */
export function useProjectUnreadCount(
  serverId: string | null,
  workspaceIds: readonly string[],
): number {
  const activitySnapshot = useSessionStore((state) => {
    if (!serverId) return null;
    return state.sessions[serverId]?.workspaces ?? null;
  });
  const lastReadByKey = useWorkspaceReadStore((state) => state.lastReadAtByWorkspaceKey);
  if (!serverId || !activitySnapshot) return 0;
  let count = 0;
  for (const id of workspaceIds) {
    const at = activitySnapshot.get(id)?.activityAt ?? null;
    if (!at) continue;
    const lastRead = lastReadByKey[`${serverId}:${id}`] ?? null;
    if (lastRead === null || at > lastRead) {
      count += 1;
    }
  }
  return count;
}
