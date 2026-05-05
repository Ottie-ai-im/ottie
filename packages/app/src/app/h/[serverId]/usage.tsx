import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { MobileTabHost } from "@/components/mobile-tab-host";
import { UsageScreen } from "@/screens/usage-screen";

export default function HostUsageRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostUsageRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostUsageRouteContent() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";

  return (
    <MobileTabHost serverId={serverId} activeTab="usage">
      <UsageScreen />
    </MobileTabHost>
  );
}
