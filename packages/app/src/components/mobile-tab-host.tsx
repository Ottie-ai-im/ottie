import { useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { StyleSheet } from "react-native-unistyles";

import { MobileTabBar, type MobileTab } from "@/components/mobile-tab-bar";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  buildHostAssistantsRoute,
  buildHostCommunityRoute,
  buildHostDevicesRoute,
  buildHostSessionsRoute,
  buildHostUsageRoute,
} from "@/utils/host-routes";

export interface MobileTabHostProps {
  serverId: string;
  activeTab: MobileTab;
  children: ReactNode;
}

/**
 * Frame for any route that participates in the mobile bottom-tab UX. Wraps
 * its children with a flex column and pins the tab bar to the bottom.
 *
 * Tab navigation uses `router.replace` so the back button doesn't pile up
 * the tab history — switching tabs feels like switching IM tabs, not a
 * navigation push.
 */
export function MobileTabHost({ serverId, activeTab, children }: MobileTabHostProps) {
  const isCompactLayout = useIsCompactFormFactor();
  const handleSelect = useCallback(
    (tab: MobileTab) => {
      if (tab === activeTab) return;
      switch (tab) {
        case "chats":
          router.replace(buildHostSessionsRoute(serverId));
          return;
        case "devices":
          router.replace(buildHostDevicesRoute(serverId));
          return;
        case "extensions":
          router.replace(buildHostCommunityRoute(serverId));
          return;
        case "assistants":
          router.replace(buildHostAssistantsRoute(serverId));
          return;
        case "usage":
          router.replace(buildHostUsageRoute(serverId));
          return;
        case "settings":
          router.replace("/settings");
          return;
      }
    },
    [activeTab, serverId],
  );

  // On desktop the navigation lives in `DesktopNavRail` at the window edge —
  // skip the bottom bar entirely and just pass children through.
  if (!isCompactLayout) {
    return children;
  }

  return (
    <View style={styles.root}>
      <View style={styles.body}>{children}</View>
      <MobileTabBar activeTab={activeTab} onSelect={handleSelect} />
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
}));
