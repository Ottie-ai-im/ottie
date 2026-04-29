import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Users } from "lucide-react-native";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";

/**
 * Placeholder for the future community surface — connecting to other people's
 * agents. Renders a centered "coming soon" state for now.
 */
export function CommunityScreen() {
  const { theme } = useUnistyles();
  return (
    <View style={styles.container}>
      <MobileTabHeader title={null} testID="community-header" />
      <View style={styles.center}>
        <View style={styles.iconBubble}>
          <Users size={32} color={theme.colors.foregroundMuted} />
        </View>
        <Text style={styles.title}>社群</Text>
        <Text style={styles.subtitle}>Coming soon</Text>
        <Text style={styles.body}>
          这里之后能让你连上别人的 agent，一起协作或借用别人公开出来的工作流。
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[3],
  },
  iconBubble: {
    width: 72,
    height: 72,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    marginBottom: theme.spacing[2],
  },
  title: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accent,
    letterSpacing: -0.1,
  },
  body: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 320,
  },
}));
