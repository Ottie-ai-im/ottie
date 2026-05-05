import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { MobileTabHost } from "@/components/mobile-tab-host";
import { AssistantsScreen } from "@/screens/assistants-screen";

export default function HostAssistantsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostAssistantsRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostAssistantsRouteContent() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";

  return (
    <MobileTabHost serverId={serverId} activeTab="assistants">
      <AssistantsScreen />
    </MobileTabHost>
  );
}
