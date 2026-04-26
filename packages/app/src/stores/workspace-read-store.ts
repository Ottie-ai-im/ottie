// Tracks the last time the user "read" each workspace (i.e. had it focused
// on screen). Compared against the workspace's `activityAt` to derive an
// unread state — drives the red pill on sidebar project rows.
//
// Persisted via AsyncStorage so unread state survives app relaunch.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface WorkspaceReadStoreState {
  /** Map<`${serverId}:${workspaceId}`, ISO timestamp of last read>. */
  lastReadAtByWorkspaceKey: Record<string, string>;
  markRead: (serverId: string, workspaceId: string, at?: string) => void;
  getLastReadAt: (serverId: string, workspaceId: string) => string | null;
}

function buildKey(serverId: string, workspaceId: string): string {
  return `${serverId.trim()}:${workspaceId.trim()}`;
}

export const useWorkspaceReadStore = create<WorkspaceReadStoreState>()(
  persist(
    (set, get) => ({
      lastReadAtByWorkspaceKey: {},
      markRead: (serverId, workspaceId, at) => {
        const key = buildKey(serverId, workspaceId);
        if (!key || key === ":") return;
        const ts = at ?? new Date().toISOString();
        const current = get().lastReadAtByWorkspaceKey[key];
        if (current && current >= ts) return;
        set((state) => ({
          lastReadAtByWorkspaceKey: {
            ...state.lastReadAtByWorkspaceKey,
            [key]: ts,
          },
        }));
      },
      getLastReadAt: (serverId, workspaceId) => {
        const key = buildKey(serverId, workspaceId);
        return get().lastReadAtByWorkspaceKey[key] ?? null;
      },
    }),
    {
      name: "workspace-last-read-at",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        lastReadAtByWorkspaceKey: state.lastReadAtByWorkspaceKey,
      }),
    },
  ),
);

/** Selects total unread workspace count for a project. */
export function selectProjectUnreadCount(input: {
  serverId: string | null;
  workspaceIds: readonly string[];
  workspaceActivityAt: Record<string, string | null | undefined>;
  lastReadAtByWorkspaceKey: Record<string, string>;
}): number {
  if (!input.serverId) return 0;
  let count = 0;
  for (const id of input.workspaceIds) {
    const activityAt = input.workspaceActivityAt[id] ?? null;
    if (!activityAt) continue;
    const key = buildKey(input.serverId, id);
    const lastRead = input.lastReadAtByWorkspaceKey[key] ?? null;
    if (lastRead === null || activityAt > lastRead) {
      count += 1;
    }
  }
  return count;
}
