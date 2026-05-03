import { create } from "zustand";

interface GlobalDragState {
  pendingDroppedProvider: string | null;
  setPendingDroppedProvider: (provider: string | null) => void;
}

export const useGlobalDragStore = create<GlobalDragState>((set) => ({
  pendingDroppedProvider: null,
  setPendingDroppedProvider: (provider) => set({ pendingDroppedProvider: provider }),
}));
