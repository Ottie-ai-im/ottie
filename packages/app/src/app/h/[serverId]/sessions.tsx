import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { MobileTabHost } from "@/components/mobile-tab-host";
import { SessionsScreen } from "@/screens/sessions-screen";
import { useIsCompactFormFactor } from "@/constants/layout";

export default function HostAgentsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostAgentsRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostAgentsRouteContent() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const isCompactLayout = useIsCompactFormFactor();

  if (!isCompactLayout) {
    return <SessionsScreen serverId={serverId} />;
  }

  return (
    <MobileTabHost serverId={serverId} activeTab="chats">
      <SessionsScreen serverId={serverId} />
    </MobileTabHost>
  );
}
