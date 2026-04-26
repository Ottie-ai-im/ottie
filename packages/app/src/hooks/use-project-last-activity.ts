// Live-derives the latest activityAt across the workspaces of a single
// project, so sidebar rows can show "5m" / "Tue" subtitles like a chat
// list. Reads directly from session store so updates push as workspaces
// refresh — no extra round trips.

import { useSessionStore } from "@/stores/session-store";

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
