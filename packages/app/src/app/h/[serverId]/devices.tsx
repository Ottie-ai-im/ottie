import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { MobileTabHost } from "@/components/mobile-tab-host";
import { DevicesScreen } from "@/screens/devices-screen";

export default function HostDevicesRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostDevicesRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostDevicesRouteContent() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";

  return (
    <MobileTabHost serverId={serverId} activeTab="devices">
      <DevicesScreen />
    </MobileTabHost>
  );
}
