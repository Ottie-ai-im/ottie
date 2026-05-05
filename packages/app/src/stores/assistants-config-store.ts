import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const DEFAULT_OPEN_WEBUI_URL = "http://localhost:3000";

interface AssistantsConfigState {
  openWebUiUrl: string;
  setOpenWebUiUrl: (url: string) => void;
  resetOpenWebUiUrl: () => void;
}

export const useAssistantsConfigStore = create<AssistantsConfigState>()(
  persist(
    (set) => ({
      openWebUiUrl: DEFAULT_OPEN_WEBUI_URL,
      setOpenWebUiUrl: (url) => set({ openWebUiUrl: url.trim() || DEFAULT_OPEN_WEBUI_URL }),
      resetOpenWebUiUrl: () => set({ openWebUiUrl: DEFAULT_OPEN_WEBUI_URL }),
    }),
    {
      name: "assistants-config",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export { DEFAULT_OPEN_WEBUI_URL };
