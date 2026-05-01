// Persisted onboarding flags. One AsyncStorage record under
// `@ottie:onboarding-state` tracks whether the Welcome screen has been shown
// (so cold-open routes straight to Chats on subsequent launches per D-21),
// whether the three Otter delight beats have fired (so each one fires at
// most once per install per D-17), and whether the first-time empty Otter
// has been played for the Workspace and Chats lists.
//
// Schema: see PATTERNS lines 568-621. Persistence pattern follows
// `draft-store.ts` (zustand `persist` middleware + AsyncStorage).
//
// Per RESEARCH.md, MMKV migration is deferred — stay on AsyncStorage for
// this milestone.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const ONBOARDING_STATE_STORAGE_KEY = "@ottie:onboarding-state";
const ONBOARDING_STORE_VERSION = 1;

export interface OnboardingState {
  welcomeShown: boolean;
  welcomeShownAt: number | null;
  delightFiredFirstAgent: boolean;
  delightFiredFirstPermission: boolean;
  delightFiredFirstVoice: boolean;
  emptyOttiePlayedFirstWorkspace: boolean;
  emptyOttiePlayedFirstChats: boolean;
}

export interface OnboardingActions {
  setWelcomeShown: (value: boolean) => void;
  setDelightFiredFirstAgent: (value: boolean) => void;
  setDelightFiredFirstPermission: (value: boolean) => void;
  setDelightFiredFirstVoice: (value: boolean) => void;
  setEmptyOttiePlayedFirstWorkspace: (value: boolean) => void;
  setEmptyOttiePlayedFirstChats: (value: boolean) => void;
  reset: () => void;
}

const INITIAL_STATE: OnboardingState = {
  welcomeShown: false,
  welcomeShownAt: null,
  delightFiredFirstAgent: false,
  delightFiredFirstPermission: false,
  delightFiredFirstVoice: false,
  emptyOttiePlayedFirstWorkspace: false,
  emptyOttiePlayedFirstChats: false,
};

export const useOnboardingStateStore = create<OnboardingState & OnboardingActions>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,
      setWelcomeShown: (value) =>
        set({ welcomeShown: value, welcomeShownAt: value ? Date.now() : null }),
      setDelightFiredFirstAgent: (value) => set({ delightFiredFirstAgent: value }),
      setDelightFiredFirstPermission: (value) => set({ delightFiredFirstPermission: value }),
      setDelightFiredFirstVoice: (value) => set({ delightFiredFirstVoice: value }),
      setEmptyOttiePlayedFirstWorkspace: (value) => set({ emptyOttiePlayedFirstWorkspace: value }),
      setEmptyOttiePlayedFirstChats: (value) => set({ emptyOttiePlayedFirstChats: value }),
      reset: () => set({ ...INITIAL_STATE }),
    }),
    {
      name: ONBOARDING_STATE_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      version: ONBOARDING_STORE_VERSION,
    },
  ),
);
