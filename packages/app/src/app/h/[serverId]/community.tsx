import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { MobileTabHost } from "@/components/mobile-tab-host";
import { CommunityScreen } from "@/screens/community-screen";

export default function HostCommunityRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostCommunityRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostCommunityRouteContent() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";

  return (
    <MobileTabHost serverId={serverId} activeTab="community">
      <CommunityScreen />
    </MobileTabHost>
  );
}
