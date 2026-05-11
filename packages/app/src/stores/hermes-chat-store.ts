import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface HermesTurn {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  ts: number;
}

interface PendingRequest {
  id: string;
  modelId: string | null;
  startedAt: number;
}

interface ConversationState {
  turns: HermesTurn[];
  pending: PendingRequest | null;
  selectedModelId: string | null;
}

interface HermesChatState {
  conversations: Record<string, ConversationState>;
  appendTurn: (serverId: string, turn: HermesTurn) => void;
  setPending: (serverId: string, pending: PendingRequest | null) => void;
  setSelectedModel: (serverId: string, modelId: string | null) => void;
  clear: (serverId: string) => void;
}

const EMPTY_CONVERSATION: ConversationState = {
  turns: [],
  pending: null,
  selectedModelId: null,
};

export const useHermesChatStore = create<HermesChatState>()(
  persist(
    (set) => ({
      conversations: {},
      appendTurn: (serverId, turn) =>
        set((state) => {
          const existing = state.conversations[serverId] ?? EMPTY_CONVERSATION;
          const turns = [...existing.turns, turn].slice(-200);
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
      setSelectedModel: (serverId, modelId) =>
        set((state) => {
          const existing = state.conversations[serverId] ?? EMPTY_CONVERSATION;
          return {
            conversations: {
              ...state.conversations,
              [serverId]: { ...existing, selectedModelId: modelId },
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
      name: "hermes-chat",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        conversations: Object.fromEntries(
          Object.entries(state.conversations).map(([k, v]) => [
            k,
            { turns: v.turns, pending: null, selectedModelId: v.selectedModelId },
          ]),
        ),
      }),
    },
  ),
);

export function selectHermesConversation(
  state: HermesChatState,
  serverId: string,
): ConversationState {
  return state.conversations[serverId] ?? EMPTY_CONVERSATION;
}
