import { useSyncExternalStore } from "react";
import { Redirect } from "expo-router";
import { WelcomeScreen } from "@/components/welcome-screen";
import { useOnboardingStateStore } from "@/stores/onboarding-state-store";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { buildHostSessionsRoute } from "@/utils/host-routes";

// Per D-21: once the user has either tapped "Skip for power users" or ticked
// "Don't show this again" on the Welcome screen, subsequent cold opens skip
// Welcome entirely. If we have an online host we land on its Chats
// (sessions) tab; otherwise we fall back to the root index, which then
// re-evaluates and either lands on a workspace or sends us back to /welcome
// when no daemon is reachable yet.
function useFirstOnlineServerId(serverIds: string[]): string | null {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
    () => null,
  );
}

export default function WelcomeRoute() {
  const welcomeShown = useOnboardingStateStore((s) => s.welcomeShown);
  const hosts = useHosts();
  const anyOnlineServerId = useFirstOnlineServerId(hosts.map((h) => h.serverId));

  if (welcomeShown && anyOnlineServerId) {
    return <Redirect href={buildHostSessionsRoute(anyOnlineServerId)} />;
  }

  return <WelcomeScreen />;
}
