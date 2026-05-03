import { createContext, useContext } from "react";

export interface HostRuntimeBootstrapState {
  phase: "starting-daemon" | "connecting" | "online" | "error";
  error: string | null;
  retry: () => void;
}

export const HostRuntimeBootstrapContext = createContext<HostRuntimeBootstrapState>({
  phase: "starting-daemon",
  error: null,
  retry: () => {},
});

export function useStoreReady(): boolean {
  return useContext(HostRuntimeBootstrapContext).phase === "online";
}

export function useHostRuntimeBootstrapState(): HostRuntimeBootstrapState {
  return useContext(HostRuntimeBootstrapContext);
}
