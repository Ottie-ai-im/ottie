// Persistent, last-known-good cache of the agent directory for each daemon.
//
// The live source of truth lives in `session-store.sessions[serverId].agents`,
// which is in-memory and only populated after the daemon has connected and
// streamed an agent_directory_snapshot. Until that happens — for example while
// the daemon is restarting, the WebSocket is reconnecting, or the app has just
// been launched — the chat list would otherwise render empty, which the user
// experiences as "my chats just disappeared".
//
// This store mirrors the live agent map to AsyncStorage on every change, and
// session-store seeds the live map from this cache on session init / cache
// rehydration. Daemon-driven updates always overwrite the seed once they
// arrive, so the daemon remains canonical.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Agent } from "./session-store";

// Fields on Agent that are Date objects in memory and must be revived from ISO
// strings after JSON round-trip. Listed explicitly to keep the round-trip
// honest — if a new Date field is added to Agent, add it here too.
const DATE_FIELDS = [
  "createdAt",
  "updatedAt",
  "lastUserMessageAt",
  "lastActivityAt",
  "attentionTimestamp",
  "archivedAt",
] as const satisfies ReadonlyArray<keyof Agent>;

type AgentSnapshot = Record<string, unknown>;

function toSnapshot(agent: Agent): AgentSnapshot {
  const out: Record<string, unknown> = { ...agent };
  for (const field of DATE_FIELDS) {
    const value = out[field];
    if (value instanceof Date) {
      out[field] = value.toISOString();
    }
  }
  return out;
}

function fromSnapshot(snapshot: AgentSnapshot): Agent {
  const out: Record<string, unknown> = { ...snapshot };
  for (const field of DATE_FIELDS) {
    const value = out[field];
    if (typeof value === "string") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        out[field] = date;
      }
    }
  }
  return out as unknown as Agent;
}

interface AgentDirectoryCacheState {
  agentsByServer: Record<string, AgentSnapshot[]>;
  setAgents: (serverId: string, agents: Agent[]) => void;
  getAgents: (serverId: string) => Agent[] | undefined;
  clearAgents: (serverId: string) => void;
}

export const useAgentDirectoryCacheStore = create<AgentDirectoryCacheState>()(
  persist(
    (set, get) => ({
      agentsByServer: {},
      setAgents: (serverId, agents) => {
        const key = serverId.trim();
        if (!key) {
          return;
        }
        set((prev) => ({
          agentsByServer: {
            ...prev.agentsByServer,
            [key]: agents.map(toSnapshot),
          },
        }));
      },
      getAgents: (serverId) => {
        const key = serverId.trim();
        if (!key) {
          return undefined;
        }
        const snapshots = get().agentsByServer[key];
        if (!snapshots) {
          return undefined;
        }
        return snapshots.map(fromSnapshot);
      },
      clearAgents: (serverId) => {
        const key = serverId.trim();
        if (!key) {
          return;
        }
        set((prev) => {
          if (!(key in prev.agentsByServer)) {
            return prev;
          }
          const next = { ...prev.agentsByServer };
          delete next[key];
          return { agentsByServer: next };
        });
      },
    }),
    {
      name: "agent-directory-cache",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ agentsByServer: state.agentsByServer }),
    },
  ),
);
