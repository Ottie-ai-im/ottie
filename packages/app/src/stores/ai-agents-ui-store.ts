// Transient (non-persisted) UI flags for the AI Agent feature.
// Kept separate from `ai-agents-store` so modal-open state never lands
// in AsyncStorage.

import { create } from "zustand";

export interface AiAgentsUiState {
  createModalOpen: boolean;
  editingAgentId: string | null;
}

export interface AiAgentsUiActions {
  openCreateModal: () => void;
  closeCreateModal: () => void;
  openEditModal: (agentId: string) => void;
}

export const useAiAgentsUiStore = create<AiAgentsUiState & AiAgentsUiActions>()((set) => ({
  createModalOpen: false,
  editingAgentId: null,
  openCreateModal: () => set({ createModalOpen: true, editingAgentId: null }),
  closeCreateModal: () => set({ createModalOpen: false, editingAgentId: null }),
  openEditModal: (agentId) => set({ createModalOpen: true, editingAgentId: agentId }),
}));
