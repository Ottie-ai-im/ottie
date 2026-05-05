import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface OpenclawTurn {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  ts: number;
}

interface PendingRequest {
  id: string;
  agentId: string | null;
  startedAt: number;
}

interface ConversationState {
  turns: OpenclawTurn[];
  pending: PendingRequest | null;
  selectedAgentId: string | null;
}

interface OpenclawChatState {
  /** Per-host conversation state, so multiple paired daemons don't bleed. */
  conversations: Record<string, ConversationState>;
  appendTurn: (serverId: string, turn: OpenclawTurn) => void;
  setPending: (serverId: string, pending: PendingRequest | null) => void;
  setSelectedAgent: (serverId: string, agentId: string | null) => void;
  clear: (serverId: string) => void;
}

const EMPTY_CONVERSATION: ConversationState = {
  turns: [],
  pending: null,
  selectedAgentId: null,
};

export const useOpenclawChatStore = create<OpenclawChatState>()(
  persist(
    (set) => ({
      conversations: {},
      appendTurn: (serverId, turn) =>
        set((state) => {
          const existing = state.conversations[serverId] ?? EMPTY_CONVERSATION;
          const turns = [...existing.turns, turn].slice(-200); // keep last 200
          return {
            conversations: {
              ...state.conversations,
              [serverId]: { ...existing, turns },
            },
          };
        }),
      setPending: (serverId, pending) =>
        set((state) => {
          const existing = state.conversations[serverId] ?? EMPTY_CONVERSATION;
          return {
            conversations: {
              ...state.conversations,
              [serverId]: { ...existing, pending },
            },
          };
        }),
      setSelectedAgent: (serverId, agentId) =>
        set((state) => {
          const existing = state.conversations[serverId] ?? EMPTY_CONVERSATION;
          return {
            conversations: {
              ...state.conversations,
              [serverId]: { ...existing, selectedAgentId: agentId },
            },
          };
        }),
      clear: (serverId) =>
        set((state) => {
          const next = { ...state.conversations };
          delete next[serverId];
          return { conversations: next };
        }),
    }),
    {
      name: "openclaw-chat",
      storage: createJSONStorage(() => AsyncStorage),
      // `pending` is in-flight state — don't restore it across app restarts,
      // because the underlying request is gone too. Turns are kept though.
      partialize: (state) => ({
        conversations: Object.fromEntries(
          Object.entries(state.conversations).map(([k, v]) => [
            k,
            { turns: v.turns, pending: null, selectedAgentId: v.selectedAgentId },
          ]),
        ),
      }),
    },
  ),
);

export function selectConversation(state: OpenclawChatState, serverId: string): ConversationState {
  return state.conversations[serverId] ?? EMPTY_CONVERSATION;
}
