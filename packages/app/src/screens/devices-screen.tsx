import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Plus, Server, Smartphone } from "lucide-react-native";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";
import { Button } from "@/components/ui/button";
import { AddHostModal } from "@/components/add-host-modal";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useHosts, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";

export function DevicesScreen() {
  const hosts = useHosts();
  const { theme } = useUnistyles();

  const [isAddHostOpen, setIsAddHostOpen] = useState(false);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const handleOpenAddHost = useCallback(() => setIsAddHostOpen(true), []);
  const handleCloseAddHost = useCallback(() => setIsAddHostOpen(false), []);
  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  const plusIcon = useMemo(
    () => <Plus size={16} color={theme.colors.foreground} />,
    [theme.colors.foreground],
  );
  const phoneIcon = useMemo(
    () => <Smartphone size={16} color={theme.colors.foreground} />,
    [theme.colors.foreground],
  );

  return (
    <View style={styles.container}>
      <MobileTabHeader title="设备" testID="devices-header" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heading}>
          <Text style={styles.subtitle}>已配对的 daemon 主机</Text>
        </View>

        <View style={styles.list}>
          {hosts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Server size={28} color={theme.colors.foregroundMuted} />
              <Text style={styles.emptyTitle}>还没有设备</Text>
              <Text style={styles.emptyHint}>
                添加一个 Ottie daemon 主机，或者用手机扫码配对一台 Mac。
              </Text>
            </View>
          ) : (
            hosts.map((host) => <DeviceRow key={host.serverId} host={host} />)
          )}
        </View>

        <View style={styles.actions}>
          <Button
            style={styles.actionButton}
            variant="default"
            leftIcon={plusIcon}
            onPress={handleOpenAddHost}
            testID="devices-add-host"
          >
            添加主机
          </Button>
          <Button
            style={styles.actionButton}
            variant="outline"
            leftIcon={phoneIcon}
            onPress={handleOpenPairDevice}
            testID="devices-pair-device"
          >
            扫码配对
          </Button>
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

function DeviceRow({ host }: { host: HostProfile }) {
  const snapshot = useHostRuntimeSnapshot(host.serverId);
  const { theme } = useUnistyles();
  const status = snapshot?.connectionStatus ?? "offline";
  let dotColor: string;
  let statusText: string;
  if (status === "online") {
    dotColor = theme.colors.palette.green[400];
    statusText = "在线";
  } else if (status === "connecting") {
    dotColor = theme.colors.palette.amber[500];
    statusText = "连接中";
  } else {
    dotColor = theme.colors.palette.red[500];
    statusText = "离线";
  }

  const dotStyle = useMemo(() => [styles.statusDot, { backgroundColor: dotColor }], [dotColor]);

  return (
    <Pressable
      style={styles.row}
      accessibilityRole="button"
      testID={`devices-row-${host.serverId}`}
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
    maxWidth: 520,
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  actionButton: {
    flex: 1,
    minWidth: 160,
  },
}));
