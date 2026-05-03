import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "expo-router";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import {
  useHostRuntimeBootstrapState,
  useStoreReady,
} from "@/contexts/host-runtime-bootstrap-context";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { buildHostRootRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useSessionStore } from "@/stores/session-store";

const WELCOME_ROUTE = "/welcome";

function useAnyOnlineHostServerId(serverIds: string[]): string | null {
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

const isDesktop = shouldUseDesktopDaemon();

function pickMostRecentWorkspaceId(serverId: string): string | null {
  const session = useSessionStore.getState().sessions[serverId];
  if (!session || session.workspaces.size === 0) return null;
  let bestId: string | null = null;
  let bestAt: string | null = null;
  for (const [id, workspace] of session.workspaces) {
    const at = workspace.activityAt ?? null;
    if (!at) continue;
    if (bestAt === null || at > bestAt) {
      bestAt = at;
      bestId = id;
    }
  }
  return bestId;
}

export default function Index() {
  const router = useRouter();
  const pathname = usePathname();
  const bootstrapState = useHostRuntimeBootstrapState();
  const storeReady = useStoreReady();
  const hosts = useHosts();
  const anyOnlineServerId = useAnyOnlineHostServerId(hosts.map((host) => host.serverId));

  useEffect(() => {
    if (!storeReady) {
      return;
    }
    if (pathname !== "/" && pathname !== "") {
      return;
    }

    if (!anyOnlineServerId) {
      router.replace(WELCOME_ROUTE);
      return;
    }

    // WeChat-style: jump straight to the most recently active workspace if we
    // know one. Falls back to the host root (workspace list) when there is no
    // activity history yet — e.g. first launch on a fresh daemon.
    const mostRecentWorkspaceId = pickMostRecentWorkspaceId(anyOnlineServerId);
    const targetRoute = mostRecentWorkspaceId
      ? buildHostWorkspaceRoute(anyOnlineServerId, mostRecentWorkspaceId)
      : buildHostRootRoute(anyOnlineServerId);
    router.replace(targetRoute);
  }, [anyOnlineServerId, pathname, router, storeReady]);

  return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
}
