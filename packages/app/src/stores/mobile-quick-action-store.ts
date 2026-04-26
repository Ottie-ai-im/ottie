// Mobile-only bridge: composer's "+" menu posts an action request here, and
// the workspace screen catches it on the next render and routes it to the
// appropriate existing modal/sheet/store. This avoids re-implementing the
// model picker, branch switcher, etc inside the composer — we just trigger
// the same components that already power the desktop UI.
//
// Desktop never reads this store; it's a no-op there.

import { create } from "zustand";

export type MobileQuickAction =
  | { kind: "openModelPicker"; serverId: string; agentId: string }
  | { kind: "openBranchSwitcher"; serverId: string; cwd: string }
  | { kind: "openWorkspaceSettings"; serverId: string; cwd: string };

interface MobileQuickActionState {
  pending: MobileQuickAction | null;
  request: (action: MobileQuickAction) => void;
  clear: () => void;
}

export const useMobileQuickActionStore = create<MobileQuickActionState>((set) => ({
  pending: null,
  request: (action) => set({ pending: action }),
  clear: () => set({ pending: null }),
}));
