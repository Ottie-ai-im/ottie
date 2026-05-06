import { useSyncExternalStore } from "react";
import { Redirect } from "expo-router";
import { WelcomeScreen } from "@/components/welcome-screen";
import { useOnboardingStateStore } from "@/stores/onboarding-state-store";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";

// Per D-21: once the user has either tapped "Skip for power users" or ticked
// "Don't show this again" on the Welcome screen, subsequent cold opens skip
// Welcome entirely. We redirect to "/" (index.tsx) rather than directly to
// the sessions route so app/index.tsx can run its identity check first —
// fresh installs (no root identity yet) need to be funneled through
// /onboarding/identity before reaching the workspace, and only index.tsx
// owns that policy. If identity is already loaded, index.tsx routes onward
// to the most recent workspace exactly as before; the extra hop is a brief
// splash, not a visible bounce.
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
    return <Redirect href="/" />;
  }

  return <WelcomeScreen />;
}
