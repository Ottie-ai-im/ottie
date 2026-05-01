// Small WhatsApp-style "is the daemon online?" indicator. Mirrors the dot
// already used on the Devices screen so users see the same color language
// in two places: the device list AND the active chat. No login flow → the
// only thing that determines whether messages can flow right now is whether
// the local daemon WebSocket is up, so this is the closest thing to a
// presence indicator the app has.
//
//   green  = online    (daemon WS connected, messages flow normally)
//   amber  = connecting (mid-handshake or reconnect)
//   red    = offline    (no daemon — UI falls back to local cache only)
//
// Pure presentation — pulls connection state via the host runtime hook the
// rest of the app already uses. No props beyond the serverId so this can
// be sprinkled anywhere a "is X reachable?" affordance helps.

import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";

export interface DaemonConnectionDotProps {
  serverId: string;
  /** Show a "Online / Connecting / Offline" label next to the dot. */
  showLabel?: boolean;
  /** Override the dot diameter (defaults to 8 — same as Devices screen at 10 minus 2 for inline use). */
  size?: number;
}

export function DaemonConnectionDot({
  serverId,
  showLabel = false,
  size = 8,
}: DaemonConnectionDotProps) {
  const snapshot = useHostRuntimeSnapshot(serverId);
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const status = snapshot?.connectionStatus ?? "offline";

  let dotColor: string;
  let label: string;
  if (status === "online") {
    dotColor = theme.status.online;
    label = t("devices.online");
  } else if (status === "connecting") {
    dotColor = theme.status.connecting;
    label = t("devices.connecting");
  } else {
    dotColor = theme.status.offline;
    label = t("devices.offline");
  }

  const dotStyle = useMemo(
    () => [
      styles.dot,
      {
        backgroundColor: dotColor,
        width: size,
        height: size,
        borderRadius: size / 2,
      },
    ],
    [dotColor, size],
  );

  if (!showLabel) {
    return <View style={dotStyle} accessibilityLabel={label} />;
  }
  return (
    <View style={styles.row} accessibilityLabel={label}>
      <View style={dotStyle} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  dot: {
    flexShrink: 0,
  },
  label: {
    fontFamily: theme.typography.fontFamily.system,
    fontSize: theme.typography.fontSize.xs,
    color: theme.text.muted,
  },
}));
