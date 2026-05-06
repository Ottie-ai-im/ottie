import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "expo-router";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import {
  useHostRuntimeBootstrapState,
  useStoreReady,
} from "@/contexts/host-runtime-bootstrap-context";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostRuntimeClient,
  useHosts,
} from "@/runtime/host-runtime";
import { buildHostRootRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useSessionStore } from "@/stores/session-store";

const WELCOME_ROUTE = "/welcome";
const IDENTITY_SETUP_ROUTE = "/onboarding/identity";

// Phase 1.e — discriminated union for identity-fetch lifecycle. Boot routing
// must wait for the resolution before deciding between onboarding and the
// workspace; without this guard the index would race past identity check and
// land users on the workspace before we know if they need to set a display
// name.
type IdentityFetchState =
  | { phase: "loading" }
  | { phase: "uninitialized" }
  | { phase: "loaded" }
  | { phase: "load-failed" }
  | { phase: "error" };

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
  const identityClient = useHostRuntimeClient(anyOnlineServerId ?? "");
  const [identityFetch, setIdentityFetch] = useState<IdentityFetchState>({ phase: "loading" });

  // Resolve the daemon's identity state once we have a connected client. We
  // deliberately do NOT cache across server-id changes — each daemon owns its
  // own identity, so switching daemons must trigger a re-check.
  useEffect(() => {
    if (!anyOnlineServerId || !identityClient) {
      setIdentityFetch({ phase: "loading" });
      return;
    }
    let cancelled = false;
    setIdentityFetch({ phase: "loading" });
    void (async () => {
      let next: IdentityFetchState;
      try {
        const response = await identityClient.identityGet();
        if (!response.state) {
          next = { phase: "error" };
        } else {
          switch (response.state.kind) {
            case "uninitialized":
              next = { phase: "uninitialized" };
              break;
            case "loaded":
              next = { phase: "loaded" };
              break;
            case "load-failed":
              next = { phase: "load-failed" };
              break;
          }
        }
      } catch {
        next = { phase: "error" };
      }
      if (!cancelled) {
        setIdentityFetch(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [anyOnlineServerId, identityClient]);

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

    // Wait for the identity check before deciding where to route. While this
    // is loading we keep showing the splash; users see a brief flicker rather
    // than a wrong-screen flash.
    if (identityFetch.phase === "loading") {
      return;
    }

    if (identityFetch.phase === "uninitialized") {
      router.replace({
        pathname: IDENTITY_SETUP_ROUTE,
        params: { serverId: anyOnlineServerId },
      });
      return;
    }

    // load-failed and error: fall through to workspace for now. The user can
    // run `ottie identity show` from the CLI to diagnose. A dedicated error
    // screen lives in the Phase 5 polish backlog.

    // WeChat-style: jump straight to the most recently active workspace if we
    // know one. Falls back to the host root (workspace list) when there is no
    // activity history yet — e.g. first launch on a fresh daemon.
    const mostRecentWorkspaceId = pickMostRecentWorkspaceId(anyOnlineServerId);
    const targetRoute = mostRecentWorkspaceId
      ? buildHostWorkspaceRoute(anyOnlineServerId, mostRecentWorkspaceId)
      : buildHostRootRoute(anyOnlineServerId);
    router.replace(targetRoute);
  }, [anyOnlineServerId, identityFetch, pathname, router, storeReady]);

  return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
}
