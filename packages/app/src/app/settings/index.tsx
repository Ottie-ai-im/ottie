import { Redirect } from "expo-router";
import { useIsCompactFormFactor } from "@/constants/layout";
import SettingsScreen from "@/screens/settings-screen";
import { MobileTabHost } from "@/components/mobile-tab-host";
import { useHosts } from "@/runtime/host-runtime";
import { buildSettingsSectionRoute } from "@/utils/host-routes";

const ROOT_VIEW = { kind: "root" as const };

export default function SettingsIndexRoute() {
  const isCompactLayout = useIsCompactFormFactor();
  const hosts = useHosts();

  if (!isCompactLayout) {
    return <Redirect href={buildSettingsSectionRoute("general")} />;
  }

  // Pick the first connected host for the tab bar's other-tab routes.
  // The settings screen itself doesn't need a serverId on the root view.
  const serverId = hosts[0]?.serverId ?? "";

  return (
    <MobileTabHost serverId={serverId} activeTab="settings">
      <SettingsScreen view={ROOT_VIEW} />
    </MobileTabHost>
  );
}
