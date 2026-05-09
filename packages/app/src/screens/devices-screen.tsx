import { type ComponentType, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronRight, PlusCircle, QrCode, Server } from "lucide-react-native";
import { router, type Href } from "expo-router";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";
import { AddHostModal } from "@/components/add-host-modal";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useHosts, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { buildSettingsHostRoute } from "@/utils/host-routes";

export function DevicesScreen() {
  const hosts = useHosts();
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  const [isAddHostOpen, setIsAddHostOpen] = useState(false);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const handleOpenAddHost = useCallback(() => setIsAddHostOpen(true), []);
  const handleCloseAddHost = useCallback(() => setIsAddHostOpen(false), []);
  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  return (
    <View style={styles.container}>
      <MobileTabHeader title={t("devices.title")} testID="devices-header" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heading}>
          <Text style={styles.subtitle}>{t("devices.subtitle")}</Text>
        </View>

        <View style={styles.list}>
          {hosts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Server size={28} color={theme.colors.foregroundMuted} />
              <Text style={styles.emptyTitle}>{t("devices.emptyTitle")}</Text>
              <Text style={styles.emptyHint}>{t("devices.emptyHint")}</Text>
            </View>
          ) : (
            hosts.map((host) => <DeviceRow key={host.serverId} host={host} />)
          )}
        </View>

        <View style={styles.actions}>
          <ActionCard
            icon={PlusCircle}
            title={t("devices.addHost")}
            description={t("devices.addHostHint")}
            onPress={handleOpenAddHost}
            testID="devices-add-host"
            tint="primary"
          />
          <ActionCard
            icon={QrCode}
            title={t("devices.pairDevice")}
            description={t("devices.pairDeviceHint")}
            onPress={handleOpenPairDevice}
            testID="devices-pair-device"
            tint="muted"
          />
        </View>
      </ScrollView>

      <AddHostModal visible={isAddHostOpen} onClose={handleCloseAddHost} />
      <PairDeviceModal
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="devices-pair-device-modal"
      />
    </View>
  );
}

interface ActionCardProps {
  icon: ComponentType<{ size?: number; color?: string }>;
  title: string;
  description: string;
  onPress: () => void;
  testID: string;
  tint: "primary" | "muted";
}

function ActionCard({ icon: Icon, title, description, onPress, testID, tint }: ActionCardProps) {
  const { theme } = useUnistyles();
  const accentBg = tint === "primary" ? theme.colors.accent : theme.colors.surface2;
  const accentFg = tint === "primary" ? theme.colors.accentForeground : theme.colors.foreground;

  const cardStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.actionCard,
      hovered ? styles.actionCardHovered : null,
      pressed ? styles.actionCardPressed : null,
    ],
    [],
  );
  const iconWrapStyle = useMemo(
    () => [styles.actionIconWrap, { backgroundColor: accentBg }],
    [accentBg],
  );

  return (
    <Pressable
      style={cardStyle}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      testID={testID}
    >
      <View style={iconWrapStyle}>
        <Icon size={22} color={accentFg} />
      </View>
      <View style={styles.actionTextWrap}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDescription} numberOfLines={2}>
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

function DeviceRow({ host }: { host: HostProfile }) {
  const snapshot = useHostRuntimeSnapshot(host.serverId);
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const status = snapshot?.connectionStatus ?? "offline";
  let dotColor: string;
  let statusText: string;
  if (status === "online") {
    dotColor = theme.colors.palette.green[400];
    statusText = t("devices.online");
  } else if (status === "connecting") {
    dotColor = theme.colors.palette.amber[500];
    statusText = t("devices.connecting");
  } else {
    dotColor = theme.colors.palette.red[500];
    statusText = t("devices.offline");
  }

  const dotStyle = useMemo(() => [styles.statusDot, { backgroundColor: dotColor }], [dotColor]);

  // Click → host detail page (connections / daemon controls / providers /
  // local services / remove). The detail page lives under the settings
  // route tree but is now reached from devices, not from a duplicated
  // "host list" in the settings sidebar — see settings-screen sidebar
  // change that drops that group.
  const handlePress = useCallback(() => {
    router.push(buildSettingsHostRoute(host.serverId) as Href);
  }, [host.serverId]);

  return (
    <Pressable
      style={styles.row}
      accessibilityRole="button"
      testID={`devices-row-${host.serverId}`}
      onPress={handlePress}
    >
      <View style={dotStyle} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {host.label || host.serverId}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {statusText}
        </Text>
      </View>
      <ChevronRight size={18} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollContent: {
    paddingBottom: theme.spacing[16],
  },
  heading: {
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[1],
  },
  subtitle: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  list: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
    marginBottom: theme.spacing[6],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    letterSpacing: -0.1,
  },
  rowMeta: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  emptyCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  emptyTitle: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
    marginTop: theme.spacing[2],
  },
  emptyHint: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignSelf: "center",
    width: "100%",
    maxWidth: 640,
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  actionCard: {
    flex: 1,
    minWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  actionCardHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  actionCardPressed: {
    opacity: 0.85,
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  actionTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  actionTitle: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
  },
  actionDescription: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: 16,
  },
}));
